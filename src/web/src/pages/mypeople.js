/* ── [필수] 사이드바 및 페이지 SCSS 로드 ── */
import "../scss/components/_sidebar.scss";
import "../scss/pages/mypeople.scss";

import { bootstrapApp } from "../main-app.js";
import { initAccountPicker } from "../features/accountPicker.js";
import * as d3 from "d3";
import { refreshSidebarList } from "../layout/appSidebar.js";
import { initGlobalFilter } from "../utils/filterSync.js";
import { store } from "../store/globalStore.js";

bootstrapApp("mypeople");

/* ── 사용자 데이터 세션/로컬 스토리지 처리 ── */
(function () {
  const p = new URLSearchParams(window.location.search);
  const n = p.get("name")
    ? decodeURIComponent(p.get("name"))
    : sessionStorage.getItem("gw_user_name") || "-";
  if (p.get("name")) sessionStorage.setItem("gw_user_name", n);
  if (p.get("gmail_id"))
    localStorage.setItem("gw_user_id", decodeURIComponent(p.get("gmail_id")));
  const el = document.getElementById("google-profile-name");
  if (el) el.textContent = n;
})();

/* ── 메일 계정 & 채팅방 피커 연결 (중복 선언 제거 단일화) ── */
// userIdPromise는 "페이지가 처음 열릴 때 고른 계정" 딱 한 번만 담아서 절대 안
// 바뀌는 값이라, 사이드바에서 계정을 바꿔도 여기 의존하는 코드는 계속 옛날 계정을
// 보고 있었다(그래서 사이드바 선택이 실제 화면에 반영되려면 새로고침이 필요했고,
// 그 새로고침 때문에 사이드바도 잠깐 사라졌다 다시 뜨는 것처럼 보였다). 지금부터는
// currentMailId라는 "지금 이 순간의 값"을 따로 두고, getCurrentMailId()가 그 값이
// 있으면 그걸, 없으면(아직 아무도 안 바꿨으면) 기존 userIdPromise 값을 쓴다 —
// 아래 모든 (await userIdPromise) 자리를 이걸로 바꿔서, 계정을 바꾼 뒤 해당 함수를
// 다시 부르기만 하면 새로고침 없이 새 계정 데이터를 그대로 다시 그릴 수 있다.
let currentMailId = "";
async function getCurrentMailId() {
  return currentMailId || (await userIdPromise) || "";
}

// 1. 메일 계정 피커 초기화 및 스토어 데이터 동기화
const userIdPromise = initAccountPicker(
  document.getElementById("account-picker-mount"),
  (selectedMail) => {
    if (selectedMail) {
      currentMailId = selectedMail;
      store.setFilter("mail", selectedMail);
      refreshSidebarList();
    }
  },
);

// 2. 채팅방 피커 초기화 및 스토어 데이터 동기화
let selectedChatroomId = "";
const chatroomIdPromise = initAccountPicker(
  document.getElementById("chatroom-picker-mount"),
  (chatroomId) => {
    selectedChatroomId = chatroomId;
    if (chatroomId) {
      store.setFilter("room", chatroomId);
      refreshSidebarList();
    }
  },
  { domain: "messenger", storageKey: "gw_chatroom_id" },
);

chatroomIdPromise.then((id) => {
  selectedChatroomId = id || "";
});

/* ── 앱 초기화 및 사이드바 바인딩 ── */
document.addEventListener("DOMContentLoaded", () => {
  // 사이드바 렌더링 + 계정/채팅방 목록 조회는 initGlobalFilter가 전부 처리한다
  // (그 안에서 renderAppSidebar도 호출하므로 여기서 다시 부르지 않음 — 두 번
  // 그리면 토글 버튼에 이벤트가 매번 새로 붙으면서 깜빡였다).
  initGlobalFilter((filterState, meta) => {
    // 초기 호출(isInitial)은 이미 userIdPromise/chatroomIdPromise 흐름이 처리 중이므로
    // 무시하고, 사이드바(또는 상단 계정 토글)에서 실제로 선택이 바뀐 경우에만 반응한다.
    // 새로고침(location.reload) 대신 currentMailId/selectedChatroomId를 갱신하고
    // 해당 데이터만 다시 불러와서 다시 그린다 — 새로고침을 하면 페이지 전체가
    // 잠깐 하얗게 사라졌다 다시 뜨면서 사이드바도 닫혔다 열리는 것처럼 보였는데,
    // 이제는 사이드바는 화면에 계속 그대로 떠 있고 카드/타임라인만 바뀐다.
    if (meta && meta.isInitial) return;

    if (filterState.mail) {
      currentMailId = filterState.mail;
      avatarGenStarted = false; // 새 계정 기준으로 아바타 생성도 다시 돌게
      periodStatsLoaded = false;
      periodStats = {};
      currentDetailPerson = null;
      document.getElementById("mp-detail")?.classList.remove("open");
      loadPeople().then(() => fetchPeriodStats());
    } else if (filterState.room) {
      selectedChatroomId = filterState.room;
      if (currentChannel === "messenger") {
        refreshMessengerRoomsForRange();
      }
    }
  });
});

/* ── 같은 name을 가진 브랜드 엔트리 통합 ── */
function groupByEntityName(list) {
  const seen = new Map();
  list.forEach((p) => {
    const key = (p.email || "").toLowerCase().trim();
    if (!key) return;
    if (!seen.has(key)) seen.set(key, p);
  });
  return [...seen.values()];
}

/* ── 이름 길이별 폰트 크기 ── */
function nameFontSize(name) {
  const len = (name || "").length;
  const isKorean = /[가-힣]/.test(name || "");
  if (isKorean) {
    if (len <= 4) return "clamp(0.9rem, 1.7cqw, 1.7rem)";
    if (len <= 6) return "clamp(0.82rem, 1.4cqw, 1.4rem)";
    if (len <= 9) return "clamp(0.72rem, 1.2cqw, 1.2rem)";
    if (len <= 15) return "clamp(0.6rem,  1.0cqw, 1.0rem)";
    return "clamp(0.5rem,  0.82cqw, 0.88rem)";
  }
  if (len <= 5) return "clamp(0.88rem, 1.68cqw, 1.68rem)";
  if (len <= 8) return "clamp(0.8rem,  1.43cqw, 1.43rem)";
  if (len <= 12) return "clamp(0.7rem,  1.2cqw,  1.2rem)";
  if (len <= 18) return "clamp(0.58rem, 0.97cqw, 0.97rem)";
  return "clamp(0.48rem, 0.8cqw,  0.85rem)";
}

/* ── 발신 전용/브랜드 계정 판별 ── */
const GENERIC_LOCAL_KEYWORDS = [
  "noreply",
  "no-reply",
  "no.reply",
  "donotreply",
  "info",
  "support",
  "admin",
  "hello",
  "contact",
  "mail",
  "newsletter",
  "update",
  "service",
  "team",
  "automated",
  "mailer",
  "postmaster",
  "alert",
  "recap",
  "recommend",
  "suggestion",
  "insight",
  "security",
  "comment",
  "digest",
  "marketing",
  "promo",
  "bot",
  "notification",
];

const BRAND_DISPLAY_NAMES = new Set([
  "instagram",
  "pinterest",
  "google",
  "google play",
  "mcafee",
  "twitter",
  "x",
  "discord",
  "microsoft",
  "xbox",
  "neo4j",
  "the neo4j team",
  "facebook",
  "linkedin",
  "naver",
  "kakao",
  "amazon",
  "apple",
  "netflix",
  "youtube",
  "spotify",
  "slack",
  "zoom",
  "adobe",
  "dropbox",
  "paypal",
  "ebay",
  "samsung",
  "lg",
  "steam",
  "playstation",
  "nintendo",
  "airbnb",
  "uber",
  "github",
  "figma",
  "notion",
]);

function isGenericLocalPart(local) {
  const l = (local || "").toLowerCase();
  return GENERIC_LOCAL_KEYWORDS.some((k) => l.includes(k));
}
function isBrandDisplayName(name) {
  return BRAND_DISPLAY_NAMES.has((name || "").trim().toLowerCase());
}

function autoFitBrandLogo(img) {
  try {
    const w = img.naturalWidth,
      h = img.naturalHeight;
    if (!w || !h) return;
    const cvs = document.createElement("canvas");
    cvs.width = w;
    cvs.height = h;
    const ctx = cvs.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const bgR = data[0],
      bgG = data[1],
      bgB = data[2],
      bgA = data[3];
    const THRESH = 18;
    let minX = w,
      minY = h,
      maxX = 0,
      maxY = 0,
      found = false;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        const a = data[i + 3];
        if (a < 10) continue;
        const dr = data[i] - bgR,
          dg = data[i + 1] - bgG,
          db = data[i + 2] - bgB,
          da = a - bgA;
        if (Math.sqrt(dr * dr + dg * dg + db * db + da * da) > THRESH) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) return;
    const fracW = (maxX - minX) / w,
      fracH = (maxY - minY) / h;
    const frac = Math.min(fracW, fracH);
    if (frac <= 0) return;
    const scale = Math.max(1, Math.min(1 / frac, 3.4));
    img.style.transform = `scale(${scale.toFixed(2)})`;
  } catch (e) {}
}
function setupBrandLogo(img) {
  if (!img) return;
  if (img.complete && img.naturalWidth) autoFitBrandLogo(img);
  else
    img.addEventListener("load", () => autoFitBrandLogo(img), { once: true });
}
function isBrandSender(p) {
  if (!p.email) return false;
  const [local] = p.email.split("@");
  return isGenericLocalPart(local) || isBrandDisplayName(p.name);
}

function resolveDisplayName(p) {
  if (!p.email) return p.name && p.name.trim() ? p.name.trim() : "(알 수 없음)";
  const [local, domain] = p.email.split("@");
  if (isBrandSender(p)) {
    const parts = (domain || "").split(".");
    return parts.length >= 3 ? parts[parts.length - 2] : parts[0];
  }
  if (p.name && p.name.trim()) return p.name.trim();
  return local || "(알 수 없음)";
}

const AFFINITY_HUE = 158;

function tierColor(hue, sat, lightHi, lightLo) {
  const hueLight = hue + 9;
  const hueDark = hue - 7;
  const textSat = Math.min(sat + 20, 85);
  const textLight = Math.max(lightLo - 26, 10);
  const shadowSat = Math.min(sat + 10, 70);
  const shadowLight = Math.max(lightLo - 14, 22);
  const shadowAlpha = 0.14 + (sat / 100) * 0.16;
  return {
    light: `hsl(${hueLight} ${sat}% ${lightHi}%)`,
    dark: `hsl(${hueDark} ${sat}% ${lightLo}%)`,
    gradient: `linear-gradient(150deg, hsl(${hueLight} ${sat}% ${lightHi}%), hsl(${hueDark} ${sat}% ${lightLo}%))`,
    shadow: `hsl(${hueDark} ${shadowSat}% ${shadowLight}% / ${shadowAlpha.toFixed(2)})`,
    shadowHover: `hsl(${hueDark} ${shadowSat}% ${shadowLight}% / ${(shadowAlpha + 0.16).toFixed(2)})`,
    text: `hsl(${hueDark} ${textSat}% ${textLight}%)`,
  };
}

const AFFINITY_TIERS = [
  { min: 0.9, sat: 75, lightHi: 57, lightLo: 41 },
  { min: 0.7, sat: 55, lightHi: 77, lightLo: 61 },
  { min: 0.4, sat: 35, lightHi: 87, lightLo: 75 },
  { min: 0.15, sat: 23, lightHi: 94, lightLo: 86 },
  { min: -Infinity, sat: 7, lightHi: 98, lightLo: 93 },
];
function affinityColor(aff) {
  const raw = aff ?? -1;
  const tier = AFFINITY_TIERS.find((tr) => raw >= tr.min);
  return tierColor(AFFINITY_HUE, tier.sat, tier.lightHi, tier.lightLo);
}

function initials(name) {
  const t = (name || "").trim();
  if (!t) return "?";
  if (/[가-힣]/.test(t[0])) return t[0];
  return t
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function dateToMs(str) {
  return new Date(str).getTime();
}
function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
function fmtShort(ms) {
  const d = new Date(ms);
  const m = d.getMonth() + 1;
  return m === 1
    ? `${d.getFullYear()}`
    : `${d.getFullYear()}.${String(m).padStart(2, "0")}`;
}

let allPeople = [];
let fakeTestPeriodStats = {};
let globalFirst = 0,
  globalLast = 0;
let selMin = 0,
  selMax = 0;
let fullMin = 0,
  fullMax = 0;
let activeFilter = "all";
let periodStats = {};
let periodStatsLoaded = false;
let statsDebounceTimer = null;
let contactPhotos = {};
let generatedAvatars = {};
let avatarGenStarted = false;
let sortMode = "affinity";
let hideBrandAccounts = false;
let sentStatsMap = {};
let receivedStatsMap = {};
let currentDetailPerson = null;
let detailDebounceTimer = null;
let myAvatarUrl = null;
let currentChannel = "mail";
let mailDateRange = null;
let messengerDateRange = null;
let messengerChatrooms = null;
let currentChatroomId = null;
let currentChatroomPeople = [];
let currentDetailMode = "mail";
let currentDetailPersonEmail = "";
let messengerScreen = "rooms";
let roomSortMode = "name";
let peopleSortMode = "name";
let currentChatroomName = "";
let roomMoodCache = {};
let currentMessengerPerson = null;
let currentMessengerDrawerMonth = null;
let currentMessengerDayList = [];

async function fetchSentStats() {
  const gmailId = await getCurrentMailId();
  try {
    const res = await fetch("/mail-person-sent-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: gmailId,
        start_date: msToDateStr(selMin),
        end_date: msToDateStr(selMax),
      }),
    });
    if (res.ok) {
      const j = await res.json();
      sentStatsMap = {};
      (j.data || []).forEach((item) => {
        sentStatsMap[(item.email || "").toLowerCase()] = item.sent || 0;
      });
    }
  } catch (e) {
    console.error("fetchSentStats 오류:", e);
  }
}

async function fetchReceivedStats() {
  const gmailId = await getCurrentMailId();
  try {
    const res = await fetch("/mail-person-received-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: gmailId,
        start_date: msToDateStr(selMin),
        end_date: msToDateStr(selMax),
      }),
    });
    if (res.ok) {
      const j = await res.json();
      receivedStatsMap = {};
      (j.data || []).forEach((item) => {
        receivedStatsMap[(item.email || "").toLowerCase()] = item.received || 0;
      });
    }
  } catch (e) {
    console.error("fetchReceivedStats 오류:", e);
  }
}

async function fetchPeriodStats() {
  const gmailId = await getCurrentMailId();
  if (!gmailId) return;
  const post = (body) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const body = {
    user_id: gmailId,
    start_date: msToDateStr(selMin),
    end_date: msToDateStr(selMax),
  };
  try {
    const [sRes, rRes] = await Promise.all([
      fetch("/mail-person-sent-stats", post(body)),
      fetch("/mail-person-received-stats", post(body)),
    ]);
    const newStats = {};
    if (sRes.ok) {
      const j = await sRes.json();
      (j.data || j).forEach((item) => {
        const e = (item.email || "").toLowerCase();
        newStats[e] = newStats[e] || { sent: 0, received: 0 };
        newStats[e].sent = item.sent || 0;
      });
    }
    if (rRes.ok) {
      const j = await rRes.json();
      (j.data || j).forEach((item) => {
        const e = (item.email || "").toLowerCase();
        newStats[e] = newStats[e] || { sent: 0, received: 0 };
        newStats[e].received = item.received || 0;
      });
    }
    periodStats = newStats;
    Object.assign(periodStats, fakeTestPeriodStats);
    periodStatsLoaded = true;
    renderCards();
  } catch (e) {
    console.error("fetchPeriodStats 오류:", e);
  }
}

function updateCardBadges() {
  document.querySelectorAll(".mp-card").forEach((card) => {
    const ps = periodStats[(card.dataset.email || "").toLowerCase()] || {};
    const total = (ps.sent || 0) + (ps.received || 0);
    let badge = card.querySelector(".mp-period-badge");
    if (total > 0) {
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "mp-period-badge";
        card.appendChild(badge);
      }
      badge.textContent = total + "건";
    } else if (badge) {
      badge.remove();
    }
  });
}

function renderCards() {
  const grid = document.getElementById("mp-grid");
  let list = groupByEntityName(allPeople);
  if (hideBrandAccounts) {
    list = list.filter((p) => !isBrandSender(p));
  }
  if (periodStatsLoaded) {
    list = list.filter((p) => {
      const ps = periodStats[(p.email || "").toLowerCase()];
      return ps && (ps.sent || 0) + (ps.received || 0) > 0;
    });
  }
  if (sortMode === "affinity") {
    list.sort((a, b) => (b.affinity || 0) - (a.affinity || 0));
  } else if (sortMode === "name") {
    list.sort((a, b) =>
      resolveDisplayName(a).localeCompare(resolveDisplayName(b), "ko"),
    );
  } else if (sortMode === "total") {
    list.sort((a, b) => {
      const ea = (a.email || "").toLowerCase(),
        eb = (b.email || "").toLowerCase();
      return (
        (sentStatsMap[eb] || 0) +
        (receivedStatsMap[eb] || 0) -
        ((sentStatsMap[ea] || 0) + (receivedStatsMap[ea] || 0))
      );
    });
  } else if (sortMode === "sent") {
    list.sort(
      (a, b) =>
        (sentStatsMap[(b.email || "").toLowerCase()] || 0) -
        (sentStatsMap[(a.email || "").toLowerCase()] || 0),
    );
  } else if (sortMode === "received") {
    list.sort(
      (a, b) =>
        (receivedStatsMap[(b.email || "").toLowerCase()] || 0) -
        (receivedStatsMap[(a.email || "").toLowerCase()] || 0),
    );
  }
  const countEl = document.getElementById("mp-count");
  if (countEl) countEl.textContent = list.length ? `${list.length}명` : "";

  if (!list.length) {
    grid.innerHTML = `<div class="mp-empty"><i class="bi bi-people"></i><p>데이터를 불러오는 중...</p></div>`;
    return;
  }
  function cardHtml(p, i) {
    const affinity = p.affinity;
    const ac = affinityColor(affinity);
    const cardVars = `--ca-light:${ac.light};--ca-dark:${ac.dark};--ca-shadow:${ac.shadow};--ca-shadow-hover:${ac.shadowHover};`;
    const displayName = resolveDisplayName(p);
    const ps = periodStats[(p.email || "").toLowerCase()] || {};
    const em = (p.email || "").toLowerCase();
    const total = (ps.sent || 0) + (ps.received || 0);
    const photo = generatedAvatars[em] || contactPhotos[em];
    const brandCls = isBrandSender(p) ? " mp-brand-logo" : "";
    const avatarInner = photo
      ? `<img src="${photo}" alt="${displayName}" class="${brandCls.trim()}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.parentElement.textContent='${initials(displayName)}'">`
      : initials(displayName);
    let badge = "";
    if (sortMode === "affinity") {
      if (affinity != null)
        badge = `<div class="mp-period-badge">${Math.round(affinity * 100)}%</div>`;
    } else if (sortMode === "name") {
      badge = "";
    } else if (sortMode === "sent") {
      const cnt = sentStatsMap[em] || 0;
      if (cnt > 0)
        badge = `<div class="mp-period-badge sent">보낸 ${cnt}건</div>`;
    } else if (sortMode === "received") {
      const cnt = receivedStatsMap[em] || 0;
      if (cnt > 0)
        badge = `<div class="mp-period-badge recv">받은 ${cnt}건</div>`;
    } else if (sortMode === "total") {
      const totalCnt =
        (sentStatsMap[em] || 0) + (receivedStatsMap[em] || 0) || total;
      if (totalCnt > 0)
        badge = `<div class="mp-period-badge">${totalCnt}건</div>`;
    }
    return `
            <div class="mp-card ca-fade" style="${cardVars}" data-idx="${i}" data-name="${p.name || ""}" data-email="${p.email || ""}" title="${p.email || ""}">
              <div class="mp-avatar" style="color:${ac.text}">${avatarInner}</div>
              <div class="mp-name" style="font-size:${nameFontSize(displayName)}">${displayName}</div>
              ${badge}
            </div>`;
  }

  if (sortMode === "affinity") {
    grid.innerHTML = renderAffinityBands(list, cardHtml);
  } else {
    grid.innerHTML = list.map((p, i) => cardHtml(p, i)).join("");
  }
  grid.querySelectorAll(".mp-avatar img.mp-brand-logo").forEach(setupBrandLogo);
}

const AFFINITY_BAND_COUNT = 5;
const AFFINITY_BAND_BG = [
  { hue: 18, sat: 78, light: 91 },
  { hue: 24, sat: 60, light: 93 },
  { hue: 30, sat: 42, light: 94.5 },
  { hue: 36, sat: 26, light: 96.5 },
  { hue: 42, sat: 12, light: 98.5 },
];

function kmeans1D(values, k) {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  const actualK = Math.max(1, Math.min(k, unique.length));
  if (actualK === 1) return [unique[0]];

  let centroids = Array.from(
    { length: actualK },
    (_, i) => unique[Math.round((i * (unique.length - 1)) / (actualK - 1))],
  );

  for (let iter = 0; iter < 100; iter++) {
    const sums = new Array(actualK).fill(0);
    const counts = new Array(actualK).fill(0);
    for (const v of values) {
      let best = 0,
        bestDist = Infinity;
      for (let c = 0; c < actualK; c++) {
        const d = Math.abs(v - centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      sums[best] += v;
      counts[best]++;
    }
    let moved = false;
    for (let c = 0; c < actualK; c++) {
      if (counts[c] === 0) continue;
      const next = sums[c] / counts[c];
      if (Math.abs(next - centroids[c]) > 1e-9) moved = true;
      centroids[c] = next;
    }
    if (!moved) break;
  }

  const sortedDesc = [
    ...new Set(centroids.map((c) => Math.round(c * 1000) / 1000)),
  ].sort((a, b) => b - a);
  return sortedDesc;
}

function renderAffinityBands(list, cardHtml) {
  const pctOf = (p) => Math.round((p.affinity || 0) * 100);
  const values = list.map(pctOf);
  const centroids = kmeans1D(values, AFFINITY_BAND_COUNT);

  const boundaries = [];
  for (let i = 0; i < centroids.length - 1; i++) {
    boundaries.push((centroids[i] + centroids[i + 1]) / 2);
  }

  let globalIdx = 0;
  let cursor = 0;
  const bandsHtml = [];
  let prevBandFloor = null;

  for (let b = 0; b < centroids.length; b++) {
    const isLastBand = b === centroids.length - 1;
    const threshold = isLastBand ? -Infinity : boundaries[b];
    let end = cursor;
    while (end < list.length && pctOf(list[end]) >= threshold) {
      end++;
    }
    const bandPeople = list.slice(cursor, end);
    cursor = end;
    if (!bandPeople.length) continue;

    const bg =
      AFFINITY_BAND_BG[b] || AFFINITY_BAND_BG[AFFINITY_BAND_BG.length - 1];
    const bandBg = `hsl(${bg.hue} ${bg.sat}% ${bg.light}%)`;

    const cardsHtml = bandPeople.map((p) => cardHtml(p, globalIdx++)).join("");

    const bandMax = pctOf(bandPeople[0]);
    const bandMin = pctOf(bandPeople[bandPeople.length - 1]);
    const divider =
      prevBandFloor == null
        ? ""
        : `<div class="mp-band-divider"><span>친밀도 ${prevBandFloor}%이상</span></div>`;

    bandsHtml.push(`
      <div class="mp-band">
        ${divider}
        <div class="mp-band-cards" style="--band-bg:${bandBg}">
          ${cardsHtml}
        </div>
      </div>
    `);
    prevBandFloor = bandMin;
  }
  return bandsHtml.join("");
}

let timelineListenersAttached = false;

function msToVal(ms) {
  return Math.round(((ms - globalFirst) / (globalLast - globalFirst)) * 1000);
}
function valToMs(v) {
  return globalFirst + (v / 1000) * (globalLast - globalFirst);
}

function updateFill() {
  const inMin = document.getElementById("tl-min");
  const inMax = document.getElementById("tl-max");
  const fill = document.getElementById("tl-fill");
  const minV = +inMin.value,
    maxV = +inMax.value;
  const lPct = minV / 10,
    rPct = maxV / 10;
  fill.style.left = lPct + "%";
  fill.style.width = rPct - lPct + "%";
  selMin = valToMs(minV);
  selMax = valToMs(maxV);
  document.getElementById("tl-selected-text").textContent =
    `${fmtDate(selMin)} — ${fmtDate(selMax)}`;

  if (currentChannel !== "mail") {
    if (currentChannel === "messenger") {
      clearTimeout(statsDebounceTimer);
      statsDebounceTimer = setTimeout(() => {
        if (messengerScreen === "rooms") {
          refreshMessengerRoomsForRange();
        } else if (messengerScreen === "people" && currentChatroomId) {
          fetchAndRenderChatroomPeople();
        }
        const detailEl = document.getElementById("mp-detail");
        if (
          currentDetailMode === "messenger" &&
          currentMessengerPerson &&
          detailEl &&
          detailEl.classList.contains("open")
        ) {
          refreshMessengerDetailStats(currentMessengerPerson);
        }
      }, 300);
    }
    return;
  }

  sentStatsMap = {};
  receivedStatsMap = {};
  renderCards();
  clearTimeout(statsDebounceTimer);
  statsDebounceTimer = setTimeout(fetchPeriodStats, 120);
  const detailEl = document.getElementById("mp-detail");
  if (
    currentDetailMode === "mail" &&
    currentDetailPerson &&
    detailEl &&
    detailEl.classList.contains("open")
  ) {
    clearTimeout(detailDebounceTimer);
    detailDebounceTimer = setTimeout(
      () => refreshDetailStats(currentDetailPerson),
      400,
    );
  }
}

function initTimeline(firstMs, lastMs) {
  globalFirst = firstMs;
  globalLast = lastMs;
  fullMin = firstMs;
  fullMax = lastMs;
  selMin = firstMs;
  selMax = lastMs;

  const inMin = document.getElementById("tl-min");
  const inMax = document.getElementById("tl-max");
  inMin.value = 0;
  inMax.value = 1000;

  document.getElementById("tl-start-lbl").textContent = fmtDate(firstMs);
  document.getElementById("tl-end-lbl").textContent = fmtDate(lastMs);

  buildTicks(firstMs, lastMs);

  if (!timelineListenersAttached) {
    timelineListenersAttached = true;
    inMin.addEventListener("input", () => {
      if (+inMin.value >= +inMax.value) inMin.value = +inMax.value - 1;
      updateFill();
    });
    inMax.addEventListener("input", () => {
      if (+inMax.value <= +inMin.value) inMax.value = +inMin.value + 1;
      updateFill();
    });
  }

  updateFill();
}

function buildTicks(firstMs, lastMs) {
  const ticks = document.getElementById("tl-ticks");
  ticks.innerHTML = "";
  const spanMs = lastMs - firstMs;
  const spanMonths = spanMs / (1000 * 60 * 60 * 24 * 30);
  const stepMonths = spanMonths > 30 ? 6 : 3;

  const start = new Date(firstMs);
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);

  const points = [];
  while (cur.getTime() <= lastMs) {
    points.push(cur.getTime());
    cur.setMonth(cur.getMonth() + stepMonths);
  }
  points.push(lastMs);

  const uniq = [...new Set([firstMs, ...points])].filter(
    (t) => t >= firstMs && t <= lastMs,
  );

  const MIN_GAP_PX = 64;
  const containerWidth =
    ticks.offsetWidth || ticks.getBoundingClientRect().width || 0;
  const withPct = uniq.map((t) => ({
    t,
    pct: ((t - firstMs) / (lastMs - firstMs)) * 100,
  }));

  let filtered = [withPct[0]];
  for (let i = 1; i < withPct.length; i++) {
    const prev = filtered[filtered.length - 1];
    const gapPx = ((withPct[i].pct - prev.pct) / 100) * containerWidth;
    if (gapPx >= MIN_GAP_PX || i === withPct.length - 1) {
      filtered.push(withPct[i]);
    }
  }
  if (filtered.length >= 2) {
    const last = filtered[filtered.length - 1];
    const beforeLast = filtered[filtered.length - 2];
    const gapPx = ((last.pct - beforeLast.pct) / 100) * containerWidth;
    if (gapPx < MIN_GAP_PX) {
      filtered.splice(filtered.length - 2, 1);
    }
  }

  filtered.forEach(({ t, pct }) => {
    // 맨 처음/맨 끝 눈금은 바로 위 tl-start-lbl/tl-end-lbl이 이미 "2026.08.21"처럼
    // 자세한 날짜로 보여주고 있어서, 여기서 같은 위치에 "2026.08"(월 단위) 눈금을
    // 또 찍으면 같은 자리에 두 가지 표기가 겹쳐 보인다 — 양 끝은 눈금 라벨 생략.
    const isEdge = t === firstMs || t === lastMs;
    const div = document.createElement("div");
    div.className = "mp-tl-tick";
    div.style.position = "absolute";
    div.style.left = pct + "%";
    div.style.transform = "translateX(-50%)";
    div.innerHTML = `<div class="mp-tl-tick-line"></div>${isEdge ? "" : `<span class="mp-tl-tick-lbl">${fmtShort(t)}</span>`}`;
    ticks.appendChild(div);
  });
}

async function loadPeople() {
  const gmailId = await getCurrentMailId();
  const post = (body) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: gmailId }),
  });

  let dateRange = null;

  try {
    const [pRes, dRes, phRes, avRes] = await Promise.all([
      fetch("/high_affinity_person_stats", post()),
      fetch("/mail-date-range", post()),
      fetch("/contact-photos", post()),
      fetch("/person-avatars", post()),
    ]);

    if (pRes.ok) {
      const j = await pRes.json();
      allPeople = j.data || j || [];
    }
    if (dRes.ok) {
      const j = await dRes.json();
      const d = j.data || j;
      if (d.first_date && d.last_date) dateRange = d;
    }
    if (phRes.ok) contactPhotos = await phRes.json();
    if (avRes.ok) generatedAvatars = await avRes.json();
  } catch (e) {
    console.error("loadPeople 네트워크 오류:", e);
  }

  renderCards();
  startAvatarGeneration();
  initMyAvatar();

  if (dateRange) {
    mailDateRange = {
      first: new Date(dateRange.first_date).getTime(),
      last: new Date(dateRange.last_date).getTime(),
    };
  } else {
    const fallbackEnd = Date.now();
    mailDateRange = {
      first: fallbackEnd - 1000 * 60 * 60 * 24 * 365 * 3,
      last: fallbackEnd,
    };
  }
  initTimeline(mailDateRange.first, mailDateRange.last);
}

async function startAvatarGeneration() {
  if (avatarGenStarted) return;
  avatarGenStarted = true;

  const gmailId = await getCurrentMailId();
  if (!gmailId) return;

  const candidates = groupByEntityName(allPeople)
    .filter((p) => p.email && !generatedAvatars[(p.email || "").toLowerCase()])
    .map((p) => ({ email: p.email, name: resolveDisplayName(p) }));

  if (!candidates.length) return;

  const BATCH_SIZE = 6;
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch("/generate-person-avatars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: gmailId, people: batch }),
      });
      if (res.ok) {
        const j = await res.json();
        Object.assign(generatedAvatars, j.data || {});
        renderCards();
      }
    } catch (e) {
      console.error("아바타 생성 오류:", e);
    }
  }
}

async function initMyAvatar() {
  const gmailId = await getCurrentMailId();
  const myNameEl = document.getElementById("mp-detail-my-name");
  const myEmailEl = document.getElementById("mp-detail-my-email");
  if (myNameEl)
    myNameEl.textContent = sessionStorage.getItem("gw_user_name") || "나";
  if (myEmailEl) myEmailEl.textContent = gmailId || "이메일 정보 없음";
  if (!gmailId) return;
  try {
    const cacheRes = await fetch("/self-avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: gmailId }),
    });
    if (cacheRes.ok) {
      const j = await cacheRes.json();
      if (j.url) {
        myAvatarUrl = j.url;
        refreshSelfAvatarEl();
        return;
      }
    }
    const myName = sessionStorage.getItem("gw_user_name") || "나";
    const genRes = await fetch("/generate-self-avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: gmailId, name: myName }),
    });
    if (genRes.ok) {
      const j = await genRes.json();
      if (j.url) {
        myAvatarUrl = j.url;
        refreshSelfAvatarEl();
      }
    }
  } catch (e) {
    console.error("내 아바타 생성 오류:", e);
  }
}

function refreshSelfAvatarEl() {
  const el = document.getElementById("mp-detail-avatar-self");
  if (!el || !myAvatarUrl) return;
  el.innerHTML = `<img src="${myAvatarUrl}" alt="나" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
}

const mailBtn = document.getElementById("mp-mail-btn");
const messengerBtn = document.getElementById("mp-messenger-btn");
const mailView = document.getElementById("mp-mail-view");
const messengerView = document.getElementById("mp-messenger-view");
const accountPickerMount = document.getElementById("account-picker-mount");
const chatroomPickerMount = document.getElementById("chatroom-picker-mount");

const MAIL_SORT_OPTIONS = [
  { value: "affinity", label: "친밀도" },
  { value: "name", label: "이름" },
  { value: "total", label: "송수신 횟수" },
  { value: "received", label: "받은 메일수" },
  { value: "sent", label: "보낸 메일수" },
];
const ROOM_SORT_OPTIONS = [
  { value: "name", label: "이름" },
  { value: "total", label: "총 채팅횟수" },
  { value: "mood", label: "분위기" },
];
const PEOPLE_SORT_OPTIONS = [
  { value: "name", label: "이름" },
  { value: "count", label: "채팅횟수" },
];

function sortMenuHtml(options, currentMode) {
  return options
    .map(
      (o) =>
        `<div class="mp-dropdown-item${o.value === currentMode ? " selected" : ""}" data-sort="${o.value}">${o.label}</div>`,
    )
    .join("");
}
function refreshSortMenuForMail() {
  ddMenu.innerHTML = sortMenuHtml(MAIL_SORT_OPTIONS, sortMode);
  ddLabel.textContent = MAIL_SORT_OPTIONS.find(
    (o) => o.value === sortMode,
  ).label;
}
function refreshSortMenuForRooms() {
  ddMenu.innerHTML = sortMenuHtml(ROOM_SORT_OPTIONS, roomSortMode);
  ddLabel.textContent = ROOM_SORT_OPTIONS.find(
    (o) => o.value === roomSortMode,
  ).label;
}
function refreshSortMenuForPeople() {
  ddMenu.innerHTML = sortMenuHtml(PEOPLE_SORT_OPTIONS, peopleSortMode);
  ddLabel.textContent = PEOPLE_SORT_OPTIONS.find(
    (o) => o.value === peopleSortMode,
  ).label;
}

async function fetchRoomMoodScore(chatroomId) {
  const startDate = msToDateStr(selMin);
  const endDate = msToDateStr(selMax);
  const cacheKey = `${chatroomId}|${startDate}|${endDate}`;
  if (cacheKey in roomMoodCache) return roomMoodCache[cacheKey];
  let score = null;
  try {
    const res = await fetch("/chatroom-mood", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatroom_id: chatroomId,
        start_date: startDate,
        end_date: endDate,
      }),
    });
    if (res.ok) {
      const j = await res.json();
      const d = j.data || {};
      const entries =
        d.monthly && d.monthly.length ? d.monthly : d.yearly || [];
      const scores = entries.map((e) => e.mood_score).filter((v) => v != null);
      if (scores.length)
        score = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
  } catch (e) {
    console.error("chatroom-mood 오류:", e);
  }
  roomMoodCache[cacheKey] = score;
  return score;
}

async function getSortedRooms() {
  const list = [...messengerChatrooms];
  if (roomSortMode === "name") {
    list.sort((a, b) => a.chatroom_name.localeCompare(b.chatroom_name, "ko"));
  } else if (roomSortMode === "total") {
    list.sort((a, b) => b.message_count - a.message_count);
  } else if (roomSortMode === "mood") {
    const scores = await Promise.all(
      list.map((r) => fetchRoomMoodScore(r.chatroom_id)),
    );
    list.forEach((r, i) => (r._moodScore = scores[i]));
    list.sort((a, b) => (b._moodScore ?? -1) - (a._moodScore ?? -1));
  }
  return list;
}

function sortPeopleList(list) {
  const copy = [...list];
  if (peopleSortMode === "count") {
    copy.sort((a, b) => (b.message_count || 0) - (a.message_count || 0));
  } else {
    copy.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
  }
  return copy;
}

function setChannel(channel) {
  const isMail = channel === "mail";
  currentChannel = channel;
  mailBtn.classList.toggle("active", isMail);
  messengerBtn.classList.toggle("active", !isMail);
  mailView.style.display = isMail ? "" : "none";
  messengerView.style.display = isMail ? "none" : "";

  accountPickerMount.style.display = isMail ? "" : "none";
  chatroomPickerMount.style.display = isMail ? "none" : "";

  document.getElementById("account-picker-mount").style.display = isMail
    ? ""
    : "none";
  document.getElementById("mp-brand-filter-btn").style.display = isMail
    ? ""
    : "none";
  if (isMail) refreshSortMenuForMail();
  else if (messengerScreen === "people") refreshSortMenuForPeople();
  else refreshSortMenuForRooms();
  if (isMail && mailDateRange) {
    initTimeline(mailDateRange.first, mailDateRange.last);
  } else if (!isMail && messengerDateRange) {
    initTimeline(messengerDateRange.first, messengerDateRange.last);
  }
}

async function ensureMessengerDateRange() {
  if (!messengerDateRange) {
    try {
      const res = await fetch("/messenger-date-range", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = res.ok ? (await res.json()).data || {} : {};
      if (d.first_date && d.last_date) {
        messengerDateRange = {
          first: new Date(d.first_date).getTime(),
          last: new Date(d.last_date).getTime(),
        };
      }
    } catch (e) {
      console.error("messenger-date-range 오류:", e);
    }
    if (!messengerDateRange) {
      const fallbackEnd = Date.now();
      messengerDateRange = {
        first: fallbackEnd - 1000 * 60 * 60 * 24 * 365 * 3,
        last: fallbackEnd,
      };
    }
  }
  initTimeline(messengerDateRange.first, messengerDateRange.last);
}

async function fetchMessengerChatroomsForRange() {
  try {
    const res = await fetch("/messenger-chatrooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_date: msToDateStr(selMin),
        end_date: msToDateStr(selMax),
      }),
    });
    messengerChatrooms = res.ok ? (await res.json()).data.chatrooms || [] : [];
  } catch (e) {
    console.error("messenger-chatrooms 오류:", e);
    messengerChatrooms = [];
  }
}

async function loadMessengerView() {
  messengerView.innerHTML = `
    <div class="mp-empty">
      <i class="bi bi-chat-dots"></i>
      <p>단톡방 목록을 불러오는 중...</p>
    </div>
  `;
  await fetchMessengerChatroomsForRange();
  await renderChatroomGrid();
}

async function refreshMessengerRoomsForRange() {
  await fetchMessengerChatroomsForRange();
  await renderChatroomGrid();
}

function buildRoomAvatarHtml(room) {
  const names = room.top_participants || [];
  if (!names.length) return `<i class="bi bi-chat-dots-fill"></i>`;

  const n = names.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rowCount = Math.ceil(n / cols);
  const cellFontEm = Math.min(0.42, 0.85 / cols).toFixed(2);

  let idx = 0;
  const rowsHtml = [];
  for (let r = 0; r < rowCount; r++) {
    const remaining = n - idx;
    const remainingRows = rowCount - r;
    const take = Math.ceil(remaining / remainingRows);
    const cellsHtml = names
      .slice(idx, idx + take)
      .map(
        (name, i) =>
          `<div class="mp-room-avatar-cell" style="background:${CARD_BG[(idx + i) % CARD_BG.length]};color:${AVATAR_COLORS_DETAIL[(idx + i) % AVATAR_COLORS_DETAIL.length]};font-size:${cellFontEm}em;">${esc(initials(name))}</div>`,
      )
      .join("");
    idx += take;
    rowsHtml.push(`<div class="mp-room-avatar-row">${cellsHtml}</div>`);
  }
  return `<div class="mp-room-avatar-grid">${rowsHtml.join("")}</div>`;
}

async function renderChatroomGrid() {
  currentChatroomId = null;
  messengerScreen = "rooms";
  refreshSortMenuForRooms();
  if (!messengerChatrooms.length) {
    messengerView.innerHTML = `
      <div class="mp-empty">
        <i class="bi bi-chat-dots"></i>
        <p>이 기간에 해당하는 단톡방이 없습니다.</p>
      </div>
    `;
    return;
  }
  if (roomSortMode === "mood") {
    messengerView.innerHTML = `
      <div class="mp-empty">
        <i class="bi bi-chat-dots"></i>
        <p>분위기 계산 중...</p>
      </div>
    `;
  }
  messengerChatrooms = await getSortedRooms();
  messengerView.innerHTML = `
    <div class="mp-grid mp-room-grid" id="mp-room-grid">
      ${messengerChatrooms
        .map((r, i) => {
          const moodText =
            roomSortMode === "mood" && r._moodScore != null
              ? ` · 분위기 ${Math.round(r._moodScore)}%`
              : "";
          return `
        <div class="mp-card mp-room-card" data-idx="${i}" title="${esc(r.chatroom_name)}">
          <div class="mp-avatar mp-room-avatar">${buildRoomAvatarHtml(r)}</div>
          <div class="mp-name" style="font-size:${nameFontSize(r.chatroom_name)}">${esc(r.chatroom_name)}</div>
          <div class="mp-period-badge">${r.participant_count}명 · ${r.message_count}건${moodText}</div>
        </div>`;
        })
        .join("")}
    </div>`;
}

async function openChatroom(chatroomId, chatroomName) {
  currentChatroomId = chatroomId;
  currentChatroomName = chatroomName;
  messengerScreen = "people";
  refreshSortMenuForPeople();
  messengerView.innerHTML = `
    <div class="mp-empty">
      <i class="bi bi-people"></i>
      <p>참여자를 불러오는 중...</p>
    </div>
  `;
  await fetchAndRenderChatroomPeople();
}

async function fetchAndRenderChatroomPeople() {
  let people = [];
  try {
    const res = await fetch("/chatroom-person-detail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatroom_id: currentChatroomId,
        start_date: msToDateStr(selMin),
        end_date: msToDateStr(selMax),
      }),
    });
    const all = res.ok ? (await res.json()).data.people || [] : [];
    people = all.filter((p) => (p.message_count || 0) > 0);
  } catch (e) {
    console.error("chatroom-person-detail 오류:", e);
  }
  renderChatroomPeople(currentChatroomName, sortPeopleList(people));
}

function renderChatroomPeople(chatroomName, people) {
  currentChatroomPeople = people;
  const cardsHtml = people.length
    ? people
        .map(
          (p, i) => `
        <div class="mp-card mp-person-card" data-idx="${i}" title="${esc(p.name)}">
          <div class="mp-avatar" style="background:${CARD_BG[i % CARD_BG.length]};color:${AVATAR_COLORS_DETAIL[i % AVATAR_COLORS_DETAIL.length]};">${initials(p.name)}</div>
          <div class="mp-name" style="font-size:${nameFontSize(p.name)}">${esc(p.name)}</div>
          <div class="mp-period-badge">${p.message_count}건</div>
        </div>`,
        )
        .join("")
    : `<div class="mp-empty"><i class="bi bi-people"></i><p>이 기간엔 메신저를 보낸 참여자가 없습니다.</p></div>`;

  messengerView.innerHTML = `
    <div class="mp-messenger-room-header">
      <button class="mp-back-btn" type="button"><i class="bi bi-arrow-left"></i> 단톡방 목록</button>
      <span class="mp-messenger-room-name">${esc(chatroomName)}</span>
    </div>
    <div class="mp-grid" id="mp-person-grid">${cardsHtml}</div>`;
}

messengerView.addEventListener("click", (e) => {
  const roomCard = e.target.closest(".mp-room-card");
  if (roomCard) {
    const room = messengerChatrooms[parseInt(roomCard.dataset.idx, 10)];
    if (room) openChatroom(room.chatroom_id, room.chatroom_name);
    return;
  }
  const personCard = e.target.closest(".mp-person-card");
  if (personCard) {
    const person = currentChatroomPeople[parseInt(personCard.dataset.idx, 10)];
    if (person) openMessengerDetail(person);
    return;
  }
  if (e.target.closest(".mp-back-btn")) renderChatroomGrid();
});

mailBtn.addEventListener("click", () => setChannel("mail"));
messengerBtn.addEventListener("click", async () => {
  setChannel("messenger");
  await ensureMessengerDateRange();
  await loadMessengerView();
});

const brandFilterBtn = document.getElementById("mp-brand-filter-btn");
const brandFilterLabel = document.getElementById("mp-brand-filter-label");
brandFilterBtn.addEventListener("click", () => {
  hideBrandAccounts = !hideBrandAccounts;
  brandFilterBtn.classList.toggle("active", hideBrandAccounts);
  brandFilterLabel.textContent = hideBrandAccounts ? "광고 표시" : "광고 제거";
  renderCards();
});

const ddBtn = document.getElementById("mp-dropdown-btn");
const ddMenu = document.getElementById("mp-dropdown-menu");
const ddLabel = document.getElementById("mp-dropdown-label");

ddBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  ddBtn.classList.toggle("open");
  ddMenu.classList.toggle("open");
});

ddMenu.addEventListener("click", async (e) => {
  const item = e.target.closest(".mp-dropdown-item");
  if (!item) return;
  const chosen = item.dataset.sort;
  ddBtn.classList.remove("open");
  ddMenu.classList.remove("open");

  if (currentChannel === "mail") {
    document
      .querySelectorAll(".mp-dropdown-item")
      .forEach((i) => i.classList.remove("selected"));
    item.classList.add("selected");
    ddLabel.textContent = item.textContent.replace("✓", "").trim();
    sortMode = chosen;
    if (sortMode === "sent") await fetchSentStats();
    else if (sortMode === "received") await fetchReceivedStats();
    else if (sortMode === "total")
      await Promise.all([fetchSentStats(), fetchReceivedStats()]);
    renderCards();
  } else if (messengerScreen === "rooms") {
    roomSortMode = chosen;
    await renderChatroomGrid();
  } else {
    peopleSortMode = chosen;
    refreshSortMenuForPeople();
    renderChatroomPeople(
      currentChatroomName,
      sortPeopleList(currentChatroomPeople),
    );
  }
});

document.addEventListener("click", () => {
  ddBtn.classList.remove("open");
  ddMenu.classList.remove("open");
});

const AVATAR_COLORS_DETAIL = [
  "#575757",
  "#1d55c4",
  "#5b21b6",
  "#b45309",
  "#9d174d",
  "#565656",
  "#c2410c",
];
const CARD_BG = [
  "linear-gradient(150deg,#d3d3d3,#aeaeae)",
  "linear-gradient(150deg,#b8d4f8,#8ab6f4)",
  "linear-gradient(150deg,#d0c0f8,#b8a4f4)",
  "linear-gradient(150deg,#fde4a8,#fbd080)",
  "linear-gradient(150deg,#fcc0d8,#f8a4c4)",
  "linear-gradient(150deg,#d3d3d3,#b8b8b8)",
  "linear-gradient(150deg,#fed4a8,#fcbc80)",
];
const WC_COLORS = [
  "#575757",
  "#1d55c4",
  "#9333ea",
  "#b45309",
  "#dc2626",
  "#d97706",
  "#0e7490",
  "#1d4ed8",
  "#be185d",
  "#4338ca",
];
let kwCache = null;
let descCache = null;
let relationshipsCache = null;
let relationshipsCacheUserId = null;

async function loadRelationships(gmailId) {
  if (relationshipsCache && relationshipsCacheUserId === gmailId) {
    return relationshipsCache;
  }
  try {
    const res = await fetch("/mail-relationships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: gmailId }),
    });
    if (res.ok) {
      const j = await res.json();
      relationshipsCache = (j.data || []).filter(
        (r) => r.relation_label && String(r.relation_label).trim(),
      );
      relationshipsCacheUserId = gmailId;
    }
  } catch (e) {
    console.error("mail-relationships 오류:", e);
  }
  return relationshipsCache || [];
}

function findRelationLabel(relationships, personEmail) {
  const email = (personEmail || "").toLowerCase();
  const match = relationships.find(
    (r) => (r.person_account_id || "").toLowerCase() === email,
  );
  return match ? match.relation_label : null;
}

function msToDateStr(ms) {
  return new Date(ms).toISOString().split("T")[0];
}

async function loadKeywords(gmailId) {
  if (kwCache) return kwCache;
  try {
    const res = await fetch("/keyword-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: gmailId }),
    });
    if (res.ok) {
      const j = await res.json();
      kwCache = (j.data || j).keywords || [];
    }
  } catch {}
  return kwCache || [];
}

async function loadDescriptions(gmailId) {
  if (descCache) return descCache;
  try {
    const res = await fetch("/person-descriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: gmailId }),
    });
    if (res.ok) {
      const j = await res.json();
      descCache = j.data || [];
    }
  } catch {}
  return descCache || [];
}

function renderDescription(person, descriptions) {
  const personEmail = typeof person === "string" ? person : person.email || "";
  const el = document.getElementById("mp-desc-profile-content");
  if (!el) return;
  const found = descriptions.find(
    (d) =>
      (d.person_account_id || "").toLowerCase() === personEmail.toLowerCase(),
  );
  const rawDesc = found ? found.description : null;
  if (!rawDesc) {
    el.innerHTML =
      '<p class="mp-desc-profile-empty">등록된 설명이 없습니다.</p>';
    return;
  }
  const lines = rawDesc.split("\n").filter(Boolean);
  el.innerHTML = lines
    .map((line) => {
      const ci = line.indexOf(":");
      if (ci === -1)
        return `<div class="mp-desc-profile-row"><span class="mp-desc-profile-val">${line}</span></div>`;
      const key = line.slice(0, ci).trim();
      const val = line.slice(ci + 1).trim();
      return `<div class="mp-desc-profile-row">
            <span class="mp-desc-profile-key">${key}</span>
            <span class="mp-desc-profile-val">${val}</span>
          </div>`;
    })
    .join("");
}

function renderBarChart(data) {
  const chartArea = document.getElementById("mp-chart");
  const totalEl = document.getElementById("mp-stats-total");
  const yEl = document.getElementById("mp-vchart-y");
  if (!data || !data.monthly || !data.monthly.length) {
    chartArea.innerHTML =
      '<span style="color:#b0b0b0;font-size:1rem;font-style:italic;">해당 기간 데이터 없음</span>';
    if (totalEl) totalEl.textContent = "";
    if (yEl) yEl.innerHTML = "<span></span><span></span><span>0</span>";
    return;
  }
  const total = data.total || { sent: 0, received: 0 };
  if (totalEl) totalEl.textContent = `총 ${total.sent + total.received}건`;
  const maxVal = Math.max(
    ...data.monthly.map((m) => Math.max(m.sent, m.received)),
    1,
  );
  if (yEl) {
    const mid = Math.round(maxVal / 2);
    yEl.innerHTML = `<span>${maxVal}</span><span>${mid}</span><span>0</span>`;
  }
  const YEAR_COLORS = ["#12886e", "#5a94e8"];
  const years = [...new Set(data.monthly.map((m) => m.month.split("-")[0]))];
  const yearColorMap = {};
  years.forEach((y, i) => {
    yearColorMap[y] = YEAR_COLORS[i % YEAR_COLORS.length];
  });

  const yearGroups = [];
  data.monthly.forEach((m) => {
    const year = m.month.split("-")[0];
    let g = yearGroups[yearGroups.length - 1];
    if (!g || g.year !== year) {
      g = { year, months: [] };
      yearGroups.push(g);
    }
    g.months.push(m);
  });

  const html = yearGroups
    .map((g) => {
      const yColor = yearColorMap[g.year];
      const monthsHtml = g.months
        .map((m) => {
          const sentPct = Math.max(2, Math.round((m.sent / maxVal) * 100));
          const recvPct = Math.max(2, Math.round((m.received / maxVal) * 100));
          const mon = m.month.split("-")[1];
          return `<div class="mp-vchart-group" style="flex:1;" data-month="${m.month}" data-sent="${m.sent}" data-recv="${m.received}" title="${m.month}: 보낸 ${m.sent}건 · 받은 ${m.received}건 (눌러서 목록보기)">
              <div class="mp-vchart-bars">
                <div class="mp-vchart-bar sent" style="height:${sentPct}%" title="보낸: ${m.sent}"></div>
                <div class="mp-vchart-bar recv" style="height:${recvPct}%" title="받은: ${m.received}"></div>
              </div>
              <div class="mp-vchart-label"><span class="mp-vchart-month">${mon}월</span></div>
            </div>`;
        })
        .join("");
      return `<div style="display:flex;flex-direction:column;align-items:stretch;height:100%;background:${yColor}14;border-radius:8px;padding:0 6px;flex:1;min-width:0;">
            <div style="text-align:center;padding:0 0 6px;flex-shrink:0;">
              <span style="display:inline-block;font-size:0.74rem;font-weight:800;color:#fff;background:${yColor};padding:2px 11px;border-radius:8px;letter-spacing:0.02em;">${g.year}</span>
            </div>
            <div style="display:flex;align-items:flex-end;gap:5px;flex:1;min-height:0;">${monthsHtml}</div>
          </div>`;
    })
    .join("");
  chartArea.innerHTML = `<div style="display:flex;align-items:stretch;gap:10px;width:100%;height:100%;padding:0 8px;box-sizing:border-box;">${html}</div>`;
}

function renderMessengerBarChart(data) {
  const chartArea = document.getElementById("mp-chart");
  const totalEl = document.getElementById("mp-stats-total");
  const yEl = document.getElementById("mp-vchart-y");
  if (!data || !data.monthly || !data.monthly.length) {
    chartArea.innerHTML =
      '<span style="color:#a0b8b0;font-size:0.82rem;font-style:italic;">메신저 데이터 없음</span>';
    if (totalEl) totalEl.textContent = "";
    if (yEl) yEl.innerHTML = "<span></span><span></span><span>0</span>";
    return;
  }
  if (totalEl) totalEl.textContent = `총 ${data.total || 0}건`;
  const maxVal = Math.max(...data.monthly.map((m) => m.count), 1);
  if (yEl) {
    const mid = Math.round(maxVal / 2);
    yEl.innerHTML = `<span>${maxVal}</span><span>${mid}</span><span>0</span>`;
  }

  const YEAR_COLORS = ["#12886e", "#5a94e8"];
  const yearGroups = [];
  data.monthly.forEach((m) => {
    const year = m.month.split("-")[0];
    let g = yearGroups[yearGroups.length - 1];
    if (!g || g.year !== year) {
      g = { year, months: [] };
      yearGroups.push(g);
    }
    g.months.push(m);
  });

  const html = yearGroups
    .map((g, gi) => {
      const yColor = YEAR_COLORS[gi % YEAR_COLORS.length];
      const monthsHtml = g.months
        .map((m) => {
          const pct = Math.max(2, Math.round((m.count / maxVal) * 100));
          const mon = m.month.split("-")[1];
          return `<div class="mp-vchart-group" style="flex:1;" data-month="${m.month}" title="${m.month}: ${m.count}건 (눌러서 일별로 보기)">
              <div class="mp-vchart-bars">
                <div class="mp-vchart-bar sent" style="height:${pct}%" title="${m.count}건"></div>
              </div>
              <div class="mp-vchart-label"><span class="mp-vchart-month">${mon}월</span></div>
            </div>`;
        })
        .join("");
      return `<div style="display:flex;flex-direction:column;align-items:stretch;height:100%;background:${yColor}14;border-radius:8px;padding:0 6px;flex:1;min-width:0;">
            <div style="text-align:center;padding:0 0 6px;flex-shrink:0;">
              <span style="display:inline-block;font-size:0.74rem;font-weight:800;color:#fff;background:${yColor};padding:2px 11px;border-radius:8px;letter-spacing:0.02em;">${g.year}</span>
            </div>
            <div style="display:flex;align-items:flex-end;gap:5px;flex:1;min-height:0;">${monthsHtml}</div>
          </div>`;
    })
    .join("");
  chartArea.innerHTML = `<div style="display:flex;align-items:stretch;gap:10px;width:100%;height:100%;padding:0 8px;box-sizing:border-box;">${html}</div>`;
}

function renderRelationDiagram(personName, relationships) {
  const el = document.getElementById("mp-desc-profile-content");
  if (!relationships.length) {
    el.innerHTML =
      '<p class="mp-desc-profile-empty">파악된 관계가 없습니다.</p>';
    return;
  }
  const size = 380,
    center = size / 2,
    radius = 130;
  const others = relationships.map((r) => ({
    name: r.source === personName ? r.target : r.source,
    label: r.relation_label || "",
  }));
  const n = others.length;
  const spokesHtml = others
    .map((o, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      const x = center + radius * Math.cos(angle);
      const y = center + radius * Math.sin(angle);
      const midX = center + radius * 0.55 * Math.cos(angle);
      const midY = center + radius * 0.55 * Math.sin(angle);
      const color = WC_COLORS[i % WC_COLORS.length];
      return `
        <line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="${color}" stroke-width="1.5" stroke-opacity="0.4"/>
        <rect x="${midX - 24}" y="${midY - 9}" width="48" height="18" rx="9" fill="${color}" fill-opacity="0.14"/>
        <text x="${midX}" y="${midY + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="${color}">${esc(o.label)}</text>
        <circle cx="${x}" cy="${y}" r="26" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.5"/>
        <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" font-weight="800" fill="${color}">${esc(initials(o.name))}</text>
        <text x="${x}" y="${y + 42}" text-anchor="middle" font-size="11" fill="#5a5a5a">${esc(o.name)}</text>`;
    })
    .join("");
  el.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" style="width:100%;max-width:400px;height:auto;display:block;margin:0 auto;">
      ${spokesHtml}
      <circle cx="${center}" cy="${center}" r="32" fill="#1a6e4a"/>
      <text x="${center}" y="${center + 5}" text-anchor="middle" font-size="13" font-weight="800" fill="#fff">${esc(initials(personName))}</text>
    </svg>`;
}

let activeDrawerMonth = null;
let currentMailDayList = [];
let currentMailDrawerDate = null;
let currentMailDayEmails = [];

document.getElementById("mp-chart").addEventListener("click", (e) => {
  const group = e.target.closest(".mp-vchart-group");
  if (!group || !group.dataset.month) return;
  document
    .querySelectorAll(".mp-vchart-group.active")
    .forEach((g) => g.classList.remove("active"));
  group.classList.add("active");

  if (currentDetailMode === "mail") {
    openEmailDrawer(
      group.dataset.month,
      +group.dataset.sent,
      +group.dataset.recv,
    );
  } else if (currentDetailMode === "messenger") {
    openMessengerDayList(group.dataset.month);
  }
});

function fmtMonthLabel(month) {
  const [y, m] = month.split("-");
  return `${y}년 ${parseInt(m)}월`;
}

function fmtEmailDateTime(dateStr) {
  const [datePart, timePart] = (dateStr || "").split(" ");
  const day = parseInt((datePart || "").split("-")[2], 10) || "";
  const time = (timePart || "").slice(0, 5);
  return `${day}일 ${time}`;
}

function renderMailDayList(days) {
  const listEl = document.getElementById("mp-echange-list-body");
  if (!days.length) {
    listEl.innerHTML =
      '<p style="color:#b7ada0;font-size:0.85rem;text-align:center;padding:40px 0;">이 달에는 주고받은 메일이 없어요.</p>';
    return;
  }
  listEl.innerHTML = days
    .map(
      (d) => `
        <button class="mp-day-row" type="button" data-date="${d.date}">
          <span class="mp-day-row-date">${fmtDayLabel(d.date)}</span>
          <span class="mp-day-row-count">${d.count}건</span>
        </button>`,
    )
    .join("");
}

async function openEmailDrawer(month, sentCount, recvCount) {
  activeDrawerMonth = month;
  const person = currentDetailPerson;
  const personName = person ? resolveDisplayName(person) : "";
  document.getElementById("mp-echange-list-title").textContent =
    fmtMonthLabel(month);
  document.getElementById("mp-echange-list-count").textContent = person
    ? `${personName} · 총 ${sentCount + recvCount}건 (보낸 ${sentCount} · 받은 ${recvCount}) · 날짜를 누르면 그날 메일을 볼 수 있어요`
    : "";
  document.getElementById("mp-echange-list-body").innerHTML =
    '<p style="color:#b7ada0;font-size:0.85rem;text-align:center;padding:40px 0;">불러오는 중...</p>';

  const chartview = document.getElementById("mp-echange-chartview");
  const listview = document.getElementById("mp-echange-listview");
  chartview.style.flex = "1 1 54%";
  listview.style.flex = "1 1 44%";
  listview.style.width = "";
  listview.style.opacity = "1";
  listview.style.pointerEvents = "auto";
  listview.style.paddingLeft = "18px";
  listview.style.borderLeft = "1px solid rgba(28,28,30,0.1)";

  if (!person || !person.email) {
    currentMailDayList = [];
    renderMailDayList([]);
    return;
  }

  const gmailId = await getCurrentMailId();

  try {
    const res = await fetch("/mail-person-daily-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: gmailId,
        person_user_id: person.email,
        month,
      }),
    });
    if (activeDrawerMonth !== month) return;
    const days = res.ok ? (await res.json()).data.days || [] : [];
    days.sort((a, b) => b.date.localeCompare(a.date));
    currentMailDayList = days;
    renderMailDayList(days);
  } catch (e) {
    console.error("mail-person-daily-stats 오류:", e);
    if (activeDrawerMonth === month) {
      currentMailDayList = [];
      renderMailDayList([]);
    }
  }
}

async function openMailDayChat(date) {
  currentMailDrawerDate = date;
  const person = currentDetailPerson;
  const listEl = document.getElementById("mp-echange-list-body");
  document.getElementById("mp-echange-list-title").textContent =
    fmtDayLabel(date);
  document.getElementById("mp-echange-list-count").textContent = "";
  listEl.innerHTML =
    '<p style="color:#b7ada0;font-size:0.85rem;text-align:center;padding:40px 0;">불러오는 중...</p>';

  if (!person || !person.email) {
    currentMailDayEmails = [];
    renderMailDayEmailList([]);
    return;
  }

  const gmailId = await getCurrentMailId();
  try {
    const res = await fetch("/mail-day-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: gmailId,
        person_user_id: person.email,
        date,
      }),
    });
    if (currentMailDrawerDate !== date) return;
    const emails = res.ok ? (await res.json()).data.emails || [] : [];
    currentMailDayEmails = emails;
    renderMailDayEmailList(emails);
  } catch (e) {
    console.error("mail-day-emails 오류:", e);
    if (currentMailDrawerDate === date) {
      currentMailDayEmails = [];
      renderMailDayEmailList([]);
    }
  }
}

function renderMailDayEmailList(emails) {
  const listEl = document.getElementById("mp-echange-list-body");
  const backBtn = `<button class="mp-back-btn" type="button" id="mp-day-back-btn"><i class="bi bi-arrow-left"></i> 날짜 목록</button>`;
  if (!emails.length) {
    listEl.innerHTML = `${backBtn}<p style="color:#b7ada0;font-size:0.85rem;text-align:center;padding:40px 0;">그날 주고받은 메일을 찾지 못했어요.</p>`;
    return;
  }
  const rowsHtml = emails
    .map(
      (e, i) => `
        <button class="mp-email-row ${e.direction}" type="button" data-idx="${i}">
          <div class="mp-email-card-top">
            <span class="mp-email-tag ${e.direction}">${e.direction === "sent" ? "보낸 메일" : "받은 메일"}</span>
            <span class="mp-email-date">${fmtEmailDateTime(e.date)}</span>
          </div>
          <div class="mp-email-subject">${esc(e.subject || "(제목 없음)")}</div>
          <div class="mp-email-from">${esc(e.sender || "")} → ${esc(e.receiver || "")}</div>
        </button>`,
    )
    .join("");
  listEl.innerHTML = `${backBtn}<div class="mp-chatline-list">${rowsHtml}</div>`;
}

function renderMailEmailDetail(email) {
  const listEl = document.getElementById("mp-echange-list-body");
  const backBtn = `<button class="mp-back-btn" type="button" id="mp-email-back-btn"><i class="bi bi-arrow-left"></i> 메일 목록</button>`;
  const cardsHtml = `
        <div class="mp-email-card ${email.direction}">
          <div class="mp-email-card-top">
            <span class="mp-email-tag ${email.direction}">${email.direction === "sent" ? "보낸 메일" : "받은 메일"}</span>
            <span class="mp-email-date">${fmtEmailDateTime(email.date)}</span>
          </div>
          <div class="mp-email-subject">${esc(email.subject || "(제목 없음)")}</div>
          <div class="mp-email-from">${esc(email.sender || "")} → ${esc(email.receiver || "")}</div>
          <div class="mp-email-body">${esc(email.body || "")}</div>
        </div>`;
  listEl.innerHTML = `${backBtn}<div class="mp-chatline-list">${cardsHtml}</div>`;
}

function closeEmailDrawer() {
  const chartview = document.getElementById("mp-echange-chartview");
  const listview = document.getElementById("mp-echange-listview");
  chartview.style.flex = "1 1 100%";
  listview.style.flex = "0 0 0%";
  listview.style.width = "0";
  listview.style.opacity = "0";
  listview.style.pointerEvents = "none";
  listview.style.paddingLeft = "0";
  listview.style.borderLeft = "none";
  document
    .querySelectorAll(".mp-vchart-group.active")
    .forEach((g) => g.classList.remove("active"));
}

function fmtDayLabel(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

async function openMessengerDayList(month) {
  currentMessengerDrawerMonth = month;
  const person = currentMessengerPerson;

  document.getElementById("mp-echange-list-title").textContent =
    fmtMonthLabel(month);
  document.getElementById("mp-echange-list-count").textContent = person
    ? `${person.name} · 날짜를 누르면 그날 대화를 볼 수 있어요`
    : "";
  document.getElementById("mp-echange-list-body").innerHTML =
    '<p style="color:#b7ada0;font-size:0.85rem;text-align:center;padding:40px 0;">불러오는 중...</p>';

  const chartview = document.getElementById("mp-echange-chartview");
  const listview = document.getElementById("mp-echange-listview");
  chartview.style.flex = "1 1 54%";
  listview.style.flex = "1 1 44%";
  listview.style.width = "";
  listview.style.opacity = "1";
  listview.style.pointerEvents = "auto";
  listview.style.paddingLeft = "18px";
  listview.style.borderLeft = "1px solid rgba(28,28,30,0.1)";

  if (!person || !currentChatroomId) {
    currentMessengerDayList = [];
    renderMessengerDayList([]);
    return;
  }

  try {
    const res = await fetch("/chatroom-person-daily-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatroom_id: currentChatroomId,
        participant_id: person.participant_id,
        month,
      }),
    });
    if (currentMessengerDrawerMonth !== month) return;
    const days = res.ok ? (await res.json()).data.days || [] : [];
    currentMessengerDayList = days;
    renderMessengerDayList(days);
  } catch (e) {
    console.error("chatroom-person-daily-stats 오류:", e);
    currentMessengerDayList = [];
    renderMessengerDayList([]);
  }
}

function renderMessengerDayList(days) {
  const listEl = document.getElementById("mp-echange-list-body");
  if (!days.length) {
    listEl.innerHTML =
      '<p style="color:#b7ada0;font-size:0.85rem;text-align:center;padding:40px 0;">이 달엔 보낸 메신저가 없어요.</p>';
    return;
  }
  listEl.innerHTML = days
    .map(
      (d) => `
        <button class="mp-day-row" type="button" data-date="${d.date}">
          <span class="mp-day-row-date">${fmtDayLabel(d.date)}</span>
          <span class="mp-day-row-count">${d.count}건</span>
        </button>`,
    )
    .join("");
}

async function openMessengerDayChat(date) {
  const listEl = document.getElementById("mp-echange-list-body");
  document.getElementById("mp-echange-list-title").textContent =
    fmtDayLabel(date);
  document.getElementById("mp-echange-list-count").textContent = "";
  listEl.innerHTML =
    '<p style="color:#b7ada0;font-size:0.85rem;text-align:center;padding:40px 0;">불러오는 중...</p>';

  try {
    const res = await fetch("/chatroom-day-messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatroom_id: currentChatroomId, date }),
    });
    const messages = res.ok ? (await res.json()).data.messages || [] : [];
    renderMessengerDayChat(messages);
  } catch (e) {
    console.error("chatroom-day-messages 오류:", e);
    renderMessengerDayChat([]);
  }
}

function renderMessengerDayChat(messages) {
  const listEl = document.getElementById("mp-echange-list-body");
  const backBtn = `<button class="mp-back-btn" type="button" id="mp-day-back-btn"><i class="bi bi-arrow-left"></i> 날짜 목록</button>`;
  if (!messages.length) {
    listEl.innerHTML = `${backBtn}<p style="color:#b7ada0;font-size:0.85rem;text-align:center;padding:40px 0;">그날 대화를 찾지 못했어요.</p>`;
    return;
  }
  const linesHtml = messages
    .map((m) =>
      m.is_system
        ? `<div class="mp-chatline system">${esc(m.text)}</div>`
        : `<div class="mp-chatline">
             <div class="mp-chatline-head"><span class="mp-chatline-sender">${esc(m.sender || "")}</span><span class="mp-chatline-time">${esc(m.time || "")}</span></div>
             <div class="mp-chatline-text">${esc(m.text)}</div>
           </div>`,
    )
    .join("");
  listEl.innerHTML = `${backBtn}<div class="mp-chatline-list">${linesHtml}</div>`;
}

document
  .getElementById("mp-echange-list-body")
  .addEventListener("click", (e) => {
    const emailRow = e.target.closest(".mp-email-row");
    if (emailRow && currentDetailMode === "mail") {
      const email = currentMailDayEmails[parseInt(emailRow.dataset.idx, 10)];
      if (email) renderMailEmailDetail(email);
      return;
    }
    const dayRow = e.target.closest(".mp-day-row");
    if (dayRow) {
      if (currentDetailMode === "mail") {
        openMailDayChat(dayRow.dataset.date);
      } else {
        openMessengerDayChat(dayRow.dataset.date);
      }
      return;
    }
    if (e.target.closest("#mp-email-back-btn")) {
      renderMailDayEmailList(currentMailDayEmails);
      return;
    }
    if (e.target.closest("#mp-day-back-btn")) {
      if (currentDetailMode === "mail") {
        renderMailDayList(currentMailDayList);
      } else {
        renderMessengerDayList(currentMessengerDayList);
      }
    }
  });

function renderWordCloud(keywords, targetId) {
  const wrap = document.getElementById(targetId || "mp-detail-wc");
  if (!keywords || !keywords.length) {
    wrap.innerHTML =
      '<span style="color:#c0c0c0;font-size:1rem;font-style:italic;">키워드 없음</span>';
    return;
  }
  const sorted = [...keywords].sort((a, b) => b.count - a.count).slice(0, 20);
  const max = sorted[0].count,
    min = sorted[sorted.length - 1].count;
  wrap.innerHTML = "";
  sorted.forEach((kw, idx) => {
    const norm =
      max === min ? 1 : Math.log1p(kw.count - min) / Math.log1p(max - min);
    const fs = Math.round(12 + norm * 22);
    const el = document.createElement("span");
    el.className = "mp-wc-word";
    el.style.cssText = `font-size:${fs}px;color:${WC_COLORS[idx % WC_COLORS.length]};transition-delay:${(idx * 0.04).toFixed(2)}s;`;
    el.title = `${kw.word}: ${kw.count}회`;
    el.innerHTML = `${kw.word}<sup class="mp-wc-count">${kw.count}</sup>`;
    wrap.appendChild(el);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => el.classList.add("show")),
    );
  });
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function switchDetailTab(tab) {
  const statsBody = document.getElementById("mp-detail-body-stats");
  const descBody = document.getElementById("mp-detail-desc");
  const kwBody = document.getElementById("mp-detail-kw");
  const btnStats = document.getElementById("mp-tab-stats");
  const btnDesc = document.getElementById("mp-tab-desc");
  const btnKw = document.getElementById("mp-tab-kw");

  statsBody.style.display = tab === "stats" ? "" : "none";
  descBody.classList.toggle("show", tab === "desc");
  kwBody.classList.toggle("show", tab === "kw");
  btnStats.className =
    "mp-detail-tab-btn" + (tab === "stats" ? " active-stats" : "");
  btnDesc.className =
    "mp-detail-tab-btn" + (tab === "desc" ? " active-desc" : "");
  btnKw.className = "mp-detail-tab-btn" + (tab === "kw" ? " active-kw" : "");
}
window.switchDetailTab = switchDetailTab;
window.closeEmailDrawer = closeEmailDrawer;

async function refreshDetailStats(person) {
  const gmailId = await getCurrentMailId();

  document.getElementById("mp-chart").innerHTML =
    '<span style="color:#b0b0b0;font-size:1rem;">로딩 중...</span>';
  document.getElementById("mp-detail-wc").innerHTML =
    '<span style="color:#b0b0b0;font-size:1rem;">로딩 중...</span>';

  const dateBody = {
    user_id: gmailId,
    person_user_id: person.email,
    start_date: msToDateStr(selMin),
    end_date: msToDateStr(selMax),
  };
  const post = (body) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const [statsRes, kwRes] = await Promise.allSettled([
    fetch("/mail-exchange-stats", post(dateBody)),
    fetch("/keyword-by-person-date", post(dateBody)),
  ]);

  let statsData = null;
  if (statsRes.status === "fulfilled" && statsRes.value.ok) {
    const j = await statsRes.value.json();
    statsData = j.data || j;
  }
  renderBarChart(statsData);

  let keywords = [];
  if (kwRes.status === "fulfilled" && kwRes.value.ok) {
    const j = await kwRes.value.json();
    keywords = j.keywords || [];
  }
  renderWordCloud(keywords.slice(0, 10), "mp-detail-wc");
}

async function openDetail(person, rowIndex) {
  const gmailId = await getCurrentMailId();
  const detailDisplayName = resolveDisplayName(person);

  currentDetailMode = "mail";
  currentDetailPersonEmail = person.email || "";
  currentMessengerPerson = null;
  document.getElementById("mp-tab-stats").textContent = "이메일 교환";
  document.getElementById("mp-tab-desc").textContent = "설명";
  document.getElementById("mp-tab-kw").textContent = "키워드";
  closeEmailDrawer();

  document.querySelector(".mp-detail-self-info").style.display = "";
  document.getElementById("mp-detail-avatar-self").style.display = "";
  document.querySelector(".mp-detail-relation").style.display = "";
  document
    .querySelector(".mp-detail-avatar-ring")
    ?.classList.remove("mp-ring-off");
  document.getElementById("mp-stats-legend").style.display = "";
  document.getElementById("mp-detail-messenger-desc")?.classList.remove("show");
  document
    .getElementById("mp-detail-namewrap")
    .classList.remove("mp-detail-namewrap-wide");

  const selfAvatarEl = document.getElementById("mp-detail-avatar-self");
  if (myAvatarUrl) {
    selfAvatarEl.innerHTML = `<img src="${myAvatarUrl}" alt="나" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
  } else {
    selfAvatarEl.innerHTML = "";
    selfAvatarEl.textContent = "나";
    selfAvatarEl.style.background = "linear-gradient(150deg,#e0e0e0,#c5c5c5)";
    selfAvatarEl.style.color = "#515151";
  }

  const relationLabelEl = document.getElementById("mp-detail-relation-label");
  relationLabelEl.innerHTML = "";
  loadRelationships(gmailId).then((relationships) => {
    if (
      currentDetailMode !== "mail" ||
      currentDetailPersonEmail !== (person.email || "")
    ) {
      return;
    }
    const label = findRelationLabel(relationships, person.email);
    relationLabelEl.innerHTML = label
      ? `<i class="bi bi-people-fill"></i>${esc(label)}`
      : "";
  });

  const ac = affinityColor(person.affinity);
  const avatarEl = document.getElementById("mp-detail-avatar");
  avatarEl.style.background = ac.gradient;
  avatarEl.style.color = ac.text;

  const ringFill = document.getElementById("mp-detail-avatar-ring-fill");
  const ringLabel = document.getElementById("mp-detail-avatar-ring-label");
  const affPct =
    person.affinity != null ? Math.round(person.affinity * 100) : null;
  if (ringFill) {
    const circumference = 2 * Math.PI * 46;
    ringFill.style.transition = "none";
    ringFill.style.strokeDashoffset = circumference;
    ringFill.getBoundingClientRect();
    ringFill.style.transition = "";
    ringFill.style.strokeDashoffset = String(
      circumference * (1 - (affPct ?? 0) / 100),
    );
  }
  if (ringLabel) {
    ringLabel.innerHTML = `<i class="bi bi-heart-fill"></i>${affPct != null ? affPct + "%" : "-"}`;
  }
  const detailEmail = (person.email || "").toLowerCase();
  const detailPhoto =
    generatedAvatars[detailEmail] || contactPhotos[detailEmail];
  if (detailPhoto) {
    const detailBrandCls = isBrandSender(person) ? " mp-brand-logo" : "";
    avatarEl.innerHTML = `<img src="${detailPhoto}" alt="${detailDisplayName}" class="${detailBrandCls.trim()}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.parentElement.textContent='${initials(detailDisplayName)}'">`;
    if (detailBrandCls)
      setupBrandLogo(avatarEl.querySelector("img.mp-brand-logo"));
  } else {
    avatarEl.textContent = initials(detailDisplayName);
  }
  document.getElementById("mp-detail-name").textContent = detailDisplayName;
  document.getElementById("mp-detail-email").textContent =
    person.email || "이메일 정보 없음";

  switchDetailTab("stats");

  currentDetailPerson = person;
  const panel = document.querySelector(".mp-panel");
  if (panel) panel.scrollTop = 0;
  document.getElementById("mp-detail").classList.remove("mp-detail-messenger");
  document.getElementById("mp-detail").classList.add("open");

  const profileEl = document.getElementById("mp-desc-profile-content");
  if (profileEl)
    profileEl.innerHTML = '<p class="mp-desc-profile-empty">로딩 중...</p>';
  loadDescriptions(gmailId).then((descs) => renderDescription(person, descs));

  await refreshDetailStats(person);
}

async function openMessengerDetail(person) {
  closeEmailDrawer();

  currentDetailMode = "messenger";
  currentDetailPerson = null;
  currentMessengerPerson = person;

  document.getElementById("mp-tab-stats").textContent = "메신저 통계";
  document.getElementById("mp-tab-desc").textContent = "관계";
  document.getElementById("mp-tab-kw").textContent = "키워드";

  document.querySelector(".mp-detail-self-info").style.display = "none";
  document.getElementById("mp-detail-avatar-self").style.display = "none";
  document.querySelector(".mp-detail-relation").style.display = "none";
  document
    .querySelector(".mp-detail-avatar-ring")
    ?.classList.add("mp-ring-off");
  document.getElementById("mp-stats-legend").style.display = "none";
  document
    .getElementById("mp-detail-namewrap")
    .classList.add("mp-detail-namewrap-wide");

  const avatarEl = document.getElementById("mp-detail-avatar");
  avatarEl.style.background = "linear-gradient(150deg,#cfe9df,#a9d4c4)";
  avatarEl.style.color = "#1a6e4a";
  avatarEl.textContent = initials(person.name);

  const ringFill = document.getElementById("mp-detail-avatar-ring-fill");
  const ringLabel = document.getElementById("mp-detail-avatar-ring-label");
  if (ringFill) ringFill.style.strokeDashoffset = String(2 * Math.PI * 46);
  if (ringLabel) ringLabel.innerHTML = "";

  document.getElementById("mp-detail-name").textContent =
    person.name || "(알 수 없음)";
  document.getElementById("mp-detail-email").textContent =
    `단톡방 참여자 · 메신저 ${person.message_count || 0}건`;

  const descEl = document.getElementById("mp-detail-messenger-desc");
  if (descEl) {
    descEl.textContent = person.description || "등록된 설명이 없습니다.";
    descEl.classList.add("show");
  }

  switchDetailTab("stats");
  const scrollPanel = document.querySelector(".mp-left");
  if (scrollPanel) scrollPanel.scrollTop = 0;
  document
    .getElementById("mp-detail")
    .classList.add("open", "mp-detail-messenger");

  document.getElementById("mp-desc-profile-content").innerHTML =
    '<p class="mp-desc-profile-empty">관계를 불러오는 중...</p>';
  try {
    const res = await fetch("/chatroom-relationships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatroom_id: currentChatroomId,
        start_date: "1970-01-01",
        end_date: msToDateStr(Date.now()),
      }),
    });
    const rels = res.ok ? (await res.json()).data.relationships || [] : [];
    const mine = rels
      .filter((r) => r.source === person.name || r.target === person.name)
      .sort((a, b) => (b.strength || 0) - (a.strength || 0))
      .slice(0, 8);
    renderRelationDiagram(person.name, mine);
  } catch (e) {
    console.error("chatroom-relationships 오류:", e);
    renderRelationDiagram(person.name, []);
  }

  await refreshMessengerDetailStats(person);
}

async function refreshMessengerDetailStats(person) {
  document.getElementById("mp-chart").innerHTML =
    '<span style="color:#a0b8b0;font-size:0.82rem;">로딩 중...</span>';
  document.getElementById("mp-detail-wc").innerHTML =
    '<span style="color:#a0b8b0;font-size:0.82rem;">로딩 중...</span>';

  const dateBody = {
    chatroom_id: currentChatroomId,
    participant_id: person.participant_id,
    start_date: msToDateStr(selMin),
    end_date: msToDateStr(selMax),
  };
  const post = (body) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const [statsRes, kwRes] = await Promise.allSettled([
    fetch("/chatroom-person-monthly-stats", post(dateBody)),
    fetch("/chatroom-keywords-by-person", post(dateBody)),
  ]);

  let stats = null;
  if (statsRes.status === "fulfilled" && statsRes.value.ok) {
    const j = await statsRes.value.json();
    stats = j.data || null;
  }
  renderMessengerBarChart(stats);

  let keywords = [];
  if (kwRes.status === "fulfilled" && kwRes.value.ok) {
    const j = await kwRes.value.json();
    keywords = j.data.keywords || [];
  }
  renderWordCloud(keywords.slice(0, 10), "mp-detail-wc");
}

document.getElementById("mp-detail-close").addEventListener("click", () => {
  document
    .getElementById("mp-detail")
    .classList.remove("open", "mp-detail-messenger");
  currentDetailPerson = null;
  currentDetailMode = "mail";
  currentDetailPersonEmail = "";
  currentMessengerPerson = null;
});

document.getElementById("mp-grid").addEventListener("click", (e) => {
  const card = e.target.closest(".mp-card");
  if (!card) return;
  const idx = parseInt(card.dataset.idx);
  const person = allPeople.find((p) => p.email === card.dataset.email);
  if (person) openDetail(person, Math.floor(idx / 7));
});

let _graphData = null;
let _graphD3Ready = false;
let _graphFullRendered = false;

function _loadGraphScripts() {
  return new Promise((resolve, reject) => {
    if (_graphD3Ready) {
      resolve();
      return;
    }
    const d3s = document.createElement("script");
    d3s.src = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
    d3s.onload = () => {
      const rgs = document.createElement("script");
      rgs.src = "/graph-render.js";
      rgs.onload = () => {
        _graphD3Ready = true;
        resolve();
      };
      rgs.onerror = reject;
      document.head.appendChild(rgs);
    };
    d3s.onerror = reject;
    document.head.appendChild(d3s);
  });
}

async function _ensureGraphData() {
  if (_graphData) return _graphData;
  await _loadGraphScripts();
  const gmailId = await getCurrentMailId();
  const res = await fetch("/graph-data?user_id=" + encodeURIComponent(gmailId));
  _graphData = await res.json();
  return _graphData;
}

function _renderMiniGraph(svgEl, data) {
  if (!data || !data.nodes || !data.nodes.length || !window.d3) return;
  const rect = svgEl.getBoundingClientRect();
  const w = rect.width || 200;
  const h = rect.height || 150;
  if (w < 10 || h < 10) return;

  const C = {
    EMAIL: "#f87171",
    PERSON: "#ffa255",
    TOPIC: "#dadada",
    ORGANIZATION: "#9d9d9d",
    LABEL: "#60a5fa",
    EVENT: "#a78bfa",
  };
  const nodes = data.nodes
    .slice(0, 80)
    .map((n) => ({ label: n.label, type: n.type || n.entity_type }));
  const labelSet = new Set(nodes.map((n) => n.label));
  const links = (data.edges || [])
    .filter((e) => labelSet.has(e.source) && labelSet.has(e.target))
    .slice(0, 150)
    .map((e) => ({ source: e.source, target: e.target }));

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const g = svg.append("g");

  const zoom = d3
    .zoom()
    .scaleExtent([0.1, 10])
    .on("zoom", (e) => g.attr("transform", e.transform));
  svg.call(zoom).on("dblclick.zoom", null);

  const link = g
    .append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke", "rgba(99, 99, 99,0.3)")
    .attr("stroke-width", 0.8);

  const node = g
    .append("g")
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("r", 4)
    .attr("fill", (d) => C[d.type] || "#c9d1d9")
    .attr("stroke", "#fff")
    .attr("stroke-width", 0.5)
    .style("cursor", "grab")
    .call(
      d3
        .drag()
        .on("start", (e, d) => {
          if (!e.active) sim.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (e, d) => {
          d.fx = e.x;
          d.fy = e.y;
        })
        .on("end", (e, d) => {
          if (!e.active) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

  const sim = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(links)
        .id((d) => d.label)
        .distance(18)
        .strength(0.5),
    )
    .force("charge", d3.forceManyBody().strength(-35))
    .force("center", d3.forceCenter(0, 0))
    .force("collide", d3.forceCollide(5));

  sim.on("tick", () => {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);
    node.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
  });

  let _fitted = false;
  function fitMini() {
    if (_fitted) return;
    _fitted = true;
    const pad = 8;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    nodes.forEach((d) => {
      x0 = Math.min(x0, d.x - 4);
      y0 = Math.min(y0, d.y - 4);
      x1 = Math.max(x1, d.x + 4);
      y1 = Math.max(y1, d.y + 4);
    });
    const bw = x1 - x0,
      bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return;
    const scale = Math.min(0.95, (w - pad * 2) / bw, (h - pad * 2) / bh);
    const tx = w / 2 - scale * ((x0 + x1) / 2);
    const ty = h / 2 - scale * ((y0 + y1) / 2);
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }
  sim.on("end", fitMini);
  let _tc = 0;
  sim.on("tick.fit", () => {
    if (++_tc >= 200) {
      fitMini();
      sim.on("tick.fit", null);
    }
  });
}

async function _initMiniGraph() {
  try {
    const data = await _ensureGraphData();
    const mini = document.getElementById("mp-graph-mini");
    if (mini) _renderMiniGraph(mini, data);
  } catch (e) {}
}

async function toggleGraphView() {
  const panel = document.getElementById("mp-graph-panel");
  const isOpen = panel.classList.contains("open");
  if (!isOpen) {
    panel.classList.add("open");
    if (!_graphFullRendered) {
      try {
        const data = await _ensureGraphData();
        await new Promise((r) => requestAnimationFrame(r));
        renderGraph(document.getElementById("graph"), data);
        _graphFullRendered = true;
      } catch (e) {
        console.error("그래프 렌더 실패:", e);
      }
    }
  } else {
    panel.classList.remove("open");
  }
}

// 초기화
loadPeople().then(() => fetchPeriodStats());
setTimeout(_initMiniGraph, 2500);
