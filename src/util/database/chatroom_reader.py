# src/util/database/chatroom_reader.py
# db_reader.py의 메신저(카카오톡) 버전. chatroom/chatroom_people/message_block/participant
# 테이블과 GraphRAG graph_data.json을 읽어 "My People" 통계(기간별 메시지 수, 사람 간 관계,
# 참여자 상세)를 만든다. 쓰기는 chatroom_db_writer.py가 담당.

import json
import os
from config.db import get_db_connection
from util.database.chatroom_db_writer import get_latest_chatroom


def get_chatroom_people(chatroom_id: str):
    """chatroom_id의 참여자 전체 목록을 기간과 무관하게 반환(chatroom_people 테이블 그대로 —
    message_count도 전체 히스토리 누적값). chatroom_id가 인덱싱된 적 없으면 None."""
    latest = get_latest_chatroom(chatroom_id)
    if not latest:
        return None
    index_date, user_id = latest["index_date"], latest["user_id"]

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT participant_id, chatroom_people_name AS name, message_count, description
            FROM chatroom_people
            WHERE chatroom_id = %s AND index_date = %s AND user_id = %s
            ORDER BY message_count DESC
            """,
            (chatroom_id, index_date, user_id),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()
        conn.close()

    return [
        {
            "participant_id": row["participant_id"],
            "name": row["name"],
            "message_count": int(row["message_count"] or 0),
            "description": row["description"],
        }
        for row in rows
    ]


def get_chatroom_people_stats(chatroom_id: str, start_date: str, end_date: str):
    """chatroom_id의 참여자별로 start_date~end_date 기간에 보낸 메시지 수 + 프로필 설명을 반환.
    chatroom_id가 인덱싱된 적 없으면 None."""
    latest = get_latest_chatroom(chatroom_id)
    if not latest:
        return None
    index_date, user_id = latest["index_date"], latest["user_id"]

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT p.participant_name AS name,
                   SUM(p.sent_message) AS message_count,
                   MAX(cp.description) AS description
            FROM participant p
            JOIN message_block b
              ON p.block_id = b.block_id AND p.chatroom_id = b.chatroom_id
             AND p.index_date = b.index_date AND p.user_id = b.user_id
            LEFT JOIN chatroom_people cp
              ON cp.participant_id = p.participant_name AND cp.chatroom_id = p.chatroom_id
             AND cp.index_date = p.index_date AND cp.user_id = p.user_id
            WHERE p.chatroom_id = %s AND p.index_date = %s AND p.user_id = %s
              AND b.block_date BETWEEN %s AND %s
            GROUP BY p.participant_name
            ORDER BY message_count DESC
            """,
            (chatroom_id, index_date, user_id, start_date, end_date),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()
        conn.close()

    return [
        {
            "participant_id": row["name"],
            "name": row["name"],
            "message_count": int(row["message_count"] or 0),
            "description": row["description"],
        }
        for row in rows
    ]


def get_chatroom_relationships(paths, active_names: set) -> list:
    """GraphRAG graph_data.json의 사람-사람 interacts_with 엣지 중 양쪽 다 active_names에
    속한 것만 반환. graph_data.json이 없으면 빈 리스트.

    GraphRAG가 같은 두 사람에 대해 날짜별로 서로 다른 방향(A→B, B→A)의 interacts_with 엣지를
    각각 뽑아내고 완전히 병합하지 않는 경우가 있어서, 같은 두 사람 쌍은 무방향으로 취급해
    strength(weight)가 가장 높은 엣지 하나만 남긴다."""
    if not os.path.exists(paths.GRAPH_JSON_PATH):
        return []

    with open(paths.GRAPH_JSON_PATH, "r", encoding="utf-8") as f:
        graph_data = json.load(f)

    merged: dict = {}
    for edge in graph_data.get("edges", []):
        relation_label = edge.get("relation_label")
        if not relation_label:
            continue
        source, target = edge.get("source"), edge.get("target")
        if source not in active_names or target not in active_names:
            continue

        pair_key = tuple(sorted((source, target)))
        candidate = {
            "source": source,
            "target": target,
            "relation_label": relation_label,
            "description": edge.get("description"),
            "strength": edge.get("weight"),
        }
        existing = merged.get(pair_key)
        if existing is None or (candidate["strength"] or 0) > (existing["strength"] or 0):
            merged[pair_key] = candidate

    return list(merged.values())


def get_chatroom_person_detail(chatroom_id: str, start_date: str, end_date: str, participant_id: str = None):
    """chatroom_id의 참여자 명단(participant_id를 주면 그 사람만)에 대해 프로필 설명 +
    start_date~end_date 기간 메시지 수를 반환. 그 기간에 메시지가 0개인 참여자도 message_count: 0
    으로 명단에서 빠지지 않고 나온다. 방이 없거나, participant_id를 줬는데 그 참여자가 없으면 None."""
    latest = get_latest_chatroom(chatroom_id)
    if not latest:
        return None
    index_date, user_id = latest["index_date"], latest["user_id"]

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        sql = """
            SELECT participant_id, chatroom_people_name AS name, description
            FROM chatroom_people
            WHERE chatroom_id = %s AND index_date = %s AND user_id = %s
        """
        params = [chatroom_id, index_date, user_id]
        if participant_id:
            sql += " AND participant_id = %s"
            params.append(participant_id)
        cursor.execute(sql, params)
        roster = cursor.fetchall()
    finally:
        cursor.close()
        conn.close()

    if not roster:
        return None

    # 기간 내 메시지 수: get_chatroom_people_stats는 그 기간에 실제로 메시지를 보낸 사람만
    # 담고 있으므로, 명단에는 있지만 이 딕셔너리에 없는 사람은 기간 내 메시지가 0개인 것이다.
    period_counts = {
        row["name"]: row["message_count"]
        for row in (get_chatroom_people_stats(chatroom_id, start_date, end_date) or [])
    }

    return [
        {
            "participant_id": row["participant_id"],
            "name": row["name"],
            "message_count": period_counts.get(row["name"], 0),
            "description": row["description"],
        }
        for row in roster
    ]


def get_chatroom_mood(chatroom_id: str, start_date: str, end_date: str):
    """chatroom_id의 start_date~end_date 기간에 걸치는 월별/연별 분위기 점수+설명을 반환.
    message_mood.generate_message_mood()가 저장한 message_mood 테이블을 읽는다.
    chatroom_id가 인덱싱된 적 없으면 None."""

    latest = get_latest_chatroom(chatroom_id)
    if not latest:
        return None
    index_date, user_id = latest["index_date"], latest["user_id"]
    month_start, month_end = start_date[:7], end_date[:7]
    year_start, year_end = start_date[:4], end_date[:4]

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT summary_period, summary_unit, mood_score, mood_description
            FROM message_mood
            WHERE chatroom_id = %s AND index_date = %s AND user_id = %s
                AND (
                    (summary_unit = 'monthly' AND summary_period BETWEEN %s AND %s)
                OR (summary_unit = 'yearly'  AND summary_period BETWEEN %s AND %s)
                )
            ORDER BY summary_unit, summary_period
            """,
            (chatroom_id, index_date, user_id, month_start, month_end, year_start, year_end),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()
        conn.close()

    monthly, yearly = [], []
    for row in rows:
        entry = {
            "period": row["summary_period"],
            "mood_score": float(row["mood_score"]) if row["mood_score"] is not None else None,
            "mood_description": row["mood_description"],
        }
        (monthly if row["summary_unit"] == "monthly" else yearly).append(entry)

    return {"monthly": monthly, "yearly": yearly}


def get_chatroom_keywords_by_person(chatroom_id: str, start_date: str, end_date: str, participant_id: str):
    """chatroom_id의 participant_id가 start_date~end_date 기간에 사용한 키워드별 언급 횟수를
    반환. chatroom_id가 인덱싱된 적 없으면 None. participant_id가 그 채팅방 명단에 없으면 False.
    참여자는 있지만 그 기간에 키워드가 없으면 빈 리스트."""
    latest = get_latest_chatroom(chatroom_id)
    if not latest:
        return None
    index_date, user_id = latest["index_date"], latest["user_id"]
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT 1 FROM chatroom_people
            WHERE chatroom_id = %s AND index_date = %s AND user_id = %s AND participant_id = %s
            """,
            (chatroom_id, index_date, user_id, participant_id),
        )
        if cursor.fetchone() is None:
            return False

        cursor.execute(
            """
            SELECT k.keyword_name AS word, SUM(k.mention_count) AS count
            FROM message_keyword k
            JOIN message_block b
              ON k.block_id = b.block_id AND k.chatroom_id = b.chatroom_id
             AND k.index_date = b.index_date AND k.user_id = b.user_id
            WHERE k.chatroom_id = %s AND k.index_date = %s AND k.user_id = %s
              AND k.participant_name = %s
              AND b.block_date BETWEEN %s AND %s
            GROUP BY k.keyword_name
            ORDER BY count DESC
            """,
            (chatroom_id, index_date, user_id, participant_id, start_date, end_date),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()
        conn.close()

    return [{"word": row["word"], "count": int(row["count"] or 0)} for row in rows]


def get_chatroom_summaries(chatroom_id: str, summarize_unit: str):
    """chatroom_id의 summarize_unit("monthly"/"yearly") 단위 LLM 요약을 summary_period
    오름차순으로 반환. chatroom_id가 인덱싱된 적 없으면 None. 요약이 아직 생성되지 않았으면
    빈 리스트."""
    latest = get_latest_chatroom(chatroom_id)
    if not latest:
        return None
    index_date, user_id = latest["index_date"], latest["user_id"]

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT summary_period, summarized_context, contacts
            FROM message_summarize
            WHERE chatroom_id = %s AND index_date = %s AND user_id = %s
              AND summarize_unit = %s
            ORDER BY summary_period
            """,
            (chatroom_id, index_date, user_id, summarize_unit),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()
        conn.close()

    result = []
    for row in rows:
        contacts = row["contacts"]
        if contacts:
            contacts = json.loads(contacts) if isinstance(contacts, str) else contacts
        else:
            contacts = []
        result.append({
            "summary_period": row["summary_period"],
            "summarized_context": row["summarized_context"],
            "contacts": contacts,
        })
    return result
