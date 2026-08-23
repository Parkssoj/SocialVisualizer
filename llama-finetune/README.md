# Llama 파인튜닝 파이프라인 (SocialVisualizer)

이 폴더는 붙임2 "유형 2: 외부 모델 파인튜닝"에 해당하는 학습/추론 소스코드입니다.
베이스 모델 `meta-llama/Llama-3.1-8B-Instruct`를 LoRA로 파인튜닝해 두 개의 어댑터로 나눠
서빙합니다.

| 어댑터 | 담당 태스크 | 서빙 이름 | 포트 |
|---|---|---|---|
| index | extract_graph, community_reports (그래프 인덱싱) | `socialvisualizer-llama-index` | GPU2 : 8002 |
| query | local_search, global_search (질의응답) | `socialvisualizer-llama-query` | GPU3 : 8004 |

인덱싱용과 질의응답용을 하나로 합쳐 학습하지 않고 **별도 LoRA 어댑터 두 개**로 나눈 이유:
extract_graph/community_reports는 엄격한 구조화 출력(JSON 유사 튜플), local_search/
global_search는 자유 서술형 자연어 출력이라 출력 분포가 크게 달라 한 LoRA에 섞으면 서로
간섭할 위험이 있었기 때문입니다. 두 어댑터 모두 순정 `Llama-3.1-8B-Instruct`에서 각각
새로 시작해 학습했습니다.

## 학습 데이터 — 전부 합성(가상) 데이터입니다

실제 개인 메일/메신저 내용이 아니라 **오프라인 단계에서 자체 생성한 합성 데이터**로
학습했습니다 (대회 규정상 학습 데이터 생성 단계는 도구 제한이 없어 Claude/GPT 계열
LLM으로 생성). `eval/` 폴더의 QA 평가셋도 전부 이 합성 데이터를 대상으로 한 질의입니다.

- 메일 도메인: 세미나/동아리/졸업/실험실/장학금 등 대학원생 일상을 소재로 한 가상 메일함
- 메신저 도메인: 캡스톤프로젝트 팀 대화 등을 소재로 한 가상 채팅방

## 폴더 구조

```
llama-finetune/
├── README.md                          # 이 파일
├── LIMITATIONS.md                     # 알려진 제한사항 (재구성 스크립트, 근사 매칭 등)
├── sft_data_construction/
│   ├── indexing/                      # extract_graph + community_reports SFT 데이터 구축
│   │   ├── README.md                  # 이 폴더 설명 + 인덱싱 파이프라인 버그수정 이력 요약
│   │   ├── build_context.py
│   │   ├── survey.py
│   │   ├── build_pairs.py
│   │   ├── compose_oversized.py
│   │   ├── finalize_pairs.py
│   │   ├── convert_to_sharegpt.py
│   │   ├── global_build_context.py
│   │   └── extract_graph_matching/    # gpt-5.4-mini 캐시 ↔ 원본 청크 매칭(v2, Jaccard) 3개
│   └── query/                         # local_search + global_search SFT 데이터 구축
│       ├── README.md                  # 이 폴더 스크립트 설명 (자세한 배경은 LIMITATIONS.md 참고)
│       ├── room_names.py
│       ├── rebuild_lancedb.py
│       ├── local_build_context.py
│       ├── build_local_sft.py
│       ├── global_context_all.py
│       ├── extract_global_batches.py
│       ├── build_reduce_data.py
│       └── assemble_global_sft.py
├── training_configs/
│   ├── index_lora.yaml                # 인덱싱 어댑터 LoRA 학습 설정 (서버 원본 대조 확정본)
│   ├── index_merge.yaml               # 인덱싱 어댑터 merge/export 설정
│   ├── query_lora.yaml                # 질의응답 어댑터 LoRA 학습 설정 (확정본)
│   └── query_merge.yaml               # 질의응답 어댑터 merge/export 설정
├── eval/
│   ├── Llama_mail_QA.xlsx             # 메일 도메인 질의응답 평가셋 (합성 데이터 기반, 최종본)
│   └── Llama_messenger_QA.xlsx        # 메신저 도메인 질의응답 평가셋 (합성 데이터 기반, 최종본)
└── serving/
    └── gpu_server_ops_cheatsheet.md   # vLLM 서빙 재기동/로그 확인 명령 모음
```

## Hugging Face 공개 저장소 (LoRA 어댑터 가중치)

계정: [`Golden-Olive`](https://huggingface.co/Golden-Olive)

| 어댑터 | 저장소 URL |
|---|---|
| index | [`Golden-Olive/llama-3.1-8b-socialvisualizer-index-lora`](https://huggingface.co/Golden-Olive/llama-3.1-8b-socialvisualizer-index-lora) |
| query | [`Golden-Olive/llama-3.1-8b-socialvisualizer-query-lora`](https://huggingface.co/Golden-Olive/llama-3.1-8b-socialvisualizer-query-lora) |

LoRA 어댑터(`adapter_model.safetensors` + `adapter_config.json` 등)만 공개하며, 병합된
전체 모델(~16GB)은 로컬 vLLM 서빙용으로만 쓰고 공개 저장소에는 올리지 않습니다 —
붙임2 작성 가이드의 "파인튜닝 결과를 LoRA 어댑터 형태로만 공개" 예시와 동일한 방식입니다.

## 학습에 쓰인 라이브러리

`LLaMA-Factory` (LoRA 학습/merge/export, Apache-2.0), `vLLM` (서빙, Apache-2.0),
`transformers`/`peft`/`datasets`/`tokenizers`(전부 Apache-2.0), `torch`(BSD-3-Clause 계열).
전체 라이선스 목록은 프로젝트 SBOM 문서의 "SBOM_라마학습서빙환경" 시트를 참고하세요.

## 재현 순서 (요약)

### 0단계: 사전 준비물 — 이 폴더 밖에서 먼저 만들어져 있어야 하는 것

이 폴더는 "SFT 데이터 구축 → 파인튜닝 → 서빙"만 담당합니다. 그 앞 단계는 이 폴더에
포함되어 있지 않고, MailGrapher 앱 본체(레포 루트의 `parquet_template/`,
`src/util/graphrag_engine.py` 등)가 담당하는 별도 파이프라인입니다.

1. **합성(가상) 메일/메신저 원문 생성** — 실제 개인 데이터가 아닌 가상의 인물·메일함·
   채팅방 텍스트를 만드는 단계. 이 레포에는 원문 자체를 포함하지 않았습니다
   (`LIMITATIONS.md` 참고).
2. **그 원문에 대한 GraphRAG 인덱싱 실행** — 위 원문을 MailGrapher 앱 본체의 GraphRAG
   파이프라인에 태워 `entities.parquet` / `relationships.parquet` / `communities.parquet` /
   `community_reports.parquet`를 생성하는 단계. `sft_data_construction/indexing/`,
   `sft_data_construction/query/`의 스크립트들은 전부 이 parquet 산출물이 **이미
   존재한다는 전제**로 `--raw-data-dir` 인자를 받는 구조입니다.
3. **(query 어댑터만 해당) bge-m3 임베딩 서버 기동** — `sft_data_construction/query/`의
   컨텍스트 재구성 스크립트가 실시간으로 호출합니다.

위 세 가지가 준비된 다음부터 아래 1~5단계가 시작됩니다.

### 1~5단계

1. `sft_data_construction/indexing/`의 스크립트로 community_reports SFT 페어 생성
   (`convert_to_sharegpt.py`로 ShareGPT 포맷 jsonl 산출)
2. `training_configs/index_lora.yaml`로 LoRA 학습 (`llamafactory-cli train`)
3. `training_configs/index_merge.yaml`로 merge/export (`llamafactory-cli export`)
4. `serving/gpu_server_ops_cheatsheet.md`의 명령으로 vLLM 서빙
5. query 어댑터도 동일한 순서 — `sft_data_construction/query/`로 SFT 데이터 준비 후
   `training_configs/query_*.yaml`로 학습/merge/export
