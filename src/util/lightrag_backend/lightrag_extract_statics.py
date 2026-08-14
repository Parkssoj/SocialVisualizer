# src/util/lightrag_backend/lightrag_extract_statics.py
#
# extract_statics.py(GraphRAG 버전)의 LightRAG 대응 파일. extract_statics.py는 건드리지
# 않았다. 그 파일의 3개 함수(_save_mail_keyword_stats, _save_mail_contact_stats,
# generate_person_descriptions) 중 앞의 둘만 여기서 raw-text 버전으로 다시 만든다.
#
# generate_person_descriptions는 옮기지 않았다: 조직/주제(Topic) 소속 같은 정보는
# GraphRAG의 LLM 엔티티 추출 결과에서만 나오고 mail_latest.txt 원문만으로는 재현할 수
# 없는 정보라서다. LightRAG 자체 그래프(엔티티/관계)를 읽어서 만드는 버전은 별도 작업으로
# 남겨두고, 지금은 db_writer.save_person_stats_to_db가 이미 갖고 있는 try/except로
# 빈 프로필({})을 받고 넘어가게 둔다 (person.description이 비게 되는 것 외엔 안전).
#
# LLM 호출 헬퍼(_is_friendly_tone_with_llm, extract_keywords_with_llm)와 client는
# extract_statics.py 것을 그대로 재사용한다 — GraphRAG 전용 로직이 아니라 순수 LLM
# 호출이라 엔진과 무관하다.

import os
import json
import re

from util.jobs.job_store import *  # extract_statics.py와 동일하게 job 로그 헬퍼 사용 가능하도록
from util.lightrag_backend.lightrag_mail_parser import parse_mail_blocks, extract_email
from util.extract_statics import extract_keywords_with_llm, _is_friendly_tone_with_llm

# mail_id별 "friendly"/"not_friendly" 판정을 캐시하는 파일. _save_mail_contact_stats_lightrag가
# 먼저 실행되며 이 캐시를 채워두면, 뒤에 실행되는 database.lightrag_db_writer.save_mail_to_db_lightrag가
# 같은 본문에 대해 LLM을 또 호출하지 않고 재사용한다 (파이프라인 순서상 contact stats가
# save_mail_to_db보다 항상 먼저 끝나므로 안전 — job_run_lightrag.py의 run_graph_pipeline/
# run_graph_update_pipeline 둘 다 _extract_statics_pipeline_lightrag를 save_mail_to_db_lightrag보다
# 먼저 호출한다).
_TONE_CACHE_FILENAME = "lightrag_tone_cache.json"


def _tone_cache_path(paths) -> str:
    return os.path.join(paths.MAIL_STATICS_PATH, _TONE_CACHE_FILENAME)


def load_tone_cache(paths) -> dict:
    path = _tone_cache_path(paths)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_tone_cache(paths, cache: dict):
    os.makedirs(paths.MAIL_STATICS_PATH, exist_ok=True)
    with open(_tone_cache_path(paths), "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


# 연락처(상대방)별 발신/수신/친밀 메일 수 집계.
# GraphRAG 버전은 entities.parquet(Person/Email 엔티티) + relationships.parquet(sent_by/sent_to
# 엣지)로 이 값을 만들었지만, mail_latest.txt에는 애초에 각 메일의 "구분"(발신/수신) 필드와
# 발신인/수신인이 그대로 있어서 그래프를 거칠 필요가 없다.
#
# 주의(알려진 단순화): 수신인 필드에 여러 명이 콤마로 나열된 경우, extract_email()은 첫 번째
# <email>만 뽑는다. GraphRAG 버전은 relationship 그래프 상 EMAIL↔PERSON 엣지가 수신인별로
# 나뉘어 있었다면 그룹메일 수신자를 각각 카운트했을 수 있지만, 이 버전은 대표 수신자 1명으로
# 카운트한다. 필요해지면 receiver 필드를 콤마로 split해서 각 수신자에게 카운트를 나눠주면 된다.
def _save_mail_contact_stats_lightrag(paths, mode: str = "rewrite"):
    if mode == "append" and os.path.exists(paths.MAIL_CONTACTS_PATH):
        with open(paths.MAIL_CONTACTS_PATH, "r", encoding="utf-8") as f:
            stats = json.load(f)
    else:
        stats = {}

    records = parse_mail_blocks(paths)
    if not records:
        print(f"[STATS][lightrag] mail_latest.txt 없음/비어있음 → contacts 생성 건너뜀")
        return

    my_email = (paths.USER_ID or "").lower()
    tone_cache = load_tone_cache(paths)

    deltas: dict[str, dict] = {}

    for r in records:
        sender_email = extract_email(r["sender"])
        receiver_email = extract_email(r["receiver"])

        # "구분" 필드(발신/수신, imap 수집 시점에 계정 주인 기준으로 이미 붙어있음)를 우선
        # 쓰고, 없으면 발신인 이메일이 본인 계정인지로 판별한다.
        if r["direction_raw"] == "발신":
            is_sent = True
        elif r["direction_raw"] == "수신":
            is_sent = False
        else:
            is_sent = (sender_email == my_email)

        if is_sent:
            contact_email, contact_raw, stat_key = receiver_email, r["receiver"], "sent"
        else:
            contact_email, contact_raw, stat_key = sender_email, r["sender"], "received"

        if not contact_email or contact_email == my_email:
            continue

        name_m = re.match(r'^(.*?)\s*<', contact_raw.strip()) if contact_raw else None
        name = name_m.group(1).strip().strip('"') if name_m else ""

        entry = deltas.setdefault(contact_email, {"name": "", "sent": 0, "received": 0, "friendly_mail": 0})
        if name and not entry["name"]:
            entry["name"] = name
        entry[stat_key] += 1

        mail_id = r["id"]
        cached = tone_cache.get(mail_id)
        if cached is None:
            is_friendly = _is_friendly_tone_with_llm(r["body"])
            tone_cache[mail_id] = "friendly" if is_friendly else "not_friendly"
        else:
            is_friendly = (cached == "friendly")

        if is_friendly:
            entry["friendly_mail"] += 1

    for email, delta in deltas.items():
        if mode == "append" and email in stats:
            prev = stats[email]
            stats[email] = {
                "name":          prev.get("name", "") or delta["name"],
                "sent":          prev.get("sent", 0)          + delta["sent"],
                "received":      prev.get("received", 0)      + delta["received"],
                "friendly_mail": prev.get("friendly_mail", 0) + delta["friendly_mail"],
            }
        else:
            stats[email] = delta

    with open(paths.MAIL_CONTACTS_PATH, "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    _save_tone_cache(paths, tone_cache)

    print(f"[STATS][lightrag] ({mode}) 계정 {len(stats)}개 집계 완료 → {paths.MAIL_CONTACTS_PATH}")


# 메일 본문에서 키워드 추출 → 키워드별/사람별/날짜별 카운트. GraphRAG 버전과 산출 JSON
# 형식(keywords/keyword_person_date_map/processed_mail_ids)은 동일하게 맞춰서
# database/db_writer.py의 save_keyword_stats_to_db(), db_reader의 소비 코드가
# 엔진과 무관하게 그대로 동작하게 했다.
def _save_mail_keyword_stats_lightrag(paths, mode: str = "rewrite"):
    if mode == "append" and os.path.exists(paths.MAIL_KEYWORDS_PATH):
        with open(paths.MAIL_KEYWORDS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            keyword_stats = data.get("keywords", {})
            keyword_person_date_map = data.get("keyword_person_date_map", {})
            processed_ids = set(data.get("processed_mail_ids", []))
    else:
        keyword_stats = {}
        keyword_person_date_map = {}
        processed_ids = set()

    records = parse_mail_blocks(paths)
    if not records:
        print(f"[KEYWORD][lightrag] mail_latest.txt 없음/비어있음 → 키워드 추출 건너뜀")
        return

    my_email = (paths.USER_ID or "").lower()

    for r in records:
        mail_id = r["id"]
        if mode == "append" and mail_id in processed_ids:
            continue

        mail_date = (r["date"] or "")[:10]  # YYYY-MM-DD
        sender_email = extract_email(r["sender"])
        receiver_email = extract_email(r["receiver"])
        person = receiver_email if sender_email == my_email else sender_email

        body = r["body"]
        if not body or not mail_date or not person:
            continue

        keywords = extract_keywords_with_llm(body)

        for kw in keywords:
            keyword_stats[kw] = keyword_stats.get(kw, 0) + 1
            keyword_person_date_map.setdefault(kw, {}).setdefault(person, {})
            keyword_person_date_map[kw][person][mail_date] = \
                keyword_person_date_map[kw][person].get(mail_date, 0) + 1

        if mail_id:
            processed_ids.add(mail_id)

    result = {
        "keywords": keyword_stats,
        "keyword_person_date_map": keyword_person_date_map,
        "processed_mail_ids": list(processed_ids),
    }

    with open(paths.MAIL_KEYWORDS_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[KEYWORD][lightrag] ({mode}) 키워드 {len(keyword_stats)}개 저장 완료 → {paths.MAIL_KEYWORDS_PATH}")


def _extract_statics_pipeline_lightrag(paths, mode: str = "rewrite"):
    os.makedirs(paths.MAIL_STATICS_PATH, exist_ok=True)
    _save_mail_keyword_stats_lightrag(paths, mode)
    _save_mail_contact_stats_lightrag(paths, mode)
