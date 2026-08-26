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

// ── 공통 유틸 ──
function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

// ══════════════════════════════════════
// 검색 컨트롤러 — 메일/메시지(카카오) 탭이 각자 독립된 입력창·최근검색·결과영역·domain을 갖도록
// 같은 로직을 재사용 가능한 형태로 묶음. 두 탭은 서로 다른 GraphRAG 도메인("mail"/"messenger")을
// 대상으로 완전히 독립적으로 검색한다.
// ══════════════════════════════════════
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
  function showResult(q, text, sourceIds) {
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
    resultEl.innerHTML = `
      <div class="gw-query-label">검색어: <strong>${escapeHtml(q)}</strong></div>
      <div class="gw-result-card">${escapeHtml(text)}</div>
      ${sourceHtml}
    `;
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

// ══════════════════════════════════════
// 메일 / 메시지 탭 전환
// ══════════════════════════════════════
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
