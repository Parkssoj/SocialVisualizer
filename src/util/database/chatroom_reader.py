# src/util/database/chatroom_reader.py
# db_reader.py의 메신저(카카오톡) 버전. chatroom/chatroom_people/message_block/participant
# 테이블과 GraphRAG graph_data.json을 읽어 "My People" 통계(기간별 메시지 수, 사람 간 관계,
# 참여자 상세)를 만든다. 쓰기는 chatroom_db_writer.py가 담당.

import calendar
import json
import os
from config.db import get_db_connection
from util.database.chatroom_db_writer import get_latest_chatroom
from util.user_path import list_accounts, UserPaths


def list_indexed_chatrooms(base_dir: str, start_date: str = None, end_date: str = None):
    """인덱싱된 messenger 계정(msg_xxx = 단톡방 1개)마다 방 이름·메시지 수·참여자 수·전체
    참여자 이름(메시지 많은 순, 카드 아바타를 참여자 수만큼 분할한 이니셜로 채우는 용도)을
    모아 반환. 메신저 탭의 "단톡방 목록" 화면에서 사용 (아직 인덱싱 중/DB에 chatroom
    레코드가 없는 계정은 목록에서 제외).

    start_date/end_date를 주면(타임슬라이더로 기간이 선택된 경우) 전체 기간 대신 그 기간의
    message_block/participant 집계로 message_count/participant_count/top_participants를
    계산하고, 그 기간에 메시지가 하나도 없는 방은 목록에서 아예 제외한다."""
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        rooms = []
        for acc in list_accounts(base_dir, "messenger"):
            if not acc["indexed"]:
                continue
            chatroom_id = acc["user_id"]
            latest = get_latest_chatroom(chatroom_id)
            if not latest:
                continue
            index_date, user_id = latest["index_date"], latest["user_id"]

            cursor.execute(
                """
                SELECT chatroom_name FROM chatroom
                WHERE chatroom_id = %s AND index_date = %s AND user_id = %s
                """,
                (chatroom_id, index_date, user_id),
            )
            meta = cursor.fetchone()
            if not meta:
                continue

            if start_date and end_date:
                cursor.execute(
                    """
                    SELECT SUM(message_count) AS message_count
                    FROM message_block
                    WHERE chatroom_id = %s AND index_date = %s AND user_id = %s
                      AND block_date BETWEEN %s AND %s
                    """,
                    (chatroom_id, index_date, user_id, start_date, end_date),
                )
                message_count = int((cursor.fetchone() or {}).get("message_count") or 0)
                if message_count == 0:
                    continue

                cursor.execute(
                    """
                    SELECT p.participant_name AS name, SUM(p.sent_message) AS cnt
                    FROM participant p
                    JOIN message_block b
                      ON p.block_id = b.block_id AND p.chatroom_id = b.chatroom_id
                     AND p.index_date = b.index_date AND p.user_id = b.user_id
                    WHERE p.chatroom_id = %s AND p.index_date = %s AND p.user_id = %s
                      AND b.block_date BETWEEN %s AND %s
                    GROUP BY p.participant_name
                    HAVING SUM(p.sent_message) > 0
                    ORDER BY cnt DESC
                    """,
                    (chatroom_id, index_date, user_id, start_date, end_date),
                )
                active_rows = cursor.fetchall()
                participant_count = len(active_rows)
                top_participants = [row["name"] for row in active_rows]
            else:
                cursor.execute(
                    """
                    SELECT message_count FROM chatroom
                    WHERE chatroom_id = %s AND index_date = %s AND user_id = %s
                    """,
                    (chatroom_id, index_date, user_id),
                )
                message_count = int((cursor.fetchone() or {}).get("message_count") or 0)

                cursor.execute(
                    """
                    SELECT COUNT(*) AS participant_count
                    FROM chatroom_people
                    WHERE chatroom_id = %s AND index_date = %s AND user_id = %s
                    """,
                    (chatroom_id, index_date, user_id),
                )
                participant_count = cursor.fetchone()["participant_count"]

                cursor.execute(
                    """
                    SELECT chatroom_people_name AS name
                    FROM chatroom_people
                    WHERE chatroom_id = %s AND index_date = %s AND user_id = %s
                    ORDER BY message_count DESC
                    """,
                    (chatroom_id, index_date, user_id),
                )
                top_participants = [row["name"] for row in cursor.fetchall()]

            rooms.append({
                "chatroom_id": chatroom_id,
                "chatroom_name": meta["chatroom_name"],
                "message_count": message_count,
                "participant_count": int(participant_count or 0),
                "top_participants": top_participants,
            })
        return rooms
    finally:
        cursor.close()
        conn.close()


def get_messenger_date_range(base_dir: str):
    """인덱싱된 모든 단톡방을 통틀어 가장 오래된/최근 메시지 날짜를 반환. message_block.
    block_date의 전체 MIN/MAX(방마다 latest index_date 스냅샷 기준). 메신저 탭 타임라인이
    특정 방과 무관하게 항상 같은 범위를 보여주도록(방을 오가도 슬라이더가 안 바뀌게) 인덱싱된
    방이 없으면 first_date/last_date 모두 None."""
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        first_date, last_date = None, None
        for acc in list_accounts(base_dir, "messenger"):
            if not acc["indexed"]:
                continue
            chatroom_id = acc["user_id"]
            latest = get_latest_chatroom(chatroom_id)
            if not latest:
                continue

            cursor.execute(
                """
                SELECT MIN(block_date) AS first_date, MAX(block_date) AS last_date
                FROM message_block
                WHERE chatroom_id = %s AND index_date = %s AND user_id = %s
                """,
                (chatroom_id, latest["index_date"], latest["user_id"]),
            )
            row = cursor.fetchone()
            if row["first_date"] and (first_date is None or row["first_date"] < first_date):
                first_date = row["first_date"]
            if row["last_date"] and (last_date is None or row["last_date"] > last_date):
                last_date = row["last_date"]

        return {
            "first_date": first_date.strftime("%Y-%m-%d") if first_date else None,
            "last_date":  last_date.strftime("%Y-%m-%d")  if last_date  else None,
        }
    finally:
        cursor.close()
        conn.close()


def get_chatroom_name(chatroom_id: str):
    """chatroom_id 하나로 chatroom_name만 조회. 프론트가 목록 화면을 거치지 않고
    chatroom_id만 들고 있을 때 방 이름을 해석하는 용도. 인덱싱된 적 없으면 None."""
    latest = get_latest_chatroom(chatroom_id)
    if not latest:
        return None
    index_date, user_id = latest["index_date"], latest["user_id"]

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT chatroom_name
            FROM chatroom
            WHERE chatroom_id = %s AND index_date = %s AND user_id = %s
            """,
            (chatroom_id, index_date, user_id),
        )
        row = cursor.fetchone()
        return row["chatroom_name"] if row else None
    finally:
        cursor.close()
        conn.close()


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


def get_chatroom_person_monthly_stats(chatroom_id: str, participant_id: str, start_date: str = None, end_date: str = None):
    """chatroom_id에서 participant_id가 월별로 보낸 메시지 수를 집계. start_date/end_date를
    주면(타임슬라이더 기간) 그 기간만, 안 주면 전체 기간. 상세보기 통계 탭의 월별
    그래프용. chatroom_id가 인덱싱된 적 없으면 None, participant_id가 그 채팅방 명단에
    없으면 False."""
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

        sql = """
            SELECT DATE_FORMAT(b.block_date, '%Y-%m') AS month, SUM(p.sent_message) AS count
            FROM participant p
            JOIN message_block b
              ON p.block_id = b.block_id AND p.chatroom_id = b.chatroom_id
             AND p.index_date = b.index_date AND p.user_id = b.user_id
            WHERE p.chatroom_id = %s AND p.index_date = %s AND p.user_id = %s
              AND p.participant_name = %s
        """
        params = [chatroom_id, index_date, user_id, participant_id]
        if start_date and end_date:
            sql += " AND b.block_date BETWEEN %s AND %s"
            params += [start_date, end_date]
        sql += " GROUP BY month ORDER BY month"

        cursor.execute(sql, params)
        rows = cursor.fetchall()
    finally:
        cursor.close()
        conn.close()

    monthly = [{"month": row["month"], "count": int(row["count"] or 0)} for row in rows]
    total = sum(m["count"] for m in monthly)
    return {"monthly": monthly, "total": total}


def get_chatroom_person_daily_stats(chatroom_id: str, participant_id: str, month: str):
    """chatroom_id에서 participant_id가 특정 월(month, "YYYY-MM")에 날짜별로 보낸 메시지
    수를 집계. 상세보기 통계 탭에서 월 막대를 클릭했을 때 "일별 목록" 화면용. chatroom_id가
    인덱싱된 적 없으면 None, participant_id가 그 채팅방 명단에 없으면 False."""
    latest = get_latest_chatroom(chatroom_id)
    if not latest:
        return None
    index_date, user_id = latest["index_date"], latest["user_id"]

    year, mon = (int(x) for x in month.split("-"))
    month_start = f"{month}-01"
    month_end = f"{month}-{calendar.monthrange(year, mon)[1]:02d}"

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
            SELECT b.block_date AS date, SUM(p.sent_message) AS count
            FROM participant p
            JOIN message_block b
              ON p.block_id = b.block_id AND p.chatroom_id = b.chatroom_id
             AND p.index_date = b.index_date AND p.user_id = b.user_id
            WHERE p.chatroom_id = %s AND p.index_date = %s AND p.user_id = %s
              AND p.participant_name = %s
              AND b.block_date BETWEEN %s AND %s
            GROUP BY b.block_date
            ORDER BY b.block_date
            """,
            (chatroom_id, index_date, user_id, participant_id, month_start, month_end),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()
        conn.close()

    days = [
        {
            "date": row["date"].strftime("%Y-%m-%d") if hasattr(row["date"], "strftime") else str(row["date"]),
            "count": int(row["count"] or 0),
        }
        for row in rows
    ]
    return {"days": days}


def get_chatroom_day_messages(base_dir: str, chatroom_id: str, date: str):
    """chatroom_id의 date("YYYY-MM-DD") 하루치 대화 원문을 반환. DB에는 집계만 있고
    원문은 없어서, text_units.parquet을 그때그때 파싱하는 _parse_message_blocks_from_parquet()
    (기존에 어조 분석용으로만 쓰이던 함수)를 재사용해 그 날짜에 해당하는 블록들의 메시지를
    시간순으로 합침(하루가 청크 크기 때문에 여러 블록으로 쪼개진 경우 대비). chatroom_id가
    인덱싱된 적 없으면 None, 그 날짜에 메시지가 없으면 빈 리스트."""
    from util.message_statics import _parse_message_blocks_from_parquet

    latest = get_latest_chatroom(chatroom_id)
    if not latest:
        return None

    paths = UserPaths(base_dir, chatroom_id, "messenger")
    blocks = _parse_message_blocks_from_parquet(paths)

    messages = []
    for block in blocks:
        if block.get("block_date") != date:
            continue
        messages.extend(block.get("messages") or [])

    messages.sort(key=lambda m: m.get("time") or "")
    return messages


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
