# src/util/lightrag_backend/lightrag_mail_parser.py
#
# LightRAG 다운스트림(통계/DB 저장) 코드들이 공통으로 쓰는 메일 파싱 헬퍼.
#
# 배경: GraphRAG 버전(extract_statics.py, database/db_writer.py, graphrag_mail_summary.py)은
# 전부 GraphRAG가 만든 text_units.parquet을 pd.read_parquet()으로 읽어서 "text" 컬럼을
# 정규식으로 파싱했다. LightRAG는 그 parquet을 만들지 않으므로, 대신 인덱싱 입력으로
# 쓰는 원본 paths.MAIL_LATEST_PATH(모든 메일이 MAIL_BLOCK_SEP로 구분된 블록 형태로 저장된
# 파일, imap_message.py가 씀)를 직접 읽어서 같은 정보를 뽑아낸다.
#
# GraphRAG 버전들은 text_units.parquet이 메일 하나당 여러 청크(행)로 쪼개질 수 있어서
# document_ids 기준으로 그룹핑하는 워크어라운드가 있었는데(예: db_writer.save_mail_folder_to_db),
# mail_latest.txt는 애초에 메일 하나 = 블록 하나라서 그 워크어라운드가 필요 없다.
#
# 이 모듈은 파싱만 담당한다. LLM 호출(키워드 추출, 어조 판별, 요약 등)은 각자 파일에서
# extract_statics.py의 기존 헬퍼를 그대로 재사용한다.

import os
import re

from config.settings import MAIL_BLOCK_SEP


# mail_latest.txt를 읽어 메일 블록 하나당 dict 하나로 변환한 리스트를 반환한다.
# 반환 필드:
#   id, date(원문 "YYYY-MM-DD HH:MM:SS" 문자열), subject, sender(원문 "Name <email>"),
#   receiver(원문), direction_raw("발신"/"수신"), folder(라벨 정보, 없으면 None), body
# id가 없는 블록은 건너뛰고, 같은 id가 중복되면 먼저 나온 것만 남긴다(GraphRAG판의
# seen_ids 처리와 동일한 안전장치 — 정상적인 mail_latest.txt라면 중복이 없어야 한다).
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

        # 실제 mail_latest.txt는 "[ID] ...", "[날짜] ..." 같은 대괄호 형식을 쓰는데(폴더/본문
        # 정규식은 원래부터 맞게 돼 있었음), 여기 여섯 필드만 콜론 형식("ID: ...")만 찾도록
        # 돼 있어서 전부 항상 실패 → mail_id가 항상 None이라 모든 블록이 통째로 스킵되고
        # parse_mail_blocks()가 매번 빈 리스트를 반환했다(= 통계/DB 저장/요약이 전부
        # "mail_latest.txt 없음/비어있음"으로 오인돼 건너뛰어짐). 대괄호/콜론 둘 다 받도록 고쳤다.
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


# "Name <email>" 형태에서 email만 뽑는다. GraphRAG 버전 여러 파일에 흩어져 있던
# 동일한 정규식(_extract_sender_email/_extract_email)을 하나로 합쳤다.
def extract_email(raw: str) -> str:
    if not raw:
        return ""
    m = re.search(r"<([^>]+)>", raw)
    return m.group(1).strip().lower() if m else raw.strip().lower()
