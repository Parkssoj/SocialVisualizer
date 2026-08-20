# src/util/message_summary.py
#
# graphrag_mail_summary.py의 메신저 버전. text_units.parquet에서 재구성한 대화 블록을
# 월별/연별로 묶어 LLM 요약을 만들고 message_summarize 테이블에 저장한다.

import os
import json
import datetime
import openai
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
from util.message_statics import _parse_message_blocks_from_parquet
from util.database.chatroom_db_writer import save_message_summarize_to_db

load_dotenv("src/parquet/.env")


def _summarize_with_llm(text, period_label, contacts):
    client = openai.OpenAI(api_key=os.environ.get("LLM_API_KEY"))
    try:
        response = client.chat.completions.create(
            model=os.getenv("SUB_TASK_CHAT_MODEL"),
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "주어진 채팅 대화 목록을 분석하여 아래 JSON 형식으로만 응답하세요.\n"
                        "{\n"
                        '  "summary": "해당 기간의 주요 대화 내용을 3~5문장으로 한국어 요약( ~입니다. 어미로 통일)",\n'
                        '  "contacts": ["요약 내용과 관련된 대화 참여자 이름 목록"]\n'
                        "}\n"
                        "contacts는 아래 제공된 참여자 목록 중에서만 골라주세요."
                    )
                },
                {
                    "role": "user",
                    "content": f"[{period_label}] 참여자 목록: {contacts}\n\n대화 목록:\n\n{text}"
                }
            ],
            max_completion_tokens=1000  # gpt-5.4-mini(reasoning 모델)는 max_tokens 미지원, max_completion_tokens 사용
        )
        result = json.loads(response.choices[0].message.content)
        return {
            "summary":  result.get("summary", ""),
            "contacts": result.get("contacts", []),
        }
    except Exception as e:
        print(f"[message_summary] LLM 오류 ({period_label}): {e}")
        return {"summary": "", "contacts": []}


def generate_message_summaries(paths):
    blocks = _parse_message_blocks_from_parquet(paths)
    if not blocks:
        print("[message_summary] 요약할 대화 블록 없음")
        return

    entries = []
    for block in blocks:
        if not block["block_date"]:
            continue
        try:
            date = datetime.datetime.strptime(block["block_date"], "%Y-%m-%d")
        except Exception:
            continue

        lines = []
        contacts = set()
        for msg in block["messages"]:
            if msg["is_system"] or not msg["sender"]:
                continue
            lines.append(f"{msg['time']} {msg['sender']}: {msg['text']}")
            contacts.add(msg["sender"])

        if not lines:
            continue

        entries.append({
            "date": date,
            "year": date.strftime("%Y"),
            "month": date.strftime("%Y-%m"),
            "text": "\n".join(lines)[:1500],
            "contacts": contacts,
        })

    if not entries:
        print("[message_summary] 요약할 대화 없음")
        return

    entries.sort(key=lambda x: x["date"])

    monthly_groups = {}
    yearly_groups = {}
    for e in entries:
        monthly_groups.setdefault(e["month"], []).append(e)
        yearly_groups.setdefault(e["year"], []).append(e)

    def _build_text(group):
        return "\n\n".join(f"날짜: {e['date'].strftime('%Y-%m-%d')}\n{e['text']}" for e in group)

    def _collect_contacts(group):
        names = set()
        for e in group:
            names |= e["contacts"]
        return sorted(names)

    def _summarize_group(kind, period, group):
        print(f"[message_summary] {kind} 요약 중: {period} ({len(group)}개 블록)")
        return kind, period, _summarize_with_llm(_build_text(group), period, _collect_contacts(group))

    jobs = [("monthly", month, group) for month, group in monthly_groups.items()] + \
           [("yearly", year, group) for year, group in yearly_groups.items()]

    monthly_summaries = {}
    yearly_summaries = {}
    with ThreadPoolExecutor(max_workers=min(len(jobs), 15)) as executor:
        futures = [executor.submit(_summarize_group, kind, period, group) for kind, period, group in jobs]
        for future in as_completed(futures):
            kind, period, summary = future.result()
            (monthly_summaries if kind == "monthly" else yearly_summaries)[period] = summary

    result = {
        "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "yearly":  yearly_summaries,
        "monthly": monthly_summaries,
    }

    os.makedirs(paths.MAIL_STATICS_PATH, exist_ok=True)
    with open(paths.MESSAGE_SUMMARIES_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[message_summary] 저장 완료: {paths.MESSAGE_SUMMARIES_PATH}")

    save_message_summarize_to_db(paths)
