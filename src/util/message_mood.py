# src/util/message_mood.py
#
# message_summary.py와 같은 원본 대화 블록(_parse_message_blocks_from_parquet)을 써서
# 월별/연별 "분위기 점수(mood_score)"와 "분위기 설명(mood_description)"을 계산하고
# message_mood 테이블에 저장한다.
#
# MoodScore = ContentJudge(35%) + Tone(35%) + Activity(15%) + ResponseSpeed(15%)
#   - ContentJudge: 원본 대화 텍스트를 LLM이 읽고 "사적 대화 비율(%)"을 직접 산출
#   - Tone: 이모지/특수기호/ㅋㅋㅎㅎ 빈도 + 문장 끝 말투(반말·애교체는 가점, 격식체는 감점) (통계, LLM 호출 없음)
#   - Activity: 대화량(같은 계정의 다른 채팅방들과 비교) × 참여 균형(엔트로피)
#     새 채팅방이 인덱싱될 때마다 recompute_all_message_moods()가 그 계정의 모든 채팅방을
#     다시 계산해서, 비교 기준(pool)이 항상 최신 상태를 반영하도록 한다.
#   - ResponseSpeed: 메시지 시간 간격의 역수 (같은 방의 다른 기간들과 비교)

import os
import re
import math
import json
import datetime
import openai
from dotenv import load_dotenv
from config.db import get_db_connection
from util.message_statics import _parse_message_blocks_from_parquet
from util.database.chatroom_db_writer import save_message_mood_to_db, _resolve_chatroom_key

load_dotenv("src/parquet/.env")

# 가중치 — 튜닝할 때 이 값들만 조정하면 됨
WEIGHT_CONTENT_JUDGE  = 0.35
WEIGHT_TONE           = 0.35
WEIGHT_ACTIVITY       = 0.15
WEIGHT_RESPONSE_SPEED = 0.15

_TONE_MARKER_RE = re.compile(
    r'!|[ㅋㅎ]{2,}|'
    r'[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF]'
)

# 문장 끝 어미 기반 말투 휴리스틱 (완벽한 문법 분석은 아니고, 자주 쓰이는 어미 패턴 매칭)
# 반말/애교체 어미 → 가점(친밀한 말투), 격식체 어미 → 감점(사무적인 말투)
_CASUAL_ENDING_RE = re.compile(r'(야|다|지|냐|거든|잖아|었어|았어|해|줘|봐|용|염|잉)[\s~.!?]*$')
_FORMAL_ENDING_RE = re.compile(r'(습니다|합니다|입니다|십니다|세요|니다)[\s.!?]*$')


def _tone_marker_score(text: str) -> float:
    # 이모지/특수기호/ㅋㅋㅎㅎ 빈도 + 문장 끝 말투 점수를 합산한 원값 (한 메시지 기준)
    score = float(len(_TONE_MARKER_RE.findall(text)))
    tail = text.strip()[-10:]
    if _FORMAL_ENDING_RE.search(tail):
        score -= 1.0
    elif _CASUAL_ENDING_RE.search(tail):
        score += 1.0
    return score


def _group_blocks_by_period(blocks):
    # block_date 기준으로 월별/연별 그룹으로 나눔 (실제 발화가 있는 블록만 포함)
    monthly, yearly = {}, {}
    for block in blocks:
        if not block["block_date"]:
            continue
        try:
            date = datetime.datetime.strptime(block["block_date"], "%Y-%m-%d")
        except Exception:
            continue

        real_messages = [m for m in block["messages"] if not m["is_system"] and m["sender"]]
        if not real_messages:
            continue

        entry = {"date": date, "real_messages": real_messages}
        monthly.setdefault(date.strftime("%Y-%m"), []).append(entry)
        yearly.setdefault(date.strftime("%Y"), []).append(entry)
    return monthly, yearly


def _build_raw_text(group):
    # 요약문이 아니라 원본 대화 그대로 (ContentJudge 입력용)
    lines = []
    for entry in sorted(group, key=lambda e: e["date"]):
        lines.append(f"날짜: {entry['date'].strftime('%Y-%m-%d')}")
        for m in entry["real_messages"]:
            lines.append(f"{m['time']} {m['sender']}: {m['text']}")
    return "\n".join(lines)


def _judge_mood_with_llm(text, period_label):
    # 원본 대화 텍스트를 읽고 사적 대화 비율(%)과 설명을 함께 반환 (LLM 호출 1회)
    client = openai.OpenAI(api_key=os.environ.get("LLM_API_KEY"))
    try:
        response = client.chat.completions.create(
            model=os.getenv("SUB_TASK_CHAT_MODEL"),
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "다음은 카카오톡 채팅방의 특정 기간 실제 대화 원문이다. "
                        "이 기간 대화 내용이 사적인 이야기(안부, 감정, 개인적 일상 공유 등)와 "
                        "공적인 이야기(업무, 공지, 스터디, 사무적인 용건 등) 중 어느 쪽에 더 가까운지 "
                        "분석해 아래 JSON 형식으로만 응답하라.\n"
                        "{\n"
                        '  "private_ratio": 0~100 사이 숫자 (전체 대화 중 사적인 내용의 비율, %),\n'
                        '  "description": "이 기간 대화 내용을 1~2문장으로 한국어 설명"\n'
                        "}"
                    ),
                },
                {
                    "role": "user",
                    "content": f"[{period_label}] 대화 내용:\n\n{text[:8000]}",
                },
            ],
            max_completion_tokens=300,  # gpt-5.4-mini(reasoning 모델)는 max_tokens 미지원
        )
        result = json.loads(response.choices[0].message.content)
        private_ratio = float(result.get("private_ratio", 50))
        private_ratio = max(0.0, min(100.0, private_ratio))
        return private_ratio, result.get("description", "")
    except Exception as e:
        print(f"[message_mood] LLM 판단 오류 ({period_label}): {e}")
        return 50.0, ""


def _avg_response_interval_minutes(entry):
    times = []
    for m in entry["real_messages"]:
        try:
            h, mi = m["time"].split(":")
            times.append(int(h) * 60 + int(mi))
        except Exception:
            continue
    if len(times) < 2:
        return None
    diffs = [max(0, times[i + 1] - times[i]) for i in range(len(times) - 1)]
    return sum(diffs) / len(diffs) if diffs else None


def _speaker_message_counts(group):
    sent_by = {}
    for entry in group:
        for m in entry["real_messages"]:
            sent_by[m["sender"]] = sent_by.get(m["sender"], 0) + 1
    return sent_by


def _participation_balance(sent_by: dict) -> float:
    # 발화자별 메시지 점유율의 정규화 엔트로피 (0=한 명만 말함, 1=모두 고르게 대화함)
    n = len(sent_by)
    if n <= 1:
        return 0.0

    total = sum(sent_by.values())
    shares = [c / total for c in sent_by.values()]
    entropy = -sum(s * math.log(s) for s in shares)
    return entropy / math.log(n)


def _minmax_normalize(raw: dict) -> dict:
    if not raw:
        return {}
    vals = list(raw.values())
    lo, hi = min(vals), max(vals)
    if hi == lo:
        return {k: 50.0 for k in raw}
    return {k: (v - lo) / (hi - lo) * 100 for k, v in raw.items()}


def _minmax_score(value, pool_values):
    if not pool_values:
        return 50.0
    lo, hi = min(pool_values), max(pool_values)
    if hi == lo:
        return 50.0
    return (value - lo) / (hi - lo) * 100


def _fetch_cross_room_message_counts(user_id, unit):
    # 같은 계정(user_id)이 가진 모든 채팅방의 기간별 메시지량 — Activity의 "다른 방과 비교" 기준 분포
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        if unit == "monthly":
            cursor.execute(
                """
                SELECT chatroom_id, DATE_FORMAT(block_date, '%Y-%m') AS period, SUM(message_count) AS cnt
                FROM message_block
                WHERE user_id = %s
                GROUP BY chatroom_id, period
                """,
                (user_id,),
            )
        else:
            cursor.execute(
                """
                SELECT chatroom_id, YEAR(block_date) AS period, SUM(message_count) AS cnt
                FROM message_block
                WHERE user_id = %s
                GROUP BY chatroom_id, period
                """,
                (user_id,),
            )
        rows = cursor.fetchall()
    finally:
        cursor.close()
        conn.close()

    return [float(cnt) for _, _, cnt in rows if cnt is not None]


def _compute_group_stats(groups: dict) -> dict:
    # period -> 원값(raw) 계산: 메시지량, 응답속도(간격 역수), 톤 표현 빈도, 참여 균형
    raw = {}
    for period, group in groups.items():
        sent_by = _speaker_message_counts(group)
        message_count = sum(sent_by.values())

        intervals = [_avg_response_interval_minutes(e) for e in group]
        intervals = [i for i in intervals if i is not None]
        avg_interval = sum(intervals) / len(intervals) if intervals else 1440.0  # 데이터 없으면 하루(느림)로 취급

        tone_hits = 0.0
        for e in group:
            for m in e["real_messages"]:
                tone_hits += _tone_marker_score(m["text"])
        tone_per_message = tone_hits / message_count if message_count else 0.0

        raw[period] = {
            "message_count": message_count,
            "response_speed_raw": 1.0 / (avg_interval + 1.0),  # 간격 역수 (빠를수록 큼)
            "tone_per_message": tone_per_message,
            "participation_balance": _participation_balance(sent_by),
        }
    return raw


def generate_message_mood(paths):
    blocks = _parse_message_blocks_from_parquet(paths)
    if not blocks:
        print("[message_mood] 분석할 대화 블록 없음")
        return

    key = _resolve_chatroom_key(paths.USER_ID)
    if key is None:
        print(f"[message_mood] chatroom 테이블에 해당 채팅방이 없습니다: {paths.USER_ID}")
        return
    chatroom_id, index_date, user_id = key

    monthly_groups, yearly_groups = _group_blocks_by_period(blocks)
    if not monthly_groups and not yearly_groups:
        print("[message_mood] 분석할 대화 없음")
        return

    def _score_unit(groups: dict, unit: str) -> dict:
        raw_stats = _compute_group_stats(groups)
        tone_norm = _minmax_normalize({p: s["tone_per_message"] for p, s in raw_stats.items()})
        speed_norm = _minmax_normalize({p: s["response_speed_raw"] for p, s in raw_stats.items()})

        cross_room_pool = _fetch_cross_room_message_counts(user_id, unit)

        result = {}
        for period, group in groups.items():
            print(f"[message_mood] {unit} 분위기 분석 중: {period} ({len(group)}개 블록)")

            private_ratio, content_description = _judge_mood_with_llm(_build_raw_text(group), period)

            stats = raw_stats[period]
            activity_cross_norm = _minmax_score(stats["message_count"], cross_room_pool)
            activity_score = activity_cross_norm * (0.5 + 0.5 * stats["participation_balance"])

            mood_score = (
                WEIGHT_CONTENT_JUDGE * private_ratio
                + WEIGHT_TONE * tone_norm.get(period, 50.0)
                + WEIGHT_ACTIVITY * activity_score
                + WEIGHT_RESPONSE_SPEED * speed_norm.get(period, 50.0)
            )

            result[period] = {
                "mood_score": round(mood_score, 2),
                "mood_description": content_description,
            }
        return result

    result = {
        "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "yearly": _score_unit(yearly_groups, "yearly"),
        "monthly": _score_unit(monthly_groups, "monthly"),
    }

    os.makedirs(paths.MAIL_STATICS_PATH, exist_ok=True)
    with open(paths.MESSAGE_MOOD_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[message_mood] 저장 완료: {paths.MESSAGE_MOOD_PATH}")

    save_message_mood_to_db(paths)


def recompute_all_message_moods(paths):
    # Activity가 같은 계정의 다른 채팅방들과 비교하는 방식이라, 새 채팅방이 인덱싱될 때마다
    # 그 계정의 모든 채팅방 mood를 다시 계산해서 비교 기준(pool)을 최신 상태로 맞춘다.
    from util.user_path import UserPaths
    from config.settings import BASE_DIR

    key = _resolve_chatroom_key(paths.USER_ID)
    if key is None:
        return
    _, _, user_id = key

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT DISTINCT chatroom_id FROM chatroom WHERE user_id = %s", (user_id,))
        chatroom_ids = [row[0] for row in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()

    for chatroom_id in chatroom_ids:
        room_paths = paths if chatroom_id == paths.USER_ID else UserPaths(BASE_DIR, chatroom_id, "messenger")
        generate_message_mood(room_paths)
