"""
local_build_context.py — local_search 프로덕션 컨텍스트 재구성

목적: GraphRAG의 실제 local_search 파이프라인이 만드는 프롬프트/컨텍스트를 "그럴듯한
예시"가 아니라 프로덕션 로직 그대로 재현해서, 그 위에 gold 답변(QA 엑셀의 "실제 답변")만
얹어 SFT 페어를 만들기 위한 컨텍스트 빌더.

config (mail/messenger 두 도메인 settings.yaml에서 동일하게 확인됨):
  top_k_entities=30, top_k_relationships=30, max_context_tokens=6000,
  text_unit_prop=0.5, community_prop=0.1

- 단일계정(메일): `LocalSearchMixedContext.build_context()`를 그대로 호출.
- 메신저(13개 방, federated): `run_federated_local_search()` 로직을 재현 —
  방마다 독립적으로 build_context() 호출 → 방별 per_account_max_tokens=3000 토큰
  (o200k_base 토크나이저)으로 트리밍 → "[계정: {room표시이름}]\n{chunk}" 형태로 합침 →
  system prompt 뒤에 하드코딩된 한국어 멀티계정 처리 지침 블록을 그대로 덧붙임.

검색 자체는 실제 API 호출이 아니라, rebuild_lancedb.py로 미리 계산해둔 bge-m3 임베딩을
텍스트 매칭으로 조회하는 StubTextEmbedder를 사용한다 (부수 발견 2: 세션 샌드박스에서
매번 실시간 임베딩 API를 부르는 대신, 사전 계산값을 재사용해 결과 재현성도 확보).
"""

from __future__ import annotations

import json
from pathlib import Path

import tiktoken

from graphrag.query.context_builder.builders import LocalContextBuilder
from graphrag.query.structured_search.local_search.mixed_context import LocalSearchMixedContext
from graphrag.query.llm.text_utils import num_tokens

LOCAL_SEARCH_CONFIG = dict(
    top_k_entities=30,
    top_k_relationships=30,
    max_context_tokens=6000,
    text_unit_prop=0.5,
    community_prop=0.1,
)
PER_ACCOUNT_MAX_TOKENS = 3000  # 메신저 federated 방별 트리밍 예산
O200K_ENCODING = "o200k_base"

# 메신저 federated 컨텍스트에 system prompt 뒤 그대로 덧붙이는, 코드에 하드코딩돼 있던
# 한국어 멀티계정 처리 지침 블록. (실제 문구는 `graphrag_engine.py` 원본 확인 필요 — 여기서는
# 노트에 서술된 취지만 담은 근사 재현입니다.)
MULTI_ACCOUNT_INSTRUCTION_KO = (
    "\n\n---\n"
    "위 컨텍스트는 여러 개의 서로 다른 채팅방([계정: 방이름] 태그로 구분됨)에서 가져온 "
    "정보입니다. 답변할 때는 어느 채팅방의 정보인지 명확히 구분해서 답하고, 서로 다른 "
    "채팅방의 내용을 섞어서 혼동하지 마세요.\n"
)


class StubTextEmbedder:
    """실시간 임베딩 API 호출 대신, 사전 계산된 질문 임베딩을 텍스트로 조회하는 스텁.

    rebuild_lancedb.py --questions-json으로 만든 query_embeddings.json을 그대로 사용.
    """

    def __init__(self, precomputed_query_embeddings_path: Path):
        self._map: dict[str, list[float]] = json.loads(
            precomputed_query_embeddings_path.read_text(encoding="utf-8")
        )

    def embed(self, text: str) -> list[float]:
        if text not in self._map:
            raise KeyError(
                f"사전 계산된 임베딩이 없는 질문입니다: {text!r} "
                "(rebuild_lancedb.py --questions-json에 포함시켜 재생성하세요)"
            )
        return self._map[text]


def trim_to_token_budget(text: str, max_tokens: int, encoding_name: str = O200K_ENCODING) -> str:
    enc = tiktoken.get_encoding(encoding_name)
    tokens = enc.encode(text)
    if len(tokens) <= max_tokens:
        return text
    return enc.decode(tokens[:max_tokens])


def build_mail_context(mail_search_engine: LocalSearchMixedContext, question: str) -> str:
    """단일계정(메일) — LocalSearchMixedContext.build_context()를 그대로 호출."""
    context_result = mail_search_engine.build_context(query=question, **LOCAL_SEARCH_CONFIG)
    return context_result.context_chunks


def build_federated_messenger_context(
    room_search_engines: dict[str, LocalSearchMixedContext],
    room_display_names: dict[str, str],
    question: str,
) -> str:
    """메신저 federated — run_federated_local_search() 로직 재현.

    방마다 독립적으로 build_context() 호출 → per_account_max_tokens로 트리밍 →
    "[계정: {표시이름}]\n{chunk}" 형태로 합침.
    """
    parts = []
    for room_id, engine in room_search_engines.items():
        context_result = engine.build_context(query=question, **LOCAL_SEARCH_CONFIG)
        trimmed = trim_to_token_budget(context_result.context_chunks, PER_ACCOUNT_MAX_TOKENS)
        display_name = room_display_names.get(room_id, room_id)
        parts.append(f"[계정: {display_name}]\n{trimmed}")
    return "\n\n".join(parts)


def render_system_prompt(local_search_prompt_template: str, context_data: str, is_federated: bool) -> str:
    system_prompt = local_search_prompt_template.format(
        context_data=context_data,
        response_type="multiple paragraphs",
    )
    if is_federated:
        system_prompt += MULTI_ACCOUNT_INSTRUCTION_KO
    return system_prompt


# NOTE: 실제 호출부(엔진 초기화, lancedb 연결, StubTextEmbedder 주입 등)는 프로젝트의
# graphrag_query.py / graphrag_engine.py 초기화 방식에 맞춰 build_local_sft.py에서
# 조립합니다 — 이 파일은 컨텍스트 빌더 로직 자체만 담당합니다.
