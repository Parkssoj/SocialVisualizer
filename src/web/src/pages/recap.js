/* ── [필수] 사이드바 및 페이지 SCSS 로드 ── */
import "../scss/components/_sidebar.scss";
import "../scss/pages/recap.scss";

import { bootstrapApp } from "../main-app.js";
import { initAccountPicker } from "../features/accountPicker.js";
import { store } from "../store/globalStore.js";
import { refreshSidebarList } from "../layout/appSidebar.js";
import { initGlobalFilter } from "../utils/filterSync.js";

bootstrapApp("recap");

// ── 사이드바 선택 ↔ 화면 렌더링 파이프라인 ──────────────────────────────
// 문제: 사이드바에서 메일→메신저(또는 그 반대)로 빠르게 넘나들면, loadRecapData()는
// 다섯 개 API를 await Promise.allSettled(...)로 "기다렸다가" DOM에 쓰는 비동기
// 함수라서, 그 대기 중에 사용자가 다른 항목을 또 클릭하면 두 번의 실행이 동시에
// 진행되다가 나중에 끝나는 쪽이 "이긴다"는 보장이 없다 — 방금 클릭한 메일 요청이
// 먼저 끝나 화면을 그렸는데, 그보다 늦게 시작했던 이전 메신저 클릭의 "준비 중"
// 처리가 뒤늦게 끝나면서 그 위에 덮어써지는(혹은 그 반대) 식으로 두 상태가 섞여
// 보이는 게 실제 증상이었다. 사이드바 클릭 → 그 클릭에 해당하는 결과만 화면에
// 반영되도록, 아래 두 가지 규칙으로 파이프라인을 다시 짰다:
//   1) 클릭 즉시(비동기 요청 시작 전) resetRecapUI()로 화면을 동기적으로 완전히
//      비우고 로딩 스피너만 띄운다 — 이전 상태가 화면에 남아있는 창(gap)을 없앤다.
//   2) 클릭마다 세대(generation) 번호를 하나씩 올리고, 비동기 작업이 끝나 DOM에
//      쓰려는 시점에 "내가 아직 최신 클릭이 맞는지" 확인한다 — 그 사이 다른 항목을
//      또 클릭해서 최신이 아니게 됐다면, 이 결과는 그냥 버리고 아무것도 안 그린다.
// 이 두 가지가 있으면 몇 번을 빠르게 왔다 갔다 클릭해도, 화면엔 항상 "가장 최근
// 클릭 하나"의 결과만 남는다.
let recapGeneration = 0;

// ── Recap 데이터 캐시 ──────────────────────────────────────────────────
// 요청 — "Recap 데이터 캐시로 띄우도록 해야지". 사이드바에서 다른 계정을
// 봤다가 방금 전 계정으로 다시 돌아오는 경우처럼, 짧은 시간 안에 같은
// gmailId를 다시 선택하면 5개 API를 또 처음부터 다 부르지 않고 메모리에
// 들고 있던 결과를 그대로 다시 그린다. TTL을 넉넉히 짧게(5분) 둬서, 그
// 사이 새로 메일이 동기화되거나 인덱싱이 갱신됐을 때도 너무 오래 낡은
// 데이터를 보여주지 않게 한다.
const RECAP_CACHE_TTL_MS = 5 * 60 * 1000;
const recapDataCache = new Map(); // gmailId -> { timestamp, results }

const RECAP_LOADING_IDS = [
  "rcSenderLoading",
  "rcMySentLoading",
  "rcKwLoading",
  "rcAfLoading",
  "rcSyncLoading",
  "rcRatingLoading",
];
const RECAP_CONTENT_IDS = [
  "rcSenderContent",
  "rcSenderBadge",
  "rcMySentContent",
  "rcMySentBadge",
  "rcKwContent",
  "rcKwBadge",
  "rcAfContent",
  "rcAfBadge",
  "rcSyncContent",
  "rcRatingContent",
];
const RECAP_ERROR_IDS = [
  "rcSenderError",
  "rcMySentError",
  "rcKwError",
  "rcAfError",
  "rcSyncError",
  "rcRatingError",
];

// 선택이 바뀌는 즉시(네트워크 요청을 시작하기도 전에) 동기적으로 호출한다 —
// 콘텐츠/배지/에러 문구를 전부 지우고 로딩 스피너만 띄워서, "이전 선택의 결과가
// 화면에 남아있는 시간"을 아예 없앤다.
function resetRecapUI() {
  RECAP_CONTENT_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  RECAP_ERROR_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = "none";
      el.textContent = "";
    }
  });
  RECAP_LOADING_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "";
  });
}

/* ── 앱 초기화 및 사이드바/데이터 로드 메인 이벤트 ── */
document.addEventListener("DOMContentLoaded", async () => {
  // 사이드바 렌더링 + 계정 목록 조회는 initGlobalFilter가 전부 처리한다.
  initGlobalFilter((filterState, meta) => {
    // 예전엔 여기서 { isInitial: true } 콜백(=페이지가 열릴 때 사이드바가 실제로
    // 어느 계정을 선택하고 있는지 알려주는 첫 신호)을 무시하고, 대신 아래
    // userIdPromise가 별도로 딱 한 번 계정을 골라 loadRecapData를 불렀다 — 두
    // 흐름이 서로 다른 계정을 고를 수 있는 데다(사이드바 선택 vs userIdPromise의
    // "/accounts?domain=mail" 첫 항목) 어느 쪽이 먼저 끝나는지도 타이밍에
    // 달려있어서, 사이드바에서 고른 계정과 실제로 뜨는 데이터가 어긋날 수 있었다.
    // 지금은 filterSync.js가 사이드바의 실제 선택 상태를 무조건 한 번은 확실히
    // 전달해주므로, isInitial 여부와 상관없이 항상 그 상태를 그대로 반영한다 —
    // 페이지는 무조건 사이드바가 고른 계정만 그린다. 예전엔 계정이 바뀔 때
    // location.reload()를 호출했는데, 그러면 사이드바를 포함한 전체 DOM이 통째로
    // 다시 그려져서 "사이드바가 닫혔다가 다시 펼쳐지는" 것처럼 보였다 — 지금은
    // loadRecapData()를 직접 다시 불러서 사이드바는 그대로 둔 채 콘텐츠만
    // 새로고침한다.
    const myGeneration = ++recapGeneration;
    resetRecapUI();

    if (filterState.mail) {
      loadRecapData(filterState.mail, myGeneration);
    } else if (filterState.room) {
      // Recap은 아직 메일 전용 기능이다 — /mail-stats 등 다섯 개 API가 전부
      // 메일 계정(user_id, domain="mail")만 받도록 백엔드에 고정돼 있고, 메신저
      // 채팅방(chatroom_id) 버전은 아직 없다. 예전엔 사이드바에서 메신저를 골라도
      // 이 분기 자체가 없어서 아무 반응도 없었는데, 그게 "뭔가 계속 움직이고
      // 새로고침되는" 것처럼 느껴졌다는 피드백이 있어서, 최소한 "준비 중"이라고
      // 명확히 알려주도록 임시 처리한다.
      showRecapComingSoon("메신저 Recap 기능은 아직 준비 중입니다.", myGeneration);
    }
  });
});

// 위 filterState.room 분기 전용 — 각 섹션의 에러 영역에 "준비 중" 안내만
// 띄운다(로딩 스피너/콘텐츠 정리는 위 resetRecapUI()가 이미 동기적으로 끝냄).
// generation 체크는 이 함수 자체는 동기라 지금 당장은 불필요하지만, 나중에
// 메신저 Recap이 실제 API를 호출하게 되면 loadRecapData와 똑같이 비동기가 될
// 것이므로 그때도 같은 규칙을 따르도록 지금부터 인자를 맞춰둔다.
function showRecapComingSoon(message, generation) {
  if (generation !== recapGeneration) return; // 그 사이 다른 항목이 선택됨 — 무시
  RECAP_ERROR_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = "";
      el.textContent = message;
    }
  });
}

// 계정이 바뀔 때(사이드바에서 다른 메일 계정 선택) 새로고침 없이 다시 부를 수
// 있도록 이름 있는 함수로 뺐다 — 원래는 DOMContentLoaded 핸들러 안에 그대로
// 박혀 있는 코드라 페이지 로드 시 딱 한 번만 돌고 끝이라, 계정을 바꿔도 다시
// 그릴 방법이 없어서 새로고침에 의존했었다.
async function loadRecapData(gmailId, generation) {
  if (!gmailId) {
    if (generation !== recapGeneration) return;
    ["rcSenderLoading", "rcKwLoading", "rcAfLoading"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
    ["rcSenderError", "rcKwError", "rcAfError"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = "";
        el.textContent = "인덱싱된 계정이 없습니다. 먼저 메일을 수집해주세요.";
      }
    });
    return;
  }

  // 캐시에 아직 유효한 결과가 있으면 네트워크 요청 없이 바로 그린다.
  const cached = recapDataCache.get(gmailId);
  if (cached && Date.now() - cached.timestamp < RECAP_CACHE_TTL_MS) {
    if (generation !== recapGeneration) return;
    renderRecapResults(cached.results, generation);
    return;
  }

  // 다섯 API 병렬 호출
  const results = await Promise.allSettled([
    postStat("/mail-stats", gmailId),
    postStat("/keyword-stats", gmailId),
    postStat("/high_affinity_person_stats", gmailId),
    postStat("/mail_sync_stats", gmailId),
    postStat("/user_rating_stats", gmailId),
  ]);

  // 다섯 API를 기다리는 동안 사용자가 다른 항목을 또 클릭했다면(=recapGeneration이
  // 더 올라갔다면), 이 결과는 이미 화면에 안 맞는 낡은 데이터다 — 캐시에는 넣어 두되
  // (다음에 이 계정으로 다시 돌아왔을 때는 쓸 수 있으니) DOM에는 손대지 않고 버린다.
  // 이게 없으면, 방금 클릭한 항목의 화면을 이 뒤늦은 결과가 덮어써서 "다른 데이터가
  // 섞여 보이는" 원인이 된다.
  recapDataCache.set(gmailId, { timestamp: Date.now(), results });
  if (generation !== recapGeneration) return;

  renderRecapResults(results, generation);
}

function renderRecapResults(
  [mailStatsResult, keywordResult, affinityResult, syncResult, ratingResult],
  generation,
) {
  if (generation !== recapGeneration) return;

  // ── 발신자/수신자 통계 ──
  renderSenderStats(
    mailStatsResult.status === "fulfilled"
      ? mailStatsResult.value.data || {}
      : {},
  );

  // ── 키워드 통계 ──
  {
    const kwData =
      keywordResult.status === "fulfilled" ? keywordResult.value.data : null;
    const loadingEl = document.getElementById("rcKwLoading");
    if (loadingEl) loadingEl.style.display = "none";

    if (kwData && (kwData.keywords || []).length) {
      renderKeywordStats(kwData);
      const contentEl = document.getElementById("rcKwContent");
      if (contentEl) contentEl.style.display = "";
    } else {
      const err = document.getElementById("rcKwError");
      if (err) {
        err.style.display = "";
        err.textContent = "데이터가 없습니다.";
      }
    }
  }

  // ── 친밀도 통계 ──
  {
    const afData =
      affinityResult.status === "fulfilled" ? affinityResult.value.data : null;
    const loadingEl = document.getElementById("rcAfLoading");
    if (loadingEl) loadingEl.style.display = "none";

    if (Array.isArray(afData) && afData.length) {
      renderAffinityStats(afData);
      const contentEl = document.getElementById("rcAfContent");
      if (contentEl) contentEl.style.display = "";
    } else {
      const err = document.getElementById("rcAfError");
      if (err) {
        err.style.display = "";
        err.textContent = "데이터가 없습니다.";
      }
    }
  }

  // ── 동기화 통계 ──
  if (syncResult.status === "fulfilled" && syncResult.value.data) {
    renderSyncStats(syncResult.value.data);
  } else {
    const loadingEl = document.getElementById("rcSyncLoading");
    if (loadingEl) loadingEl.style.display = "none";
    const err = document.getElementById("rcSyncError");
    if (err) {
      err.style.display = "";
      err.textContent =
        syncResult.status === "rejected"
          ? "불러오기 실패: " + syncResult.reason.message
          : "데이터가 없습니다.";
    }
  }

  // ── 만족도 통계 ──
  if (ratingResult.status === "fulfilled" && ratingResult.value.data) {
    renderRatingStats(ratingResult.value.data);
  } else {
    const loadingEl = document.getElementById("rcRatingLoading");
    if (loadingEl) loadingEl.style.display = "none";
    const err = document.getElementById("rcRatingError");
    if (err) {
      err.style.display = "";
      err.textContent =
        ratingResult.status === "rejected"
          ? "불러오기 실패: " + ratingResult.reason.message
          : "데이터가 없습니다.";
    }
  }
}

// 이름/user_id 처리
const params = new URLSearchParams(window.location.search);
const nameParam = params.get("name");
const name = nameParam
  ? decodeURIComponent(nameParam)
  : sessionStorage.getItem("gw_user_name") || "-";
if (nameParam)
  sessionStorage.setItem("gw_user_name", decodeURIComponent(nameParam));

const gmailIdParam = params.get("gmail_id");
if (gmailIdParam)
  localStorage.setItem("gw_user_id", decodeURIComponent(gmailIdParam));

const profileNameEl = document.getElementById("google-profile-name");
if (profileNameEl) profileNameEl.textContent = name;

const userIdPromise = initAccountPicker(
  document.getElementById("account-picker-mount"),
  (selectedMail) => {
    if (selectedMail) {
      // setFilter("mail", ...) 한 번이면 반대쪽(room)은 store가 알아서 null
      // 처리한다(globalStore.js의 applySelection 참고) — 예전처럼 room을 먼저
      // null로 지우는 별도 호출을 추가하면 그 사이에 중간(둘 다 없음) 상태가
      // 생겨서 리스너가 재진입하는 원인이 된다.
      store.setFilter("mail", selectedMail);
      refreshSidebarList();
    }
  },
);

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function initials(nameStr) {
  const parts = nameStr.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : nameStr.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  ["#fcd34d", "#f59e0b"],
  ["#a5b4fc", "#818cf8"],
  ["#c8c8c8", "#a7a7a7"],
  ["#f9a8d4", "#ec4899"],
  ["#67e8f9", "#06b6d4"],
  ["#fca5a5", "#ef4444"],
];

/* ids: { badge, topEl, barList, loadingEl, errorEl, contentEl }
   field: 'received' | 'sent'
   tag: 1위 뱃지 텍스트, unit: 단위 텍스트 */
function renderMailStats(data, field, ids, tag, unit) {
  const sorted = Object.entries(data)
    .map(([email, v]) => ({
      email,
      name: v.name || email,
      count: v[field] || 0,
    }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const loadingEl = document.getElementById(ids.loadingEl);
  if (loadingEl) loadingEl.style.display = "none";

  if (sorted.length === 0) {
    const err = document.getElementById(ids.errorEl);
    if (err) {
      err.style.display = "";
      err.textContent = "데이터가 없습니다.";
    }
    return;
  }

  const max = sorted[0].count;
  const top = sorted[0];

  // 히어로 서브타이틀 (received 기준으로만 업데이트)
  if (field === "received") {
    const heroSub = document.getElementById("rcHeroSub");
    if (heroSub) {
      // 요청 — "메일함 통계" → "전체적인 통계를 보여줍니다"로 문구 변경.
      heroSub.textContent =
        (name !== "-" ? name + "님의 " : "") + "전체적인 통계를 보여줍니다";
    }
  }

  const badgeEl = document.getElementById(ids.badge);
  if (badgeEl) {
    badgeEl.textContent = sorted.length + "명";
    badgeEl.style.display = "";
  }

  const [c1, c2] = AVATAR_COLORS[0];
  const topEl = document.getElementById(ids.topEl);
  if (topEl) {
    topEl.innerHTML = `
    <div class="rc-rank1-card">
      <div class="rc-rank1-avatar" style="background:linear-gradient(135deg,${c1},${c2});">
        ${esc(initials(top.name))}
      </div>
      <div class="rc-rank1-info">
        <div class="rc-rank1-tag">🏆 ${tag}</div>
        <div class="rc-rank1-name">${esc(top.name)}</div>
        <div class="rc-rank1-email">${esc(top.email)}</div>
      </div>
      <div class="rc-rank1-count">
        <div class="rc-rank1-num">${top.count}</div>
        <div class="rc-rank1-unit">${unit}</div>
      </div>
    </div>`;
  }

  const barListEl = document.getElementById(ids.barList);
  if (barListEl) {
    barListEl.innerHTML = sorted
      .map((item, i) => {
        const rankClass =
          i === 0 ? "rank1" : i === 1 ? "rank2" : i === 2 ? "rank3" : "";
        const rankLabel =
          i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1;
        const pct = max > 0 ? Math.round((item.count / max) * 100) : 0;
        return `
        <li class="rc-bar-item">
          <div class="rc-bar-rank ${i < 3 ? "top" : ""}">${rankLabel}</div>
          <div class="rc-bar-inner">
            <div class="rc-bar-name" title="${esc(item.email)}">${esc(item.name)}</div>
            <div class="rc-bar-track">
              <div class="rc-bar-fill ${rankClass}" data-pct="${pct}" data-scope="${ids.barList}"></div>
            </div>
          </div>
          <div class="rc-bar-count">${item.count}통</div>
        </li>`;
      })
      .join("");
  }

  const contentEl = document.getElementById(ids.contentEl);
  if (contentEl) contentEl.style.display = "";

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document
        .querySelectorAll(`#${ids.barList} .rc-bar-fill`)
        .forEach((el) => {
          el.style.width = el.dataset.pct + "%";
        });
    }),
  );
}

function renderSenderStats(data) {
  renderMailStats(
    data,
    "received",
    {
      badge: "rcSenderBadge",
      topEl: "rcTopSender",
      barList: "rcBarList",
      loadingEl: "rcSenderLoading",
      errorEl: "rcSenderError",
      contentEl: "rcSenderContent",
    },
    "TOP RECEIVER",
    "통 받음",
  );
  renderMailStats(
    data,
    "sent",
    {
      badge: "rcMySentBadge",
      topEl: "rcTopMySent",
      barList: "rcMySentBarList",
      loadingEl: "rcMySentLoading",
      errorEl: "rcMySentError",
      contentEl: "rcMySentContent",
    },
    "TOP SENT",
    "통 보냄",
  );
}

/* ── 워드 클라우드 색상 팔레트 ── */
const WC_COLORS = [
  "#353535",
  "#555555",
  "#757575",
  "#e63946",
  "#457b9d",
  "#e07b39",
  "#7b2d8b",
  "#1d6fa0",
  "#b5451b",
  "#565656",
];

function renderKeywordStats(data) {
  const keywords = (data.keywords || [])
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  if (keywords.length === 0) return;

  const max = keywords[0].count;
  const min = keywords[keywords.length - 1].count;

  const badge = document.getElementById("rcKwBadge");
  if (badge) {
    badge.textContent = keywords.length + "개 키워드";
    badge.style.display = "";
  }

  const wrap = document.getElementById("rcKwCanvas");
  if (!wrap) return;
  wrap.innerHTML = "";

  keywords.forEach((kw, idx) => {
    const norm =
      max === min ? 1 : Math.log1p(kw.count - min) / Math.log1p(max - min);
    const fs = Math.round(14 + norm * 32);
    const color = WC_COLORS[idx % WC_COLORS.length];

    const el = document.createElement("span");
    el.className = "rc-wc-word";
    el.style.cssText = `font-size:${fs}px; color:${color}; transition-delay:${(idx * 0.06).toFixed(2)}s;`;
    el.title = `${kw.word}: ${kw.count}회`;
    el.innerHTML = `${esc(kw.word)}<sup class="rc-wc-count">${kw.count}</sup>`;
    wrap.appendChild(el);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => el.classList.add("show")),
    );
  });
}

/* ── 친밀도 렌더 ── */
function renderAffinityStats(data) {
  const list = (Array.isArray(data) ? data : []).slice(0, 7);
  if (list.length === 0) return;

  const sorted = [...list].sort(
    (a, b) => (b.affinity ?? 0) - (a.affinity ?? 0),
  );
  const totalAffinity = sorted.reduce(
    (sum, item) => sum + (item.affinity ?? 0),
    0,
  );

  const badge = document.getElementById("rcAfBadge");
  if (badge) {
    badge.textContent = sorted.length + "명";
    badge.style.display = "";
  }

  const AF_COLORS = [
    "#ec4899",
    "#a78bfa",
    "#f97316",
    "#06b6d4",
    "#808080",
    "#f59e0b",
    "#ef4444",
  ];
  const RANK_LABELS = ["🥇", "🥈", "🥉"];

  const centerNumEl = document.getElementById("rcAfCenterNum");
  if (centerNumEl) {
    const topScore = sorted[0].affinity ?? 0;
    centerNumEl.textContent = Math.round(topScore * 100) + "%";
  }

  const svg = document.getElementById("rcAfDonutSvg");
  if (!svg) return;
  const radius = 82.5;
  const circumference = 2 * Math.PI * radius;

  let currentOffset = 0;

  sorted.forEach((item, i) => {
    const score = item.affinity ?? 0;
    const percentage = totalAffinity > 0 ? score / totalAffinity : 0;
    const segmentLength = circumference * percentage;
    const color = AF_COLORS[i % AF_COLORS.length];

    const circle = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    circle.setAttribute("class", "rc-af-donut-segment");
    circle.setAttribute("cx", "100");
    circle.setAttribute("cy", "100");
    circle.setAttribute("r", radius.toString());
    circle.setAttribute("stroke", color);
    circle.setAttribute(
      "stroke-dasharray",
      `${segmentLength} ${circumference}`,
    );
    circle.setAttribute("stroke-dashoffset", (-currentOffset).toString());
    circle.style.transition = "all 0.8s cubic-bezier(0.22, 1, 0.36, 1)";

    circle.addEventListener("mouseenter", () => {
      document.querySelectorAll(".rc-af-legend-item").forEach((el, idx) => {
        if (idx === i) {
          el.style.background = "rgba(240, 240, 244, 0.8)";
          el.style.transform = "translateX(6px) scale(1.02)";
        } else {
          el.style.opacity = "0.5";
        }
      });
    });

    circle.addEventListener("mouseleave", () => {
      document.querySelectorAll(".rc-af-legend-item").forEach((el) => {
        el.style.background = "rgba(240, 240, 244, 0.3)";
        el.style.transform = "translateX(0) scale(1)";
        el.style.opacity = "1";
      });
    });

    svg.appendChild(circle);
    currentOffset += segmentLength;
  });

  const legendEl = document.getElementById("rcAfLegend");
  if (legendEl) {
    legendEl.innerHTML = sorted
      .map((item, i) => {
        const score = item.affinity ?? 0;
        const color = AF_COLORS[i % AF_COLORS.length];
        const rankLabel = i < 3 ? RANK_LABELS[i] : i + 1;
        const percentage = Math.round(score * 100);

        return `
        <div class="rc-af-legend-item" data-index="${i}">
          <div class="rc-af-legend-rank">${rankLabel}</div>
          <div class="rc-af-legend-color" style="background:${color};"></div>
          <div class="rc-af-legend-info">
            <div class="rc-af-legend-name">${esc(item.name || item.email)}</div>
            <div class="rc-af-legend-email">${esc(item.email || "")}</div>
          </div>
          <div class="rc-af-legend-score" style="color:${color};">${percentage}%</div>
        </div>`;
      })
      .join("");
  }

  document.querySelectorAll(".rc-af-legend-item").forEach((el, idx) => {
    el.addEventListener("mouseenter", () => {
      const segments = document.querySelectorAll(".rc-af-donut-segment");
      segments.forEach((seg, i) => {
        if (i === idx) {
          seg.style.strokeWidth = "40";
          seg.style.filter = "brightness(1.1)";
        } else {
          seg.style.opacity = "0.4";
        }
      });
    });

    el.addEventListener("mouseleave", () => {
      const segments = document.querySelectorAll(".rc-af-donut-segment");
      segments.forEach((seg) => {
        seg.style.strokeWidth = "35";
        seg.style.filter = "none";
        seg.style.opacity = "1";
      });
    });
  });

  requestAnimationFrame(() => {
    const segments = document.querySelectorAll(".rc-af-donut-segment");
    segments.forEach((seg) => {
      seg.style.strokeDashoffset = seg.getAttribute("stroke-dashoffset");
    });
  });
}

/* ── 동기화 통계 렌더링 ── */
function renderSyncStats(data) {
  function fmtTime(t) {
    if (!t) return "—";
    const [h, m] = String(t).split("-");
    if (m === undefined) return h;
    return (parseInt(h) ? h + "시간 " : "") + (parseInt(m) ? m : "");
  }
  function fmtDate(d) {
    if (!d) return "—";
    const parts = String(d).split("-");
    if (parts.length === 3)
      return parts[0].slice(2) + "." + parts[1] + "." + parts[2];
    return d;
  }

  function countUp(el, target, duration = 900) {
    if (!el) return;
    const start = performance.now();
    function tick(now) {
      const p = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(ease * target).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  const count = data.mail_count || 0;
  const countEl = document.getElementById("rcSyncCount");
  countUp(countEl, count);
  setTimeout(() => {
    if (countEl) countEl.textContent = count.toLocaleString() + "통";
  }, 940);

  const timeEl = document.getElementById("rcSyncTime");
  if (timeEl) timeEl.textContent = fmtTime(data.sync_time);

  const dateEl = document.getElementById("rcSyncDate");
  if (dateEl) dateEl.textContent = fmtDate(data.sync_update_date);

  const loadingEl = document.getElementById("rcSyncLoading");
  if (loadingEl) loadingEl.style.display = "none";

  const contentEl = document.getElementById("rcSyncContent");
  if (contentEl) contentEl.style.display = "";
}

/* ── 만족도 게이지 렌더링 ── */
function renderRatingStats(data) {
  const score = Math.min(100, Math.max(0, data.total_rating || 0));
  const ARC = 251.3;
  const offset = ARC * (1 - score / 100);

  const numEl = document.getElementById("rcGaugeNum");
  if (numEl) {
    const start = performance.now();
    function countTick(now) {
      const p = Math.min((now - start) / 1200, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      numEl.textContent = Math.round(ease * score);
      if (p < 1) requestAnimationFrame(countTick);
    }
    requestAnimationFrame(countTick);
  }

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const fillEl = document.getElementById("rcGaugeFill");
      if (fillEl) fillEl.style.strokeDashoffset = offset;
    }),
  );

  const stars = Math.round(score / 20);
  const starsEl = document.getElementById("rcGaugeStars");
  if (starsEl) {
    starsEl.innerHTML = "";
    let html = "";
    for (let i = 0; i < 5; i++) {
      html += `<span style="opacity:${i < stars ? 1 : 0.2};transition:opacity 0.3s ${i * 0.12}s;">⭐</span>`;
    }
    setTimeout(() => {
      starsEl.innerHTML = html;
    }, 400);
  }

  const label =
    score >= 90
      ? "매우 만족 🎉"
      : score >= 70
        ? "만족 😊"
        : score >= 50
          ? "보통 😐"
          : "개선 필요 😅";

  const labelEl = document.getElementById("rcGaugeLabel");
  if (labelEl) labelEl.textContent = label;

  const loadingEl = document.getElementById("rcRatingLoading");
  if (loadingEl) loadingEl.style.display = "none";

  const contentEl = document.getElementById("rcRatingContent");
  if (contentEl) contentEl.style.display = "";
}

async function postStat(endpoint, gmailId) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: gmailId }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
