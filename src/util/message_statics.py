# src/util/message_statics.py
#
# extract_statics.py의 메신저(카카오톡) 버전. text_units.parquet에 저장된 메시지 블록을
# 파싱해서 chatroom_people/message_keyword용 중간 JSON을 만든다 (mail 쪽의
# mail_contact_stats.json / mail_keyword_stats.json과 동일한 역할).

import os
import re
import json
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv("src/parquet/.env")

client = OpenAI(api_key=os.getenv("LLM_API_KEY"))

# build_message_blocks()가 쓰는 대화 내용 줄 포맷과 정확히 대응:
#   "HH:MM 발신자: 메시지"          -> sender/text
#   "HH:MM [알림] 메시지"           -> sys_text (입장/퇴장 등 시스템 메시지)
_MSG_LINE_RE = re.compile(
    r'^(?P<time>\d{2}:\d{2})\s+(?:\[알림\]\s?(?P<sys_text>.*)|(?P<sender>[^:\n]+?):\s(?P<text>.*))$'
)


# text_units.parquet의 모든 row를 훑어서 메시지 블록 단위로 파싱한다.
# save_mail_to_db와 동일하게 [ID] 헤더가 있는 첫 청크만 사용(GraphRAG 청크 분할로 같은
# 블록이 여러 row로 쪼개질 수 있음 — 헤더는 항상 첫 청크에 함께 있으므로 이 방식으로 충분).
def _parse_message_blocks_from_parquet(paths) -> list[dict]:
    import pandas as pd

    text_units_path = paths.RELATIONSHIPS_PATH.replace("relationships.parquet", "text_units.parquet")
    if not os.path.exists(text_units_path):
        print(f"[MSG_STATS] text_units.parquet 없음: {text_units_path}")
        return []

    df = pd.read_parquet(text_units_path)

    blocks = []
    seen_ids = set()

    for _, row in df.iterrows():
        text = str(row.get('text', ''))

        id_match = re.search(r'^ID:\s*(.+)$', text, re.MULTILINE)
        block_id = id_match.group(1).strip() if id_match else None
        if not block_id or block_id in seen_ids:
            continue
        seen_ids.add(block_id)

        room_match = re.search(r'^채팅방:\s*(.+)$', text, re.MULTILINE)
        chatroom_name = room_match.group(1).strip() if room_match else ""

        date_match = re.search(r'^날짜:\s*(.+)$', text, re.MULTILINE)
        block_date = date_match.group(1).strip() if date_match else None

        participants_match = re.search(r'^참여자:\s*(.+)$', text, re.MULTILINE)
        participants_raw = participants_match.group(1).strip() if participants_match else ""
        participants = [
            p.strip() for p in participants_raw.split(",")
            if p.strip() and p.strip() != "알 수 없음"
        ]

        body_match = re.search(r'\[대화 내용\]\s*\n(.*?)(?:\n=+|\Z)', text, re.DOTALL)
        body = body_match.group(1) if body_match else ""

        # 한 메시지가 여러 줄일 수 있어(원본에 개행 포함) 새 "HH:MM ...:" 줄이 나올 때까지는
        # 직전 메시지의 연속으로 본다 (message_parser.parse_message_export와 동일한 규칙).
        messages = []
        for line in body.splitlines():
            m = _MSG_LINE_RE.match(line)
            if m:
                if m.group('sys_text') is not None:
                    messages.append({
                        "time": m.group('time'), "sender": None,
                        "text": m.group('sys_text'), "is_system": True,
                    })
                else:
                    messages.append({
                        "time": m.group('time'), "sender": m.group('sender').strip(),
                        "text": m.group('text'), "is_system": False,
                    })
            elif messages:
                messages[-1]["text"] += "\n" + line

        blocks.append({
            "block_id": block_id,
            "chatroom_name": chatroom_name,
            "block_date": block_date,
            "participants": participants,
            "messages": messages,
        })

    return blocks


# LLM으로 대화 블록 전체의 어조 판별 (message_block.llm_tone)
def _classify_message_tone_with_llm(text: str) -> str:
    if not text.strip():
        return "not_friendly"

    text = text[:1500]

    prompt = f"""
    다음은 카카오톡 채팅방의 하루치 대화 내용이다. 이 대화가 '친밀한 어조'인지 판별하라.

    판별 기준:
    - '친밀한 어조'란, 개인적인 친분이나 가까운 관계가 느껴지는 말투를 뜻한다.
    - 반말, 이모티콘/농담, 사적인 안부, 편한 말투가 중심이면 friendly다.
    - 공지/알림 위주, 업무·스터디 관련 형식적인 대화, 존댓말 중심의 사무적인 대화는 not_friendly다.

    반드시 아래 둘 중 하나만 정확히 출력하라.
    friendly
    not_friendly

    대화 내용:
    {text}
    """.strip()

    result = client.chat.completions.create(
        model=os.getenv("SUB_TASK_CHAT_MODEL"),
        messages=[
            {
                "role": "system",
                "content": "당신은 채팅 대화의 어조를 분류하는 AI입니다. 반드시 friendly 또는 not_friendly 둘 중 하나만 출력하세요."
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0,
    )

    answer = result.choices[0].message.content.strip().lower()
    return "friendly" if answer == "friendly" else "not_friendly"


# 참여자별 "언제 무슨 메시지를 보냈는지" 이력을 저장 (chatroom_people.description 생성용 원본 데이터)
def _save_chatroom_people_messages(paths, mode: str = "rewrite"):
    blocks = _parse_message_blocks_from_parquet(paths)

    if mode == "append" and os.path.exists(paths.CHATROOM_PEOPLE_MESSAGES_PATH):
        with open(paths.CHATROOM_PEOPLE_MESSAGES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        people = data.get("people", {})
        processed_block_ids = set(data.get("processed_block_ids", []))
    else:
        people = {}
        processed_block_ids = set()

    for block in blocks:
        if block["block_id"] in processed_block_ids:
            continue

        block_date = block["block_date"]
        for msg in block["messages"]:
            if msg["is_system"] or not msg["sender"]:
                continue
            datetime_str = f"{block_date} {msg['time']}" if block_date else msg["time"]
            people.setdefault(msg["sender"], []).append({
                "datetime": datetime_str,
                "text": msg["text"],
            })

        processed_block_ids.add(block["block_id"])

    result = {
        "processed_block_ids": sorted(processed_block_ids),
        "people": people,
    }

    with open(paths.CHATROOM_PEOPLE_MESSAGES_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[MSG_STATS] ({mode}) 참여자 {len(people)}명 메시지 이력 저장 완료 → {paths.CHATROOM_PEOPLE_MESSAGES_PATH}")


# 참여자별 메시지 이력(시간 포함)을 근거로 LLM 프로필 문장 생성 (DB 저장은 호출자가 담당)
def generate_chatroom_people_descriptions(paths) -> dict:
    if not os.path.exists(paths.CHATROOM_PEOPLE_MESSAGES_PATH):
        print("[MSG_PROFILES] 참여자 메시지 이력 없음 → 프로필 생성 건너뜀")
        return {}

    with open(paths.CHATROOM_PEOPLE_MESSAGES_PATH, "r", encoding="utf-8") as f:
        people = json.load(f).get("people", {})

    from concurrent.futures import ThreadPoolExecutor, as_completed

    MAX_MESSAGES_FOR_PROMPT = 80

    def _build_prompt(name, messages):
        ordered = sorted(messages, key=lambda m: m["datetime"])
        sample = ordered[-MAX_MESSAGES_FOR_PROMPT:]
        history_text = "\n".join(f"[{m['datetime']}] {m['text']}" for m in sample)
        return f"""다음은 '{name}'님이 채팅방에서 실제로 보낸 메시지 이력입니다 (최근 {len(sample)}건 / 총 {len(messages)}건 중).

{history_text}

위 메시지들만 근거로 아래 형식으로만 출력하세요. 다른 텍스트는 절대 포함하지 마세요.
참여 패턴: <대화에 얼마나 자주/활발히 참여하는지 한 문장으로>
자주 하는 이야기: <주로 어떤 주제/내용의 메시지를 보내는지 한 문장으로>
말투: <반말/존댓말, 이모티콘 사용 등 말투 특징을 한 문장으로>""".strip()

    def _call_llm(name, messages):
        try:
            prompt = _build_prompt(name, messages)
            result = client.chat.completions.create(
                model=os.getenv("SUB_TASK_CHAT_MODEL"),
                messages=[
                    {
                        "role": "system",
                        "content": "당신은 채팅 메시지 이력을 분석해 참여자 프로필을 한국어로 간결하게 요약하는 AI입니다."
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
            )
            return name, result.choices[0].message.content.strip()
        except Exception as e:
            print(f"[MSG_PROFILES] LLM 호출 실패 ({name}): {e}")
            return name, None

    targets = [(name, msgs) for name, msgs in people.items() if msgs]

    descriptions: dict[str, str] = {}
    if targets:
        with ThreadPoolExecutor(max_workers=min(len(targets), 15)) as executor:
            futures = {executor.submit(_call_llm, name, msgs): name for name, msgs in targets}
            for future in as_completed(futures):
                name, desc = future.result()
                if desc:
                    descriptions[name] = desc

    print(f"[MSG_PROFILES] 총 {len(descriptions)}명 프로필 생성 완료")
    return descriptions


# 참여자별·블록별 키워드 언급 횟수 저장 (message_keyword용 중간 JSON)
def _save_message_keyword_stats(paths, mode: str = "rewrite"):
    from util.extract_statics import extract_keywords_with_llm

    blocks = _parse_message_blocks_from_parquet(paths)

    if mode == "append" and os.path.exists(paths.MESSAGE_KEYWORDS_PATH):
        with open(paths.MESSAGE_KEYWORDS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        keyword_stats = data.get("keywords", {})
        mention_map = data.get("keyword_participant_block_map", {})
        processed_ids = set(data.get("processed_block_ids", []))
    else:
        keyword_stats = {}
        mention_map = {}
        processed_ids = set()

    for block in blocks:
        if block["block_id"] in processed_ids:
            continue

        per_sender_text: dict[str, list[str]] = {}
        for msg in block["messages"]:
            if msg["is_system"] or not msg["sender"]:
                continue
            per_sender_text.setdefault(msg["sender"], []).append(msg["text"])

        for sender, texts in per_sender_text.items():
            body = "\n".join(texts).strip()
            if not body:
                continue
            keywords = extract_keywords_with_llm(body)
            for kw in keywords:
                keyword_stats[kw] = keyword_stats.get(kw, 0) + 1
                mention_map.setdefault(kw, {}).setdefault(sender, {})
                mention_map[kw][sender][block["block_id"]] = \
                    mention_map[kw][sender].get(block["block_id"], 0) + 1

        processed_ids.add(block["block_id"])

    result = {
        "keywords": keyword_stats,
        "keyword_participant_block_map": mention_map,
        "processed_block_ids": list(processed_ids),
    }

    with open(paths.MESSAGE_KEYWORDS_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[MSG_KEYWORD] ({mode}) 키워드 {len(keyword_stats)}개 저장 완료 → {paths.MESSAGE_KEYWORDS_PATH}")


def _extract_message_statics_pipeline(paths, mode: str = "rewrite"):
    os.makedirs(paths.MAIL_STATICS_PATH, exist_ok=True)
    _save_chatroom_people_messages(paths, mode)
    _save_message_keyword_stats(paths, mode)
