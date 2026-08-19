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
