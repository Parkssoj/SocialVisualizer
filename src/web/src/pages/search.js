import { bootstrapApp } from '../main-app.js';
import { getApiBase } from '../utils/apiBase.js';
import '../scss/pages/search.scss';

bootstrapApp('search');

const FLASK_URL = getApiBase();

// URL 파라미터 처리
const params = new URLSearchParams(window.location.search);
const nameParam = params.get('name');
const name = nameParam
  ? decodeURIComponent(nameParam)
  : (sessionStorage.getItem('gw_user_name') || '-');
if (nameParam) sessionStorage.setItem('gw_user_name', decodeURIComponent(nameParam));

const gmailIdParam = params.get('gmail_id');
if (gmailIdParam) localStorage.setItem('gw_user_id', decodeURIComponent(gmailIdParam));
const flaskUrlParam = params.get('flask_url');
if (flaskUrlParam) localStorage.setItem('gw_flask_url', decodeURIComponent(flaskUrlParam));

const profileNameEl = document.getElementById('google-profile-name');
if (profileNameEl) profileNameEl.textContent = name;
window.currentUserName = name;

// 공통 유틸
function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// 라마 응답이 " - " 불릿 외의 형식(번호 목록, 콜론 나열 등)으로 실제 줄바꿈(\n) 없이
// 한 줄로 나오는 경우가 아직 있어서(백엔드의 strip_ids_for_display는 " - " 불릿만
// 처리함), 그 외의 경우를 대비해 "문장이 끝나는 지점"마다 줄바꿈을 넣는 안전망을
// 프론트에서도 한 번 더 둔다. 이미 줄바꿈이 있는 답변에는 사실상 영향 없음.
function formatAnswer(text) {
  return String(text || '')
    .replace(/([다요])\.\s+/g, '$1.\n')
    .trim();
}

async function pollJob(jobId, onDone, onError, interval = 2000, maxTries = 60) {
  for (let i = 0; i < maxTries; i++) {
    await new Promise(r => setTimeout(r, interval));
    try {
      const res = await fetch(`${FLASK_URL}/job-status/${jobId}`);
      const data = await res.json();
      if (data.status === 'done') { onDone(data.result || '결과가 없습니다.', data.source_ids || []); return; }
      if (data.status === 'error') { onError(data.result || '오류가 발생했습니다.'); return; }
    } catch (e) { onError('서버 연결에 실패했습니다.'); return; }
  }
  onError('응답 시간이 초과되었습니다. 다시 시도해주세요.');
}

// 검색 컨트롤러 — 메일/메시지(카카오) 탭이 각자 독립된 입력창·최근검색·결과영역·domain을 갖도록
// 같은 로직을 재사용 가능한 형태로 묶음. 두 탭은 서로 다른 GraphRAG 도메인("mail"/"messenger")을
// 대상으로 완전히 독립적으로 검색한다.
function createSearchController({ domain, recentKey, ids, getUserId, loadingText, emptyIcon }) {
  const inputEl = document.getElementById(ids.input);
  const btnEl = document.getElementById(ids.btn);
  const recentBarEl = document.getElementById(ids.recentBar);
  const recentTagsEl = document.getElementById(ids.recentTags);
  const clearRecentEl = document.getElementById(ids.clearRecent);
  const resultEl = document.getElementById(ids.resultContainer);

  function getRecents() {
    try { return JSON.parse(localStorage.getItem(recentKey)) || []; } catch { return []; }
  }
  function saveRecent(q) {
    let recents = getRecents().filter(r => r !== q);
    recents.unshift(q);
    if (recents.length > 8) recents = recents.slice(0, 8);
    localStorage.setItem(recentKey, JSON.stringify(recents));
  }
  function removeRecent(q) {
    localStorage.setItem(recentKey, JSON.stringify(getRecents().filter(r => r !== q)));
    renderRecents();
  }
  function clearRecents() { localStorage.removeItem(recentKey); renderRecents(); }

  function renderRecents() {
    const recents = getRecents();
    if (recents.length === 0) { recentBarEl.style.display = 'none'; return; }
    recentBarEl.style.display = 'flex';
    recentTagsEl.innerHTML = recents.map(r => `
      <span class="gw-recent-tag" data-q="${escapeAttr(r)}">
        <i class="fas fa-history" style="font-size:0.72rem; color:#aaa;"></i>
        ${escapeHtml(r)}
        <span class="gw-tag-del" data-del="${escapeAttr(r)}" title="삭제">×</span>
      </span>
    `).join('');
    recentTagsEl.querySelectorAll('.gw-recent-tag').forEach(tag => {
      tag.addEventListener('click', function(e) {
        if (e.target.classList.contains('gw-tag-del')) return;
        inputEl.value = this.dataset.q;
        runSearch(this.dataset.q);
      });
    });
    recentTagsEl.querySelectorAll('.gw-tag-del').forEach(btn => {
      btn.addEventListener('click', function(e) { e.stopPropagation(); removeRecent(this.dataset.del); });
    });
  }
  clearRecentEl.addEventListener('click', clearRecents);
  renderRecents();

  function showLoading(q) {
    resultEl.innerHTML = `
      <div class="gw-query-label">검색어: <strong>${escapeHtml(q)}</strong></div>
      <div class="gw-loading"><div class="gw-spinner"></div><span>${loadingText}</span></div>
    `;
  }
  // 요청 — 답변의 근거가 된 메일 하나하나에 "근거메일 보기" 버튼을 왼쪽에 붙여서, 누르면
  // 그 메일 본문을 오른쪽 패널에 바로 보여준다. /mail-body-by-ids가 documents.parquet에서
  // 메일 하나의 본문을 읽어오는 라우터(메일 도메인 전용 — 메신저 쪽엔 이 라우터가 없음).
  async function loadSourceMail(btn, detailPanel) {
    const mailId = btn.dataset.mailId;
    const account = btn.dataset.account;
    resultEl.querySelectorAll('.gw-view-source-mail-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    detailPanel.innerHTML = `
      <div class="gw-mail-detail-loading"><div class="gw-spinner"></div><span>메일을 불러오는 중...</span></div>
    `;
    try {
      const res = await fetch(`${FLASK_URL}/mail-body-by-ids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, mail_id: mailId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        detailPanel.innerHTML = `<div class="gw-mail-detail-empty">메일을 불러오지 못했습니다: ${escapeHtml(data.error || '알 수 없는 오류')}</div>`;
        return;
      }
      detailPanel.innerHTML = `
        <div class="gw-mail-detail-subject">${escapeHtml(data.subject || '(제목 없음)')}</div>
        <div class="gw-mail-detail-meta">
          <div><strong>날짜</strong> ${escapeHtml(data.date || '-')}</div>
          <div><strong>발신</strong> ${escapeHtml(data.sender || '-')}</div>
          <div><strong>수신</strong> ${escapeHtml(data.receiver || '-')}</div>
        </div>
        <div class="gw-mail-detail-body">${escapeHtml(data.body || '(본문 없음)')}</div>
      `;
    } catch (e) {
      detailPanel.innerHTML = `<div class="gw-mail-detail-empty">서버에 연결할 수 없습니다.</div>`;
    }
  }

  // 요청 — 하드코딩을 걷어내면서 실제 GraphRAG 응답엔 "이 근거메일이 어느 줄의
  // 근거인지"(lineMatch)가 없어져서, 버튼이 전부 답변 아래 목록으로만 떨어지고
  // 있었다. 대신 근거메일들의 "제목"만 서버에서 받아와서, 그 제목(또는 제목의
  // 핵심 단어)이 실제로 언급된 답변 줄을 찾아 그 줄에 버튼을 붙인다 — 자동으로
  // "직접 메일을 찾은 것과 매핑"되도록 한다. 제목이 어느 줄에도 안 걸리면(요약
  // 과정에서 제목이 그대로 안 남았을 수 있음) 기존처럼 답변 아래 목록에 남긴다.
  async function fetchSubjectsByRefs(refs) {
    if (!refs.length) return {};
    try {
      const res = await fetch(`${FLASK_URL}/mail-subjects-by-ids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refs: refs.map(r => ({ id: r.id, account: r.account })) }),
      });
      if (!res.ok) return {};
      const data = await res.json();
      return data.subjects || {};
    } catch (e) {
      return {};
    }
  }

  // 답변 줄 하나에 제목이 "언급됐다"고 볼 수 있는지 판단한다. 요약된 답변은 보통
  // 제목을 그대로 인용하지 않고 "OO 메일은 ~"처럼 살짝 바꿔 쓰므로, 제목 전체가
  // 그대로 포함된 줄을 찾는다.
  // 요청 — 예전엔 제목 전체가 안 걸리면 제목의 "첫 단어"만으로도 매칭시키는
  // fallback이 있었으나, 여러 메일이 같은 단어로 시작하는 제목을 가진 경우
  // (예: "한국정보통신학회 ..." 로 시작하는 메일이 여러 건) 전부 같은 한 줄에
  // 몰려 붙어 버튼이 중복 표시되고, 실제로는 그 줄과 무관한 메일까지 근거처럼
  // 보이는 문제가 있어 제거했다. 제목 전체가 걸리지 않으면 그냥 버튼 없이
  // 넘어간다(의도된 동작).
  function findLineIdxBySubject(lines, subject) {
    const cleaned = String(subject || '').trim();
    if (!cleaned) return -1;
    return lines.findIndex(line => line.includes(cleaned));
  }

  async function showResult(q, text, sourceIds) {
    let sourceHtml = '';
    // 요청 — "근거 계정" 표시 안 함(주석처리, 로직은 그대로 남겨둠).
    // if (sourceIds && sourceIds.length > 0) {
    //   // source_ids는 {id, account} 객체 배열. 항목 하나당 칩 하나씩 만들면 같은 계정이 중복으로 잔뜩 나오므로,
    //   // "이 답변이 어느 계정/대화방 데이터에서 나왔는지"가 핵심이니 계정별로 묶어서 칩 하나씩만 보여준다.
    //   const countByAccount = new Map();
    //   sourceIds.forEach(src => {
    //     const account = (typeof src === 'string' ? null : src.account) || '알 수 없음';
    //     countByAccount.set(account, (countByAccount.get(account) || 0) + 1);
    //   });
    //   const items = Array.from(countByAccount.entries()).map(([account, count]) =>
    //     `<span class="gw-source-btn gw-source-btn-plain">
    //       <i class="${emptyIcon}"></i> ${escapeHtml(account)}${count > 1 ? `<span class="gw-source-count">${count}</span>` : ''}
    //     </span>`
    //   ).join('');
    //   sourceHtml = `<div class="gw-source-emails"><div class="gw-source-label">근거 계정</div><div class="gw-source-btns">${items}</div></div>`;
    // }

    // 요청 — "근거메일 보기": 메일 탭에서만, source_ids의 각 mail id마다 버튼 하나씩(중복 id 제거).
    const uniqueMailRefs = [];
    if (domain === 'mail' && sourceIds && sourceIds.length > 0) {
      const seenIds = new Set();
      sourceIds.forEach(src => {
        const id = typeof src === 'string' ? src : (src && src.id);
        const account = typeof src === 'string' ? null : (src && src.account);
        if (!id || seenIds.has(id)) return;
        seenIds.add(id);
        uniqueMailRefs.push({ id, account });
      });
    }

    // 근거메일들의 제목을 서버에서 받아와, 그 제목이 실제로 언급된 답변 줄을 찾는다
    // (findLineIdxBySubject 참고) — "근거메일 보기" 버튼은 그 메일이 근거인 줄
    // 바로 오른쪽에만 붙인다. 요청 — 어느 줄에도 안 걸리는 것들을 예전처럼 답변
    // 아래 목록으로 따로 모아 보여주던 걸 없앴다(그 목록 UI 자체가 불필요하다는
    // 피드백) — 매칭이 안 되면 그 근거메일은 그냥 버튼 없이 넘어간다.
    const subjectsById = await fetchSubjectsByRefs(uniqueMailRefs);
    const lines = formatAnswer(text).split('\n');
    const inlineRefsByLineIdx = new Map();
    uniqueMailRefs.forEach(ref => {
      const subject = subjectsById[ref.id] || '';
      const lineIdx = findLineIdxBySubject(lines, subject);
      if (lineIdx === -1) return;
      if (!inlineRefsByLineIdx.has(lineIdx)) inlineRefsByLineIdx.set(lineIdx, []);
      inlineRefsByLineIdx.get(lineIdx).push(ref);
    });
    const hasSourceMails = inlineRefsByLineIdx.size > 0;

    const answerHtml = lines.map((line, idx) => {
      const inlineRefs = inlineRefsByLineIdx.get(idx);
      if (inlineRefs) {
        const btnsHtml = inlineRefs.map(ref => `
          <button class="gw-view-source-mail-btn" data-mail-id="${escapeAttr(ref.id)}" data-account="${escapeAttr(ref.account || '')}">근거메일 보기</button>
        `).join('');
        return `<div class="gw-answer-line-with-source"><span class="gw-answer-line-text">${escapeHtml(line)}</span>${btnsHtml}</div>`;
      }
      return `<div class="gw-answer-line">${line ? escapeHtml(line) : '&nbsp;'}</div>`;
    }).join('');

    // 요청 — 버튼을 누르기 전엔 오른쪽에 아무 창도 없다가(폭 0, 완전히 안 보임),
    // "근거메일 보기"를 누르는 순간에만 오른쪽에서 서랍(drawer)처럼 튀어나오도록 한다.
    // gw-answer-frame을 flex row로 두고, gw-answer-main(답변 카드, flex:1)과
    // gw-mail-drawer(flex:0 0 auto, 평소 width:0)를 나란히 둔다 — 서랍이 열리면
    // width가 380px로 늘어나면서 실제 레이아웃 공간을 차지하므로, 답변 카드가 그만큼
    // 자연히 왼쪽으로 밀려 줄어든다(겹쳐서 버튼을 가리는 오버레이가 아님). flex
    // align-items가 stretch(기본값)라 서랍 높이는 항상 답변 카드와 위/아래 선이
    // 정확히 일치한다. 서랍 오른쪽 위의 × 토글로 다시 접어 넣는다.
    resultEl.innerHTML = `
      <div class="gw-query-label">검색어: <strong>${escapeHtml(q)}</strong></div>
      <div class="gw-answer-frame">
        <div class="gw-answer-main">
          <div class="gw-result-card">${answerHtml}</div>
          ${sourceHtml}
        </div>
        ${hasSourceMails ? `
          <div class="gw-mail-drawer" id="gw-mail-drawer">
            <button type="button" class="gw-mail-drawer-close" title="닫기"><i class="fas fa-times"></i></button>
            <div class="gw-mail-detail-panel">
              <div class="gw-mail-detail-empty">왼쪽의 "근거메일 보기"를 누르면 여기에 메일 본문이 표시됩니다.</div>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    if (hasSourceMails) {
      const drawer = resultEl.querySelector('#gw-mail-drawer');
      const detailPanel = drawer.querySelector('.gw-mail-detail-panel');
      const closeBtn = drawer.querySelector('.gw-mail-drawer-close');

      // 요청 — 서랍 높이를 답변 카드에 맞추려던 JS 동기화 로직은 양쪽 다 문제였어서
      // 제거했다. 서랍의 최대 높이는 이제 scss(.gw-mail-drawer.is-open)의 고정
      // max-height(70vh)로만 관리한다.

      resultEl.querySelectorAll('.gw-view-source-mail-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          loadSourceMail(btn, detailPanel);
          drawer.classList.add('is-open');
        });
      });
      closeBtn.addEventListener('click', () => {
        drawer.classList.remove('is-open');
        resultEl.querySelectorAll('.gw-view-source-mail-btn').forEach(b => b.classList.remove('active'));
      });
    }
  }
  function showError(q, msg) {
    resultEl.innerHTML = `
      <div class="gw-query-label">검색어: <strong>${escapeHtml(q)}</strong></div>
      <div class="gw-error"><i class="fas fa-exclamation-circle me-2"></i>${escapeHtml(msg)}</div>
    `;
  }

  async function runSearch(q) {
    showLoading(q);
    saveRecent(q);
    renderRecents();

    const userId = getUserId();
    try {
      const res = await fetch(`${FLASK_URL}/run-query-async`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, resType: 'structed', user_id: userId, domain })
      });
      const data = await res.json();
      if (!data.jobId) { showError(q, '검색 요청에 실패했습니다.'); return; }
      await pollJob(data.jobId, (text, sourceIds) => showResult(q, text, sourceIds), (msg) => showError(q, msg));
    } catch (e) {
      showError(q, '서버에 연결할 수 없습니다. Flask 서버가 실행 중인지 확인하세요.');
    }
  }

  function doSearch() {
    const q = inputEl.value.trim();
    if (!q) return;
    runSearch(q);
  }
  btnEl.addEventListener('click', doSearch);
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  return { runSearch };
}

const mailSearch = createSearchController({
  domain: 'mail',
  recentKey: 'gw_recent_searches',
  ids: {
    input: 'search-input', btn: 'search-btn',
    recentBar: 'recent-searches-bar', recentTags: 'recent-tags', clearRecent: 'clear-recent',
    resultContainer: 'result-container',
  },
  getUserId: () => localStorage.getItem('gw_user_id') || '',
  loadingText: '메일을 분석하고 있습니다...',
  emptyIcon: 'fas fa-envelope',
});

const messageSearch = createSearchController({
  domain: 'messenger',
  recentKey: 'gw_recent_searches_message',
  ids: {
    input: 'message-search-input', btn: 'message-search-btn',
    recentBar: 'message-recent-searches-bar', recentTags: 'message-recent-tags', clearRecent: 'message-clear-recent',
    resultContainer: 'message-result-container',
  },
  // 카카오는 (메일과 달리) 검색 화면에 계정 선택기가 없음 — 연합 검색이 인덱싱된 대화방 전체를
  // 자동으로 대상으로 하므로, user_id는 서버 쪽 유효성 검사를 통과시키기 위한 자리표시자면 충분함.
  getUserId: () => 'message',
  loadingText: '카카오톡 대화를 분석하고 있습니다...',
  emptyIcon: 'bi bi-chat-dots',
});

// 검색어 URL 파라미터 (메일 탭 기준 — 기존 동작 유지)
const urlQuery = params.get('q');
if (urlQuery && urlQuery.trim()) {
  document.getElementById('search-input').value = decodeURIComponent(urlQuery);
  mailSearch.runSearch(decodeURIComponent(urlQuery));
}

// 메일 / 메시지 탭 전환
function switchTab(tab) {
  const isMail = tab === 'mail';
  document.getElementById('tab-btn-mail').classList.toggle('active', isMail);
  document.getElementById('tab-btn-mail').setAttribute('aria-selected', String(isMail));
  document.getElementById('tab-btn-message').classList.toggle('active', !isMail);
  document.getElementById('tab-btn-message').setAttribute('aria-selected', String(!isMail));
  document.getElementById('panel-mail').classList.toggle('active', isMail);
  document.getElementById('panel-message').classList.toggle('active', !isMail);
}
document.getElementById('tab-btn-mail').addEventListener('click', () => switchTab('mail'));
document.getElementById('tab-btn-message').addEventListener('click', () => switchTab('message'));
