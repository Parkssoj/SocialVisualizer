# src/util/lightrag_backend/lightrag_query.py
#
# graphrag_query.py(GraphRAG 버전)의 LightRAG 대응 파일. 새로 만든 파일이며
# graphrag_query.py는 건드리지 않았다.
#
# 바뀐 것: get_engines()로 가져오던 GraphRAG의 LocalSearch/GlobalSearch 엔진 객체를
# lightrag_engine.get_lightrag_instance()가 반환하는 LightRAG 인스턴스 하나로 교체했다.
# 답변 생성은 rag.aquery(), 생성 없이 근거 청크만 가져올 때는 rag.aquery_data()를 쓴다
# (GraphRAG 버전이 result.context_text에서 근거를 뽑던 것과 같은 역할).
#
# ID/발신인 관련 정규식 로직(strip_ids_for_display 등)은 GraphRAG 라이브러리가 만든 게
# 아니라 이 파일 자체에서 우리가 만든 서버 로직이라 그대로 재사용한다. 다만 이게 잘
# 동작하려면 인덱싱하는 문서(메일 본문)에 "ID: ..." "발신인: ..." 필드가 들어있어야 하는데,
# 그건 프롬프트/문서 포맷 쪽 문제라 우리 책임 밖이다(개발자가 정할 부분).
#
# 연합 검색(run_federated_*)은 GraphRAG 버전이 context_builder/model 같은 라이브러리
# 내부 객체를 직접 찔러서 여러 계정 컨텍스트를 하나로 합친 뒤 생성 호출을 1번만 했는데,
# LightRAG는 그런 내부 객체를 노출하지 않는다. 대신 rag.aquery_data()로 계정별 근거
# 청크만 가져오고(생성 호출 없음, 저렴함) 합친 뒤, 우리가 직접 만든 프롬프트로 생성 호출을
# 1번만 실행하는 방식으로 동일한 목표(계정 수만큼 비싼 생성 호출이 늘어나지 않게)를 유지했다.
#
# 모드는 GraphRAG의 local/global 이분법에 갇히지 않고 LightRAG가 지원하는 6개
# (local/global/hybrid/naive/mix/bypass) 전부를 그대로 통과시킨다:
#   - run_lightrag_query(method=...)      : method 문자열을 그대로 QueryParam(mode=...)에 전달
#   - run_federated_search(mode=...)      : 연합 검색용 공개 함수, mode 아무거나 가능
#   - run_federated_local_search/_global_search : app.py가 지금 쓰는 이름을 유지하기 위한
#     얇은 래퍼(각각 run_federated_search(mode="local"/"global")를 호출)
# app.py는 아직 resMethod를 "local"/"global" 둘 중 하나로만 분류해서 이 두 래퍼만 부르고
# 있어서(다른 4개 모드는 이 파일만 준비돼 있고 실제로 호출되진 않음) — app.py 쪽 분기를
# 넓히는 건 app.py를 lightrag로 연결할 때 같이 처리해야 하는 별도 작업이다.

import os
import sys
import re
import json
import concurrent.futures
import traceback
import time
import openai

from config.settings import MAIL_BLOCK_SEP, BASE_DIR
from util.lightrag_backend.lightrag_engine import get_lightrag_instance, get_and_reset_usage
from util.lightrag_backend.lightrag_loop import run_coroutine
from util.database.db_writer import save_query_to_db

sys.path.insert(0, os.path.join(BASE_DIR, "LightRAG"))
from lightrag import QueryParam

# 질의 분류(로컬/글로벌 판단)처럼 RAG 검색 자체가 아닌 보조 작업은 SUB_TASK_CHAT_MODEL을 쓴다.
_RAG_CHAT_MODEL = os.environ.get("RAG_CHAT_MODEL", "gpt-4o-mini")


# 연합 검색은 query 테이블에 계정마다 행을 따로 남기지 않고 딱 1행만 저장한다.
# user_id는 앱 전체에서 하나로 통일돼 있어 어느 계정으로 저장해도 동일하므로 primary_user_id는 FK 채우기용일 뿐이고,
# 실제로 참고한 계정 목록은 refer_kg에 기록한다. 토큰 사용량은 참여한 계정들의 사용량을 전부 더한 총합으로 저장한다.
def _save_federated_query(accounts_paths: list, primary_user_id: str, original_message: str,
                           elapsed: float, method: str, answer: str, refer_accounts: list = None):
    total_input = 0
    total_output = 0
    model_name = None
    for paths in accounts_paths:
        usage = get_and_reset_usage(paths.USER_ID)  # LightRAG는 엔진이 하나뿐이라 method 인자 불필요
        total_input += usage["input_tokens"]
        total_output += usage["output_tokens"]
        if not model_name and usage["model_name"]:
            model_name = usage["model_name"]

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


# 계정의 mail_latest.txt에서 "메일 ID → 실제 발신인" 매핑을 읽어온다.
# LLM이 조립한 컨텍스트나 답변을 정규식으로 다시 파싱하면 내부 포맷/토큰 잘림/LLM의 필드 혼동 때문에
# 틀리기 쉬워서, 원본 파일에서 직접 읽어와 정답으로 덮어쓰는 방식이 훨씬 안정적이다.
def _load_account_sender_map(paths) -> dict:
    try:
        with open(paths.MAIL_LATEST_PATH, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return {}
    sender_map = {}
    # 대괄호 형식("[ID] ...")과 콜론 형식("ID: ...") 둘 다 받는다 — 실제 mail_latest.txt는
    # 대괄호 형식이라 콜론만 찾던 이전 버전은 항상 매칭 실패했다(다른 lightrag_* 파일들의
    # 같은 버그와 동일한 원인/수정).
    for block in text.split(MAIL_BLOCK_SEP):
        id_m = re.search(r'^\s*(?:\[ID\]|ID:)\s*(.+?)\s*$', block, re.MULTILINE)
        sender_m = re.search(r'^\s*(?:\[발신인\]|발신인:)\s*(.+?)\s*$', block, re.MULTILINE)
        if id_m and sender_m:
            sender_map[id_m.group(1).strip().lower()] = sender_m.group(1).strip()
    return sender_map


# 답변에서 "ID: xxx" 뽑을 때 \S+ 가 뒤에 붙은 문장부호(대괄호, 마침표 등)까지 같이 잡아버리는 경우가 있어
# (예: "[ID: xxx@icloud.com]" → "xxx@icloud.com]") 매칭 전에 제거해준다
def _strip_id_punct(mail_id: str) -> str:
    return mail_id.strip(']),.;:》」』')


# LLM이 답변에서 메일을 1, 2, 3... 처럼 순번을 매기다가 그 순번을 그대로 "ID: 2"로 써버리는 경우가 있음.
# 실제 메일 ID는 항상 길고(16자리 hex, 또는 '@'가 포함된 긴 문자열) 이런 순수 짧은 숫자가 나올 수 없으므로,
# 매칭 시도(=필연적으로 실패해서 "알 수 없음"으로 뜸) 자체를 하지 않고 미리 걸러낸다.
def _is_plausible_mail_id(mail_id: str) -> bool:
    return not (mail_id.isdigit() and len(mail_id) <= 6)


# ID/계정 필드는 근거 추출(계정 매칭, 발신인 교정)에만 쓰고 사용자에게 보여줄 답변에서는 지운다.
def strip_ids_for_display(text: str) -> str:
    text = re.sub(r'^[ \t]*[-*]?[ \t]*(ID|계정):\s*\S+[ \t]*\n?', '', text, flags=re.MULTILINE)
    text = re.sub(r'(ID|계정):\s*\S+', '', text)
    text = re.sub(r'^[ \t]*(?:\d+[.)]|[-*])[ \t]*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    return text


# 텍스트에서 그럴듯한 메일 ID만 뽑아내는 공용 헬퍼 (답변/근거 청크 양쪽에서 재사용)
def _extract_ids_from_text(text: str) -> list[str]:
    found = [_strip_id_punct(m) for m in re.findall(r'ID:\s*(\S+)', text)]
    return [m for m in found if _is_plausible_mail_id(m)]


# rag.aquery_data()가 돌려주는 구조화 결과에서 근거 청크 본문만 이어붙인다
def _chunks_text(data: dict) -> str:
    chunks = data.get("data", {}).get("chunks", [])
    return "\n".join(c.get("content", "") for c in chunks)


# cli 호출 방식인 _run_graphrag() / GraphRAG 엔진 직접 호출 방식인 run_graphrag_query() 대체용.
# method는 그대로 QueryParam(mode=...)에 들어가므로 "local"/"global"뿐 아니라
# "hybrid"/"naive"/"mix"/"bypass" 아무거나 넘겨도 동작한다 (_VALID_MODES 참고).
def run_lightrag_query(message: str, original_message: str, paths, method: str = "mix") -> tuple[str, list]:
    start_time = time.time()

    # 예전엔 여기서 스레드+새 이벤트 루프를 매번 만들었다 닫았는데(플라스크가 자체
    # 이벤트 루프를 갖고 있어서 asyncio.run()을 바로 못 쓰는 사정은 동일), 그러면 캐시된
    # LightRAG 인스턴스가 매번 다른 루프에서 재사용되면서 "Event loop is closed"/
    # "Task was destroyed but it is pending!" 문제가 났다. 지금은 앱 전체가 공유하는
    # 절대 안 닫는 루프(lightrag_loop.py)에 코루틴만 제출한다 — 인스턴스와 그 백그라운드
    # 워커들이 항상 같은 루프에서 살기 때문에 그 문제가 근본적으로 없어진다.
    async def _search():
        rag = await get_lightrag_instance(paths.USER_ID, paths.LIGHTRAG_OUTPUT_DIR)
        param = QueryParam(mode=method)

        answer = await rag.aquery(message, param)
        answer = re.sub(r'\[Data:.*?\]|\[데이터:.*?\]', '', answer)
        answer = re.sub(r'\*+|#+', '', answer)
        answer = answer.strip()

        # 1차: 답변 텍스트에서 ID 추출
        found = _extract_ids_from_text(answer)

        # 2차: 답변에 ID가 없으면(LLM이 안 썼으면) 생성 호출 없이 근거 청크만
        # 다시 가져와서(aquery_data는 LLM 답변 생성 단계를 건너뜀) 추출
        if not found:
            data = await rag.aquery_data(message, param)
            found = _extract_ids_from_text(_chunks_text(data))

        # 순서 유지하면서 중복 제거
        seen = set()
        source_ids = []
        for id in found:
            if id not in seen:
                seen.add(id)
                source_ids.append({"id": id, "account": paths.USER_ID})

        display_answer = strip_ids_for_display(answer)
        return display_answer, source_ids

    try:
        result = run_coroutine(_search(), timeout=120)
    except concurrent.futures.TimeoutError:
        raise RuntimeError("lightrag 검색 타임아웃 (120초)")
    except Exception as e:
        traceback.print_exc()
        raise

    elapsed = time.time() - start_time
    print(f"[ENGINE][lightrag] 검색 완료: {elapsed:.2f}초")
    answer, source_ids = result
    print(f"[ENGINE][lightrag] 답변: {answer}")
    print(f"[ENGINE][lightrag] source_ids: {source_ids}")
    try:
        usage = get_and_reset_usage(paths.USER_ID)
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


# 여러 계정의 근거 청크를 계정별로 따로 모은 뒤(aquery_data만 사용, 생성 호출 없음),
# 답변 생성 LLM 호출은 전체를 합쳐서 딱 한 번만 실행한다.
# (계정 수만큼 비싼 답변 생성 호출이 늘어나는 걸 막기 위함 — 근거 수집은 임베딩 검색이라 저렴함)
# mode에 "local"/"global"뿐 아니라 "hybrid"/"naive"/"mix"/"bypass" 등 QueryParam이
# 받는 6개 모드 아무거나 넣어도 동작하는 공개 함수다. run_federated_local_search/
# run_federated_global_search는 app.py가 쓰는 기존 이름을 유지하려고 남겨둔 얇은 래퍼일 뿐,
# 다른 모드로 연합 검색을 하고 싶으면 이 함수를 직접 mode="hybrid" 등으로 불러도 된다.
def run_federated_search(message: str, original_message: str, accounts_paths: list, mode: str,
                          primary_user_id: str = None, per_account_max_tokens: int = 3000) -> tuple[str, list]:
    start_time = time.time()

    async def _search():
        param = QueryParam(mode=mode)
        combined_chunks = []
        account_sender_maps = {}  # user_id -> {메일ID(소문자): 진짜 발신인 값}
        valid_accounts_paths = []

        for paths in accounts_paths:
            try:
                rag = await get_lightrag_instance(paths.USER_ID, paths.LIGHTRAG_OUTPUT_DIR)
                data = await rag.aquery_data(message, param)
            except Exception as e:
                print(f"[FEDERATED] {paths.USER_ID} 인스턴스 로드/조회 실패, 스킵: {e}")
                continue

            chunk_text = _chunks_text(data)
            # 계정 하나가 프롬프트 예산을 독점하지 않도록 상한을 둔다.
            # GraphRAG 버전은 engine.token_encoder로 토큰 단위로 잘랐는데, LightRAG는
            # 그 인코더를 노출하지 않아서 문자 수(대략 1토큰≈4자)로 추정해서 대체한다.
            max_chars = per_account_max_tokens * 4
            if len(chunk_text) > max_chars:
                chunk_text = chunk_text[:max_chars]

            account_sender_maps[paths.USER_ID] = _load_account_sender_map(paths)
            print(f"[FEDERATED] {paths.USER_ID}: 컨텍스트 {len(chunk_text)}자, 보유 메일 {len(account_sender_maps[paths.USER_ID])}건")

            combined_chunks.append(f"[계정: {paths.USER_ID}]\n{chunk_text}")
            valid_accounts_paths.append(paths)

        if not combined_chunks:
            return "인덱싱된 계정이 없습니다.", []

        merged_context = "\n\n".join(combined_chunks)

        # 답변에 나온 ID로 원본 데이터를 찾는다. 완전 일치 → 도메인 빠진 경우 → 일부만 옮겨 적힌 경우 순으로 완화.
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

        def _resolve_account(mail_id: str):
            _, user_id = _find_real_id(mail_id)
            if not user_id:
                print(f"[FEDERATED] 계정 매칭 실패, 원본 ID: {mail_id!r}")
            return user_id

        # 응답 형식/ID·발신인 혼동 방지 지시사항은 GraphRAG 라이브러리 프롬프트가 아니라
        # 이 파일에서 우리가 직접 짠 문구라 그대로 재사용한다.
        system_prompt = (
            "아래 데이터를 근거로 질문에 여러 문단(Multiple Paragraphs) 형식으로 답하라.\n\n"
            f"데이터:\n{merged_context}\n\n"
            "추가 지시사항: 위 데이터는 서로 다른 여러 이메일 계정에서 수집되었으며, "
            "각 데이터 블록 앞에 [계정: 이메일주소] 형태로 출처 계정이 표시되어 있다. "
            "질문과 관련된 내용이 여러 계정에 걸쳐 있다면 한쪽 계정에 치우치지 말고 "
            "관련 있는 계정을 빠짐없이 골고루 다루되, 특정 계정에 관련 내용이 없으면 "
            "그 계정은 억지로 언급하지 말고 실제로 관련 있는 내용만으로 답하라. "
            "원본 데이터에는 메일마다 'ID:'와 '발신인:'이 서로 다른 별개 필드로 있으니 "
            "절대 혼동하지 말 것 — 발신자를 쓸 때는 반드시 '발신인:' 필드의 이메일 주소를 쓰고, "
            "'ID:' 필드의 값을 발신자 자리에 쓰지 마라. "
            "목록으로 나열하든 묶어서 요약하든 답변 형식과 무관하게, 실제로 언급/근거로 삼은 "
            "메일마다 'ID: 원본ID값'을 요약 문장에 섞어 쓰지 말고 그 메일 항목의 별도 줄로 표기하라. "
            "'ID:' 뒤에는 반드시 데이터에 있는 실제 ID 값을 정확히 그대로 옮겨 적어야 한다. "
            "답변에서 메일을 1번, 2번처럼 순서대로 나열하더라도 그 순번을 'ID: 1', 'ID: 2'처럼 "
            "ID인 것으로 쓰지 마라 — 그건 데이터에 없는 값을 지어내는 것이다. "
            "그리고 언급/근거로 삼은 메일마다 'ID:', '발신인:'과 같은 줄에 '계정: 이메일주소' 줄도 "
            "추가하라 — 그 메일이 어느 [계정: ...] 블록에서 나온 데이터인지, 컨텍스트에 표시된 "
            "계정 이메일 주소를 정확히 그대로 옮겨 적어라."
        )

        client = openai.AsyncOpenAI(api_key=os.environ.get("LLM_API_KEY"))
        try:
            # 여러 계정 내용을 종합하는 답변이라 계정 하나만 볼 때보다 더 길어질 수 있어 응답 길이 상한을 넉넉히 둠
            max_tokens = max(2000, 2000 * len(valid_accounts_paths))
            response = await client.chat.completions.create(
                model=_RAG_CHAT_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": message},
                ],
                max_completion_tokens=max_tokens,  # RAG_CHAT_MODEL이 gpt-5 계열이면 max_tokens 대신 이 파라미터를 받는다
            )
        finally:
            # client를 명시적으로 안 닫으면 aclose()가 나중에 가비지 컬렉터에서 뒤늦게
            # 실행될 수 있어(예전엔 그 시점에 이미 loop.close()가 끝나 있어서 "Event loop
            # is closed" 에러가 났음), 루프가 살아있는 지금 이 자리에서 바로 닫는다.
            # (지금은 공유 루프가 절대 안 닫히므로 예전만큼 급한 문제는 아니지만,
            # 커넥션을 계속 열어두지 않기 위해 명시적으로 정리하는 게 맞다.)
            await client.close()
        full_response = response.choices[0].message.content or ""

        answer = re.sub(r'\[Data:.*?\]|\[데이터:.*?\]', '', full_response)
        answer = re.sub(r'\*+|#+', '', answer)
        answer = answer.strip()

        # 프롬프트로 "발신인 자리에 ID값 쓰지 마라"고 지시해도 LLM이 종종 혼동해서 틀리게 쓰므로,
        # 아예 각 항목의 ID로 원본 데이터를 찾아 진짜 발신인 값으로 강제로 덮어쓴다.
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

        # 항목마다 ID가 있으면 그 ID로 진짜 소속 계정을 역추적하는 쪽이 정확하다.
        found = _extract_ids_from_text(answer)
        seen = set()
        source_ids = []
        for id in found:
            if id not in seen:
                seen.add(id)
                source_ids.append({"id": id, "account": _resolve_account(id)})

        if not source_ids:
            # ID를 하나도 못 찾았을 때(요약형 답변 등)만 LLM이 쓴 '계정:' 값으로 폴백.
            # 실제 인덱싱된 계정 목록에 없는 값(오타/환각)은 조용히 버린다.
            valid_accounts = {p.USER_ID.strip().lower(): p.USER_ID for p in valid_accounts_paths}
            cited_accounts = []
            for m in re.findall(r'계정:\s*(\S+)', answer):
                real = valid_accounts.get(_strip_id_punct(m).strip().lower())
                if real:
                    cited_accounts.append(real)
            source_ids = [{"id": None, "account": acc} for acc in cited_accounts]

        display_answer = strip_ids_for_display(answer)
        return display_answer, source_ids

    # 계정 수가 많으면 근거 수집에 시간이 더 걸릴 수 있어 기존 120초보다 여유를 둠
    try:
        result = run_coroutine(_search(), timeout=180)
    except concurrent.futures.TimeoutError:
        raise RuntimeError("연합 검색 타임아웃 (180초)")
    except Exception:
        traceback.print_exc()
        raise

    elapsed = time.time() - start_time
    answer, source_ids = result
    print(f"[FEDERATED][lightrag] 검색 완료: {elapsed:.2f}초, 계정 {len(accounts_paths)}개, mode={mode}")

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
        original_message, elapsed, mode, answer, referenced,
    )
    return answer, source_ids


# app.py가 현재 이 이름으로 import해서 쓰고 있어서(local/global 이분법) 이름은 유지.
# 다른 4개 모드가 필요하면 run_federated_search(mode="hybrid"/"naive"/"mix"/"bypass")를 직접 호출.
def run_federated_local_search(message: str, original_message: str, accounts_paths: list,
                                primary_user_id: str = None, per_account_max_tokens: int = 3000) -> tuple[str, list]:
    return run_federated_search(message, original_message, accounts_paths, "local",
                                 primary_user_id=primary_user_id, per_account_max_tokens=per_account_max_tokens)


def run_federated_global_search(message: str, original_message: str, accounts_paths: list,
                                 primary_user_id: str = None) -> tuple[str, list]:
    return run_federated_search(message, original_message, accounts_paths, "global",
                                 primary_user_id=primary_user_id)


# LightRAG가 지원하는 질의 모드 6개. QueryParam(mode=...)에 그대로 들어가는 값이라
# 여기 없는 문자열이 들어오면 LightRAG 쪽에서 에러가 난다.
_VALID_MODES = ("local", "global", "hybrid", "naive", "mix", "bypass")

# 질의 분류 (RAG 검색 자체가 아닌 보조 작업이라 SUB_TASK_CHAT_MODEL 사용).
# GraphRAG 버전은 local/global 둘 중 하나만 골랐지만(GraphRAG가 그 두 개만 지원했으므로),
# LightRAG는 6개 모드를 다 지원하니 분류기도 6개 중에서 고르게 넓혔다.
def _classify_query_method(message: str) -> str:
    prompt = f"""다음 질문에 가장 적합한 검색 모드를 아래 6개 중 하나만 골라 그 이름만 반환하라.

                - local: 특정 메일·인물·날짜·주제에 대한 구체적인 질문 (특정 엔티티 중심)
                - global: 전체 경향·요약·패턴·빈도 같은 폭넓은 질문 (전체 관계망 중심)
                - hybrid: 구체적인 근거와 전체적인 맥락이 둘 다 필요한 질문
                - naive: 특정 문구·키워드가 포함된 메일을 그대로 찾기만 하면 되는 단순 검색
                - mix: 위 성격이 애매하게 섞여 있거나 판단이 어려운 일반적인 질문 (기본값)
                - bypass: 메일 데이터와 무관한 일반 대화·인사말 등 검색이 필요 없는 질문

                질문: {message}"""

    client = openai.OpenAI(api_key=os.environ.get("LLM_API_KEY"))

    res = client.chat.completions.create(
        model=os.environ.get("SUB_TASK_CHAT_MODEL", "gpt-4o-mini"),
        messages=[{"role": "user", "content": prompt}],
        max_completion_tokens=10,  # SUB_TASK_CHAT_MODEL이 gpt-5 계열이면 max_tokens 대신 이 파라미터를 받는다
        temperature=0
    )

    method = res.choices[0].message.content.strip().lower()
    print(f"[CLASSIFY][lightrag] 질의: {message[:30]} → {method}")
    # LightRAG 자체가 mix를 "가장 무난한 기본 모드"로 권장하므로, 애매하거나 분류가
    # 실패했을 때의 기본값도 GraphRAG 시절의 "local"이 아니라 "mix"로 바꿨다.
    return method if method in _VALID_MODES else "mix"
