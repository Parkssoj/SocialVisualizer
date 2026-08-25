# GPU 서버 서비스 운영 치트시트

## 서비스 목록

| tmux 세션 | 실제 모델 | GPU | 포트 | 용도 |
|---|---|---|---|---|
| `socialvisualizer-index-serve` | socialvisualizer-llama-index (merged) | GPU2 | 8002 | 인덱싱용 파인튜닝 모델 서빙 |
| `vllm-embed` | BAAI/bge-m3 | GPU3 | 8001 | 임베딩 서버 |
| `vllm-llama` | Qwen2.5-7B-Instruct | GPU3 | 8003 | 서브태스크용 서빙 |
| `socialvisualizer-query-serve` | socialvisualizer-llama-query (merged) | GPU3 | 8004 | 질의(local_search/global_search)용 서빙 |
| `flux-server` | FLUX.1-schnell | GPU3 | 8005 | 이미지/아바타 생성 |

## 재기동 명령

```bash
# index 모델 (GPU2, port 8002)
tmux new -s socialvisualizer-index-serve
source /workspace/mailgrapher-llama-venv/bin/activate
CUDA_VISIBLE_DEVICES=2 vllm serve /workspace/models/mailgrapher-llama-v5-merged \
  --served-model-name socialvisualizer-llama-index \
  --port 8002 \
  --max-model-len 32768 \
  --gpu-memory-utilization 0.85

# bge-m3 임베딩 (GPU3, port 8001)
tmux new -s vllm-embed
source /workspace/mailgrapher-llama-venv/bin/activate
CUDA_VISIBLE_DEVICES=3 vllm serve BAAI/bge-m3 --convert embed --port 8001 --gpu-memory-utilization 0.1

# Qwen2.5-7B (GPU3, port 8003)
tmux new -s vllm-llama
source /workspace/mailgrapher-llama-venv/bin/activate
CUDA_VISIBLE_DEVICES=3 vllm serve Qwen/Qwen2.5-7B-Instruct --port 8003 --gpu-memory-utilization 0.5

# ── flux 이미지 생성 (port 8005, flux_server.py 안에 하드코딩돼 있어 CLI 인자 없음) ──
tmux new -s flux-server
cd /workspace
CUDA_VISIBLE_DEVICES=3 python flux_server.py

# ── query 모델 (GPU3, port 8004) ──
tmux new -s socialvisualizer-query-serve
source /workspace/mailgrapher-llama-venv/bin/activate
CUDA_VISIBLE_DEVICES=3 vllm serve /workspace/models/mailgrapher-llama-query-merged \
  --served-model-name socialvisualizer-llama-query \
  --port 8004 \
  --max-model-len 32768 \
  --gpu-memory-utilization 0.3
```

`--served-model-name`은 Hugging Face 공개명(`socialvisualizer-llama-*`)과 맞춰뒀습니다.
실제 GPU 서버에 적용할 때는 `.env`의 `RAG_CHAT_MODEL`/`INDEXING_CHAT_MODEL` 값도 함께
바꿔야 합니다.

## 로그 확인

```bash
tmux attach -t <세션명>      # 나올 땐 Ctrl+B, D
tmux capture-pane -t <세션명> -p -S -200
```