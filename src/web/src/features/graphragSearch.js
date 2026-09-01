/**
GraphRAG 자연어 검색 공통 로직 — 잡 폴링, 답변 텍스트 후처리, 근거메일 제목으로 답변 줄 매칭,
최근 검색어 저장. DOM을 직접 건드리지 않는 순수 함수만 모아서 검색 페이지의 React 컴포넌트에서
재사용한다.

Shared GraphRAG search logic — job polling, answer post-processing, matching source-mail subjects
to answer lines, and recent-search persistence. Pure functions with no direct DOM access, reused by
the search page's React components.
 */

export const MAX_RECENTS = 8;

// 라마 응답이 " - " 불릿 외의 형식으로 줄바꿈 없이 나오는 경우를 대비해 문장이 끝나는
// 지점마다 줄바꿈을 넣는 안전망(백엔드의 strip_ids_for_display는 " - " 불릿만 처리함)
export function formatAnswer(text) {
  return String(text || '')
    .replace(/([다요])\.\s+/g, '$1.\n')
    .trim();
}

// jobId 처리 상태를 폴링하다 완료/실패 시 콜백 호출
export async function pollJob(flaskUrl, jobId, onDone, onError, interval = 2000, maxTries = 60) {
  for (let i = 0; i < maxTries; i++) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const res = await fetch(`${flaskUrl}/job-status/${jobId}`);
      const data = await res.json();
      if (data.status === 'done') { onDone(data.result || '결과가 없습니다.', data.source_ids || []); return; }
      if (data.status === 'error') { onError(data.result || '오류가 발생했습니다.'); return; }
    } catch (e) {
      onError('서버 연결에 실패했습니다.');
      return;
    }
  }
  onError('응답 시간이 초과되었습니다. 다시 시도해주세요.');
}

// 근거로 인용된 메일 id 목록의 제목을 조회
export async function fetchSubjectsByRefs(flaskUrl, refs) {
  if (!refs.length) return {};
  try {
    const res = await fetch(`${flaskUrl}/mail-subjects-by-ids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refs: refs.map((r) => ({ id: r.id, account: r.account })) }),
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data.subjects || {};
  } catch (e) {
    return {};
  }
}

// 답변 줄 하나에 제목이 "언급됐다"고 볼 수 있는지 판단 — 제목 전체가 그대로 포함된 줄을 찾는다.
// (제목 전체가 안 걸리면 첫 단어만으로 매칭하던 fallback이 있었으나, 같은 단어로 시작하는
// 제목의 메일이 여럿일 때 전부 한 줄에 몰려 버튼이 중복 표시되는 문제가 있어 제거했다 —
// 제목 전체가 걸리지 않으면 버튼 없이 넘어간다.)
export function findLineIdxBySubject(lines, subject) {
  const cleaned = String(subject || '').trim();
  if (!cleaned) return -1;
  return lines.findIndex((line) => line.includes(cleaned));
}

// source_ids({id, account} 배열)에서 메일 도메인 근거만, 중복 id 제거해서 뽑기
export function extractUniqueMailRefs(domain, sourceIds) {
  const refs = [];
  if (domain !== 'mail' || !sourceIds || !sourceIds.length) return refs;
  const seen = new Set();
  sourceIds.forEach((src) => {
    const id = typeof src === 'string' ? src : src && src.id;
    const account = typeof src === 'string' ? null : src && src.account;
    if (!id || seen.has(id)) return;
    seen.add(id);
    refs.push({ id, account });
  });
  return refs;
}

export function loadRecents(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}

export function saveRecent(key, q) {
  let recents = loadRecents(key).filter((r) => r !== q);
  recents.unshift(q);
  if (recents.length > MAX_RECENTS) recents = recents.slice(0, MAX_RECENTS);
  localStorage.setItem(key, JSON.stringify(recents));
}

export function removeRecent(key, q) {
  localStorage.setItem(key, JSON.stringify(loadRecents(key).filter((r) => r !== q)));
}

export function clearRecents(key) {
  localStorage.removeItem(key);
}
