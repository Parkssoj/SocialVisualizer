# src/util/lightrag_backend/lightrag_progress.py
#
# graphrag_progress.py(GraphRAG 버전)의 LightRAG 대응 파일. 새로 만든 파일이며
# graphrag_progress.py는 건드리지 않았다.
#
# GraphRAG 버전은 entities.parquet, relationships.parquet 같은 "단계마다 생기는 파일"이
# 몇 개나 나타났는지로 진행 단계를 구분했다. LightRAG는 그런 단계별 산출 파일이 없고,
# 대신 문서(메일) 하나하나가 각자 PENDING → PARSING → PROCESSING → PROCESSED라는 상태를
# 가지며, 그 상태가 working_dir/kv_store_doc_status.json에 즉시(=버퍼링 없이) 저장된다
# (LightRAG/lightrag/kg/json_doc_status_impl.py의 JsonDocStatusStorage 문서 참고 —
# "doc-status changes hit disk immediately"). 그래서 이 파일은 "전체 문서 중 몇 개가
# processed/failed(=더 이상 안 바뀌는 상태)로 끝났는지 비율"로 진행률을 계산한다.

import os
import json

# job_run_lightrag.py가 인덱싱 시작 시 이미 progress=30으로 세팅해두고, 완료 후 90으로
# 올리므로, 그 사이(30~90) 구간을 문서 처리 비율로 채운다.
_PROGRESS_START = 30
_PROGRESS_END = 90

# 더 이상 상태가 안 바뀌는(=끝난) 상태들. 실패한 문서도 "처리는 끝났다"는 의미로 포함한다.
_TERMINAL_STATUSES = ("processed", "failed")


def get_stage_progress(working_dir, start_time, reported_progress=0):
    status_path = os.path.join(working_dir, "kv_store_doc_status.json")
    if not os.path.exists(status_path):
        return []

    try:
        # 이전 인덱싱 실행이 남긴 파일이면(이번 실행 시작 전에 마지막으로 수정됨) 무시.
        # GraphRAG 버전의 parquet mtime 체크와 같은 목적.
        if os.path.getmtime(status_path) < start_time:
            return []
        with open(status_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        # 다른 스레드/프로세스가 파일을 쓰는 도중에 읽어서 깨진 상태로 걸릴 수 있음 —
        # 다음 폴링(3초 뒤)에 다시 시도하면 되므로 조용히 스킵한다.
        return []

    total = len(data)
    if total == 0:
        return []

    done = sum(1 for v in data.values() if v.get("status") in _TERMINAL_STATUSES)
    prog = _PROGRESS_START + int((_PROGRESS_END - _PROGRESS_START) * done / total)

    if prog <= reported_progress:
        return []

    msg = f"문서 처리 중 ({done}/{total})"
    return [(prog, msg)]
