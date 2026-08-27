# query(local_search/global_search) SFT 데이터 구축 스크립트

이 폴더의 8개 스크립트는 local_search/global_search 태스크의 SFT 학습 데이터
(`mailgrapher_v5_local_search_{train,val}.jsonl`, `mailgrapher_v5_global_search_{train,val}.jsonl`)를
만드는 파이프라인이다. 개발 당시 분석·기록해둔 프로덕션 프롬프트 조립 방식·config 값·알고리즘
설명을 근거로 작성했으며, 실제 학습 서버의 세부 구현(경로 규칙, 예외 처리 등)과 사소한
차이가 있을 수 있다 — 자세한 내용은 [`LIMITATIONS.md`](../../LIMITATIONS.md)를 참고한다.

각 파일:

| 파일 | 역할 |
|---|---|
| `room_names.py` | 메신저 방 해시ID → 표시이름 매핑 |
| `rebuild_lancedb.py` | 1536차원(OpenAI) lancedb → bge-m3 1024차원 lancedb 재생성 |
| `local_build_context.py` | local_search 프로덕션 컨텍스트 재구성 (StubTextEmbedder 포함) |
| `build_local_sft.py` | local_search 최종 SFT 페어 조립 (메일 단일계정 + 메신저 federated) |
| `global_context_all.py` | global_search MAP 배치 사전 계산 (도메인당 1회, random_state=86 고정) |
| `extract_global_batches.py` | 배치 × 질문 조합으로 MAP 프롬프트(system/user) 생성 |
| `build_reduce_data.py` | global_search REDUCE 집계 로직(정렬·필터·토큰예산) 재현 |
| `assemble_global_sft.py` | MAP+REDUCE 최종 SFT 페어 조립 및 4그룹 층화 train/val 분할 |
