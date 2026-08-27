# src/util/lightrag_backend/lightrag_engine.py
#
# graphrag_engine.py(GraphRAG 버전)의 LightRAG 대응 파일. 새로 만든 파일이며
# graphrag_engine.py는 건드리지 않았다.
#
# GraphRAG 버전은 유저 한 명당 LocalSearch/GlobalSearch 엔진 "두 개"를 만들어서
# 캐싱했다 (parquet 5개 읽어서 컨텍스트 빌더를 조립하는 방식). LightRAG는 인스턴스
# 하나로 aquery(query, QueryParam(mode="local"/"global"/...)) 만 호출하면 되므로,
# 유저당 캐싱 대상이 "엔진 두 개"에서 "LightRAG 인스턴스 하나"로 줄어든다.
# DirectOpenAIChatModel/DirectOpenAIEmbedder 같은 커스텀 프로토콜 클래스도 필요 없다
# (LightRAG는 그냥 콜러블 함수를 받는다).

import os
import sys
import asyncio
import threading
from functools import partial

from config.settings import BASE_DIR

sys.path.insert(0, os.path.join(BASE_DIR, "LightRAG"))
from lightrag import LightRAG
from lightrag.utils import EmbeddingFunc, TokenTracker
from lightrag.llm.openai import openai_complete_if_cache, openai_embed

_RAG_CHAT_MODEL = os.environ.get("RAG_CHAT_MODEL", "gpt-4o-mini")
_RAG_EMBEDDING_MODEL = os.environ.get("RAG_EMBEDDING_MODEL", "text-embedding-3-small")

# job_run_lightrag.py에 있는 것과 같은 표. 임베딩 모델별 벡터 차원 수
# (LightRAG는 embedding_dim을 미리 알아야 해서 자동 감지가 안 됨).
_EMBEDDING_DIMS = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
    "BAAI/bge-m3": 1024,
}

_cache_lock = threading.Lock()
# 유저별 캐시: { user_id: { "rag": LightRAG 인스턴스, "token_tracker": TokenTracker, "mtime": float } }
_instance_cache: dict = {}


# 인덱스가 최신인지 판단하는 기준 파일.
# GraphRAG 버전은 entities.parquet의 수정시각을 봤는데(_get_output_mtime),
# LightRAG는 그 파일이 없으므로 LightRAG가 그래프를 저장하는 graphml 파일로 대체한다.
def _get_storage_mtime(working_dir: str) -> float:
    graph_path = os.path.join(working_dir, "graph_chunk_entity_relation.graphml")
    return os.path.getmtime(graph_path) if os.path.exists(graph_path) else 0.0


# util/graphrag.py의 _is_index_ready(paths)에 대응하는 LightRAG 버전.
# GraphRAG는 output/stats.json 존재 여부로 판단했는데, LightRAG는 그 파일이 없으므로
# 위 _get_storage_mtime()과 동일하게 graphml 파일 존재 여부로 판단한다.
# app.py가 RAG_ENGINE 값에 따라 _is_index_ready(GraphRAG)/is_index_ready(LightRAG) 중
# 골라 쓴다.
def is_index_ready(working_dir: str) -> bool:
    return _get_storage_mtime(working_dir) > 0.0


# LightRAG 인스턴스를 새로 만든다. job_run_lightrag.py의 _lightrag_ainsert()와
# 모델 바인딩 방식이 동일하지만, 여기서는 검색 후 토큰 사용량을 조회해야 하므로
# TokenTracker를 llm/embedding 함수에 같이 물려준다.
async def _build_lightrag_instance(working_dir: str, token_tracker: TokenTracker) -> LightRAG:
    api_key = os.environ.get("LLM_API_KEY")

    llm_model_func = partial(
        openai_complete_if_cache,
        _RAG_CHAT_MODEL,
        api_key=api_key,
        base_url=os.environ.get("RAG_CHAT_API_BASE") or None,  # 지정 시 로컬 vLLM(라마)으로 라우팅
        token_tracker=token_tracker,
    )
    embedding_func = EmbeddingFunc(
        embedding_dim=_EMBEDDING_DIMS.get(_RAG_EMBEDDING_MODEL, 1536),
        func=partial(
            openai_embed.func,
            model=_RAG_EMBEDDING_MODEL,
            api_key=api_key,
            base_url=os.environ.get("INDEXING_EMBEDDING_API_BASE") or None,  # 로컬 bge-m3로 라우팅
            token_tracker=token_tracker,
        ),
    )

    rag = LightRAG(
        working_dir=working_dir,
        llm_model_func=llm_model_func,
        embedding_func=embedding_func,
    )
    await rag.initialize_storages()
    return rag


# GraphRAG 버전의 get_engines()에 대응. 유저별로 캐시된 LightRAG 인스턴스를 반환하고,
# 캐시가 없거나 인덱스가 갱신됐으면 새로 빌드한다.
# async인 이유: rag.initialize_storages()가 코루틴이라 await가 필요하기 때문 —
# 호출하는 쪽(graphrag_query_lightrag.py, 아직 미작성)도 async 컨텍스트 안에서 불러야 한다.
#
# 캐시에 이벤트 루프도 같이 저장하는 이유: 이 함수를 부르는 쪽(lightrag_query.py)이 질의
# 하나마다 별도 스레드에서 asyncio.new_event_loop()로 새 루프를 만들었다가 끝나면 바로
# loop.close()로 닫는 구조라서다. LightRAG 인스턴스는 내부적으로 자기가 만들어진 시점의
# 이벤트 루프에 묶인 자원(락, http 커넥션 등)을 들고 있어서, 그 루프가 닫힌 뒤 "다른" 루프
# (= 다음 질의의 새 스레드)에서 캐시된 인스턴스를 재사용하면 "Event loop is closed" 에러가
# 난다. mtime뿐 아니라 "지금 루프가 이 인스턴스를 만들 때의 그 루프인지"까지 같이 확인해서,
# 다르면 캐시를 안 쓰고 새로 만든다 — initialize_storages()는 로컬 파일을 읽는 정도라
# LLM/임베딩 호출처럼 비싸지 않으므로, 매 요청마다 새로 만들어도 부담이 크지 않다.
async def get_lightrag_instance(user_id: str, working_dir: str) -> LightRAG:
    mtime = _get_storage_mtime(working_dir)
    if mtime == 0.0:
        raise RuntimeError(f"인덱스가 아직 생성되지 않았습니다: {working_dir}")

    current_loop = asyncio.get_running_loop()

    with _cache_lock:
        cached = _instance_cache.get(user_id)
        if cached and cached["mtime"] == mtime and cached["loop"] is current_loop:
            return cached["rag"]

    # 캐시 미스, 인덱스 갱신, 또는 이전과 다른 이벤트 루프에서 호출됨 → 새로 빌드.
    # await는 락을 잡지 않은 상태에서 실행한다 (락 안에서 await하면 그동안 다른 유저
    # 요청도 못 들어와서 병목이 생김). 대신 동시에 같은 유저 요청이 두 번 들어오면
    # 인스턴스가 중복으로 만들어질 수 있는데, 마지막에 쓴 값으로 덮어써질 뿐 데이터가
    # 깨지지는 않으므로 유저 트래픽 규모에서는 감수 가능한 수준.
    print(f"[ENGINE][lightrag] 인스턴스 빌드 시작: {user_id}")
    token_tracker = TokenTracker()
    rag = await _build_lightrag_instance(working_dir, token_tracker)

    with _cache_lock:
        _instance_cache[user_id] = {
            "rag": rag, "token_tracker": token_tracker, "mtime": mtime, "loop": current_loop,
        }

    print(f"[ENGINE][lightrag] 인스턴스 빌드 완료: {user_id}")
    return rag


# GraphRAG 버전의 get_and_reset_usage(user_id, method)에 대응.
# GraphRAG는 local/global 엔진이 따로 있어서 method로 어느 쪽 사용량인지 골라야 했지만,
# LightRAG는 인스턴스가 하나뿐이라 method 인자가 필요 없다.
def get_and_reset_usage(user_id: str) -> dict:
    with _cache_lock:
        cached = _instance_cache.get(user_id)
        if not cached:
            return {"model_name": _RAG_CHAT_MODEL, "input_tokens": 0, "output_tokens": 0}

        tracker: TokenTracker = cached["token_tracker"]
        usage = {
            "model_name": _RAG_CHAT_MODEL,
            "input_tokens": tracker.prompt_tokens,
            "output_tokens": tracker.completion_tokens,
        }
        tracker.reset()
        return usage
