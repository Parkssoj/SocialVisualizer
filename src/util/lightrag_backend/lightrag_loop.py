# src/util/lightrag_backend/lightrag_loop.py
import asyncio
import threading

_loop: "asyncio.AbstractEventLoop | None" = None
_thread: "threading.Thread | None" = None
_start_lock = threading.Lock()


# 전달받은 이벤트 루프를 현재 스레드에 붙이고 무한 실행한다
def _run_loop_forever(loop: "asyncio.AbstractEventLoop"):
    asyncio.set_event_loop(loop)
    loop.run_forever()


# 공유 질의용 이벤트 루프를 백그라운드 스레드에서 딱 한 번 띄우고 그 루프를 반환한다
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


# 코루틴을 공유 루프에 제출하고 호출한 스레드에서 결과를 기다려 반환한다
def run_coroutine(coro, timeout: "float | None" = None):
    loop = _ensure_loop_started()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=timeout)
