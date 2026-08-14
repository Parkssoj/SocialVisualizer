# src/util/lightrag_backend/lightrag_loop.py
#
# LightRAG 질의(query) 경로 전체가 공유하는, 앱이 떠 있는 동안 절대 안 닫히는 이벤트 루프.
#
# 배경: lightrag_engine.get_lightrag_instance()는 유저별로 LightRAG 인스턴스를 캐싱해서
# 재사용한다. 근데 LightRAG 인스턴스는 내부적으로 백그라운드 워커 태스크(rate-limit 큐
# 워커, health check 등 — LightRAG/lightrag/utils.py의 priority_limit_async_func_call이
# 만드는 것들)를 띄워서, 자기가 만들어진 이벤트 루프에 계속 붙어 산다.
#
# 원래 lightrag_query.py는 질의 하나마다 asyncio.new_event_loop()로 새 루프를 만들었다가
# 끝나면 바로 loop.close()로 닫는 방식이었다. 이게 두 가지 문제를 냈다:
#   1. 캐시된 인스턴스를 "그 인스턴스를 만들 때와 다른" 새 루프에서 재사용하면
#      "Event loop is closed" 에러가 남 (lightrag_engine.py에서 루프 불일치 시 강제
#      재빌드하도록 1차로 막아뒀음).
#   2. 그런데 매 요청마다 새 루프에서 새로 빌드하면, 그 전 요청이 띄워둔 백그라운드
#      워커 태스크들은 정리될 기회도 없이 루프가 통째로 닫혀버려서 "Task was destroyed
#      but it is pending!" 경고가 요청마다 계속 쌓인다.
#
# 근본 해결책: 질의 경로 전용으로 절대 안 닫는 이벤트 루프 하나를 백그라운드 스레드에서
# 앱 시작부터 끝까지 돌리고, 모든 질의 요청은 그 루프에 코루틴을 제출(
# run_coroutine_threadsafe)해서 처리한다. 캐시된 LightRAG 인스턴스와 그 백그라운드
# 워커들이 전부 이 하나의 루프에서만 살고 죽으므로 위 두 문제가 다 없어지고,
# get_lightrag_instance()의 캐시도 원래 의도대로(유저당 인스턴스 재사용) 동작하게 된다.
#
# 인덱싱(job_run_lightrag.py의 _lightrag_ainsert)은 이 루프를 안 쓴다 — 거긴 매번 새
# LightRAG 인스턴스를 만들어서 쓰고 finalize_storages()로 확실히 정리까지 한 뒤 끝나는
# 자기완결적 구조라 원래도 문제가 없었다.

import asyncio
import threading

_loop: "asyncio.AbstractEventLoop | None" = None
_thread: "threading.Thread | None" = None
_start_lock = threading.Lock()


def _run_loop_forever(loop: "asyncio.AbstractEventLoop"):
    asyncio.set_event_loop(loop)
    loop.run_forever()


def _ensure_loop_started() -> "asyncio.AbstractEventLoop":
    global _loop, _thread
    if _loop is not None:
        return _loop
    with _start_lock:
        if _loop is None:
            _loop = asyncio.new_event_loop()
            _thread = threading.Thread(
                target=_run_loop_forever, args=(_loop,),
                daemon=True, name="lightrag-query-loop",
            )
            _thread.start()
    return _loop


# 코루틴을 공유 루프에 제출하고, 호출한 스레드(Flask 요청 스레드)에서 결과를 기다린다.
# 요청 스레드 자체가 블로킹되는 건 문제없다 — 원래도 그 스레드 하나가 이 질의 하나만
# 처리하고 끝났던 구조라, "누가 기다리느냐"만 바뀌었을 뿐 동시성 성격은 그대로다.
def run_coroutine(coro, timeout: "float | None" = None):
    loop = _ensure_loop_started()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=timeout)
