# src/util/lightrag_backend/lightrag_mail_parser.py
import os
import re

from config.settings import MAIL_BLOCK_SEP


# mail_latest.txt를 읽어 메일 블록 하나당 dict 하나(id/date/subject/sender/receiver/direction/folder/body)로 변환한 리스트를 반환한다
def parse_mail_blocks(paths) -> list[dict]:
    if not os.path.exists(paths.MAIL_LATEST_PATH):
        return []

    with open(paths.MAIL_LATEST_PATH, "r", encoding="utf-8") as f:
        text = f.read()

    records = []
    seen_ids = set()

    for block in text.split(MAIL_BLOCK_SEP):
        block = block.strip()
        if not block:
            continue

        # 대괄호/콜론 둘 다 가능
        id_m = re.search(r"^\s*(?:\[ID\]|ID:)\s*(.+?)\s*$", block, re.MULTILINE)
        mail_id = id_m.group(1).strip() if id_m else None
        if not mail_id or mail_id in seen_ids:
            continue
        seen_ids.add(mail_id)

        date_m = re.search(r"^\s*(?:\[날짜\]|날짜:)\s*(.+?)\s*$", block, re.MULTILINE)
        subject_m = re.search(r"^\s*(?:\[제목\]|제목:)\s*(.+?)\s*$", block, re.MULTILINE)
        sender_m = re.search(r"^\s*(?:\[발신인\]|발신인:)\s*(.+?)\s*$", block, re.MULTILINE)
        receiver_m = re.search(r"^\s*(?:\[수신인\]|수신인:)\s*(.+?)\s*$", block, re.MULTILINE)
        direction_m = re.search(r"^\s*(?:\[구분\]|구분:)\s*(.+?)\s*$", block, re.MULTILINE)
        folder_m = re.search(r"\[라벨 정보\]\s*\n(.+)", block)
        body_m = re.search(r"\[메일 본문\]\s*\n(.*?)(?:\n=+|\Z)", block, re.DOTALL)

        folder_raw = folder_m.group(1).strip() if folder_m else None
        if folder_raw == "없음":
            folder_raw = None

        records.append({
            "id": mail_id,
            "date": date_m.group(1).strip() if date_m else None,
            "subject": subject_m.group(1).strip() if subject_m else "",
            "sender": sender_m.group(1).strip() if sender_m else "",
            "receiver": receiver_m.group(1).strip() if receiver_m else "",
            "direction_raw": direction_m.group(1).strip() if direction_m else None,
            "folder": folder_raw,
            "body": body_m.group(1).strip() if body_m else "",
        })

    return records


# "Name <email>" 형태 문자열에서 이메일 주소만 소문자로 뽑아낸다
def extract_email(raw: str) -> str:
    if not raw:
        return ""
    m = re.search(r"<([^>]+)>", raw)
    return m.group(1).strip().lower() if m else raw.strip().lower()
