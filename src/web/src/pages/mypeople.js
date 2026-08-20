import { bootstrapApp } from "../main-app.js";
import { initAccountPicker } from "../features/accountPicker.js";
import * as d3 from "d3";
import "../scss/pages/mypeople.scss";

bootstrapApp("mypeople");

/* ── 사용자 처리 ── */
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

const userIdPromise = initAccountPicker(
  document.getElementById("account-picker-mount"),
);

/* 메신저 뷰용 채팅방 선택 토글 — My Time과 동일하게 accountPicker.js를
   domain:"messenger"로 재사용. 선택값은 storageKey("gw_chatroom_id")로
   localStorage에 저장됨. */
let currentChatroomId = "";
const chatroomIdPromise = initAccountPicker(
  document.getElementById("chatroom-picker-mount"),
  (chatroomId) => {
    currentChatroomId = chatroomId;
  },
  { domain: "messenger", storageKey: "gw_chatroom_id" },
);
chatroomIdPromise.then((id) => {
  currentChatroomId = id || "";
});

/* ── 같은 name을 가진 브랜드 엔트리 통합 (친밀도 높은 대표 1개만 유지) ── */
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
  /* 영문/숫자는 글자 폭이 한글보다 좁으므로 같은 길이 구간이어도 더 크게 하되,
           최댓값(가장 짧은 구간)은 한글 3~4글자 구간 크기를 넘지 않도록 캡 */
  if (len <= 5) return "clamp(0.88rem, 1.68cqw, 1.68rem)";
  if (len <= 8) return "clamp(0.8rem,  1.43cqw, 1.43rem)";
  if (len <= 12) return "clamp(0.7rem,  1.2cqw,  1.2rem)";
  if (len <= 18) return "clamp(0.58rem, 0.97cqw, 0.97rem)";
  return "clamp(0.48rem, 0.8cqw,  0.85rem)";
}

/* ── 발신 전용/브랜드 계정 판별 (표시 이름 추론 + 아바타 생성 대상 판별 공용) ──
         로컬파트 정확히 일치 목록만으로는 stories-recap@, graph-insights@, recommendations@
         같은 변형을 못 거르므로, 키워드 포함 매칭 + 브랜드 표시명 차단목록을 함께 사용한다. */
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

/* ── 브랜드 로고 이미지의 실제 여백을 캔버스로 분석해, 원을 정확히 채우는 배율을 계산 ── */
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
        if (a < 10) continue; // 완전 투명 = 배경
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
  } catch (e) {
    /* CORS 등으로 픽셀 분석 불가 시 CSS 기본 확대값 유지 */
  }
}
function setupBrandLogo(img) {
  if (!img) return;
  if (img.complete && img.naturalWidth) autoFitBrandLogo(img);
  else
    img.addEventListener("load", () => autoFitBrandLogo(img), { once: true });
}
/* 발신 전용/브랜드 계정인지 (이름 필드를 사람 이름으로 신뢰할 수 없는 경우) */
function isBrandSender(p) {
  if (!p.email) return false;
  const [local] = p.email.split("@");
  return isGenericLocalPart(local) || isBrandDisplayName(p.name);
}

/* ── 이메일에서 표시 이름 추론 ── */
function resolveDisplayName(p) {
  if (!p.email) return p.name && p.name.trim() ? p.name.trim() : "(알 수 없음)";
  const [local, domain] = p.email.split("@");
  // 발신 전용/브랜드 계정은 이름 필드 무시 → 도메인 브랜드명 사용
  if (isBrandSender(p)) {
    const parts = (domain || "").split(".");
    // mail.instagram.com → instagram, accounts.google.com → google
    return parts.length >= 3 ? parts[parts.length - 2] : parts[0];
  }
  // 일반 계정: 이름 있으면 이름, 없으면 @ 앞부분
  if (p.name && p.name.trim()) return p.name.trim();
  return local || "(알 수 없음)";
}

/* ── 친밀도 기반 카드 색상 ── 하나의 초록 색조(hue)를 고정하고, 친밀도가 높을수록
         채도·명도를 진하게 만들어 "친밀도가 낮으면 흐린 민트, 높으면 짙은 에메랄드"로
         자연스럽게 이어지는 그라데이션을 만든다(구간별 다른 색이 아니라 연속값). */
const AFFINITY_HUE = 158; // 친밀도: 초록 계열 (카드 색상용, 현재 CSS에서 비활성화됨)
const AFFINITY_BAND_HUE = 28; // 친밀도 밴드 배경: 은은한 주황 계열 (너무 찐한 색 방지를 위해 채도를 낮게 유지)

/* 지정한 색조(hue)에 채도/명도 값을 직접 넣어 카드 그라데이션·그림자·글자색을 만드는 공용 함수.
         밝은 쪽/어두운 쪽에 색조를 살짝 다르게 줘서(단색 명암 대비가 아니라) 더 입체적이고
         디자인된 느낌의 그라데이션이 되도록 한다. */
function tierColor(hue, sat, lightHi, lightLo) {
  const hueLight = hue + 9; // 밝은 쪽은 살짝 따뜻하게
  const hueDark = hue - 7; // 어두운 쪽은 살짝 청록/차갑게
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

// 기존 5단계 친밀도 구간(90%/70%/40%/15%/그 이하)을 유지하되, 구간마다 채도·명도를
// 큰 폭으로 떨어뜨려 인접한 구간끼리도(예: 90%대 vs 70%대) 확실히 구분되게 한다.
const AFFINITY_TIERS = [
  { min: 0.9, sat: 75, lightHi: 57, lightLo: 41 }, // 90%+: 선명한 에메랄드
  { min: 0.7, sat: 55, lightHi: 77, lightLo: 61 }, // 70~90%: 채도를 크게 낮춘 중간 톤
  { min: 0.4, sat: 35, lightHi: 87, lightLo: 75 }, // 40~70%: 옅은 파스텔
  { min: 0.15, sat: 23, lightHi: 94, lightLo: 86 }, // 15~40%: 아주 옅은 민트
  { min: -Infinity, sat: 7, lightHi: 98, lightLo: 93 }, // 15% 미만: 거의 흰색
];
function affinityColor(aff) {
  const raw = aff ?? -1;
  const tier = AFFINITY_TIERS.find((tr) => raw >= tr.min);
  return tierColor(AFFINITY_HUE, tier.sat, tier.lightHi, tier.lightLo);
}

/* ── 이니셜 ── */
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

/* ── 날짜 유틸 ── */
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

/* ── 전역 상태 ── */
let allPeople = [];
let globalFirst = 0,
  globalLast = 0; // ms
let selMin = 0,
  selMax = 0; // ms (현재 선택 구간)
let fullMin = 0,
  fullMax = 0; // ms (전체 기간, 슬라이더 무관)
let activeFilter = "all";
let periodStats = {}; // email → {sent, received}
let periodStatsLoaded = false;
let statsDebounceTimer = null;
let contactPhotos = {}; // email → photo URL
let generatedAvatars = {}; // email → GPT 생성 아바타 이미지 URL
let avatarGenStarted = false;
let sortMode = "affinity";
let hideBrandAccounts = false; // true면 기업/광고성 발신자 카드를 목록에서 숨김
let sentStatsMap = {}; // email → 보낸 메일수
let receivedStatsMap = {}; // email → 받은 메일수
let currentDetailPerson = null; // 현재 열린 상세보기 person 객체
let detailDebounceTimer = null;
let myAvatarUrl = null; // 로그인한 사용자 본인의 아바타 이미지 URL (페이지 로드 시 1회 생성/캐시)

async function fetchSentStats() {
  const gmailId = (await userIdPromise) || "";
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
  const gmailId = (await userIdPromise) || "";
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
  const gmailId = (await userIdPromise) || "";
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
    periodStatsLoaded = true;
    console.log(
      "[periodStats] loaded. keys:",
      Object.keys(newStats).length,
      newStats,
    );
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

/* ── 카드 렌더링 ── */
function renderCards() {
  const grid = document.getElementById("mp-grid");
  let list = groupByEntityName(allPeople);
  console.log(
    "[renderCards] loaded:",
    periodStatsLoaded,
    "before filter:",
    list.length,
    "periodStats keys:",
    Object.keys(periodStats).length,
  );
  if (hideBrandAccounts) {
    list = list.filter((p) => !isBrandSender(p));
  }
  if (periodStatsLoaded) {
    list = list.filter((p) => {
      const ps = periodStats[(p.email || "").toLowerCase()];
      return ps && (ps.sent || 0) + (ps.received || 0) > 0;
    });
  }
  // 정렬
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

/* ── 친밀도 정렬 전용: 분포 기반 밴드 렌더링 ──
 * 고정된 임계값(90/70/40/15%)이나 고정된 퍼센타일(20/40/60/80%)로 나누면 실제
 * 값들이 좁은 범위에 몰려있을 때(예: 1~5% 사람들만 있는 경우) 아무 의미 없는
 * 경계가 그어진다. 그래서 실제 친밀도 값들에 1차원 k-means(Lloyd's algorithm)를
 * 돌려서 "이 데이터 안에서 자연스럽게 갈라지는 지점"을 스스로 찾는다 — 값이
 * 1~5% 다섯 개뿐이면 각자 자기 줄을 갖게 되고, 값이 한쪽에 몰려있으면 몰린
 * 덩어리는 한 줄로 묶이고 떨어진 값만 별도 줄로 갈라진다. 1차원 데이터에서는
 * k-means로 찾은 군집이 항상 정렬 순서상 연속 구간이 되므로(값이 겹치지 않는 한
 * 군집이 섞이지 않음), 정렬된 리스트를 그 경계에서 자르기만 하면 된다.
 * 구분선에는 각 줄의 실제 친밀도 값 범위(예: "4%" 또는 "61~79%")를 표시하고,
 * 밴드 배경은 상위(진함)→하위(연함) 그라데이션으로 깔아서 어느 줄이 더 친밀한
 * 그룹인지 한눈에 보이게 한다. */
const AFFINITY_BAND_COUNT = 5;
// 밴드 배경(hsl) — 카드 자체 색(AFFINITY_TIERS)보다 훨씬 옅게 깔아서 카드 색이 묻히지 않게 함.
// 실제 밴드 수가 5보다 적으면(값 종류가 적을 때) 앞에서부터만 사용됨.
const AFFINITY_BAND_BG = [
  { sat: 46, light: 90 }, // 상위 밴드
  { sat: 34, light: 92.5 },
  { sat: 24, light: 94.5 },
  { sat: 15, light: 96.5 },
  { sat: 6, light: 98.5 }, // 하위 밴드
];

/* 1차원 k-means(Lloyd's algorithm) — values 안에서 자연스러운 k개의 중심을 찾는다.
 * 유니크 값 개수가 k보다 적으면(예: 값이 3종류뿐인데 k=5) 실제로 만들 수 있는
 * 만큼만 반환한다. 중심이 수렴하다가 겹치면(예: 촘촘한 구간) 하나로 합쳐서
 * 실제로 구분되는 군집 수만큼만 최종 반환 — 억지로 5개를 채우지 않는다. */
function kmeans1D(values, k) {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  const actualK = Math.max(1, Math.min(k, unique.length));
  if (actualK === 1) return [unique[0]];

  // 초기 중심: 유니크 값 범위에서 균등 간격으로 뽑음
  let centroids = Array.from({ length: actualK }, (_, i) =>
    unique[Math.round((i * (unique.length - 1)) / (actualK - 1))],
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
      if (counts[c] === 0) continue; // 이번 라운드에 아무도 안 배정된 중심은 그대로 둠
      const next = sums[c] / counts[c];
      if (Math.abs(next - centroids[c]) > 1e-9) moved = true;
      centroids[c] = next;
    }
    if (!moved) break;
  }

  // 중심끼리 너무 가까우면(사실상 같은 군집) 하나로 합쳐서 실제 군집 수만 반환
  const sortedDesc = [...new Set(centroids.map((c) => Math.round(c * 1000) / 1000))].sort(
    (a, b) => b - a,
  );
  return sortedDesc;
}

function renderAffinityBands(list, cardHtml) {
  // list는 이미 affinity 내림차순 정렬된 상태(renderCards에서 정렬).
  // 카드 배지에는 반올림한 정수 퍼센트(예: 2%)만 보이는데, 군집을 원본 소수
  // 친밀도 값으로 만들면 배지에는 똑같이 "2%"로 보이는 두 사람이 실제로는
  // 1.6%/2.4%처럼 서로 다른 값이라 다른 줄로 갈라지는 문제가 있었다.
  // 그래서 반올림한 정수 퍼센트 자체를 군집 대상으로 쓴다 — 화면에 같은 숫자로
  // 보이는 사람은 항상 같은 줄에 묶이도록 보장.
  const pctOf = (p) => Math.round((p.affinity || 0) * 100);
  const values = list.map(pctOf);
  const centroids = kmeans1D(values, AFFINITY_BAND_COUNT); // 내림차순, 정수 퍼센트 기준

  // 중심과 중심 사이의 중간값을 경계로 사용 — 1D에서는 이 경계로 자르면
  // 각 값이 가장 가까운 중심에 배정된 것과 동일한 결과가 된다.
  const boundaries = [];
  for (let i = 0; i < centroids.length - 1; i++) {
    boundaries.push((centroids[i] + centroids[i + 1]) / 2);
  }

  let globalIdx = 0;
  let cursor = 0; // list는 내림차순 정렬돼 있으므로 앞에서부터 밴드별로 잘라내면 됨
  const bandsHtml = [];
  let prevBandFloor = null; // 바로 위 밴드(방금 끝난 밴드)의 최솟값(하한선) — 구분선 라벨에 사용

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

    const bg = AFFINITY_BAND_BG[b] || AFFINITY_BAND_BG[AFFINITY_BAND_BG.length - 1];
    const bandBg = `hsl(${AFFINITY_BAND_HUE} ${bg.sat}% ${bg.light}%)`;

    const cardsHtml = bandPeople
      .map((p) => cardHtml(p, globalIdx++))
      .join("");

    const bandMax = pctOf(bandPeople[0]);
    const bandMin = pctOf(bandPeople[bandPeople.length - 1]);
    // 구분선은 "바로 위 줄(방금 끝난 밴드)"의 기준을 보여준다 — 그 줄에 있던 사람들의
    // 친밀도가 전부 이 값 이상이라는 뜻으로 "-N% 이상"이라고 표시.
    const divider =
      prevBandFloor == null
        ? ""
        : `<div class="mp-band-divider"><span>${prevBandFloor}% 이상</span></div>`;

    bandsHtml.push(`
      <div class="mp-band">
        ${divider}
        <div class="mp-band-cards" style="--band-bg:${bandBg}">
          ${cardsHtml}
        </div>
      </div>
    `);
    prevBandFloor = bandMin; // 다음 구분선에는 방금 끝난 밴드의 최솟값(=하한선)을 "N% 이상"으로 표시
  }
  return bandsHtml.join("");
}

/* ── 타임라인 초기화 ── */
function initTimeline(firstMs, lastMs) {
  globalFirst = firstMs;
  globalLast = lastMs;
  fullMin = firstMs;
  fullMax = lastMs;
  selMin = firstMs;
  selMax = lastMs;

  const inMin = document.getElementById("tl-min");
  const inMax = document.getElementById("tl-max");
  const fill = document.getElementById("tl-fill");

  document.getElementById("tl-start-lbl").textContent = fmtDate(firstMs);
  document.getElementById("tl-end-lbl").textContent = fmtDate(lastMs);

  /* 눈금 생성 (약 6~8개) */
  buildTicks(firstMs, lastMs);

  function msToVal(ms) {
    return Math.round(((ms - firstMs) / (lastMs - firstMs)) * 1000);
  }
  function valToMs(v) {
    return firstMs + (v / 1000) * (lastMs - firstMs);
  }

  function updateFill() {
    const minV = +inMin.value,
      maxV = +inMax.value;
    const lPct = minV / 10,
      rPct = maxV / 10;
    fill.style.left = lPct + "%";
    fill.style.width = rPct - lPct + "%";
    selMin = valToMs(minV);
    selMax = valToMs(maxV);
    sentStatsMap = {};
    receivedStatsMap = {}; // 날짜 범위 변경 시 캐시 무효화
    document.getElementById("tl-selected-text").textContent =
      `${fmtDate(selMin)} — ${fmtDate(selMax)}`;
    renderCards();
    clearTimeout(statsDebounceTimer);
    statsDebounceTimer = setTimeout(fetchPeriodStats, 120);
    // 상세보기가 열려 있으면 기간별 데이터도 갱신
    const detailEl = document.getElementById("mp-detail");
    if (
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

  inMin.addEventListener("input", () => {
    if (+inMin.value >= +inMax.value) inMin.value = +inMax.value - 1;
    updateFill();
  });
  inMax.addEventListener("input", () => {
    if (+inMax.value <= +inMin.value) inMax.value = +inMin.value + 1;
    updateFill();
  });

  updateFill();
}

function buildTicks(firstMs, lastMs) {
  const ticks = document.getElementById("tl-ticks");
  ticks.innerHTML = "";
  const spanMs = lastMs - firstMs;
  const spanMonths = spanMs / (1000 * 60 * 60 * 24 * 30);

  /* 간격 결정: 3년 이상이면 반년, 그 미만이면 분기 */
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

  /* 라벨 겹침 방지: 두 라벨 사이 실제 픽셀 간격이 최소 간격(MIN_GAP_PX)보다
     좁으면 뒤쪽 라벨을 건너뛴다. 컨테이너 실측 폭(offsetWidth) 기준으로
     % 좌표를 픽셀로 환산해서 비교하므로 화면 폭이 좁아져도 항상 절대 간격이
     보장된다. 마지막 포인트(lastMs)는 항상 남기고, 그 앞의 라벨이 마지막
     라벨과 너무 가까우면 그 앞 라벨을 대신 빼서 끝 지점 라벨이 밀리지 않게 한다. */
  const MIN_GAP_PX = 64;
  const containerWidth = ticks.offsetWidth || ticks.getBoundingClientRect().width || 0;
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
  // 마지막 라벨이 바로 앞 라벨과 여전히 너무 가까우면(위 루프가 강제로 끝점을
  // 넣었을 수 있음) 앞 라벨을 제거해서 끝점만 남긴다.
  if (filtered.length >= 2) {
    const last = filtered[filtered.length - 1];
    const beforeLast = filtered[filtered.length - 2];
    const gapPx = ((last.pct - beforeLast.pct) / 100) * containerWidth;
    if (gapPx < MIN_GAP_PX) {
      filtered.splice(filtered.length - 2, 1);
    }
  }

  filtered.forEach(({ t, pct }) => {
    const div = document.createElement("div");
    div.className = "mp-tl-tick";
    div.style.position = "absolute";
    div.style.left = pct + "%";
    div.style.transform = "translateX(-50%)";
    div.innerHTML = `<div class="mp-tl-tick-line"></div><span class="mp-tl-tick-lbl">${fmtShort(t)}</span>`;
    ticks.appendChild(div);
  });
}

/* ── 데이터 로드 ── */
async function loadPeople() {
  const gmailId = (await userIdPromise) || "";
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
    } else {
      console.error("high_affinity_person_stats 오류:", pRes.status);
    }

    if (dRes.ok) {
      const j = await dRes.json();
      const d = j.data || j;
      if (d.first_date && d.last_date) dateRange = d;
    } else {
      console.error("mail-date-range 오류:", dRes.status);
    }

    if (phRes.ok) {
      contactPhotos = await phRes.json();
    }

    if (avRes.ok) {
      generatedAvatars = await avRes.json();
    }
  } catch (e) {
    console.error("loadPeople 네트워크 오류:", e);
  }

  renderCards();
  startAvatarGeneration();
  initMyAvatar();

  if (dateRange) {
    initTimeline(
      new Date(dateRange.first_date).getTime(),
      new Date(dateRange.last_date).getTime(),
    );
  } else {
    const fallbackEnd = Date.now();
    const fallbackStart = fallbackEnd - 1000 * 60 * 60 * 24 * 365 * 3;
    initTimeline(fallbackStart, fallbackEnd);
  }
}

/* ── 모든 사람/발신자에 대해 아바타 생성 (이미 생성된 사람은 서버에서 캐시로 건너뜀)
         실제 기업/브랜드 발신자인지는 서버에서 LLM으로 판별해 로고 이미지를, 그 외에는
         GPT 이미지 API로 일러스트 아바타를 생성한다. ── */
async function startAvatarGeneration() {
  if (avatarGenStarted) return;
  avatarGenStarted = true;

  const gmailId = (await userIdPromise) || "";
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

/* ── 로그인한 사용자 본인 아바타: 페이지 로드 시 1회 생성/캐시해두고,
         상세보기를 열 때마다 다시 만들 필요 없이 바로 꺼내 쓴다. ── */
async function initMyAvatar() {
  const gmailId = (await userIdPromise) || "";
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

/* 상세보기가 이미 열려 있는 상태에서 내 아바타가 뒤늦게 도착하면 화면에 반영 */
function refreshSelfAvatarEl() {
  const el = document.getElementById("mp-detail-avatar-self");
  if (!el || !myAvatarUrl) return;
  el.innerHTML = `<img src="${myAvatarUrl}" alt="나" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
}

/* ── 메일 / 메신저 채널 토글 ──
 * 기본값은 메일 뷰(mp-mail-view). 메신저 버튼을 처음 누르는 순간에만
 * loadMessengerView()가 비동기로 내용을 채움(현재는 setTimeout으로 로딩만
 * 흉내냄 — 이후 fetch/렌더링 구현 예정). 이후엔 채워진 뷰를 토글만 함.
 */
const mailBtn = document.getElementById("mp-mail-btn");
const messengerBtn = document.getElementById("mp-messenger-btn");
const mailView = document.getElementById("mp-mail-view");
const messengerView = document.getElementById("mp-messenger-view");
const accountPickerMount = document.getElementById("account-picker-mount");
const chatroomPickerMount = document.getElementById(
  "chatroom-picker-mount",
);
let messengerLoaded = false;

async function loadMessengerView() {
  if (messengerLoaded) return;
  // TODO: 여기에 메신저 전용 기능(다른 데이터 소스/카드 등)을 새로 만들면 됨.
  // 지금은 자리만 마련해두고, 비동기로 "열리는" 느낌만 흉내냄.
  await new Promise((resolve) => setTimeout(resolve, 300));
  messengerView.innerHTML = `
    <div class="mp-empty">
      <i class="bi bi-chat-dots"></i>
      <p>메신저 기능은 아직 준비 중입니다.</p>
    </div>
  `;
  messengerLoaded = true;
}

function setChannel(channel) {
  const isMail = channel === "mail";
  mailBtn.classList.toggle("active", isMail);
  messengerBtn.classList.toggle("active", !isMail);
  mailView.style.display = isMail ? "" : "none";
  messengerView.style.display = isMail ? "none" : "";
  // 계정 토글 ↔ 채팅방 토글도 뷰에 맞춰 같이 전환
  accountPickerMount.style.display = isMail ? "" : "none";
  chatroomPickerMount.style.display = isMail ? "none" : "";
}

mailBtn.addEventListener("click", () => setChannel("mail"));
messengerBtn.addEventListener("click", async () => {
  setChannel("messenger");
  await loadMessengerView();
});

/* ── 광고(기업 발신자) 제거 토글 ── */
const brandFilterBtn = document.getElementById("mp-brand-filter-btn");
const brandFilterLabel = document.getElementById("mp-brand-filter-label");
brandFilterBtn.addEventListener("click", () => {
  hideBrandAccounts = !hideBrandAccounts;
  brandFilterBtn.classList.toggle("active", hideBrandAccounts);
  brandFilterLabel.textContent = hideBrandAccounts ? "광고 표시" : "광고 제거";
  renderCards();
});

/* ── 드롭다운 토글 ── */
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
  document
    .querySelectorAll(".mp-dropdown-item")
    .forEach((i) => i.classList.remove("selected"));
  item.classList.add("selected");
  ddLabel.textContent = item.textContent.replace("✓", "").trim();
  sortMode = item.dataset.sort;
  ddBtn.classList.remove("open");
  ddMenu.classList.remove("open");
  if (sortMode === "sent") await fetchSentStats();
  else if (sortMode === "received") await fetchReceivedStats();
  else if (sortMode === "total")
    await Promise.all([fetchSentStats(), fetchReceivedStats()]);
  renderCards();
});

document.addEventListener("click", () => {
  ddBtn.classList.remove("open");
  ddMenu.classList.remove("open");
});

/* ── 디테일 패널 ── */
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
  const personName = typeof person === "object" ? person.name || "" : "";
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
  const YEAR_COLORS = ["#626262", "#5a94e8"];
  const years = [...new Set(data.monthly.map((m) => m.month.split("-")[0]))];
  const yearColorMap = {};
  years.forEach((y, i) => {
    yearColorMap[y] = YEAR_COLORS[i % YEAR_COLORS.length];
  });

  // 월별 데이터를 연도별로 묶어 각 연도 블록에 색이 있는 배지와 은근한 배경을 준다
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

  // 막대 높이는 JS로 픽셀을 계산하지 않고 %로 넘겨서 CSS 레이아웃이 실제 렌더링
  // 시점의 진짜 높이를 기준으로 그리게 한다 — clientHeight를 읽는 타이밍에 따라
  // 계산이 어긋나 막대가 컨테이너보다 커져버리는 문제를 원천적으로 없앤다.
  const html = yearGroups
    .map((g) => {
      const yColor = yearColorMap[g.year];
      const monthsHtml = g.months
        .map((m) => {
          const sentPct = Math.max(2, Math.round((m.sent / maxVal) * 100));
          const recvPct = Math.max(2, Math.round((m.received / maxVal) * 100));
          const mon = m.month.split("-")[1];
          return `<div class="mp-vchart-group">
              <div class="mp-vchart-bars">
                <div class="mp-vchart-bar sent" style="height:${sentPct}%" title="보낸: ${m.sent}"></div>
                <div class="mp-vchart-bar recv" style="height:${recvPct}%" title="받은: ${m.received}"></div>
              </div>
              <div class="mp-vchart-label"><span class="mp-vchart-month">${mon}</span></div>
            </div>`;
        })
        .join("");
      return `<div style="display:flex;flex-direction:column;align-items:stretch;height:100%;background:${yColor}14;border-radius:8px;padding:0 6px;flex-shrink:0;">
            <div style="text-align:center;padding:0 0 6px;flex-shrink:0;">
              <span style="display:inline-block;font-size:1rem;font-weight:800;color:#fff;background:${yColor};padding:2px 11px;border-radius:8px;letter-spacing:0.02em;">${g.year}</span>
            </div>
            <div style="display:flex;align-items:flex-end;gap:5px;flex:1;min-height:0;">${monthsHtml}</div>
          </div>`;
    })
    .join("");
  chartArea.innerHTML = `<div style="display:inline-flex;align-items:stretch;gap:10px;min-width:100%;height:100%;justify-content:center;padding:0 8px;box-sizing:border-box;">${html}</div>`;
}

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

/* ── HTML 이스케이프 ── */
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
window.switchDetailTab = switchDetailTab; // HTML의 인라인 onclick에서 호출하므로 전역에 노출

async function refreshDetailStats(person) {
  const gmailId = (await userIdPromise) || "";

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

  // 교환통계 + 키워드 동시 fetch
  const [statsRes, kwRes] = await Promise.allSettled([
    fetch("/mail-exchange-stats", post(dateBody)),
    fetch("/keyword-by-person-date", post(dateBody)),
  ]);

  // 교환 그래프
  let statsData = null;
  if (statsRes.status === "fulfilled" && statsRes.value.ok) {
    const j = await statsRes.value.json();
    statsData = j.data || j;
  }
  renderBarChart(statsData);

  // 키워드
  let keywords = [];
  if (kwRes.status === "fulfilled" && kwRes.value.ok) {
    const j = await kwRes.value.json();
    keywords = j.keywords || [];
  }
  renderWordCloud(keywords.slice(0, 10), "mp-detail-wc");
}

async function openDetail(person, rowIndex) {
  const gmailId = (await userIdPromise) || "";
  const detailDisplayName = resolveDisplayName(person);

  // 나 아바타 (페이지 로드 시 미리 생성된 캐시를 바로 사용, 아직 안 왔으면 도착 시 refreshSelfAvatarEl가 채워줌)
  const selfAvatarEl = document.getElementById("mp-detail-avatar-self");
  if (myAvatarUrl) {
    selfAvatarEl.innerHTML = `<img src="${myAvatarUrl}" alt="나" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
  } else {
    selfAvatarEl.innerHTML = "";
    selfAvatarEl.textContent = "나";
    selfAvatarEl.style.background = "linear-gradient(150deg,#e0e0e0,#c5c5c5)";
    selfAvatarEl.style.color = "#515151";
  }
  // 관계 라벨: 실제 관계 추론 로직은 아직 없어서 임시로 고정값 표시 (추후 교체 예정)
  document.getElementById("mp-detail-relation-label").innerHTML =
    '<i class="bi bi-people-fill"></i>친구';

  const ac = affinityColor(person.affinity);
  const avatarEl = document.getElementById("mp-detail-avatar");
  avatarEl.style.background = ac.gradient;
  avatarEl.style.color = ac.text;

  // 친밀도 원형 게이지 (아바타 테두리를 감싸는 도넛)
  const ringFill = document.getElementById("mp-detail-avatar-ring-fill");
  const ringLabel = document.getElementById("mp-detail-avatar-ring-label");
  const affPct =
    person.affinity != null ? Math.round(person.affinity * 100) : null;
  if (ringFill) {
    const circumference = 2 * Math.PI * 46;
    // 채도 낮은 친밀도 티어 색(ac.dark) 대신 항상 선명한 핑크/하트 톤으로 고정해 "친밀도"라는 게 한눈에 보이게 함
    ringFill.style.transition = "none";
    ringFill.style.strokeDashoffset = circumference;
    ringFill.getBoundingClientRect(); // 강제 리플로우: 0%에서 다시 채워지는 애니메이션을 매번 보이게 함
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
  document.getElementById("mp-detail").classList.add("open");

  // 설명 탭 프로필
  const profileEl = document.getElementById("mp-desc-profile-content");
  if (profileEl)
    profileEl.innerHTML = '<p class="mp-desc-profile-empty">로딩 중...</p>';
  loadDescriptions(gmailId).then((descs) => renderDescription(person, descs));

  await refreshDetailStats(person);
}

document.getElementById("mp-detail-close").addEventListener("click", () => {
  document.getElementById("mp-detail").classList.remove("open");
  currentDetailPerson = null;
});

document.getElementById("mp-grid").addEventListener("click", (e) => {
  const card = e.target.closest(".mp-card");
  if (!card) return;
  const idx = parseInt(card.dataset.idx);
  const person = allPeople.find((p) => p.email === card.dataset.email);
  if (person) openDetail(person, Math.floor(idx / 7));
});

/* ── 그래프 D3 로드 + 렌더링 ── */
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
  const gmailId = (await userIdPromise) || "";
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

  // 줌/팬
  const zoom = d3
    .zoom()
    .scaleExtent([0.1, 10])
    .on("zoom", (e) => g.attr("transform", e.transform));
  svg.call(zoom).on("dblclick.zoom", null);

  // 엣지
  const link = g
    .append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke", "rgba(99, 99, 99,0.3)")
    .attr("stroke-width", 0.8);

  // 노드 (드래그 가능)
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

  // 시뮬레이션 (라이브)
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

  // 시뮬레이션 안정 후 전체 노드 fit
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
  } catch (e) {
    /* silent */
  }
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

loadPeople().then(() => fetchPeriodStats());

setTimeout(_initMiniGraph, 2500);
