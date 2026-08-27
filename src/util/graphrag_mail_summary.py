# src/util/graphrag_mail_summary.py
#
# GraphRAG 전용 파일 (mail_summary.py에서 이름만 변경). text_units.parquet을 직접 읽어
# 월별/연별 메일 요약을 만든다. LightRAG 버전은 util/lightrag_backend/lightrag_mail_summary.py.

import os
import re
import json
import datetime
import openai
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
from util.database.db_writer import save_mail_summarize_to_db
# My Time 화면에서 기간 요약 삽화(image_url)를 더 이상 렌더링하지 않고, 이걸 만들려면
# 로컬 FLUX 이미지 서버(port 8005)가 떠있어야 하는데 지금은 꺼져있어서 매번 생성 실패
# 로그만 남긴다 — 안 쓰는 기능이라 호출 자체를 꺼둠 (2026-08-27).
# from util.summary_image_generator import generate_mail_summary_images

load_dotenv("src/parquet/.env")


def _extract_field(text, field_name):
    m = re.search(rf'^\[{re.escape(field_name)}\]\s*(.+)$', text, re.MULTILINE)
    return m.group(1).strip() if m else None


def _extract_body(text):
    m = re.search(r'\[메일 본문\]\s*\n(.*?)(?=\n\[|$)', text, re.DOTALL)
    return m.group(1).strip() if m else ""


def _extract_email(raw):
    m = re.search(r'<([^>]+)>', raw or "")
    return m.group(1).strip() if m else raw.strip() if raw else None


def _summarize_with_llm(text, period_label, contacts):
    client = openai.OpenAI(
        api_key=os.environ.get("LLM_API_KEY"),
        base_url=os.environ.get("SUB_TASK_API_BASE") or None,
    )
    try:
        response = client.chat.completions.create(
            model=os.getenv("SUB_TASK_CHAT_MODEL"),
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "주어진 이메일 목록을 분석하여 아래 JSON 형식으로만 응답하세요.\n"
                        "{\n"
                        '  "summary": "해당 기간의 주요 메일 내용을 3~5문장으로 한국어 요약",\n'
                        '  "contacts": ["요약 내용과 관련된 메일을 주고받은 이메일 주소 목록"]\n'
                        "}\n"
                        "contacts는 아래 제공된 이메일 목록 중에서만 골라주세요."
                    )
                },
                {
                    "role": "user",
                    "content": f"[{period_label}] 이메일 목록: {contacts}\n\n메일 목록:\n\n{text}"
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
        print(f"[mail_summary] LLM 오류 ({period_label}): {e}")
        return {"summary": "", "contacts": []}


def generate_mail_summaries(paths):
    import pandas as pd

    text_units_path = paths.RELATIONSHIPS_PATH.replace("relationships.parquet", "text_units.parquet")
    if not os.path.exists(text_units_path):
        print(f"[mail_summary] text_units.parquet 없음: {text_units_path}")
        return

    df = pd.read_parquet(text_units_path)

    mails = []
    seen_ids = set()

    for _, row in df.iterrows():
        text = str(row.get('text', ''))

        mail_id = _extract_field(text, 'ID')
        if not mail_id or mail_id in seen_ids:
            continue
        seen_ids.add(mail_id)

        date_str = _extract_field(text, '날짜')
        if not date_str:
            continue

        try:
            date = datetime.datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
        except Exception:
            continue

        sender_raw     = _extract_field(text, '발신인') or ""
        receiver_raw   = _extract_field(text, '수신인') or ""
        sender_email   = _extract_email(sender_raw)
        receiver_email = _extract_email(receiver_raw)

        mails.append({
            "date":           date,
            "year":           date.strftime("%Y"),
            "month":          date.strftime("%Y-%m"),
            "subject":        _extract_field(text, '제목') or "",
            "sender":         sender_raw,
            "sender_email":   sender_email,
            "receiver_email": receiver_email,
            "body":           _extract_body(text)[:500],
        })

    if not mails:
        print("[mail_summary] 요약할 메일 없음")
        return

    mails.sort(key=lambda x: x["date"])

    monthly_groups = {}
    yearly_groups  = {}
    for mail in mails:
        monthly_groups.setdefault(mail["month"], []).append(mail)
        yearly_groups.setdefault(mail["year"],  []).append(mail)

    def _build_text(group):
        return "\n\n".join(
            f"제목: {m['subject']}\n발신인: {m['sender']}\n내용: {m['body']}"
            for m in group
        )

    def _collect_contacts(group):
        emails = set()
        for m in group:
            if m.get("sender_email"):
                emails.add(m["sender_email"])
            if m.get("receiver_email"):
                emails.add(m["receiver_email"])
        return sorted(emails)

    def _summarize_group(kind, period, group):
        print(f"[mail_summary] {kind} 요약 중: {period} ({len(group)}건)")
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
    with open(paths.MAIL_SUMMARIES_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[mail_summary] 저장 완료: {paths.MAIL_SUMMARIES_PATH}")

    save_mail_summarize_to_db(paths)
    # generate_mail_summary_images(paths)  # 위 import 주석 처리 사유와 동일 — 미사용 기능
