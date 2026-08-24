"""
GraphRAG의 기본 TokenChunker(graphrag_chunking.token_chunker)는 순수 토큰 인덱스로만
청크를 자른다 -- 줄바꿈/단어 경계를 전혀 신경쓰지 않는다. 그래서 "이모티콘" 같은 단어가
"이모" + "티콘"으로 청크 경계에서 반으로 잘리고, 잘린 뒷부분("티콘")이 다음 청크의
첫 줄로 남아 LLM이 이를 ChatRoom 같은 엉뚱한 엔티티 이름으로 오인하는 근본 원인이 된다.

이 모듈은 줄(메시지) 경계를 절대 넘지 않는 LineAwareTokenChunker를 정의하고,
graphrag_chunking의 "tokens" 전략 자리에 덮어 등록한다 (settings.yaml의
chunking.type: tokens 값은 그대로 둬도 됨 -- 코드 레벨에서 바꿔치기 됨).

이 파일은 이름이 정확히 sitecustomize.py여야 하고, PYTHONPATH에 이 파일이 있는
디렉토리가 포함되어 있어야 파이썬 인터프리터 시작 시 자동으로 로드된다
(job_run_graphrag.py에서 graphrag index/update 서브프로세스 실행 시 PYTHONPATH로 주입함).
"""
import logging

logger = logging.getLogger(__name__)


def _split_text_line_aware(text, chunk_size, chunk_overlap, encode, decode):
    """텍스트를 줄 단위로 그리디하게 묶어서 chunk_size 토큰 근처에서 자른다.
    한 줄이 chunk_size보다 큰 극단적인 경우에만 그 줄 내부에서 기존 방식대로
    토큰 슬라이싱으로 폴백한다 (실제 대화 데이터에서는 거의 발생하지 않음)."""
    if not text:
        return []

    lines = text.splitlines(keepends=True)  # \n을 유지해야 원문 그대로 재조립됨
    if not lines:
        return []

    line_token_counts = [len(encode(line)) for line in lines]
    n_lines = len(lines)

    chunks = []
    start = 0
    while start < n_lines:
        # 한 줄 자체가 너무 크면 (거의 없는 케이스) 그 줄만 토큰 슬라이싱으로 쪼갠다
        if line_token_counts[start] > chunk_size:
            oversized_tokens = encode(lines[start])
            sub_start = 0
            while sub_start < len(oversized_tokens):
                sub_end = min(sub_start + chunk_size, len(oversized_tokens))
                chunks.append(decode(list(oversized_tokens[sub_start:sub_end])))
                if sub_end == len(oversized_tokens):
                    break
                sub_start += chunk_size - chunk_overlap
            start += 1
            continue

        cur_tokens = 0
        end = start
        while end < n_lines:
            lt = line_token_counts[end]
            if lt > chunk_size:
                break  # 다음 줄이 단독 처리 대상이므로 여기서 청크를 끊음
            if cur_tokens + lt > chunk_size and end > start:
                break
            cur_tokens += lt
            end += 1

        chunk_text = "".join(lines[start:end])
        chunks.append(chunk_text)

        if end >= n_lines:
            break

        # overlap: 끝에서부터 overlap 토큰만큼 줄 단위로 되돌아가서 다음 청크 시작점 결정
        back = end
        overlap_tokens = 0
        while back > start and overlap_tokens < chunk_overlap:
            back -= 1
            overlap_tokens += line_token_counts[back]

        next_start = back if back > start else end  # 무한루프 방지 안전장치
        start = next_start

    return chunks


def install():
    """graphrag_chunking의 'tokens' 전략을 LineAwareTokenChunker로 덮어 등록한다."""
    try:
        from graphrag_chunking.chunker import Chunker
        from graphrag_chunking.chunker_factory import register_chunker
        from graphrag_chunking.create_chunk_results import create_chunk_results
    except ImportError as e:
        logger.warning("[line_aware_chunker] graphrag_chunking import 실패, 패치 미적용: %s", e)
        return

    class LineAwareTokenChunker(Chunker):
        """줄(메시지) 경계를 존중하는 토큰 기반 청커. size/overlap 시맨틱은
        기존 TokenChunker와 최대한 동일하게 유지한다."""

        def __init__(self, size, overlap, encode, decode, **kwargs):
            self._size = size
            self._overlap = overlap
            self._encode = encode
            self._decode = decode

        def chunk(self, text, transform=None):
            chunks = _split_text_line_aware(
                text,
                chunk_size=self._size,
                chunk_overlap=self._overlap,
                encode=self._encode,
                decode=self._decode,
            )
            return create_chunk_results(chunks, transform=transform, encode=self._encode)

    register_chunker("tokens", LineAwareTokenChunker)
    logger.info("[line_aware_chunker] 'tokens' 청킹 전략을 LineAwareTokenChunker로 교체 완료")
    print("[line_aware_chunker] 'tokens' 청킹 전략을 LineAwareTokenChunker로 교체 완료")


install()
