# 캐싱된 LocalSearch/GlobalSearch 엔진을 직접 호출해 단일·다중 계정 질의에 답변하고, 근거 메일 ID와 질의 로그를 정리해 저장한다.

# Calls the cached LocalSearch/GlobalSearch engines directly to answer single- or multi-account queries, then organizes and saves the supporting mail IDs and query logs.

import os
import re
import json
import asyncio # 비동기 실행 지원
import traceback
import threading
import time
import openai
from dotenv import load_dotenv

from util.graphrag_engine import get_engines, get_and_reset_usage # 유저별 캐싱된 local. global 엔진 반환 함수 임포트
from util.database.db_writer import save_query_to_db
from config.settings import MAIL_BLOCK_SEP

load_dotenv("src/parquet/.env")

# 연합 검색 결과를 query 테이블에 1행으로 저장한다 (참여 계정들의 토큰 사용량 총합, 인용 계정은 refer_kg에 기록)
def _save_federated_query(accounts_paths: list, primary_user_id: str, original_message: str,
                           elapsed: float, method: str, answer: str, refer_accounts: list = None):
    total_input = 0
    total_output = 0
    model_name = None
    for paths in accounts_paths:
        usage = get_and_reset_usage(paths.USER_ID, method)
        total_input += usage["input_tokens"]
        total_output += usage["output_tokens"]
        if not model_name and usage["model_name"]:
            model_name = usage["model_name"]

    # 어떤 계정이 실제로 근거가 됐는지 확신할 수 없으면 그냥 비워둠
    refer_kg = json.dumps(refer_accounts) if refer_accounts else None

    try:
        save_query_to_db(
            primary_user_id, original_message, elapsed, method,
            model_name=model_name,
            input_tokens=total_input,
            output_tokens=total_output,
            answer=answer,
            refer_kg=refer_kg,
        )
    except Exception as e:
        print(f"[WARN] 연합 검색 query DB 저장 실패 (무시): {e}")

# 계정의 mail_latest.txt에서 {메일ID(소문자): 실제 발신인} 매핑을 읽어 반환한다
def _load_account_sender_map(paths) -> dict:
    try:
        with open(paths.MAIL_LATEST_PATH, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return {}
    sender_map = {}
    for block in text.split(MAIL_BLOCK_SEP):
        id_m = re.search(r'^\[ID\]\s*(.+?)\s*$', block, re.MULTILINE)
        sender_m = re.search(r'^\[발신인\]\s*(.+?)\s*$', block, re.MULTILINE)
        if id_m and sender_m:
            sender_map[id_m.group(1).strip().lower()] = sender_m.group(1).strip()
    return sender_map

# 추출한 메일 ID 끝에 붙은 문장부호(대괄호·마침표 등)를 제거한다
def _strip_id_punct(mail_id: str) -> str:
    return mail_id.strip(']),.;:》」』')

# 메일 ID가 올바른지 판단한다 (LLM이 순번 "2" 등을 ID로 잘못 쓴 짧은 숫자는 걸러냄)
def _is_plausible_mail_id(mail_id: str) -> bool:
    return not (mail_id.isdigit() and len(mail_id) <= 6)

# LLM이 답변 맨 앞에 되풀이한 "> 질문" 줄을 제거한다
def _strip_echoed_question(answer: str) -> str:
    return re.sub(r'^>.*\n+', '', answer)

# 화면 표시용으로 답변을 정리한다 (불릿 줄바꿈 정규화, ID/계정 줄 제거, 빈 번호 줄 정리)
def strip_ids_for_display(text: str) -> str:
    text = re.sub(r'(?<!\n) - (?=\S)', '\n- ', text)
    text = re.sub(r'^[ \t]*[-*]?[ \t]*(ID|계정):\s*\S+[ \t]*\n?', '', text, flags=re.MULTILINE)
    text = re.sub(r'(ID|계정):\s*\S+', '', text)
    text = re.sub(r'^[ \t]*(?:\d+[.)]|[-*])[ \t]*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    return text

# 캐시된 LocalSearch/GlobalSearch 엔진을 직접 호출해 단일 계정 질의 답변과 근거 메일 ID 목록을 반환하고 query 로그를 저장한다
def run_graphrag_query(message: str, original_message: str, paths, method: str = "local") -> tuple[str, list]:
    start_time = time.time()
    result_container = {"result": None, "error": None} # 스레드 간에 결과나 에러를 공유하기 위한 컨테이너

    # 새 이벤트 루프를 가진 별도 스레드에서 비동기 검색을 실행하고 결과/에러를 컨테이너에 담는다
    def _run():
        loop = asyncio.new_event_loop() # 현재 스레드 전용 새 이벤트 루프 생성
        asyncio.set_event_loop(loop) # 현재 스레드의 기본 루프로 설정
        try:
            # 엔진을 검색해 답변을 정제하고 근거 메일 ID를 추출한다
            async def _search():
                output_dir = os.path.join(paths.GRAPHRAG_ROOT, "output")
                local_engine, global_engine = get_engines(paths.USER_ID, output_dir, paths.GRAPHRAG_ROOT) # 유저별 캐싱된 local + global 엔진 둘 다 가져오기 (캐시에서 재사용)
                engine = local_engine if method == "local" else global_engine
                result = await engine.search(message) # 엔진 객체 함수 호출
                answer = result.response # 검색 결과 객체에서 답변 텍스트 추출
                answer = _strip_echoed_question(answer) # 답변 맨 앞에 붙는 "> 질문 그대로" 줄 제거
                answer = re.sub(r'\[Data:.*?\]|\[데이터:.*?\]', '', answer) # graphrag가 답변에 삽입하는 출처 태그 제거
                answer = re.sub(r'\*+|#+', '', answer) # 마크다운 강조 기호 제거 (**, ## 등)
                answer = answer.strip() # 앞뒤 공백 제거

                # 1차: 답변 텍스트에서 ID 추출
                found = [_strip_id_punct(m) for m in re.findall(r'ID:\s*(\S+)', answer)]
                found = [m for m in found if _is_plausible_mail_id(m)]

                # 2차: LLM이 답변에 ID를 직접 안 썼을 때 → context_text(LLM에 넘긴 원본 청크)에서 추출
                if not found:
                    ctx = result.context_text
                    if isinstance(ctx, list):
                        ctx = '\n'.join(ctx)
                    if isinstance(ctx, str):
                        found = [_strip_id_punct(m) for m in re.findall(r'ID:\s*(\S+)', ctx)]
                        found = [m for m in found if _is_plausible_mail_id(m)]

                # 순서 유지하면서 중복 제거. 연합 검색(run_federated_local_search) 형태 통일
                seen = set()
                source_ids = []
                for id in found:
                    if id not in seen:
                        seen.add(id)
                        source_ids.append({"id": id, "account": paths.USER_ID})

                display_answer = strip_ids_for_display(answer)

                return display_answer, source_ids # 답변 텍스트와 근거 메일 ID 목록을 튜플로 반환

            result_container["result"] = loop.run_until_complete(_search())

        except Exception as e:
            traceback.print_exc()
            result_container["error"] = e
        finally:
            loop.close()

    # 완전히 새로운 스레드에서 _run 실행
    t = threading.Thread(target=_run, daemon=True)
    t.start()
    t.join(timeout=120)  # 최대 120초 대기. 120초 넘어도 답이 안 오면 런타임에러 발생 및 CLI fallback로 넘어감.

    if t.is_alive():
        raise RuntimeError("graphrag 검색 타임아웃 (120초)")

    if result_container["error"]:
        raise result_container["error"]

    elapsed = time.time() - start_time
    print(f"[ENGINE] 검색 완료: {elapsed:.2f}초")
    answer, source_ids = result_container["result"]  # 언패킹
    print(f"[ENGINE] 답변: {answer}")
    print(f"[ENGINE] source_ids: {source_ids}")
    try:
        usage = get_and_reset_usage(paths.USER_ID, method)
        save_query_to_db(
            paths.USER_ID, original_message, elapsed, method,
            model_name=usage["model_name"],
            input_tokens=usage["input_tokens"],
            output_tokens=usage["output_tokens"],
            answer=answer,
        )
    except Exception as e:
        print(f"[WARN] query DB 저장 실패 (무시): {e}")
    return answer, source_ids  # app.py의 _worker()로 튜플 반환

# 여러 계정의 로컬 서치 컨텍스트를 계정별로 조립·병합해 답변을 한 번만 생성하고, 근거 메일 ID·계정을 반환한다
def run_federated_local_search(message: str, original_message: str, accounts_paths: list,
                                primary_user_id: str = None, per_account_max_tokens: int = 3000) -> tuple[str, list]:
    start_time = time.time()
    result_container = {"result": None, "error": None}

    # 새 이벤트 루프를 가진 별도 스레드에서 연합 로컬 검색을 실행한다
    def _run():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            # 계정별 로컬 엔진 컨텍스트를 모아 답변을 생성하고 근거를 추출한다
            async def _search():
                engines = []
                for paths in accounts_paths:
                    try:
                        output_dir = os.path.join(paths.GRAPHRAG_ROOT, "output")
                        local_engine, _ = get_engines(paths.USER_ID, output_dir, paths.GRAPHRAG_ROOT)
                        engines.append((paths, local_engine))
                    except Exception as e:
                        print(f"[FEDERATED] {paths.USER_ID} 엔진 로드 실패, 스킵: {e}")

                if not engines:
                    return "인덱싱된 계정이 없습니다.", []

                combined_chunks = []
                account_sender_maps = {}  # user_id -> {메일ID(소문자): 진짜 발신인 값}
                for paths, engine in engines:
                    context_result = engine.context_builder.build_context(
                        query=message,
                        **engine.context_builder_params,
                    )
                    chunk_text = context_result.context_chunks
                    if isinstance(chunk_text, list):
                        chunk_text = "\n".join(chunk_text)

                    # 계정 하나가 프롬프트 예산을 독점하지 않도록 계정별로 토큰 상한을 둠
                    tokens = engine.tokenizer.encode(chunk_text)
                    if len(tokens) > per_account_max_tokens:
                        chunk_text = engine.tokenizer.decode(tokens[:per_account_max_tokens])

                    account_sender_maps[paths.USER_ID] = _load_account_sender_map(paths)
                    used_tokens = min(len(tokens), per_account_max_tokens)
                    print(f"[FEDERATED] {paths.USER_ID}: 컨텍스트 {used_tokens}토큰, 보유 메일 {len(account_sender_maps[paths.USER_ID])}건")

                    combined_chunks.append(f"[계정: {paths.USER_ID}]\n{chunk_text}")

                merged_context = "\n\n".join(combined_chunks)

                # 답변 속 메일 ID로 원본 데이터를 찾아 (진짜 ID, 계정 user_id)를 반환한다 (완전일치→부분일치 순 완화, 실패 시 None,None)
                def _find_real_id(mail_id: str):
                    key = mail_id.lower()

                    for user_id, smap in account_sender_maps.items():
                        if key in smap:
                            return key, user_id

                    key_local = key.split('@')[0]
                    for user_id, smap in account_sender_maps.items():
                        for real_id in smap:
                            if real_id.split('@')[0] == key_local:
                                return real_id, user_id

                    if len(key) >= 8:
                        for user_id, smap in account_sender_maps.items():
                            for real_id in smap:
                                if real_id.startswith(key) or key.startswith(real_id):
                                    return real_id, user_id

                    return None, None

                # 메일 ID로 소속 계정 user_id를 역추적한다 (실패 시 None)
                def _resolve_account(mail_id: str):
                    _, user_id = _find_real_id(mail_id)
                    if not user_id:
                        print(f"[FEDERATED] 계정 매칭 실패, 원본 ID: {mail_id!r}")
                    return user_id

                # 답변 생성 설정(system_prompt/model 등)은 계정마다 동일하므로 첫 번째 엔진 것을 그대로 재사용
                _, first_engine = engines[0]
                search_prompt = first_engine.system_prompt.format(
                    context_data=merged_context,
                    response_type=first_engine.response_type,
                )

                # 도메인마다 원본 블록의 필드 구성이 다르므로(이메일: 발신인/수신인, 카카오: 채팅방/참여자)도메인별로 분기한다.
                domain = engines[0][0].DOMAIN
                if domain == "messenger":
                    search_prompt += (
                        "\n\n추가 지시사항: 위 데이터는 서로 다른 여러 카카오톡 채팅방에서 수집되었으며, "
                        "각 데이터 블록 앞에 [계정: 채팅방이름] 형태로 출처 채팅방이 표시되어 있다. "
                        "질문과 관련된 내용이 여러 채팅방에 걸쳐 있다면 한쪽 채팅방에 치우치지 말고 "
                        "관련 있는 채팅방을 빠짐없이 골고루 다루되, 특정 채팅방에 관련 내용이 없으면 "
                        "그 채팅방은 억지로 언급하지 말고 실제로 관련 있는 내용만으로 답하라. "
                        "원본 데이터의 각 대화 블록은 'ID:'(날짜 기준 블록 식별자), '채팅방:', '참여자:' 필드를 "
                        "갖고 있고, 실제 발화 내용은 '[대화 내용]' 아래 'HH:MM 이름: 메시지' 형태로 적혀있다. "
                        "발화자를 언급할 때는 그 줄의 이름을 그대로 쓰고, 'ID:' 필드의 값을 발화자 이름 "
                        "자리에 쓰지 마라. "
                        "목록으로 나열하든 묶어서 요약하든 답변 형식과 무관하게, 실제로 언급/근거로 삼은 "
                        "대화 블록마다 'ID: 원본ID값'을 요약 문장에 섞어 쓰지 말고 그 항목의 별도 줄로 표기하라. "
                        "'ID:' 뒤에는 반드시 데이터에 있는 실제 ID 값을 정확히 그대로 옮겨 적어야 한다. "
                        "답변에서 대화를 1번, 2번처럼 순서대로 나열하더라도 그 순번을 'ID: 1', 'ID: 2'처럼 "
                        "ID인 것으로 쓰지 마라 — 그건 데이터에 없는 값을 지어내는 것이다. "
                        "그리고 언급/근거로 삼은 대화 블록마다 'ID:'와 같은 줄에 '계정: 채팅방이름' 줄도 "
                        "추가하라 — 그 대화가 어느 [계정: ...] 블록에서 나온 데이터인지, 컨텍스트에 표시된 "
                        "채팅방 이름을 정확히 그대로 옮겨 적어라."
                    )
                else:
                    search_prompt += (
                        "\n\n추가 지시사항: 위 데이터는 서로 다른 여러 이메일 계정에서 수집되었으며, "
                        "각 데이터 블록 앞에 [계정: 이메일주소] 형태로 출처 계정이 표시되어 있다. "
                        "질문과 관련된 내용이 여러 계정에 걸쳐 있다면 한쪽 계정에 치우치지 말고 "
                        "관련 있는 계정을 빠짐없이 골고루 다루되, 특정 계정에 관련 내용이 없으면 "
                        "그 계정은 억지로 언급하지 말고 실제로 관련 있는 내용만으로 답하라. "
                        "원본 데이터에는 메일마다 '[ID]'와 '[발신인]'이 서로 다른 별개 필드로 있으니 "
                        "절대 혼동하지 말 것 — 발신자를 쓸 때는 반드시 '[발신인]' 필드의 이메일 주소를 쓰고, "
                        "'[ID]' 필드의 값을 발신자 자리에 쓰지 마라. "
                        "목록으로 나열하든 묶어서 요약하든 답변 형식과 무관하게, 실제로 언급/근거로 삼은 "
                        "메일마다 'ID: 원본ID값'을 요약 문장에 섞어 쓰지 말고 그 메일 항목의 별도 줄로 표기하라. "
                        "'ID:' 뒤에는 반드시 데이터에 있는 실제 ID 값을 정확히 그대로 옮겨 적어야 한다. "
                        "답변에서 메일을 1번, 2번처럼 순서대로 나열하더라도 그 순번을 'ID: 1', 'ID: 2'처럼 "
                        "ID인 것으로 쓰지 마라 — 그건 데이터에 없는 값을 지어내는 것이다. "
                        "그리고 언급/근거로 삼은 메일마다 'ID:', '발신인:'과 같은 줄에 '계정: 이메일주소' 줄도 "
                        "추가하라 — 그 메일이 어느 [계정: ...] 블록에서 나온 데이터인지, 컨텍스트에 표시된 "
                        "계정 이메일 주소를 정확히 그대로 옮겨 적어라."
                    )
                
                
                messages = [
                    {"role": "system", "content": search_prompt},
                    {"role": "user", "content": message},
                ]

                full_response = ""
                response = await first_engine.model.completion_async(
                    messages=messages,
                    stream=True,
                )
                async for chunk in response:
                    full_response += chunk.choices[0].delta.content or ""

                full_response = _strip_echoed_question(full_response) # 답변 맨 앞에 붙는 "> 질문 그대로" 줄 제거
                answer = re.sub(r'\[Data:.*?\]|\[데이터:.*?\]', '', full_response)
                answer = re.sub(r'\*+|#+', '', answer)
                answer = answer.strip()

                # 답변 문단 하나에서 ID에 해당하는 진짜 발신인 값으로 '발신인:' 줄을 강제 교정한다
                def _fix_paragraph_sender(p):
                    id_m = re.search(r'ID:\s*(\S+)', p)
                    if not id_m:
                        return p
                    real_id, user_id = _find_real_id(_strip_id_punct(id_m.group(1)))
                    if not real_id:
                        return p
                    real_sender = account_sender_maps[user_id].get(real_id)
                    if not real_sender or not re.search(r'발신인:', p):
                        return p
                    return re.sub(r'(발신인:\s*)(.*)$', lambda m: m.group(1) + real_sender, p, count=1, flags=re.MULTILINE)

                answer = '\n\n'.join(_fix_paragraph_sender(p) for p in answer.split('\n\n'))

                # 항목마다 ID가 있으면 그 ID로 진짜 소속 계정을 역추적
                found = [_strip_id_punct(m) for m in re.findall(r'ID:\s*(\S+)', answer)]
                found = [m for m in found if _is_plausible_mail_id(m)]
                seen = set()
                source_ids = []
                for id in found:
                    if id not in seen:
                        seen.add(id)
                        source_ids.append({"id": id, "account": _resolve_account(id)})

                if not source_ids:
                    # ID를 하나도 못 찾았을 때(요약형 답변 등)만 LLM이 쓴 '계정:' 값으로 폴백.
                    valid_accounts = {p.USER_ID.strip().lower(): p.USER_ID for p, _ in engines}
                    cited_accounts = []
                    for m in re.findall(r'계정:\s*(\S+)', answer):
                        real = valid_accounts.get(_strip_id_punct(m).strip().lower())
                        if real:
                            cited_accounts.append(real)
                    source_ids = [{"id": None, "account": acc} for acc in cited_accounts]

                display_answer = strip_ids_for_display(answer)

                return display_answer, source_ids

            result_container["result"] = loop.run_until_complete(_search())

        except Exception as e:
            traceback.print_exc()
            result_container["error"] = e
        finally:
            loop.close()

    # 계정 수가 많으면 컨텍스트 조립(임베딩 검색)에 시간이 더 걸릴 수 있어 기존 120초보다 여유를 둠
    t = threading.Thread(target=_run, daemon=True)
    t.start()
    t.join(timeout=180)

    if t.is_alive():
        raise RuntimeError("연합 검색 타임아웃 (180초)")

    if result_container["error"]:
        raise result_container["error"]

    elapsed = time.time() - start_time
    answer, source_ids = result_container["result"]
    print(f"[FEDERATED] 검색 완료: {elapsed:.2f}초, 계정 {len(accounts_paths)}개")

    # source_ids에서 실제로 인용된 계정만 refer_kg에 남긴다 (인용이 없으면 refer_kg는 비워둠)
    referenced = []
    seen_accounts = set()
    for s in source_ids:
        acc = s.get("account")
        if acc and acc not in seen_accounts:
            seen_accounts.add(acc)
            referenced.append(acc)
    _save_federated_query(
        accounts_paths, primary_user_id or accounts_paths[0].USER_ID,
        original_message, elapsed, "local", answer, referenced,
    )
    return answer, source_ids

# 여러 계정의 글로벌 서치를 연합한다 (map은 계정별, reduce는 전체를 모아 1회 실행해 비용 절감)
def run_federated_global_search(message: str, original_message: str, accounts_paths: list,
                                 primary_user_id: str = None) -> tuple[str, list]:
    start_time = time.time()
    result_container = {"result": None, "error": None}

    # 새 이벤트 루프를 가진 별도 스레드에서 연합 글로벌 검색을 실행한다
    def _run():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            # 계정별 map 응답을 모아 reduce를 1회 실행해 최종 답변을 만든다
            async def _search():
                engines = []
                for paths in accounts_paths:
                    try:
                        output_dir = os.path.join(paths.GRAPHRAG_ROOT, "output")
                        _, global_engine = get_engines(paths.USER_ID, output_dir, paths.GRAPHRAG_ROOT)
                        engines.append((paths, global_engine))
                    except Exception as e:
                        print(f"[FEDERATED-GLOBAL] {paths.USER_ID} 엔진 로드 실패, 스킵: {e}")

                if not engines:
                    return "인덱싱된 계정이 없습니다.", [], []

                all_map_responses = []
                for paths, engine in engines:
                    context_result = await engine.context_builder.build_context(
                        query=message,
                        **engine.context_builder_params,
                    )
                    # map: 커뮤니티 보고서 묶음마다 개별 LLM 호출 (계정별로 각자 실행)
                    map_responses = await asyncio.gather(*[
                        engine._map_response_single_batch(
                            context_data=data, query=message,
                            max_length=engine.map_max_length,
                            **engine.map_llm_params,
                        )
                        for data in context_result.context_chunks
                    ])
                    print(f"[FEDERATED-GLOBAL] {paths.USER_ID}: map 배치 {len(map_responses)}개")
                    all_map_responses.extend(map_responses)

                # reduce: 전체 계정의 map 결과를 모아 딱 1번만 합성 (계정 수와 무관하게 항상 1번)
                _, first_engine = engines[0]
                reduce_response = await first_engine._reduce_response(
                    map_responses=all_map_responses,
                    query=message,
                    **first_engine.reduce_llm_params,
                )

                reduce_text = _strip_echoed_question(reduce_response.response) # 답변 맨 앞에 붙는 "> 질문 그대로" 줄 제거
                answer = re.sub(r'\[Data:.*?\]|\[데이터:.*?\]', '', reduce_text)
                answer = re.sub(r'\*+|#+', '', answer)
                answer = answer.strip()

                # 글로벌 서치는 원래도 개별 메일을 인용하는 방식이 아니라(전체 경향/패턴 요약) 근거 계정이 없음.
                # 다만 map 단계가 실제로 돌아간 계정 목록은 확실하므로 refer_kg용으로 같이 반환한다.
                participated = [paths.USER_ID for paths, _ in engines]
                return answer, [], participated

            result_container["result"] = loop.run_until_complete(_search())

        except Exception as e:
            traceback.print_exc()
            result_container["error"] = e
        finally:
            loop.close()

    # map 단계가 계정 수만큼 늘어날 수 있어 넉넉하게 대기
    t = threading.Thread(target=_run, daemon=True)
    t.start()
    t.join(timeout=240)

    if t.is_alive():
        raise RuntimeError("연합 글로벌 검색 타임아웃 (240초)")

    if result_container["error"]:
        raise result_container["error"]

    elapsed = time.time() - start_time
    answer, source_ids, participated = result_container["result"]
    print(f"[FEDERATED-GLOBAL] 검색 완료: {elapsed:.2f}초, 계정 {len(accounts_paths)}개")
    _save_federated_query(
        accounts_paths, primary_user_id or accounts_paths[0].USER_ID,
        original_message, elapsed, "global", answer, participated,
    )
    return answer, source_ids

# 질문이 로컬 검색용인지 글로벌 검색용인지 LLM으로 분류해 "local"/"global"을 반환한다
def _classify_query_method(message: str) -> str:
    prompt = f"""다음 질문이 로컬 검색(특정 메일·인물·날짜·주제)에 적합한지,
                글로벌 검색(전체 경향·요약·패턴·빈도)에 적합한지 판단하라.
                "local" 또는 "global" 중 하나만 반환하라.

                질문: {message}"""

    client = openai.OpenAI(
        api_key=os.environ.get("LLM_API_KEY"),
        base_url=os.environ.get("SUB_TASK_API_BASE") or None,
    )

    res = client.chat.completions.create(
        model=os.getenv("SUB_TASK_CHAT_MODEL"),
        messages=[{"role": "user", "content": prompt}],
        temperature=0
    )

    method = res.choices[0].message.content.strip().lower()
    print(f"[CLASSIFY] 질의: {message[:30]} → {method}")
    return method if method in ("local", "global") else "local"
