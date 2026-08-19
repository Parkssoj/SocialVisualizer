# src/util/database/chatroom_db_writer.py
# db_writer.py의 메신저(카카오톡) 버전. chatroom/chatroom_people/message_block/participant/message_keyword/message_summarize 테이블에 데이터 저장
# get_db_connection/get_or_create_user_id/collect_indexing_stats는 도메인 독립적이라 db_writer.py 것을 그대로 재사용

import os
import json
import datetime
from config.db import get_db_connection
from util.database.db_writer import get_or_create_user_id, collect_indexing_stats

def _normalize_datetime(value):
    # chatroom.index_date는 DATETIME(초 단위, 마이크로초 없음) 컬럼이므로 형태 통일 목적
    if isinstance(value, datetime.datetime):
        return value.replace(microsecond=0)
    return value

def init_chatroom_tables():
    """서버 시작 시 chatroom 관련 6개 테이블이 없으면 자동 생성 (sql/message_schema.sql과 동일한 구조)"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chatroom (
                chatroom_id CHAR(40) NOT NULL,
                index_date DATETIME NOT NULL,
                user_id CHAR(36) NOT NULL,
                chatroom_name VARCHAR(255) NOT NULL,
                message_platform VARCHAR(50),
                message_count INT,
                index_time VARCHAR(50),
                llm_model VARCHAR(100),
                embed_model VARCHAR(100),
                llm_calls INT,
                input_tokens INT,
                output_tokens INT,
                embed_calls INT,
                embed_tokens INT,
                total_tokens INT,
                cost_usd DECIMAL(12,6),
                node_count INT,
                edge_count INT,
                PRIMARY KEY (chatroom_id, index_date, user_id),
                FOREIGN KEY (user_id) REFERENCES `user`(user_id)
            ) ENGINE=InnoDB
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chatroom_people (
                participant_id VARCHAR(255) NOT NULL,
                chatroom_id CHAR(40) NOT NULL,
                index_date DATETIME NOT NULL,
                user_id CHAR(36) NOT NULL,
                chatroom_people_name VARCHAR(255),
                message_count INT,
                description TEXT,
                PRIMARY KEY (participant_id, chatroom_id, index_date, user_id),
                FOREIGN KEY (chatroom_id, index_date, user_id)
                    REFERENCES chatroom(chatroom_id, index_date, user_id)
            ) ENGINE=InnoDB
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS message_block (
                block_id VARCHAR(255) NOT NULL,
                chatroom_id CHAR(40) NOT NULL,
                index_date DATETIME NOT NULL,
                user_id CHAR(36) NOT NULL,
                block_date DATE,
                message_count INT,
                participant_count INT,
                kg_tone VARCHAR(20),
                llm_tone VARCHAR(20),
                participant JSON,
                PRIMARY KEY (block_id, chatroom_id, index_date, user_id),
                FOREIGN KEY (chatroom_id, index_date, user_id)
                    REFERENCES chatroom(chatroom_id, index_date, user_id)
            ) ENGINE=InnoDB
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS participant (
                participant_name VARCHAR(255) NOT NULL,
                block_id VARCHAR(255) NOT NULL,
                chatroom_id CHAR(40) NOT NULL,
                index_date DATETIME NOT NULL,
                user_id CHAR(36) NOT NULL,
                sent_message INT,
                PRIMARY KEY (participant_name, block_id, chatroom_id, index_date, user_id),
                FOREIGN KEY (block_id, chatroom_id, index_date, user_id)
                    REFERENCES message_block(block_id, chatroom_id, index_date, user_id)
            ) ENGINE=InnoDB
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS message_keyword (
                keyword_name VARCHAR(100) NOT NULL,
                participant_name VARCHAR(255) NOT NULL,
                block_id VARCHAR(255) NOT NULL,
                chatroom_id CHAR(40) NOT NULL,
                index_date DATETIME NOT NULL,
                user_id CHAR(36) NOT NULL,
                mention_count INT,
                PRIMARY KEY (keyword_name, participant_name, block_id, chatroom_id, index_date, user_id),
                FOREIGN KEY (participant_name, block_id, chatroom_id, index_date, user_id)
                    REFERENCES participant(participant_name, block_id, chatroom_id, index_date, user_id)
            ) ENGINE=InnoDB
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS message_summarize (
                summarize_unit VARCHAR(20) NOT NULL,
                summary_period VARCHAR(20) NOT NULL,
                chatroom_id CHAR(40) NOT NULL,
                index_date DATETIME NOT NULL,
                user_id CHAR(36) NOT NULL,
                summarized_context TEXT,
                contacts JSON,
                PRIMARY KEY (summarize_unit, summary_period, chatroom_id, index_date, user_id),
                FOREIGN KEY (chatroom_id, index_date, user_id)
                    REFERENCES chatroom(chatroom_id, index_date, user_id)
            ) ENGINE=InnoDB
        """)

        conn.commit()
        cursor.close()
        conn.close()
        print("[DB] chatroom 관련 테이블 준비 완료")
    except Exception as e:
        print(f"[DB] chatroom 테이블 초기화 실패 (무시): {e}")


def get_latest_chatroom(chatroom_id: str):
    # chatroom 테이블에서 해당 chatroom_id의 가장 최근 레코드 반환
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT chatroom_id, index_date, user_id
            FROM chatroom
            WHERE chatroom_id = %s
            ORDER BY index_date DESC
            LIMIT 1
            """,
            (chatroom_id,),
        )
        return cursor.fetchone()
    except Exception as e:
        print(f"[ERROR] get_latest_chatroom 실패: {e}")
        raise
    finally:
        cursor.close()
        conn.close()


def _resolve_chatroom_key(chatroom_id: str, update_date=None):
    # chatroom 레코드의 (chatroom_id, index_date, user_id)를 반환. 아직 chatroom 레코드가 없고 update_date도 없으면 None.
    update_date = _normalize_datetime(update_date)

    latest = get_latest_chatroom(chatroom_id)
    if update_date is None:
        if not latest:
            return None
        return chatroom_id, latest["index_date"], latest["user_id"]
    user_id = latest["user_id"] if latest else get_or_create_user_id(chatroom_id)
    return chatroom_id, update_date, user_id


def create_chatroom(chatroom_id, chatroom_name, ended_at, index_time, message_count, message_platform):
    # chatroom 테이블에 인덱싱 결과 레코드 생성 (user_id 없으면 신규 발급)
    user_id = get_or_create_user_id(chatroom_id)
    ended_at = _normalize_datetime(ended_at)

    conn = get_db_connection()
    cursor = conn.cursor()

    sql = """
    INSERT INTO chatroom (
        chatroom_id, index_date, user_id, chatroom_name, message_platform,
        message_count, index_time, llm_model, embed_model
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """

    cursor.execute(sql, (
        chatroom_id,
        ended_at,
        user_id,
        chatroom_name,
        message_platform,
        message_count,
        str(index_time),
        "",
        "",
    ))

    conn.commit()
    cursor.close()
    conn.close()
    return user_id


def update_chatroom_indexing_stats(chatroom_id: str, index_date, stats: dict):
    # chatroom 테이블의 인덱싱 컬럼 업데이트
    key = _resolve_chatroom_key(chatroom_id, index_date)
    if key is None:
        print(f"[WARN] update_chatroom_indexing_stats: chatroom 없음 {chatroom_id}")
        return
    chatroom_id, index_date, user_id = key

    total_tokens = stats["input_tokens"] + stats["output_tokens"] + stats["embed_tokens"]

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE chatroom SET
                llm_calls     = %s,
                input_tokens  = %s,
                output_tokens = %s,
                llm_model     = %s,
                embed_calls   = %s,
                embed_tokens  = %s,
                embed_model   = %s,
                total_tokens  = %s,
                cost_usd      = %s
            WHERE chatroom_id = %s AND index_date = %s AND user_id = %s
            """,
            (
                stats["llm_calls"],
                stats["input_tokens"],
                stats["output_tokens"],
                stats["llm_model"],
                stats["embed_calls"],
                stats["embed_tokens"],
                stats["embed_model"],
                total_tokens,
                stats["cost_usd"],
                chatroom_id,
                index_date,
                user_id,
            ),
        )
        conn.commit()
        print(f"[DB] chatroom 인덱싱 통계 저장 완료: {chatroom_id} cost=${stats['cost_usd']:.6f}")
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] update_chatroom_indexing_stats 실패: {e}")
        raise
    finally:
        cursor.close()
        conn.close()


def save_chatroom_graph_stats_to_db(paths, update_date=None):
    # graph_data.json을 읽어 노드/엣지 수를 chatroom 테이블에 저장
    if not os.path.exists(paths.GRAPH_JSON_PATH):
        print(f"[WARN] 그래프 JSON 파일이 없습니다: {paths.GRAPH_JSON_PATH}")
        return

    key = _resolve_chatroom_key(paths.USER_ID, update_date)
    if key is None:
        print(f"[WARN] chatroom 테이블에 해당 채팅방이 없습니다: {paths.USER_ID}")
        return
    chatroom_id, update_date, user_id = key

    with open(paths.GRAPH_JSON_PATH, "r", encoding="utf-8") as f:
        graph_data = json.load(f)

    node_count = len(graph_data.get("nodes", []))
    edge_count = len(graph_data.get("edges", []))

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE chatroom SET
                node_count = %s,
                edge_count = %s
            WHERE chatroom_id = %s AND index_date = %s AND user_id = %s
            """,
            (node_count, edge_count, chatroom_id, update_date, user_id),
        )
        conn.commit()
        print(f"[DB] chatroom 그래프 통계 저장 완료: node={node_count} edge={edge_count}")
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] save_chatroom_graph_stats_to_db 실패: {e}")
        raise
    finally:
        cursor.close()
        conn.close()


def save_message_block_to_db(paths, update_date=None):
    # text_units.parquet에서 대화 블록을 파싱해 message_block + participant 테이블에 저장
    from util.message_statics import _parse_message_blocks_from_parquet, _classify_message_tone_with_llm

    key = _resolve_chatroom_key(paths.USER_ID, update_date)
    if key is None:
        print(f"[WARN] chatroom 테이블에 해당 채팅방이 없습니다: {paths.USER_ID}")
        return
    chatroom_id, update_date, user_id = key

    blocks = _parse_message_blocks_from_parquet(paths)
    if not blocks:
        print("[DB] 저장할 메시지 블록 없음")
        return

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        block_sql = """
            INSERT INTO message_block (
                block_id, chatroom_id, index_date, user_id, block_date,
                message_count, participant_count, kg_tone, llm_tone, participant
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                block_date = VALUES(block_date),
                message_count = VALUES(message_count),
                participant_count = VALUES(participant_count),
                kg_tone = VALUES(kg_tone),
                llm_tone = VALUES(llm_tone),
                participant = VALUES(participant)
        """
        participant_sql = """
            INSERT INTO participant (
                participant_name, block_id, chatroom_id, index_date, user_id, sent_message
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE sent_message = VALUES(sent_message)
        """

        block_count = 0
        participant_row_count = 0
        for block in blocks:
            real_messages = [m for m in block["messages"] if not m["is_system"] and m["sender"]]

            sent_by: dict[str, int] = {}
            for m in real_messages:
                sent_by[m["sender"]] = sent_by.get(m["sender"], 0) + 1

            # 참여자 헤더(참여자:)가 비어있으면(예: 파싱 실패) 실제 발신자 집합으로 대체
            participants = block["participants"] or list(sent_by.keys())

            body_text = "\n".join(f"{m['time']} {m['sender']}: {m['text']}" for m in real_messages)
            llm_tone = _classify_message_tone_with_llm(body_text)

            cursor.execute(block_sql, (
                block["block_id"], chatroom_id, update_date, user_id, block["block_date"],
                len(real_messages), len(participants), None, llm_tone,
                json.dumps(participants, ensure_ascii=False),
            ))
            block_count += 1

            for name, count in sent_by.items():
                cursor.execute(participant_sql, (
                    name, block["block_id"], chatroom_id, update_date, user_id, count,
                ))
                participant_row_count += 1

        conn.commit()
        print(f"[DB] message_block 저장 완료: {block_count}건 / participant {participant_row_count}건")
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] save_message_block_to_db 실패: {e}")
        raise
    finally:
        cursor.close()
        conn.close()


def save_chatroom_people_to_db(paths, update_date=None):
    # chatroom_people_messages.json 기반 메시지 수 + LLM 프로필(description)을 chatroom_people에 저장
    from util.message_statics import generate_chatroom_people_descriptions

    key = _resolve_chatroom_key(paths.USER_ID, update_date)
    if key is None:
        print(f"[WARN] chatroom 테이블에 해당 채팅방이 없습니다: {paths.USER_ID}")
        return
    chatroom_id, update_date, user_id = key

    if not os.path.exists(paths.CHATROOM_PEOPLE_MESSAGES_PATH):
        raise FileNotFoundError(f"참여자 메시지 이력 파일이 없습니다: {paths.CHATROOM_PEOPLE_MESSAGES_PATH}")

    with open(paths.CHATROOM_PEOPLE_MESSAGES_PATH, "r", encoding="utf-8") as f:
        people = json.load(f).get("people", {})

    try:
        descriptions = generate_chatroom_people_descriptions(paths)
    except Exception as e:
        print(f"[WARN] 참여자 프로필 생성 실패, description 없이 저장: {e}")
        descriptions = {}

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        insert_sql = """
            INSERT INTO chatroom_people (
                participant_id, chatroom_id, index_date, user_id,
                chatroom_people_name, message_count, description
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                chatroom_people_name = VALUES(chatroom_people_name),
                message_count        = VALUES(message_count),
                description          = COALESCE(VALUES(description), description)
        """
        count = 0
        for name, messages in people.items():
            cursor.execute(insert_sql, (
                name, chatroom_id, update_date, user_id,
                name, len(messages), descriptions.get(name),
            ))
            count += 1

        conn.commit()
        print(f"[DB] chatroom_people 테이블 저장 완료: {count}건")
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] save_chatroom_people_to_db 실패: {e}")
        raise
    finally:
        cursor.close()
        conn.close()


def save_message_keyword_to_db(paths, update_date=None):
    # message_keyword_stats.json을 읽어 participant에 실제 존재하는 (참여자, 블록) 쌍만 message_keyword에 저장
    key = _resolve_chatroom_key(paths.USER_ID, update_date)
    if key is None:
        print(f"[WARN] chatroom 테이블에 해당 채팅방이 없습니다: {paths.USER_ID}")
        return
    chatroom_id, update_date, user_id = key

    if not os.path.exists(paths.MESSAGE_KEYWORDS_PATH):
        raise FileNotFoundError(f"통계 파일이 없습니다: {paths.MESSAGE_KEYWORDS_PATH}")

    with open(paths.MESSAGE_KEYWORDS_PATH, "r", encoding="utf-8") as f:
        stats = json.load(f)

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        keywords = stats.get("keywords", {})
        mention_map = stats.get("keyword_participant_block_map", {})

        cursor.execute(
            "SELECT participant_name, block_id FROM participant WHERE chatroom_id = %s AND index_date = %s AND user_id = %s",
            (chatroom_id, update_date, user_id),
        )
        valid_pairs = {(row[0], row[1]) for row in cursor.fetchall()}

        insert_sql = """
            INSERT INTO message_keyword (
                keyword_name, participant_name, block_id, chatroom_id, index_date, user_id, mention_count
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE mention_count = VALUES(mention_count)
        """
        rows = []
        for keyword_name, participant_map in mention_map.items():
            if keywords.get(keyword_name, 0) < 2:
                continue
            for participant_name, block_map in participant_map.items():
                for block_id, count in block_map.items():
                    if (participant_name, block_id) not in valid_pairs:
                        continue
                    rows.append((keyword_name, participant_name, block_id, chatroom_id, update_date, user_id, count))

        if rows:
            cursor.executemany(insert_sql, rows)
            conn.commit()
            print(f"[DB] message_keyword 테이블 저장 완료: {len(rows)}건")

    except Exception as e:
        conn.rollback()
        print(f"[ERROR] save_message_keyword_to_db 실패: {e}")
        raise
    finally:
        cursor.close()
        conn.close()


def save_message_summarize_to_db(paths, update_date=None):
    # message_summaries.json(연/월별 LLM 요약)을 message_summarize 테이블에 저장
    key = _resolve_chatroom_key(paths.USER_ID, update_date)
    if key is None:
        print(f"[WARN] chatroom 테이블에 해당 채팅방이 없습니다: {paths.USER_ID}")
        return
    chatroom_id, update_date, user_id = key

    if not os.path.exists(paths.MESSAGE_SUMMARIES_PATH):
        print(f"[WARN] 파일이 없습니다: {paths.MESSAGE_SUMMARIES_PATH}")
        return

    with open(paths.MESSAGE_SUMMARIES_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    rows = []
    for period, info in data.get("yearly", {}).items():
        rows.append((
            "yearly", period, chatroom_id, update_date, user_id,
            info.get("summary"),
            json.dumps(info.get("contacts"), ensure_ascii=False) if info.get("contacts") else None,
        ))
    for period, info in data.get("monthly", {}).items():
        rows.append((
            "monthly", period, chatroom_id, update_date, user_id,
            info.get("summary"),
            json.dumps(info.get("contacts"), ensure_ascii=False) if info.get("contacts") else None,
        ))

    if not rows:
        print("[WARN] save_message_summarize_to_db: 저장할 데이터가 없습니다.")
        return

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        insert_sql = """
            INSERT INTO message_summarize (
                summarize_unit, summary_period, chatroom_id, index_date, user_id,
                summarized_context, contacts
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                summarized_context = VALUES(summarized_context),
                contacts = VALUES(contacts)
        """
        cursor.executemany(insert_sql, rows)
        conn.commit()
        print(f"[DB] message_summarize 테이블 저장 완료: {len(rows)}건")
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] save_message_summarize_to_db 실패: {e}")
        raise
    finally:
        cursor.close()
        conn.close()


def save_message_mood_to_db(paths, update_date=None):
    # message_mood.json(연/월별 분위기 점수+설명)을 message_mood 테이블에 저장
    key = _resolve_chatroom_key(paths.USER_ID, update_date)
    if key is None:
        print(f"[WARN] chatroom 테이블에 해당 채팅방이 없습니다: {paths.USER_ID}")
        return
    chatroom_id, update_date, user_id = key

    if not os.path.exists(paths.MESSAGE_MOOD_PATH):
        print(f"[WARN] 파일이 없습니다: {paths.MESSAGE_MOOD_PATH}")
        return

    with open(paths.MESSAGE_MOOD_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    rows = []
    for period, info in data.get("yearly", {}).items():
        rows.append((
            period, "yearly", chatroom_id, update_date, user_id,
            info.get("mood_description"),
            info.get("mood_score"),
        ))
    for period, info in data.get("monthly", {}).items():
        rows.append((
            period, "monthly", chatroom_id, update_date, user_id,
            info.get("mood_description"),
            info.get("mood_score"),
        ))

    if not rows:
        print("[WARN] save_message_mood_to_db: 저장할 데이터가 없습니다.")
        return

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        insert_sql = """
            INSERT INTO message_mood (
                summary_period, summary_unit, chatroom_id, index_date, user_id,
                mood_description, mood_score
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                mood_description = VALUES(mood_description),
                mood_score = VALUES(mood_score)
        """
        cursor.executemany(insert_sql, rows)
        conn.commit()
        print(f"[DB] message_mood 테이블 저장 완료: {len(rows)}건")
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] save_message_mood_to_db 실패: {e}")
        raise
    finally:
        cursor.close()
        conn.close()
