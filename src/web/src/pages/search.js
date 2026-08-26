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

// 요청 — "비용 지불 관련 메일 있어?" 하드코딩(메일 탭 전용, GPU 없이도 시연 가능하도록).
// 답변 본문은 그대로 두고, 일단은(GPU 재인덱싱 전까지는) 9개 불릿 전부에 "근거메일 보기"
// 버튼을 붙인다 — 실제 계정에 존재가 확인된 4건은 실제 메일 id를, 나머지 5건(Amazon Pay
// Balance/TVING/KG이니시스/카드 결제 주문 내역/Apple App Store Gift Card)은 하드코딩
// 전용 가짜 id를 붙이고, 본문도 HARDCODED_MAIL_BODIES에 하드코딩해서 보여준다.
const HARDCODED_MAIL_QA = [
  {
    match: (q) => q.includes('비용') && q.includes('메일'),
    answer:
      '네, 비용 지불 관련 메일이 있습니다.\n\n' +
      '- 전기요금 청구서 도착 메일은 이번 달 전기요금 청구서 도착 사실을 알리는 내용입니다.\n' +
      '- 신용카드 발급 완료 메일은 신청한 신용카드 발급 완료를 안내하며, 두 건 모두 결제/청구 관련 내용입니다.\n' +
      '- Amazon Pay Balance 결제 완료 안내 메일은 결제가 성공적으로 완료되었다는 내용입니다.\n' +
      '- 넷플릭스 결제 안내 메일은 넷플릭스 구독료 결제 완료를 안내합니다.\n' +
      '- TVING 정기결제 완료결과 메일은 정기결제 완료와 결제 정보, 청약 철회 및 환불 안내를 전달합니다.\n' +
      '- KG이니시스 결제확인 메일은 (주)이벤터스에서 이루어진 결제 내역을 안내합니다.\n' +
      '- 카드 결제 주문 내역 안내 메일은 카드 결제 주문 내역과 배송 안내를 전달합니다.\n' +
      '- Apple App Store Gift Card 결제 메일은 Amazon Pay Balance 사용과 결제 성공을 알립니다.\n' +
      '- 이사 견적서를 첨부해 문의 답변을 전달하는 메일은 이사 견적서를 안내하고 비용 관련 내용을 전달합니다.',
    // 요청 — "근거메일 보기" 버튼을 답변 목록 아래가 아니라, 그 메일이 근거인 불릿 줄
    // 바로 왼쪽에 붙인다. lineMatch는 그 불릿 줄에서만 나오는 고유한 부분 문자열이라
    // 렌더링할 때 이 문자열이 포함된 줄에 버튼을 붙인다(showResult 참고).
    sourceIds: [
      { id: 'CAH6sPfZ-foFWK3cA0O6JsQqCrUHd0MDG3kJkZRFJDsOYq0ii3A@mail.gmail.com', account: '03yeah03@gmail.com', lineMatch: '전기요금 청구서 도착 메일은' },
      { id: 'CAH6sPfYSKxOQQtFgET=dE-tN2wqom0sWHeeyR1xPUi1Ka+JG4Q@mail.gmail.com', account: '03yeah03@gmail.com', lineMatch: '신용카드 발급 완료 메일은' },
      { id: 'CAH6sPfZ=8CAGN8ucA0wJy=Nhsfrtp3aGLLi19ghUmnSAK6Qdpw@mail.gmail.com', account: '03yeah03@gmail.com', lineMatch: '신용카드 발급 완료 메일은' },
      { id: 'CAH6sPfaOV2XuCFgYpCaw1Q=x1L7-To8fbjKK7-iv+UJqLDLsmQ@mail.gmail.com', account: '03yeah03@gmail.com', lineMatch: '넷플릭스 결제 안내 메일은' },
      { id: 'CAH6sPfY21ViT0ZRr+ci2kL4q5QuQgnobaATFGkGDme4trFEudA@mail.gmail.com', account: '03yeah03@gmail.com', lineMatch: '이사 견적서를 첨부해 문의 답변을 전달하는 메일은' },
      { id: 'hardcoded-amazonpay-001@mail.gmail.com', account: '03yeah03@gmail.com', lineMatch: 'Amazon Pay Balance 결제 완료 안내 메일은' },
      { id: 'hardcoded-tving-001@mail.gmail.com', account: '03yeah03@gmail.com', lineMatch: 'TVING 정기결제 완료결과 메일은' },
      { id: 'hardcoded-kginicis-001@mail.gmail.com', account: '03yeah03@gmail.com', lineMatch: 'KG이니시스 결제확인 메일은' },
      { id: 'hardcoded-cardorder-001@mail.gmail.com', account: '03yeah03@gmail.com', lineMatch: '카드 결제 주문 내역 안내 메일은' },
      { id: 'hardcoded-applegift-001@mail.gmail.com', account: '03yeah03@gmail.com', lineMatch: 'Apple App Store Gift Card 결제 메일은' },
    ],
  },
];

function findHardcodedMailAnswer(domain, q) {
  if (domain !== 'mail') return null;
  const hit = HARDCODED_MAIL_QA.find(item => item.match(q));
  return hit || null;
}

// 요청 — 실제 메일 id 4건은 실제 수집된 메일(latest.txt)엔 있지만, GPU 재인덱싱을 아직
// 못 해서 documents.parquet(실제 /mail-body-by-ids가 읽는 곳)엔 없는 상태 — 그래서 버튼을
// 누르면 서버 요청이 "메일을 찾을 수 없습니다"로 실패한다. 재인덱싱 전까지는 그 4건과,
// 근거메일이 실제로 확인되지 않은 나머지 5건(hardcoded-* id) 모두 원문을 여기 하드코딩해서
// 버튼을 누르면 서버 요청 없이 바로 오른쪽에 표시되게 한다. 재인덱싱 이후엔 실제 4건은
// 이 하드코딩 없이도 실제 라우터로 그대로 동작하니 이 맵은 그대로 둬도 무방하다
// (우선순위만 하드코딩이 앞섬).
const HARDCODED_MAIL_BODIES = {
  'CAH6sPfZ-foFWK3cA0O6JsQqCrUHd0MDG3kJkZRFJDsOYq0ii3A@mail.gmail.com': {
    subject: '전기요금 청구서 도착',
    date: '2026-07-11',
    sender: '2계정 <03yeah03@gmail.com>',
    receiver: '<beauty777033@gmail.com>',
    body:
      '안녕하세요, 고객님.\n\n' +
      '이번 달 전기요금 청구서가 도착하여 안내드립니다.\n\n' +
      '▶ 청구 정보\n' +
      '- 청구월: 2026년 7월분\n' +
      '- 사용기간: 2026.06.11 ~ 2026.07.10\n' +
      '- 계약전력: 3kW (주택용 저압)\n' +
      '- 사용전력량: 312kWh\n\n' +
      '▶ 요금 내역\n' +
      '- 전력량요금: 48,760원\n' +
      '- 기후환경요금: 6,240원\n' +
      '- 연료비조정액: -1,870원\n' +
      '- 부가가치세: 5,313원\n' +
      '- 전력산업기반기금: 1,960원\n' +
      '- 청구금액 합계: 62,403원\n\n' +
      '▶ 납부 안내\n' +
      '- 납부기한: 2026.07.25\n' +
      '- 납부방법: 자동이체(국민은행 ****-**-1234)\n\n' +
      '자세한 내역은 한전 ON 앱 또는 홈페이지에서 확인하실 수 있습니다.\n' +
      '감사합니다.',
  },
  'CAH6sPfYSKxOQQtFgET=dE-tN2wqom0sWHeeyR1xPUi1Ka+JG4Q@mail.gmail.com': {
    subject: '신용카드 발급 완료',
    date: '2026-06-03',
    sender: '2계정 <03yeah03@gmail.com>',
    receiver: '<beauty777033@gmail.com>',
    body: '신청하신 신용카드가 발급되었습니다.',
  },
  'CAH6sPfZ=8CAGN8ucA0wJy=Nhsfrtp3aGLLi19ghUmnSAK6Qdpw@mail.gmail.com': {
    subject: '신용카드 발급 완료',
    date: '2026-06-03',
    sender: '2계정 <03yeah03@gmail.com>',
    receiver: '<beauty777033@gmail.com>',
    body: '신청하신 신용카드가 발급되었습니다.',
  },
  'CAH6sPfaOV2XuCFgYpCaw1Q=x1L7-To8fbjKK7-iv+UJqLDLsmQ@mail.gmail.com': {
    subject: '넷플릭스 결제 안내',
    date: '2026-08-05',
    sender: '2계정 <03yeah03@gmail.com>',
    receiver: '<beauty777033@gmail.com>',
    body: '이번 달 구독료가 결제되었습니다.',
  },
  'CAH6sPfY21ViT0ZRr+ci2kL4q5QuQgnobaATFGkGDme4trFEudA@mail.gmail.com': {
    subject: '이사 견적 문의 답변',
    date: '2026-07-22',
    sender: '2계정 <03yeah03@gmail.com>',
    receiver: '<beauty777033@gmail.com>',
    body: '요청하신 이사 견적서를 첨부합니다.',
  },
  'hardcoded-amazonpay-001@mail.gmail.com': {
    subject: '결제 완료 안내',
    date: '2026-08-01',
    sender: 'Amazon Pay <no-reply@amazonpay.com>',
    receiver: '<03yeah03@gmail.com>',
    body: '결제가 성공적으로 완료되었습니다. 이용해 주셔서 감사합니다.',
  },
  'hardcoded-tving-001@mail.gmail.com': {
    subject: '정기결제 완료결과 안내',
    date: '2026-08-03',
    sender: 'TVING <noreply@tving.com>',
    receiver: '<03yeah03@gmail.com>',
    body: '정기결제가 완료되었습니다. 결제 정보 및 청약 철회·환불 안내는 아래를 참고해 주세요.',
  },
  'hardcoded-kginicis-001@mail.gmail.com': {
    subject: '결제확인 안내',
    date: '2026-07-15',
    sender: 'KG이니시스 <noreply@kginicis.com>',
    receiver: '<03yeah03@gmail.com>',
    body: '(주)이벤터스에서 이루어진 결제가 확인되었습니다.',
  },
  'hardcoded-cardorder-001@mail.gmail.com': {
    subject: '카드 결제 주문 내역 안내',
    date: '2026-07-28',
    sender: '쇼핑몰 <order@shop.com>',
    receiver: '<03yeah03@gmail.com>',
    body: '카드 결제가 완료된 주문 내역과 배송 안내입니다.',
  },
  'hardcoded-applegift-001@mail.gmail.com': {
    subject: 'Apple App Store Gift Card 결제 완료',
    date: '2026-08-10',
    sender: 'Apple <no_reply@email.apple.com>',
    receiver: '<03yeah03@gmail.com>',
    body: 'Amazon Pay Balance를 사용하여 결제가 성공적으로 완료되었습니다.',
  },
};

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
  // 요청 — 답변의 근거가 된 메일 하나하나에 "근거메일 보기" 버튼을 왼쪽에 붙여서, 누르면
  // 그 메일 본문을 오른쪽 패널에 바로 보여준다. /mail-body-by-ids가 documents.parquet에서
  // 메일 하나의 본문을 읽어오는 라우터(메일 도메인 전용 — 메신저 쪽엔 이 라우터가 없음).
  async function loadSourceMail(btn, detailPanel) {
    const mailId = btn.dataset.mailId;
    const account = btn.dataset.account;
    resultEl.querySelectorAll('.gw-view-source-mail-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const hardcodedBody = HARDCODED_MAIL_BODIES[mailId];
    if (hardcodedBody) {
      detailPanel.innerHTML = `
        <div class="gw-mail-detail-subject">${escapeHtml(hardcodedBody.subject)}</div>
        <div class="gw-mail-detail-meta">
          <div><strong>날짜</strong> ${escapeHtml(hardcodedBody.date || '-')}</div>
          <div><strong>발신</strong> ${escapeHtml(hardcodedBody.sender)}</div>
          <div><strong>수신</strong> ${escapeHtml(hardcodedBody.receiver)}</div>
        </div>
        <div class="gw-mail-detail-body">${escapeHtml(hardcodedBody.body)}</div>
      `;
      return;
    }

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

    // 요청 — "근거메일 보기": 메일 탭에서만, source_ids의 각 mail id마다 버튼 하나씩(중복 id 제거).
    const uniqueMailRefs = [];
    if (domain === 'mail' && sourceIds && sourceIds.length > 0) {
      const seenIds = new Set();
      sourceIds.forEach(src => {
        const id = typeof src === 'string' ? src : (src && src.id);
        const account = typeof src === 'string' ? null : (src && src.account);
        const lineMatch = typeof src === 'string' ? null : (src && src.lineMatch);
        if (!id || seenIds.has(id)) return;
        seenIds.add(id);
        uniqueMailRefs.push({ id, account, lineMatch });
      });
    }
    const hasSourceMails = uniqueMailRefs.length > 0;

    // 요청 — "근거메일 보기" 버튼을 답변 아래 목록이 아니라, 그 메일이 근거인 불릿 줄
    // 바로 왼쪽에 붙인다. lineMatch가 있고 그 문자열이 실제로 어느 줄에 포함되면 그 줄에
    // 인라인으로 붙이고, lineMatch가 없거나 어느 줄에도 안 걸리면(실제 GraphRAG 답변처럼
    // 줄 단위 매칭 정보가 없는 경우) 기존처럼 답변 아래 목록에 남긴다.
    const lines = String(text || '').split('\n');
    const inlineRefsByLineIdx = new Map();
    const listRefs = [];
    uniqueMailRefs.forEach(ref => {
      const lineIdx = ref.lineMatch ? lines.findIndex(line => line.includes(ref.lineMatch)) : -1;
      if (lineIdx === -1) { listRefs.push(ref); return; }
      if (!inlineRefsByLineIdx.has(lineIdx)) inlineRefsByLineIdx.set(lineIdx, []);
      inlineRefsByLineIdx.get(lineIdx).push(ref);
    });

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

    const sourceMailHtml = listRefs.length > 0 ? `
      <div class="gw-source-mail-list">
        <div class="gw-source-label">근거메일</div>
        ${listRefs.map((ref, i) => `
          <div class="gw-source-mail-item">
            <button class="gw-view-source-mail-btn" data-mail-id="${escapeAttr(ref.id)}" data-account="${escapeAttr(ref.account || '')}">근거메일 보기</button>
            <span class="gw-source-mail-label">메일 ${i + 1}${ref.account ? ` · ${escapeHtml(ref.account)}` : ''}</span>
          </div>
        `).join('')}
      </div>
    ` : '';

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
          ${sourceMailHtml}
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

    const hardcoded = findHardcodedMailAnswer(domain, q);
    if (hardcoded) {
      setTimeout(() => showResult(q, hardcoded.answer, hardcoded.sourceIds), 900);
      return;
    }

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
