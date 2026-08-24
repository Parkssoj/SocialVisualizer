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
// chatroom-picker-mount는 html에서 없앴다(단톡방 선택은 이제 사이드바가
// 전담) — document.getElementById가 null을 돌려줘도 initAccountPicker는
// container 없이 "헤드리스"로 동작해서, /accounts?domain=messenger를 불러
// 초기 채팅방 id만 조용히 resolve하고 localStorage(gw_chatroom_id)에
// 반영한다. My Time의 account-picker-mount와 동일한 패턴.
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
      setChannel("mail");
      loadPeople().then(() => fetchPeriodStats());
    } else if (filterState.room) {
      selectedChatroomId = filterState.room;
      setChannel("messenger");
      // 예전엔 여기서 단톡방 목록(패널)을 다시 그렸는데(refreshMessengerRoomsForRange),
      // 그 방식을 없애기로 했다 — 이제 사이드바에서 방을 고르면 목록 없이
      // 바로 그 방의 참여자 화면으로 들어간다(My Time과 동일 패턴).
      // refreshMessengerRoomsForRange();
      openSelectedChatroomFromSidebar();
    }
  });
});

/* ── 같은 name을 가진 브랜드 엔트리 통합 (친밀도 높은 대표 1개만 유지) ──
         no-reply@google.com, no-reply@accounts.google.com, google-noreply@google.com 처럼
         실제로는 서로 다른 발신 주소지만 화면엔 전부 "google"로 표시되는 브랜드/발신전용
         계정들을, 표시 이름 기준으로 하나의 대표 카드로 합친다. 브랜드가 아닌 일반 계정은
         원래대로 이메일 단위 그대로 둔다.
         대표로 뽑히지 않은 나머지 주소들의 대화 내역이 안 보이게 되는 걸 막기 위해, 대표
         객체에 병합된 이메일 전체 목록(_groupEmails)을 붙여둔다 — 상세보기/통계 조회 시
         이 배열을 써서 모든 주소의 메일을 합쳐서 보여준다(personEmails() 참고). */

function groupByEntityName(list) {
  const seen = new Map();
  list.forEach((p) => {
    const email = (p.email || "").toLowerCase().trim();
    if (!email) return;
    const key = isBrandSender(p) ? `brand:${resolveDisplayName(p).toLowerCase()}` : email;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...p, _groupEmails: [email] });
    } else {
      if (!existing._groupEmails.includes(email)) existing._groupEmails.push(email);
      if ((p.affinity || 0) > (existing.affinity || 0)) {
        // 친밀도 더 높은 쪽으로 대표(이름/이메일 등 표시용 필드)를 교체하되, 지금까지
        // 모아둔 _groupEmails는 유지한다.
        const groupEmails = existing._groupEmails;
        seen.set(key, { ...p, _groupEmails: groupEmails });
      }
    }
  });
  return [...seen.values()];
}

/* 카드/상세보기에서 실제로 조회 대상이 될 이메일 목록. 브랜드 통합 카드면 병합된 전체
     주소를, 아니면 자기 자신의 이메일 하나만 반환한다. */
function personEmails(person) {
  if (person && Array.isArray(person._groupEmails) && person._groupEmails.length) {
    return person._groupEmails;
  }
  return person && person.email ? [person.email.toLowerCase()] : [];
}

/* email → 숫자 맵(sentStatsMap 등)에서, 통합 카드면 병합된 모든 주소의 값을 합산한다. */
function sumMap(map, person) {
  return personEmails(person).reduce((s, e) => s + (map[e] || 0), 0);
}

/* periodStats(email → {sent, received})에서 통합 카드의 전체 주소분을 합산한다. */
function sumPeriodStats(person) {
  return personEmails(person).reduce(
    (acc, e) => {
      const ps = periodStats[e];
      if (ps) {
        acc.sent += ps.sent || 0;
        acc.received += ps.received || 0;
      }
      return acc;
    },
    { sent: 0, received: 0 },
  );
}

/* ── 이름 길이별 폰트 크기 ── */
// 카드 패널을 더 작게(8열→10열) 줄인 만큼(비율 0.8배) 이름 글자 크기도
// 같은 비율로 줄여서, 카드가 작아져도 예전과 같은 시각적 균형을 유지한다.
// (메일·메신저 사람 카드가 전부 이 함수 하나를 공유하므로 두 패널이
// 자동으로 통일된 크기로 맞춰진다.)
const NAME_FONT_SCALE = 0.8;
function scaledClamp(minRem, midCqw, maxRem) {
  return `clamp(${(minRem * NAME_FONT_SCALE).toFixed(3)}rem, ${(midCqw * NAME_FONT_SCALE).toFixed(3)}cqw, ${(maxRem * NAME_FONT_SCALE).toFixed(3)}rem)`;
}
function nameFontSize(name) {
  const len = (name || "").length;
  const isKorean = /[가-힣]/.test(name || "");
  if (isKorean) {
    if (len <= 4) return scaledClamp(0.9, 1.7, 1.7);
    if (len <= 6) return scaledClamp(0.82, 1.4, 1.4);
    if (len <= 9) return scaledClamp(0.72, 1.2, 1.2);
    if (len <= 15) return scaledClamp(0.6, 1.0, 1.0);
    return scaledClamp(0.5, 0.82, 0.88);
  }
  if (len <= 5) return scaledClamp(0.88, 1.68, 1.68);
  if (len <= 8) return scaledClamp(0.8, 1.43, 1.43);
  if (len <= 12) return scaledClamp(0.7, 1.2, 1.2);
  if (len <= 18) return scaledClamp(0.58, 0.97, 0.97);
  return scaledClamp(0.48, 0.8, 0.85);
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

/* ── 친밀도 퍼센트 → 5단계 카테고리 라벨 ──
   "~% 이상" 식 퍼센트 표기 대신 말로 풀어서 보여주기 위한 구간(경계는
   100~90 / 90~70 / 70~45 / 45~20 / 20~0 요청값 그대로 사용). */
const AFFINITY_LABEL_TIERS = [
  { min: 90, label: "아주 친밀한 관계" },
  { min: 70, label: "친밀한 관계" },
  { min: 45, label: "보통의 관계" },
  { min: 20, label: "친밀하지 않은 관계" },
  { min: -Infinity, label: "무관한 관계" },
];
function affinityLabelFromPct(pct) {
  const tier = AFFINITY_LABEL_TIERS.find((tr) => pct >= tr.min);
  return tier.label;
}
function affinityLabel(aff) {
  return affinityLabelFromPct(Math.round((aff ?? 0) * 100));
}

/* ── 단톡방 분위기 점수(0~100) → 말로 풀어쓴 라벨 ──
   mood_score는 높을수록 사적·친밀한 분위기라는 스펙에 맞춰 5단계로 나눔. */
function moodLabel(score) {
  if (score == null) return null;
  if (score >= 80) return "매우 사적이고 친밀한 분위기";
  if (score >= 60) return "편안하고 친근한 분위기";
  if (score >= 40) return "무난한 분위기";
  if (score >= 20) return "다소 사무적인 분위기";
  return "격식 있고 사무적인 분위기";
}
function moodEmoji(score) {
  if (score == null) return "";
  if (score >= 80) return "💛";
  if (score >= 60) return "🙂";
  if (score >= 40) return "😐";
  if (score >= 20) return "🧊";
  return "🧾";
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
let currentRenderedList = []; // 마지막 renderCards()가 실제로 그린(그룹핑·필터·정렬 끝난) 목록 —
// 카드 클릭 시 이걸로 찾아야 브랜드 통합 카드의 _groupEmails가 살아있다. allPeople에서
// 이메일로 다시 찾으면 원본(미병합) 객체가 나와서 병합 정보가 사라진다.
let periodStats = {}; // email → {sent, received}
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
  // getCurrentMailId()는 계정을 바꾼 뒤 새로고침 없이 새 계정 기준으로 다시
  // 불러올 수 있게 해주는 최신 방식(userIdPromise 직접 참조는 계정 전환 후에도
  // 옛 계정을 계속 보고 있었음) — 계정 정보가 없을 때도 "불러오는 중"에 계속
  // 멈춰있지 않도록 renderCards()는 그대로 호출한다.
  const gmailId = await getCurrentMailId();
  if (!gmailId) {
    renderCards();
    return;
  }
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
  } catch (e) {
    console.error("fetchPeriodStats 오류:", e);
  } finally {
    // renderCards()는 성공/실패 상관없이 여기 finally에서 한 번만 호출한다.
    renderCards();
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
  // periodStats가 아직 한 번도 로딩되지 않은 시점(페이지 진입 직후, 아바타 생성 배치가
  // 먼저 끝나서 renderCards가 조기 호출되는 경우 등)에는 필터 안 된 원본 목록을 절대
  // 그리지 않는다 — 안 그러면 avatarGeneration 등 다른 곳에서 부르는 renderCards() 때문에
  // 여전히 "많이 떴다가 5개로 줄어드는" 깜빡임이 재현된다.
  if (!periodStatsLoaded) {
    if (grid) {
      grid.innerHTML = `<div class="mp-empty"><i class="bi bi-people"></i><p>데이터를 불러오는 중...</p></div>`;
    }
    return;
  }
  let list = groupByEntityName(allPeople);
  if (hideBrandAccounts) {
    list = list.filter((p) => !isBrandSender(p));
  }
  if (periodStatsLoaded) {
    list = list.filter((p) => {
      const ps = sumPeriodStats(p);
      return (ps.sent || 0) + (ps.received || 0) > 0;
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
      return (
        sumMap(sentStatsMap, b) +
        sumMap(receivedStatsMap, b) -
        (sumMap(sentStatsMap, a) + sumMap(receivedStatsMap, a))
      );
    });
  } else if (sortMode === "sent") {
    list.sort((a, b) => sumMap(sentStatsMap, b) - sumMap(sentStatsMap, a));
  } else if (sortMode === "received") {
    list.sort(
      (a, b) => sumMap(receivedStatsMap, b) - sumMap(receivedStatsMap, a),
    );
  }
  currentRenderedList = list; // 클릭 시 이 배열로 찾아야 병합된 _groupEmails가 유지된다

  const countEl = document.getElementById("mp-count");
  if (countEl) countEl.textContent = list.length ? `${list.length}명` : "";

  if (!list.length) {
    grid.innerHTML = `<div class="mp-empty"><i class="bi bi-people"></i><p>데이터를 불러오는 중...</p></div>`;
    return;
  }
  // incoming(cardHtml 이름 함수화)을 기준으로 채택 — 아래쪽 renderAffinityBands(list, cardHtml) /
  // list.map((p,i)=>cardHtml(p,i)) 호출부(공통 코드, 충돌 없음)가 이미 이 이름을 전제로 하고 있어
  // HEAD의 인라인 map 구조를 쓰면 "cardHtml is not defined"로 깨짐.
  // 다만 통계 조회는 HEAD 쪽의 sumMap/sumPeriodStats(그룹 카드 합산, _groupEmails 대응)로 유지 —
  // incoming의 직접 조회(periodStats[email] 등)는 브랜드 통합 카드에서 합계가 덜 잡히는 문제가 있음.
  function cardHtml(p, i) {
    const affinity = p.affinity;
    const ac = affinityColor(affinity);
    const cardVars = `--ca-light:${ac.light};--ca-dark:${ac.dark};--ca-shadow:${ac.shadow};--ca-shadow-hover:${ac.shadowHover};`;
    const displayName = resolveDisplayName(p);
    const ps = sumPeriodStats(p);
    const em = (p.email || "").toLowerCase();
    const total = (ps.sent || 0) + (ps.received || 0);
    const photo = generatedAvatars[em] || contactPhotos[em];
    const brandCls = isBrandSender(p) ? " mp-brand-logo" : "";
    const avatarInner = photo
      ? `<img src="${photo}" alt="${displayName}" class="${brandCls.trim()}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.parentElement.textContent='${initials(displayName)}'">`
      : initials(displayName);
    let badge = "";
    if (sortMode === "affinity") {
      // 친밀도 등급은 카드 위가 아니라 구분선(renderAffinityBands)에만
      // 표시한다 — 카드에는 아무것도 안 붙임.
    } else if (sortMode === "name") {
      badge = "";
    } else if (sortMode === "sent") {
      const cnt = sumMap(sentStatsMap, p);
      if (cnt > 0)
        badge = `<div class="mp-period-badge sent">보낸 ${cnt}건</div>`;
    } else if (sortMode === "received") {
      const cnt = sumMap(receivedStatsMap, p);
      if (cnt > 0)
        badge = `<div class="mp-period-badge recv">받은 ${cnt}건</div>`;
    } else if (sortMode === "total") {
      const totalCnt =
        sumMap(sentStatsMap, p) + sumMap(receivedStatsMap, p) || total;
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

// 등급별 배경색(진한 순 → 옅은 순, AFFINITY_LABEL_TIERS와 인덱스로 짝을 맞춤)
const AFFINITY_BAND_BG = [
  { hue: 18, sat: 78, light: 91 },
  { hue: 24, sat: 60, light: 93 },
  { hue: 30, sat: 42, light: 94.5 },
  { hue: 36, sat: 26, light: 96.5 },
  { hue: 42, sat: 12, light: 98.5 },
];

// 예전엔 실제 데이터 분포(k-means)로 5개 구간 경계를 매번 다시 계산해서,
// 데이터가 한쪽에 몰려 있으면(예: 전부 "소원한 사람") 등급이 1~2개만 뜨고
// 나머지는 아예 안 보였다 — 요청대로 100~90/90~70/70~45/45~20/20~0 고정
// 경계(AFFINITY_LABEL_TIERS)를 그대로 써서, 데이터가 어떻든 5개 등급이
// 전부 자기 구분선 + 배경색을 갖고 표시되도록 함(해당하는 사람이 0명이어도
// 구분선과 빈 밴드는 그대로 보여준다).
function renderAffinityBands(list, cardHtml) {
  const pctOf = (p) => Math.round((p.affinity || 0) * 100);
  let globalIdx = 0;

  return AFFINITY_LABEL_TIERS.map((tier, i) => {
    const bandPeople = list.filter(
      (p) => affinityLabelFromPct(pctOf(p)) === tier.label,
    );
    const bg = AFFINITY_BAND_BG[i] || AFFINITY_BAND_BG[AFFINITY_BAND_BG.length - 1];
    const bandBg = `hsl(${bg.hue} ${bg.sat}% ${bg.light}%)`;

    const cardsHtml = bandPeople.length
      ? bandPeople.map((p) => cardHtml(p, globalIdx++)).join("")
      : `<div class="mp-band-empty">이 등급에 해당하는 사람이 없습니다.</div>`;

    return `
      <div class="mp-band">
        <div class="mp-band-divider"></div>
        <div class="mp-band-cards" style="--band-bg:${bandBg}">
          <span class="mp-band-label">${tier.label}</span>
          ${cardsHtml}
        </div>
      </div>
    `;
  }).join("");
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
          // 방 분위기가 날짜 범위를 바꿀 때마다 사라졌던 문제 — 여기서도 방
          // 분위기를 같이 넘겨줘서(캐시되어 있어 비용은 거의 없음) 항상 고정으로 보이게 함
          fetchAndRenderChatroomPeople(fetchRoomMoodScore(currentChatroomId));
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
  // 활동 없는 발신자가 필터링되기 전 "원본" 목록이 잠깐 화면에 나왔다가 사라지는 깜빡임을
  // 막기 위해, 기간 통계(periodStats)가 아직 없는 첫 렌더에서는 카드 목록 대신 로딩 표시를
  // 유지한다 — 실제 카드는 아래에서 fetchPeriodStats까지 끝난 뒤 한 번만 그린다.
  const grid = document.getElementById("mp-grid");
  if (grid) {
    grid.innerHTML = `<div class="mp-empty"><i class="bi bi-people"></i><p>데이터를 불러오는 중...</p></div>`;
  }

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

  // 여기서 한 번만 실제 카드를 그린다(fetchPeriodStats 내부에서 성공/실패 어느 쪽이든
  // renderCards를 호출하므로 그 결과가 화면에 나오는 첫 카드 목록이 된다).
  await fetchPeriodStats();

  // 아바타 생성은 periodStats까지 반영된 "실제로 화면에 뜨는" 목록(currentRenderedList)이
  // 확정된 뒤에 시작한다 — person 테이블엔 있지만 실제 메일 교환 기록이 없어 화면에
  // 절대 안 뜨는 사람까지 이미지 생성 API를 호출하는 낭비를 막기 위함.
  startAvatarGeneration();
}

/* ── 실제로 카드에 뜨는(=이 기간에 진짜 메일을 주고받은) 사람에 대해서만 아바타 생성
         (이미 생성된 사람은 서버에서 캐시로 건너뜀) 실제 기업/브랜드 발신자인지는 서버에서
         LLM으로 판별해 로고 이미지를, 그 외에는 로컬 FLUX 서버로 일러스트 아바타를 생성한다.
         person 테이블에는 있지만 mail 테이블상 실제 교환 기록이 없어 카드 목록에서 걸러지는
         사람까지 생성하면 절대 안 보일 이미지를 의미 없이 계속 만들게 되므로 대상에서 뺀다. ── */
async function startAvatarGeneration() {
  if (avatarGenStarted) return;
  avatarGenStarted = true;

  const gmailId = await getCurrentMailId();
  if (!gmailId) return;

  const seenEmails = new Set();
  const candidates = [];
  currentRenderedList.forEach((p) => {
    const name = resolveDisplayName(p);
    personEmails(p).forEach((email) => {
      if (!email || seenEmails.has(email) || generatedAvatars[email]) return;
      seenEmails.add(email);
      candidates.push({ email, name });
    });
  });

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

// 메일/메신저 전환 버튼은 없앰(My Time과 동일) — 사이드바에서 메일 계정을
// 고르면 mailView가, 메신저 데이터를 고르면 messengerView가 뜨도록
// setChannel()을 initGlobalFilter 콜백에서 직접 호출한다.
const mailView = document.getElementById("mp-mail-view");
const messengerView = document.getElementById("mp-messenger-view");

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
  mailView.style.display = isMail ? "" : "none";
  messengerView.style.display = isMail ? "none" : "";

  const brandBtn = document.getElementById("mp-brand-filter-btn");
  if (brandBtn) brandBtn.style.display = isMail ? "" : "none";
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

// 사이드바에서 메신저 데이터(단톡방)를 고르면, 예전처럼 단톡방 목록 패널을
// 거치지 않고 바로 그 방의 참여자 화면으로 들어간다 — 방 이름은 새로 API를
// 부르지 않고 사이드바가 이미 갖고 있는 목록(store.getCollectedLists().rooms)
// 에서 id로 찾아 쓴다.
async function openSelectedChatroomFromSidebar() {
  if (!selectedChatroomId) return;
  await ensureMessengerDateRange();
  const { rooms = [] } = store.getCollectedLists() || {};
  const room = rooms.find((r) => r.id === selectedChatroomId);
  await openChatroom(selectedChatroomId, room ? room.label : selectedChatroomId);
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
  // 버그 수정 — 메일 화면(renderCards)에서 채워둔 "N명"이 메신저 탭으로 넘어와도
  // 안 지워지고 그대로 남아있던 문제. 단톡방 목록 화면에서는 "명" 개념이
  // 명확하지 않으니(방 여러 개, 참여자는 방마다 다름) 일단 비워둔다 — 실제
  // 참여자 수는 방 하나를 열었을 때(renderChatroomPeople)만 정확히 알 수 있음.
  const roomsCountEl = document.getElementById("mp-count");
  if (roomsCountEl) roomsCountEl.textContent = "";
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
              ? ` · ${moodLabel(r._moodScore)}`
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
  // 방을 선택(클릭)한 시점에 방 분위기도 같이 불러와서, 사람 목록과 함께
  // 헤더에 텍스트로(퍼센트 대신) 바로 박아 보여준다.
  const moodPromise = fetchRoomMoodScore(chatroomId);
  await fetchAndRenderChatroomPeople(moodPromise);
}

async function fetchAndRenderChatroomPeople(moodPromise) {
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
  const moodScore = moodPromise ? await moodPromise : null;
  renderChatroomPeople(currentChatroomName, sortPeopleList(people), moodScore);
}

function renderChatroomPeople(chatroomName, people, moodScore) {
  currentChatroomPeople = people;
  // 버그 수정 — 메신저 방 참여자 화면에서도 "My People" 옆 명수가 메일 쪽
  // 값(또는 빈 값)으로 남아있던 걸, 실제 이 방 참여자 수로 채움.
  const peopleCountEl = document.getElementById("mp-count");
  if (peopleCountEl)
    peopleCountEl.textContent = people.length ? `${people.length}명` : "";
  const cardsHtml = people.length
    ? people
        .map((p, i) => {
          const avatarInner = p.avatar_url
            ? `<img src="${p.avatar_url}" alt="${esc(p.name)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.parentElement.textContent='${initials(p.name)}'">`
            : initials(p.name);
          return `
        <div class="mp-card mp-person-card" data-idx="${i}" title="${esc(p.name)}">
          <div class="mp-avatar" style="background:${CARD_BG[i % CARD_BG.length]};color:${AVATAR_COLORS_DETAIL[i % AVATAR_COLORS_DETAIL.length]};">${avatarInner}</div>
          <div class="mp-name" style="font-size:${nameFontSize(p.name)}">${esc(p.name)}</div>
          <div class="mp-period-badge">${p.message_count}건</div>
        </div>`;
        })
        .join("")
    : `<div class="mp-empty"><i class="bi bi-people"></i><p>이 기간엔 메신저를 보낸 참여자가 없습니다.</p></div>`;

  const moodHtml =
    moodScore != null
      ? `<span class="mp-room-mood"><span class="mp-room-mood-emoji">${moodEmoji(moodScore)}</span>${moodLabel(moodScore)}</span>`
      : "";

  messengerView.innerHTML = `
    <div class="mp-messenger-room-header">
      <!-- 요청 — 단톡방 목록으로 돌아가는 버튼은 주석 처리(사이드바가 방 전환을
           전담하게 된 뒤로는 필요 없음). -->
      <!-- <button class="mp-back-btn" type="button"><i class="bi bi-arrow-left"></i> 단톡방 목록</button> -->
      <span class="mp-messenger-room-name">${esc(chatroomName)}</span>
      ${moodHtml}
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
  // 사이드바에서 바로 방으로 들어온 경우 messengerChatrooms가 아직 한 번도
  // 안 채워졌을 수 있으니(예전엔 목록 화면을 먼저 거쳐야만 채워졌음),
  // renderChatroomGrid() 대신 새로 불러오는 refreshMessengerRoomsForRange()를
  // 써서 null 목록을 그대로 렌더링하다 에러 나는 일이 없게 한다.
  if (e.target.closest(".mp-back-btn")) refreshMessengerRoomsForRange();
});

// 메일/메신저 전환 버튼은 없앴다(My Time과 동일 — 사이드바가 전담).
// mailBtn.addEventListener("click", () => setChannel("mail"));
// messengerBtn.addEventListener("click", async () => {
//   setChannel("messenger");
//   await ensureMessengerDateRange();
//   await loadMessengerView();
// });

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
    // 정렬을 바꿀 때도 방 분위기가 사라지지 않도록 같이 넘겨줌(캐시되어 있어
    // 다시 네트워크 요청이 가지 않음)
    const moodScore = await fetchRoomMoodScore(currentChatroomId);
    renderChatroomPeople(
      currentChatroomName,
      sortPeopleList(currentChatroomPeople),
      moodScore,
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
  // 요청 — "2020년 11월"처럼 매번 연도를 붙이니 자리를 너무 많이 차지해서
  // 원래처럼 "11월"만 표시. 연도가 아예 안 보이면 알기 어려우니, 연도가
  // 바뀌는 첫 달(과 맨 처음 달)에만 작게 연도를 같이 표기.
  let lastYear = null;
  const monthsHtml = data.monthly
    .map((m) => {
      const sentPct = Math.max(2, Math.round((m.sent / maxVal) * 100));
      const recvPct = Math.max(2, Math.round((m.received / maxVal) * 100));
      const [y, mon] = m.month.split("-");
      const showYear = y !== lastYear;
      lastYear = y;
      const yearHtml = showYear
        ? `<span class="mp-vchart-year">${y}</span>`
        : "";
      return `<div class="mp-vchart-group" style="flex:1;" data-month="${m.month}" data-sent="${m.sent}" data-recv="${m.received}" title="${m.month}: 보낸 ${m.sent}건 · 받은 ${m.received}건 (눌러서 목록보기)">
              <div class="mp-vchart-bars">
                <div class="mp-vchart-bar sent" style="height:${sentPct}%" title="보낸: ${m.sent}"></div>
                <div class="mp-vchart-bar recv" style="height:${recvPct}%" title="받은: ${m.received}"></div>
              </div>
              <div class="mp-vchart-label">${yearHtml}<span class="mp-vchart-month">${parseInt(mon, 10)}월</span></div>
            </div>`;
    })
    .join("");
  chartArea.innerHTML = `<div style="display:flex;align-items:flex-end;gap:5px;width:100%;height:100%;padding:0 8px;box-sizing:border-box;background:#fff;">${monthsHtml}</div>`;

  // 오른쪽 원본 확인 창이 막대를 눌러야만 열리던 걸, 처음부터 가장 최근 달로
  // 기본으로 열려있도록(요청) — 막대 그래프를 다 그린 다음 마지막(최신) 달을
  // 자동으로 "클릭"한 것처럼 처리.
  const latest = data.monthly[data.monthly.length - 1];
  const latestGroup = chartArea.querySelector(
    `.mp-vchart-group[data-month="${latest.month}"]`,
  );
  if (latestGroup) {
    latestGroup.classList.add("active");
    openEmailDrawer(latest.month, latest.sent, latest.received);
  }
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

  // 요청 — "2020년 11월"처럼 매번 연도를 붙이니 자리를 너무 많이 차지해서
  // 원래처럼 "11월"만 표시. 연도가 아예 안 보이면 알기 어려우니, 연도가
  // 바뀌는 첫 달(과 맨 처음 달)에만 작게 연도를 같이 표기.
  let lastYear = null;
  const monthsHtml = data.monthly
    .map((m) => {
      const pct = Math.max(2, Math.round((m.count / maxVal) * 100));
      const [y, mon] = m.month.split("-");
      const showYear = y !== lastYear;
      lastYear = y;
      const yearHtml = showYear
        ? `<span class="mp-vchart-year">${y}</span>`
        : "";
      return `<div class="mp-vchart-group" style="flex:1;" data-month="${m.month}" title="${m.month}: ${m.count}건 (눌러서 일별로 보기)">
              <div class="mp-vchart-bars">
                <div class="mp-vchart-bar sent" style="height:${pct}%" title="${m.count}건"></div>
              </div>
              <div class="mp-vchart-label">${yearHtml}<span class="mp-vchart-month">${parseInt(mon, 10)}월</span></div>
            </div>`;
    })
    .join("");
  chartArea.innerHTML = `<div style="display:flex;align-items:flex-end;gap:5px;width:100%;height:100%;padding:0 8px;box-sizing:border-box;background:#fff;">${monthsHtml}</div>`;

  // 메신저 통계도 메일과 동일하게 최신 달을 기본으로 열어둔다(요청)
  const latest = data.monthly[data.monthly.length - 1];
  const latestGroup = chartArea.querySelector(
    `.mp-vchart-group[data-month="${latest.month}"]`,
  );
  if (latestGroup) {
    latestGroup.classList.add("active");
    openMessengerDayList(latest.month);
  }
}

// 방사형 스포크 다이어그램 대신 프로필 사진 + 이름 + 관계 설명을 담은
// 카드 그리드로 표현(요청) — 열 수는 고정하지 않고 auto-fill로 패널 폭에
// 맞게 2~3열 사이를 알아서 오가도록 반응형 처리.
function renderRelationDiagram(personName, relationships) {
  const el = document.getElementById("mp-desc-profile-content");
  if (!relationships.length) {
    el.innerHTML =
      '<p class="mp-desc-profile-empty">파악된 관계가 없습니다.</p>';
    return;
  }
  const others = relationships.map((r) => ({
    name: r.source === personName ? r.target : r.source,
    label: r.relation_label || "",
  }));
  const cardsHtml = others
    .map((o) => {
      const p = currentChatroomPeople.find((x) => x.name === o.name);
      const avatarInner =
        p && p.avatar_url
          ? `<img src="${p.avatar_url}" alt="${esc(o.name)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.parentElement.textContent='${initials(o.name)}'">`
          : initials(o.name);
      // 요청 — 그 사람의 참여 패턴(메시지 건수) 정보도 같이 넣고, 새 박스를
      // 만들지 말고 기존 카드 안에 표처럼 2열(항목/값)로 선을 그어 구분.
      const participationText =
        p && p.message_count != null
          ? `메시지 ${p.message_count.toLocaleString()}건`
          : "정보 없음";
      return `
        <div class="mp-relation-card">
          <div class="mp-relation-card-avatar">${avatarInner}</div>
          <div class="mp-relation-card-name">${esc(o.name)}</div>
          <div class="mp-relation-card-table">
            <div class="mp-relation-card-row">
              <div class="mp-relation-card-cell mp-relation-card-cell-key">관계</div>
              <div class="mp-relation-card-cell mp-relation-card-cell-val${o.label ? "" : " mp-relation-card-cell-empty"}">${o.label ? esc(o.label) : "파악된 설명 없음"}</div>
            </div>
            <div class="mp-relation-card-row">
              <div class="mp-relation-card-cell mp-relation-card-cell-key">참여 패턴</div>
              <div class="mp-relation-card-cell mp-relation-card-cell-val">${esc(participationText)}</div>
            </div>
          </div>
        </div>`;
    })
    .join("");
  el.innerHTML = `<div class="mp-relation-cards">${cardsHtml}</div>`;
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
    ? `${personName} · 총 ${sentCount + recvCount}건 (보낸 ${sentCount} · 받은 ${recvCount}) · 막대를 누르면 해당 월의, 날짜를 누르면 그날의 원본 메일을 확인할 수 있어요`
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
    // 이 세션에서 만든 "달 클릭 → 일별 목록 → 날짜 클릭 → 그날 메일" 드릴다운
    // 흐름(renderMailDayList/openMailDayChat)을 그대로 유지한다.
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
    ? `${person.name} · 막대를 누르면 해당 월의, 날짜를 누르면 그날의 원본 대화를 확인할 수 있어요`
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

/* 여러 달의 {month, sent, received}를 월 단위로 합산 (브랜드 통합 카드 = 여러 주소 대상) */
function mergeExchangeStats(list) {
  const byMonth = new Map();
  let totalSent = 0,
    totalReceived = 0;
  list.forEach((r) => {
    if (!r) return;
    (r.monthly || []).forEach((m) => {
      const cur = byMonth.get(m.month) || { month: m.month, sent: 0, received: 0 };
      cur.sent += m.sent || 0;
      cur.received += m.received || 0;
      byMonth.set(m.month, cur);
    });
    totalSent += (r.total && r.total.sent) || 0;
    totalReceived += (r.total && r.total.received) || 0;
  });
  const monthly = [...byMonth.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  return { monthly, total: { sent: totalSent, received: totalReceived } };
}

/* 여러 사람의 키워드 리스트를 단어 기준으로 합산 */
function mergeKeywordLists(lists) {
  const byWord = new Map();
  lists.forEach((kws) => {
    (kws || []).forEach((kw) => {
      const cur = byWord.get(kw.word) || { word: kw.word, count: 0, dates: [] };
      cur.count += kw.count || 0;
      if (kw.dates) cur.dates.push(...kw.dates);
      byWord.set(kw.word, cur);
    });
  });
  return [...byWord.values()];
}

async function refreshDetailStats(person) {
  const gmailId = await getCurrentMailId();

  document.getElementById("mp-chart").innerHTML =
    '<span style="color:#b0b0b0;font-size:1rem;">로딩 중...</span>';
  document.getElementById("mp-detail-wc").innerHTML =
    '<span style="color:#b0b0b0;font-size:1rem;">로딩 중...</span>';

  const post = (body) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // 브랜드 통합 카드(예: google)면 병합된 모든 주소를 각각 조회해서 합산한다 —
  // 대표 1명 것만 보면 나머지 주소로 온 메일 내역이 통째로 안 보이게 되기 때문.
  // (참고: 병합 전 HEAD 버전은 여기서 정의된 적 없는 dateBody를 참조하고 있어
  // 실행 시 오류가 나는 상태였음 — 아래의 완결된 버전으로 대체함)
  const emails = personEmails(person);
  const dateBodies = emails.map((email) => ({
    user_id: gmailId,
    person_user_id: email,
    start_date: msToDateStr(selMin),
    end_date: msToDateStr(selMax),
  }));

  const [statsResults, kwResults] = await Promise.all([
    Promise.allSettled(
      dateBodies.map((b) => fetch("/mail-exchange-stats", post(b))),
    ),
    Promise.allSettled(
      dateBodies.map((b) => fetch("/keyword-by-person-date", post(b))),
    ),
  ]);

  // 교환 그래프
  const statsDataList = await Promise.all(
    statsResults.map(async (r) => {
      if (r.status !== "fulfilled" || !r.value.ok) return null;
      const j = await r.value.json();
      return j.data || j;
    }),
  );
  renderBarChart(mergeExchangeStats(statsDataList));

  // 키워드
  const kwDataList = await Promise.all(
    kwResults.map(async (r) => {
      if (r.status !== "fulfilled" || !r.value.ok) return [];
      const j = await r.value.json();
      return j.keywords || [];
    }),
  );
  const keywords = mergeKeywordLists(kwDataList);
  renderWordCloud(keywords.slice(0, 10), "mp-detail-wc");
}

// 메일/메신저 통계 범례 — 예전엔 메일용 두 항목(보낸/받은 메일)이 HTML에
// 고정되어 있고 메신저에서는 그냥 숨기기만 해서 "보낸 메신저"라는 표시가
// 전혀 없었음(요청) — 모드별로 내용을 다시 그려서 메신저에도 초록 막대가
// 뭘 뜻하는지 보이게 함.
function setStatsLegend(mode) {
  const legend = document.getElementById("mp-stats-legend");
  if (!legend) return;
  const dot = (color) =>
    `<span style="width:9px;height:9px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;"></span>`;
  const item = (color, label) =>
    `<span style="display:flex;align-items:center;gap:10px;font-size:1rem;font-weight:600;color:#4a4640;white-space:nowrap;flex-shrink:0;">${dot(color)}${label}</span>`;
  if (mode === "mail") {
    legend.innerHTML = item("#12886e", "보낸 메일") + item("#5a94e8", "받은 메일");
    legend.style.display = "flex";
  } else if (mode === "messenger") {
    legend.innerHTML = item("#12886e", "보낸 메신저");
    legend.style.display = "flex";
  } else {
    legend.innerHTML = "";
    legend.style.display = "none";
  }
}

async function openDetail(person, rowIndex) {
  const gmailId = await getCurrentMailId();
  const detailDisplayName = resolveDisplayName(person);

  currentDetailMode = "mail";
  currentDetailPersonEmail = person.email || "";
  currentMessengerPerson = null;
  document.getElementById("mp-tab-stats").textContent = "메일 통계";
  document.getElementById("mp-stats-title").textContent = "메일 통계";
  document.getElementById("mp-tab-desc").textContent = "설명";
  document.getElementById("mp-tab-kw").textContent = "키워드";
  closeEmailDrawer();

  document.querySelector(".mp-detail-self-info").style.display = "";
  document.getElementById("mp-detail-avatar-self").style.display = "";
  document.querySelector(".mp-detail-relation").style.display = "";
  // 친밀도 퍼센트를 감싸던 핑크 링을 없애기로 해서(요청) 메일 상세보기도
  // 메신저와 동일하게 항상 링을 꺼둔다 — 대신 등급 텍스트는 관계 라벨
  // 밑(.mp-detail-affinity-label)에 표시.
  document
    .querySelector(".mp-detail-avatar-ring")
    ?.classList.add("mp-ring-off");
  setStatsLegend("mail");
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
    // 요청 — 배지(박스) 없이 선 밑에 아이콘 없는 순수 텍스트로만, "관계: 기업"
    // 형식으로 표시.
    relationLabelEl.textContent = label ? `관계: ${label}` : "";
  });

  // 색감 통일 요청 — 아바타 배경도 친밀도에 따른 색(핑크/주황 계열) 대신
  // "나" 아바타와 동일한 무채색 그라데이션으로 통일.
  const avatarEl = document.getElementById("mp-detail-avatar");
  avatarEl.style.background = "linear-gradient(150deg,#e0e0e0,#c5c5c5)";
  avatarEl.style.color = "#515151";

  // 링이 없어진 자리에 친밀도 등급을 관계 라벨 밑에 효율적으로 표시
  const affPct =
    person.affinity != null ? Math.round(person.affinity * 100) : null;
  const affinityLabelEl = document.getElementById("mp-detail-affinity-label");
  if (affinityLabelEl) {
    // 요청 — 배지(박스) 없이 선 밑에 아이콘 없는 순수 텍스트로만 표시.
    affinityLabelEl.textContent =
      affPct != null ? affinityLabelFromPct(affPct) : "";
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
  const groupEmails = personEmails(person);
  document.getElementById("mp-detail-email").textContent =
    groupEmails.length > 1
      ? `${person.email} 외 ${groupEmails.length - 1}개 주소 (통합 표시)`
      : person.email || "이메일 정보 없음";

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
  // "이메일 교환"이 그대로 남아있던 잔재 — mp-stats-title은 예전엔 HTML에
  // 박제된 텍스트라 메신저에서도 안 바뀌고 있었음(요청으로 수정)
  document.getElementById("mp-stats-title").textContent = "메신저 통계";
  document.getElementById("mp-tab-desc").textContent = "관계";
  document.getElementById("mp-tab-kw").textContent = "키워드";

  document.querySelector(".mp-detail-self-info").style.display = "none";
  document.getElementById("mp-detail-avatar-self").style.display = "none";
  document.querySelector(".mp-detail-relation").style.display = "none";
  document
    .querySelector(".mp-detail-avatar-ring")
    ?.classList.add("mp-ring-off");
  setStatsLegend("messenger");
  document
    .getElementById("mp-detail-namewrap")
    .classList.add("mp-detail-namewrap-wide");

  // 색감 통일 요청 — 메신저 아바타 배경도 초록 계열 대신 메일과 동일한 무채색으로
  const avatarEl = document.getElementById("mp-detail-avatar");
  avatarEl.style.background = "linear-gradient(150deg,#e0e0e0,#c5c5c5)";
  avatarEl.style.color = "#515151";
  if (person.avatar_url) {
    avatarEl.innerHTML = `<img src="${person.avatar_url}" alt="${esc(person.name)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.parentElement.textContent='${initials(person.name)}'">`;
  } else {
    avatarEl.innerHTML = "";
    avatarEl.textContent = initials(person.name);
  }
  const affinityLabelEl = document.getElementById("mp-detail-affinity-label");
  if (affinityLabelEl) affinityLabelEl.innerHTML = "";

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
  // allPeople(원본, 미병합)이 아니라 실제로 카드가 그려질 때 쓴 currentRenderedList에서
  // 찾아야 브랜드 통합 카드의 _groupEmails(병합된 주소 목록)가 살아있다.
  const person = currentRenderedList[idx];
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
