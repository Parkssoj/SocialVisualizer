# src/util/lightrag_backend/lightrag_date_query.py
#
# graphrag_date_query.py(GraphRAG 버전)의 LightRAG 대응 파일. 새로 만든 파일이며 graphrag_date_query.py는
# 건드리지 않았다.
#
# 안 바뀐 것: 질의 문장에서 "어제", "3월 22일~25일" 같은 표현을 실제 날짜 범위로 바꾸는
# _extract_date_range()는 GraphRAG/LightRAG와 무관한 순수 정규식 로직이라 그대로
# 복사해서 재사용한다.
#
# 바뀐 것: 이메일을 어디서 찾아오는지. GraphRAG 버전은 paths.GRAPHRAG_ROOT/output/
# entities.parquet(GraphRAG가 엔티티 추출로 만든 요약본)에서 "Date: ..." 필드를 정규식으로
# 읽었는데, LightRAG는 그런 parquet을 안 만들어서 그 파일 자체가 없다. 대신 인덱싱 입력으로
# 쓰는 원본 mail_latest.txt(모든 메일이 "날짜:", "제목:", "ID:" 같은 필드로 블록화되어
# 저장된 파일)를 직접 읽어서 필터링한다 — GraphRAG의 LLM 요약을 거치지 않은 원본이라
# 정보 손실도 없다.

import os
import re
import time
import datetime
import calendar
import openai

from config.settings import MAIL_BLOCK_SEP

# 질의 문장에서 날짜/기간 표현을 (시작일, 종료일) 문자열로 변환. graphrag_date_query.py와 동일한
# 순수 로직 — RAG 엔진과 무관해서 그대로 복사했다.
def _extract_date_range(message: str):
    today = datetime.datetime.now()
    year = today.year

    # 패턴1: 3월 22일 ~ 3월 25일
    m = re.search(r'(\d+)월\s*(\d+)일\s*[~～\-]\s*(\d+)월\s*(\d+)일', message)
    if m:
        start = f"{year}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
        end = f"{year}-{int(m.group(3)):02d}-{int(m.group(4)):02d}"
        return start, end

    # 패턴2: 3월 22일 ~ 25일
    m = re.search(r'(\d+)월\s*(\d+)일\s*[~～\-]\s*(\d+)일', message)
    if m:
        month = int(m.group(1))
        start = f"{year}-{month:02d}-{int(m.group(2)):02d}"
        end = f"{year}-{month:02d}-{int(m.group(3)):02d}"
        return start, end

    # 패턴3: 2026-03-22 ~ 2026-03-25
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})\s*[~～\-]\s*(\d{4})-(\d{2})-(\d{2})', message)
    if m:
        start = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        end = f"{m.group(4)}-{m.group(5)}-{m.group(6)}"
        return start, end

    # 패턴4: 2026-03-22 ~ 03-25
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})\s*[~～\-]\s*(\d{2})-(\d{2})', message)
    if m:
        start = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        end = f"{m.group(1)}-{m.group(4)}-{m.group(5)}"
        return start, end

    # 패턴5: 이번 주
    if '이번 주' in message or '이번주' in message:
        start_of_week = today - datetime.timedelta(days=today.weekday())
        end_of_week = start_of_week + datetime.timedelta(days=6)
        return start_of_week.strftime('%Y-%m-%d'), end_of_week.strftime('%Y-%m-%d')

    # 패턴6: 지난 주 / 저번 주 / 저저번 주 (N주 전)
    m = re.search(r'(저저번|저번|지난)\s*주', message)
    if m:
        weeks_ago = 2 if m.group(1) == '저저번' else 1
        start_of_week = today - datetime.timedelta(days=today.weekday() + 7 * weeks_ago)
        end_of_week = start_of_week + datetime.timedelta(days=6)
        return start_of_week.strftime('%Y-%m-%d'), end_of_week.strftime('%Y-%m-%d')

    # 패턴7: 오늘
    if '오늘' in message:
        date = today.strftime('%Y-%m-%d')
        return date, date

    # 패턴8: 어제
    if '어제' in message:
        date = (today - datetime.timedelta(days=1)).strftime('%Y-%m-%d')
        return date, date

    # 패턴9: 며칠 전 (3일 전, 5일 전 등)
    m = re.search(r'(\d+)\s*일\s*전', message)
    if m:
        date = (today - datetime.timedelta(days=int(m.group(1)))).strftime('%Y-%m-%d')
        return date, date

    # 패턴10: 최근 N일
    m = re.search(r'최근\s*(\d+)\s*일', message)
    if m:
        start = (today - datetime.timedelta(days=int(m.group(1)) - 1)).strftime('%Y-%m-%d')
        end = today.strftime('%Y-%m-%d')
        return start, end

    # 패턴11: 이번 달
    if '이번 달' in message or '이번달' in message:
        start = today.replace(day=1).strftime('%Y-%m-%d')
        end = today.strftime('%Y-%m-%d')
        return start, end

    # 패턴12: 지난 달 / 저번 달 / 저저번 달 (N달 전)
    m = re.search(r'(저저번|저번|지난)\s*달', message)
    if m:
        months_ago = 2 if m.group(1) == '저저번' else 1
        month = today.month - months_ago
        y = today.year
        while month <= 0:
            month += 12
            y -= 1
        last_day = calendar.monthrange(y, month)[1]
        return f"{y}-{month:02d}-01", f"{y}-{month:02d}-{last_day:02d}"

    # 패턴13: 올해
    if '올해' in message:
        start = f"{year}-01-01"
        end = today.strftime('%Y-%m-%d')
        return start, end

    # 패턴14: 작년
    if '작년' in message:
        last_year = year - 1
        return f"{last_year}-01-01", f"{last_year}-12-31"

    # 패턴15: N년 전
    m = re.search(r'(\d+)\s*년\s*전', message)
    if m:
        target_year = year - int(m.group(1))
        return f"{target_year}-01-01", f"{target_year}-12-31"

    # 패턴16: N달 전 (해당 월 전체)
    m = re.search(r'(\d+)\s*달\s*전', message)
    if m:
        months_ago = int(m.group(1))
        month = today.month - months_ago
        y = today.year
        while month <= 0:
            month += 12
            y -= 1
        last_day = calendar.monthrange(y, month)[1]
        return f"{y}-{month:02d}-01", f"{y}-{month:02d}-{last_day:02d}"

    # 패턴17: N개월 전 (해당 월 전체)
    m = re.search(r'(\d+)\s*개월\s*전', message)
    if m:
        months_ago = int(m.group(1))
        month = today.month - months_ago
        y = today.year
        while month <= 0:
            month += 12
            y -= 1
        last_day = calendar.monthrange(y, month)[1]
        return f"{y}-{month:02d}-01", f"{y}-{month:02d}-{last_day:02d}"

    # 패턴18: 2026년 3월 22일
    m = re.search(r'(\d{4})\s*년\s*(\d+)\s*월\s*(\d+)\s*일', message)
    if m:
        date = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        return date, date

    # 패턴19: 2026년 3월 (연월 전체)
    m = re.search(r'(\d{4})\s*년\s*(\d+)\s*월', message)
    if m and not re.search(r'\d+일', message):
        y, month = int(m.group(1)), int(m.group(2))
        last_day = calendar.monthrange(y, month)[1]
        return f"{y}-{month:02d}-01", f"{y}-{month:02d}-{last_day:02d}"

    # 패턴20: 2026년 전체
    m = re.search(r'(\d{4})\s*년', message)
    if m and not re.search(r'\d+월', message):
        y = int(m.group(1))
        return f"{y}-01-01", f"{y}-12-31"

    # 패턴21: 3월 전체 (연도 없이 월만)
    m = re.search(r'(\d+)월', message)
    if m and not re.search(r'\d+일', message):
        month = int(m.group(1))
        last_day = calendar.monthrange(year, month)[1]
        return f"{year}-{month:02d}-01", f"{year}-{month:02d}-{last_day:02d}"

    # 패턴22: 3월 22일 (단일 날짜)
    m = re.search(r'(\d+)월\s*(\d+)일', message)
    if m:
        date = f"{year}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
        return date, date

    # 패턴23: 2026-03-22 (단일 날짜 숫자형)
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', message)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}", f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

    # 패턴24: 26-03-22 또는 2026-3-22 (zero-padding 없는 경우)
    m = re.search(r'(\d{2,4})-(\d{1,2})-(\d{1,2})', message)
    if m:
        y = int(m.group(1))
        if y < 100:
            y += 2000
        date = f"{y}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        return date, date

    return None


# mail_latest.txt(원본 메일 블록 파일)에서 날짜 범위에 맞는 이메일 필터링.
# GraphRAG 버전의 _filter_emails_by_date()는 entities.parquet을 읽었지만, 여기서는
# 인덱싱 입력으로 쓰는 원본 텍스트를 직접 읽는다 — imap_message.py가 만드는 블록 포맷
# 기준(ID:/제목:/날짜:/[메일 본문] 필드)으로 파싱한다.
def _filter_emails_by_date(paths, start_date: str, end_date: str) -> list:
    if not os.path.exists(paths.MAIL_LATEST_PATH):
        return []

    with open(paths.MAIL_LATEST_PATH, "r", encoding="utf-8") as f:
        text = f.read()

    start_dt = datetime.datetime.strptime(start_date, '%Y-%m-%d')
    end_dt = datetime.datetime.strptime(end_date, '%Y-%m-%d').replace(hour=23, minute=59, second=59)

    results = []
    for block in text.split(MAIL_BLOCK_SEP):
        block = block.strip()
        if not block:
            continue

        date_m = re.search(r'^날짜:\s*(.+?)\s*$', block, re.MULTILINE)
        if not date_m:
            continue  # 날짜 필드 없으면 걍 넘어감

        try:
            mail_dt = datetime.datetime.strptime(date_m.group(1).strip(), '%Y-%m-%d %H:%M:%S')
        except ValueError:
            continue  # 날짜 파싱 실패하면 걍 넘어감

        if not (start_dt <= mail_dt <= end_dt):
            continue  # 날짜 범위 밖이면 걍 넘어감

        id_m = re.search(r'^ID:\s*(.+?)\s*$', block, re.MULTILINE)
        title_m = re.search(r'^제목:\s*(.+?)\s*$', block, re.MULTILINE)

        # [메일 본문] 섹션 이후를 본문으로 사용. GraphRAG판의 "summary"는 GraphRAG가 LLM으로
        # 요약한 값이었지만, 여기는 원본 본문 앞부분을 그대로 잘라 쓴다(컨텍스트 길이 제한용).
        body_m = re.search(r'\[메일 본문\]\s*\n(.*)', block, re.DOTALL)
        body = body_m.group(1).strip() if body_m else ''
        snippet = body[:300]

        results.append({
            'title': title_m.group(1).strip() if title_m else '(제목 없음)',
            'id': id_m.group(1).strip() if id_m else '알 수 없음',
            'date': date_m.group(1).strip(),
            'summary': snippet,
        })

    # 날짜 오름차순 정렬
    results.sort(key=lambda x: x['date'])
    return results


# 질의에서 날짜 범위 추출하여 mail_latest.txt에서 필터링 후 llm 답변
def run_date_range_query(message: str, paths) -> str:
    date_range = _extract_date_range(message)  # 질의에서 날짜 범위 추출, 날짜 패턴 없으면 None 반환
    if not date_range:
        return None  # 날짜 쿼리 아니면 LightRAG로 넘긴다

    start_date, end_date = date_range
    start_time = time.time()
    emails = _filter_emails_by_date(paths, start_date, end_date)
    print(f"[DEBUG][lightrag] filtered emails count: {len(emails)}")

    if not emails:  # 해당 기간 이메일 없으면 바로 없다고 메시지 반환
        print(f'date_query(lightrag) execution_time : {time.time() - start_time}')
        return f"{start_date} ~ {end_date} 사이에 수신된 이메일이 없습니다."

    # 필터링된 이메일 목록 LLM에 넘길 텍스트로 변환
    lines = []
    for i, e in enumerate(emails, 1):
        lines.append(
            f"{i}. 제목: {e['title']}\n"
            f"   ID: {e['id']}\n"
            f"   날짜: {e['date']}\n"
            f"   내용: {e['summary']}"
        )
    context = "\n\n".join(lines)

    client = openai.OpenAI(api_key=os.environ.get("LLM_API_KEY"))

    # 필터링된 이메일 목록을 근거로 최종 답변을 생성하는 호출이라(단순 분류/요약 같은
    # 보조 작업이 아니라 사용자에게 보여줄 실제 답) SUB_TASK_CHAT_MODEL이 아니라
    # RAG_CHAT_MODEL을 쓴다 — run_lightrag_query()의 답변 생성과 같은 급.
    response = client.chat.completions.create(
        model=os.environ.get("RAG_CHAT_MODEL", "gpt-4o-mini"),
        messages=[
            {
                "role": "system",
                "content": (
                    "당신은 이메일 데이터를 분석하는 어시스턴트입니다. "
                    "아래 제공된 이메일 목록을 기반으로 사용자 질문에 한국어로 답변하세요. "
                    "제공된 데이터 외의 내용은 추측하지 마세요."
                    "날짜 필터링은 이미 완료되었습니다. "
                    "제공된 이메일 목록이 곧 사용자가 요청한 기간의 전체 결과입니다. "
                    "날짜 범위를 임의로 재해석하거나 변경하지 마세요. "
                    "목록이 비어있지 않다면 반드시 모든 이메일을 답변에 포함하세요."
                    "이메일 목록의 첫 번째부터 마지막까지 순서대로 전부 나열하세요."
                )
            },
            {
                "role": "user",
                "content": f"[이메일 목록]\n{context}\n\n[질문]\n{message}"
            }
        ],
        temperature=0.0  # 날짜 기반 질문은 창의성 필요 ㄴㄴ
    )
    print(f'date_query(lightrag) execution_time : {time.time() - start_time}')
    print(f'date_query(lightrag) answer : {response.choices[0].message.content.strip()}')
    return response.choices[0].message.content.strip()
