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
let selectedChatroomId = "";
const chatroomIdPromise = initAccountPicker(
  document.getElementById("chatroom-picker-mount"),
  (chatroomId) => {
    selectedChatroomId = chatroomId;
  },
  { domain: "messenger", storageKey: "gw_chatroom_id" },
);
chatroomIdPromise.then((id) => {
  selectedChatroomId = id || "";
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
let currentRenderedList = []; // 마지막 renderCards()가 실제로 그린(그룹핑·필터·정렬 끝난) 목록 —
// 카드 클릭 시 이걸로 찾아야 브랜드 통합 카드의 _groupEmails가 살아있다. allPeople에서
// 이메일로 다시 찾으면 원본(미병합) 객체가 나와서 병합 정보가 사라진다.
let periodStats = {}; // email → {sent, received}
let periodStatsLoaded = false;
let statsDebounceTimer = null;
let contactPhotos = {}; // email → photo URL
let generatedAvatars = {}; // email → GPT 생성 아바타 이미지 URL
let sortMode = "affinity";
let hideBrandAccounts = false; // true면 기업/광고성 발신자 카드를 목록에서 숨김
let sentStatsMap = {}; // email → 보낸 메일수
let receivedStatsMap = {}; // email → 받은 메일수
let currentDetailPerson = null; // 현재 열린 상세보기 person 객체
let detailDebounceTimer = null;
let myAvatarUrl = null; // 로그인한 사용자 본인의 아바타 이미지 URL (페이지 로드 시 1회 생성/캐시)
let currentChannel = "mail"; // "mail" | "messenger" — 하단 타임라인이 어느 도메인 것인지
let mailDateRange = null; // {first, last} ms — 메일 탭 타임라인 캐시
let messengerDateRange = null; // {first, last} ms — 메신저 탭 타임라인 캐시 (전체 방 통합)
let messengerChatrooms = null; // /messenger-chatrooms 캐시
let currentChatroomId = null;
let currentChatroomPeople = [];
let currentDetailMode = "mail"; // "mail" | "messenger" — #mp-detail이 지금 뭘 보여주는 중인지
let messengerScreen = "rooms"; // "rooms" | "people" — 메신저 탭에서 지금 어느 화면인지
let roomSortMode = "name"; // "name" | "total" | "mood"
let peopleSortMode = "name"; // "name" | "count"
let currentChatroomName = "";
let roomMoodCache = {}; // `${chatroom_id}|${start}|${end}` → 평균 분위기 점수 캐시
let currentMessengerPerson = null; // 메신저 상세보기에서 열려있는 person 객체(currentDetailPerson은 메일 전용이라 별도로 둠)
let currentMessengerDrawerMonth = null; // 월별 그래프 클릭으로 연 일별 서랍이 지금 어느 달을 보여주는 중인지
let currentMessengerDayList = []; // 그 달의 일별 목록 캐시(하루 상세 봤다가 "날짜 목록"으로 돌아올 때 재요청 안 하려고)

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
  if (!gmailId) {
    renderCards(); // 계정 정보가 없어도 화면이 "불러오는 중"에 계속 멈춰있지 않게 한다
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
    periodStatsLoaded = true;
    console.log(
      "[periodStats] loaded. keys:",
      Object.keys(newStats).length,
      newStats,
    );
  } catch (e) {
    console.error("fetchPeriodStats 오류:", e);
  } finally {
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

/* ── 카드 렌더링 ── */
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
      const ps = sumPeriodStats(p);
      return (ps.sent || 0) + (ps.received || 0) > 0;
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
      if (affinity != null)
        badge = `<div class="mp-period-badge">${Math.round(affinity * 100)}%</div>`;
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
      if (counts[c] === 0) continue; // 이번 라운드에 아무도 안 배정된 중심은 그대로 둠
      const next = sums[c] / counts[c];
      if (Math.abs(next - centroids[c]) > 1e-9) moved = true;
      centroids[c] = next;
    }
    if (!moved) break;
  }

  // 중심끼리 너무 가까우면(사실상 같은 군집) 하나로 합쳐서 실제 군집 수만 반환
  const sortedDesc = [
    ...new Set(centroids.map((c) => Math.round(c * 1000) / 1000)),
  ].sort((a, b) => b - a);
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

    const bg =
      AFFINITY_BAND_BG[b] || AFFINITY_BAND_BG[AFFINITY_BAND_BG.length - 1];
    const bandBg = `hsl(${AFFINITY_BAND_HUE} ${bg.sat}% ${bg.light}%)`;

    const cardsHtml = bandPeople.map((p) => cardHtml(p, globalIdx++)).join("");

    const bandMax = pctOf(bandPeople[0]);
    const bandMin = pctOf(bandPeople[bandPeople.length - 1]);
    // 구분선은 "바로 위 줄(방금 끝난 밴드)"의 기준을 보여준다 — 그 줄에 있던 사람들의
    // 친밀도가 전부 이 값 이상이라는 뜻으로 "-N% 이상"이라고 표시.
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
    prevBandFloor = bandMin; // 다음 구분선에는 방금 끝난 밴드의 최솟값(=하한선)을 "N% 이상"으로 표시
  }
  return bandsHtml.join("");
}

/* ── 타임라인 초기화 ──
 * 메일/메신저 두 탭이 서로 다른 날짜 범위를 갖고 채널 전환 시마다 initTimeline()을
 * 다시 호출하므로, 리스너를 매번 새로 붙이면 중복 등록된다. 그래서 min/max input의
 * change 리스너는 최초 1회만 붙이고, updateFill/msToVal/valToMs는 그때그때의
 * globalFirst/globalLast(모듈 전역)를 읽도록 바깥으로 뺐다. */
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
    // 메신저 탭: 슬라이더로 고른 기간에 맞춰 지금 보고 있는 화면(단톡방 목록/참여자
    // 목록)과, 열려있는 상세보기의 통계·키워드 탭을 다시 불러온다(디바운스).
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
  receivedStatsMap = {}; // 날짜 범위 변경 시 캐시 무효화
  renderCards();
  clearTimeout(statsDebounceTimer);
  statsDebounceTimer = setTimeout(fetchPeriodStats, 120);
  // 상세보기가 열려 있으면 기간별 데이터도 갱신
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

  /* 눈금 생성 (약 6~8개) */
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
  // 활동 없는 발신자가 필터링되기 전 "원본" 목록이 잠깐 화면에 나왔다가 사라지는 깜빡임을
  // 막기 위해, 기간 통계(periodStats)가 아직 없는 첫 렌더에서는 카드 목록 대신 로딩 표시를
  // 유지한다 — 실제 카드는 아래에서 fetchPeriodStats까지 끝난 뒤 한 번만 그린다.
  const grid = document.getElementById("mp-grid");
  if (grid) {
    grid.innerHTML = `<div class="mp-empty"><i class="bi bi-people"></i><p>데이터를 불러오는 중...</p></div>`;
  }

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

  const gmailId = (await userIdPromise) || "";
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
 * 기본값은 메일(mp-mail-view가 항상 먼저 뜸). 메신저 탭은 첫 클릭 시
 * /messenger-chatrooms로 인덱싱된 단톡방 목록을 불러와 카드 그리드로 보여주고,
 * 방을 클릭하면 그 방 참여자 목록으로, 참여자를 클릭하면 메일 탭과 동일한
 * #mp-detail 패널이 뜬다. 하단 타임라인도 탭마다 별도 날짜 범위(메일 계정 범위 /
 * 인덱싱된 전체 단톡방 통합 범위)를 쓰도록 분리했다.
 */
const mailBtn = document.getElementById("mp-mail-btn");
const messengerBtn = document.getElementById("mp-messenger-btn");
const mailView = document.getElementById("mp-mail-view");
const messengerView = document.getElementById("mp-messenger-view");
const accountPickerMount = document.getElementById("account-picker-mount");
const chatroomPickerMount = document.getElementById("chatroom-picker-mount");
let messengerLoaded = false;

/* ── 정렬 드롭다운: 메일/단톡방 목록/참여자 목록 3개 화면이 서로 다른 정렬 기준을 쓴다.
 * #mp-dropdown-menu의 내용을 화면 전환마다 통째로 갈아끼우는 방식으로 공용 드롭다운
 * 하나를 재사용한다. ── */
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

/* 방의 "분위기"는 /chatroom-mood(이미 있는 라우터)가 주는 월별 mood_score(0~100)를
 * 타임슬라이더로 선택된 기간에 대해 평균 낸 값으로 정의한다. 슬라이더를 움직이면
 * updateFill()에서 이 정렬을 다시 계산한다(아래 참고). */
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

  // 계정 토글 ↔ 채팅방 토글도 뷰에 맞춰 같이 전환
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

/* 방 목록은 타임슬라이더 기간에 따라 내용 자체가 바뀌므로(그 기간에 메시지 없는 방은
 * 아예 빠짐) 캐시하지 않고 매번 현재 selMin/selMax로 다시 불러온다. */
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

/* 타임슬라이더가 움직였을 때(단톡방 목록 화면에 있는 동안) 다시 불러와 다시 그림 */
async function refreshMessengerRoomsForRange() {
  await fetchMessengerChatroomsForRange();
  await renderChatroomGrid();
}

/* 단톡방 카드 아바타 = 참여자 이니셜 원을 인원수만큼 분할해 채움 — 상한 없이 인원수대로
 * 칸이 늘어남. 줄마다 칸 수를 최대한 고르게 나눠(예: 5명 → 3+2, 3명 → 2+1) "줄 단위 flex"로
 * 배치하므로, CSS grid처럼 마지막 줄에 빈 칸이 남아 원이 안 채워지는 문제가 없음. 참여자
 * 정보가 없으면(top_participants 빈 배열) 기존 채팅 아이콘으로 대체. */
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
    const take = Math.ceil(remaining / remainingRows); // 남은 줄에 인원을 고르게 분배
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

/* 참여자 목록도 타임슬라이더 기간에 따라 바뀌므로(그 기간에 메시지 없는 사람은 빠짐)
 * /chatroom-people(전체 기간) 대신 이미 있던 기간별 라우터 /chatroom-person-detail을
 * 쓰고, 0건인 사람만 걸러낸다. 방 화면과 슬라이더 변경 둘 다 이 함수를 재사용. */
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
    : `<div class="mp-empty"><i class="bi bi-people"></i><p>이 기간엔 메시지를 보낸 참여자가 없습니다.</p></div>`;

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

/* ── 메신저 참여자 상세: 월별 메시지 수 그래프 (보낸/받은 구분이 없는 단일 계열이라
 * renderBarChart와 별도 함수로 둠 — 클릭해도 여는 목록이 없어서 data-month 등도 안 붙임) ── */
function renderMessengerBarChart(data) {
  const chartArea = document.getElementById("mp-chart");
  const totalEl = document.getElementById("mp-stats-total");
  const yEl = document.getElementById("mp-vchart-y");
  if (!data || !data.monthly || !data.monthly.length) {
    chartArea.innerHTML =
      '<span style="color:#a0b8b0;font-size:0.82rem;font-style:italic;">메시지 데이터 없음</span>';
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

  // 연/월 몇 개 안 되는 경우가 많아서 mail 차트처럼 내용 크기대로 두고 가운데 정렬하면
  // 좌우에 빈 여백만 커 보이므로, 연도 블록과 월 막대 모두 flex:1로 늘려 항상 패널
  // 전체 너비를 채우게 함(빈 여백에 몰려 보이는 문제 방지)
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
              <div class="mp-vchart-label"><span class="mp-vchart-month">${mon}</span></div>
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

/* ── 메신저 참여자 상세: 관계 방사형 다이어그램 (본인을 중심에 두고 이 방에서 함께 활동한
 * 다른 참여자들을 둘레에 배치, 선 위에 관계 라벨을 얹음) ── */
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

/* ── 막대 클릭 → 오른쪽 이메일 목록 창 (실제 /mail-person-emails 조회) ── */
let currentBarChartData = null;
let activeDrawerMonth = null;

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

/* "YYYY-MM-DD HH:MM:SS" → "5일 19:34" */
function fmtEmailDateTime(dateStr) {
  const [datePart, timePart] = (dateStr || "").split(" ");
  const day = parseInt((datePart || "").split("-")[2], 10) || "";
  const time = (timePart || "").slice(0, 5);
  return `${day}일 ${time}`;
}

/* 메일 ID로 Gmail 앱의 해당 메일 화면으로 바로 이동하는 딥링크를 만든다 */
function gmailMessageUrl(id) {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`;
}

function renderEmailDrawerList(emails) {
  const listEl = document.getElementById("mp-echange-list-body");
  if (!emails.length) {
    listEl.innerHTML =
      '<p style="color:#b7ada0;font-size:0.85rem;text-align:center;padding:40px 0;">이 기간에는 주고받은 메일이 없어요.</p>';
    return;
  }
  const myName = sessionStorage.getItem("gw_user_name") || "나";
  const personName = currentDetailPerson
    ? resolveDisplayName(currentDetailPerson)
    : "";
  listEl.innerHTML = emails
    .map((e) => {
      const from = e.direction === "sent" ? myName : personName;
      const to = e.direction === "sent" ? personName : myName;
      return `
          <a class="mp-email-card ${e.direction}" href="${e.gmailUrl || gmailMessageUrl(e.id)}" target="_blank" rel="noopener" title="Gmail에서 이 메일 열기">
            <div class="mp-email-card-top">
              <span class="mp-email-tag ${e.direction}">${e.direction === "sent" ? "보낸 메일" : "받은 메일"}</span>
              <span class="mp-email-date">${fmtEmailDateTime(e.date)}</span>
            </div>
            <div class="mp-email-subject">${esc(e.subject)}</div>
            <div class="mp-email-snippet">${esc(e.snippet)}</div>
            <div class="mp-email-from">${esc(from)} → ${esc(to)}</div>
          </a>`;
    })
    .join("");
}

async function openEmailDrawer(month, sentCount, recvCount) {
  activeDrawerMonth = month;
  const person = currentDetailPerson;
  const personName = person ? resolveDisplayName(person) : "";
  document.getElementById("mp-echange-list-title").textContent =
    fmtMonthLabel(month);
  document.getElementById("mp-echange-list-count").textContent =
    `${personName} · 총 ${sentCount + recvCount}건 (보낸 ${sentCount} · 받은 ${recvCount})`;
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
    renderEmailDrawerList([]);
    return;
  }

  const [y, m] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  const gmailId = (await userIdPromise) || "";

  // 브랜드 통합 카드면 병합된 모든 주소에서 각각 메일 목록을 가져와 합친다.
  const emails = personEmails(person);

  try {
    const results = await Promise.allSettled(
      emails.map((email) =>
        fetch("/mail-person-emails", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: gmailId,
            person_user_id: email,
            start_date: monthStart,
            end_date: monthEnd,
          }),
        }),
      ),
    );
    if (activeDrawerMonth !== month) return; // 그 사이 다른 달을 클릭했으면 이 응답은 버림
    const lists = await Promise.all(
      results.map(async (r) => {
        if (r.status !== "fulfilled" || !r.value.ok) return [];
        return (await r.value.json()).data || [];
      }),
    );
    const seenIds = new Set();
    const merged = [];
    lists.flat().forEach((e) => {
      if (e.id && seenIds.has(e.id)) return;
      if (e.id) seenIds.add(e.id);
      merged.push(e);
    });
    merged.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    renderEmailDrawerList(merged);
  } catch (e) {
    console.error("메일 목록 조회 오류:", e);
    if (activeDrawerMonth === month) renderEmailDrawerList([]);
  }
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

/* "2026-07-15" → "2026년 7월 15일" */
function fmtDayLabel(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

/* ── 메신저 상세: 월 막대 클릭 → 오른쪽 서랍에 "일별 목록" ── (메일의 openEmailDrawer와
 * 같은 슬라이드 서랍(#mp-echange-chartview/#mp-echange-listview)을 재사용, 내용만 다름) */
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
    if (currentMessengerDrawerMonth !== month) return; // 그 사이 다른 달을 클릭했으면 이 응답은 버림
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
      '<p style="color:#b7ada0;font-size:0.85rem;text-align:center;padding:40px 0;">이 달엔 보낸 메시지가 없어요.</p>';
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

/* 일별 목록에서 하루를 누르면 같은 서랍 안 내용을 그날 대화 원문으로 교체 */
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
    const dayRow = e.target.closest(".mp-day-row");
    if (dayRow) {
      openMessengerDayChat(dayRow.dataset.date);
      return;
    }
    if (e.target.closest("#mp-day-back-btn")) {
      renderMessengerDayList(currentMessengerDayList);
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
window.closeEmailDrawer = closeEmailDrawer; // #mp-echange-back의 인라인 onclick용(기존에 누락돼있던 것)
window.toggleGraphView = toggleGraphView; // "카드 보기" 버튼의 인라인 onclick용(기존에 누락돼있던 것)

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
  const gmailId = (await userIdPromise) || "";

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

async function openDetail(person, rowIndex) {
  const gmailId = (await userIdPromise) || "";
  const detailDisplayName = resolveDisplayName(person);

  currentDetailMode = "mail";
  currentMessengerPerson = null;
  document.getElementById("mp-tab-stats").textContent = "이메일 교환";
  document.getElementById("mp-tab-desc").textContent = "설명";
  document.getElementById("mp-tab-kw").textContent = "키워드";
  closeEmailDrawer(); // 이전 사람의 메일 목록 서랍이 열려 있던 상태로 새 상세보기가 뜨지 않도록 초기화

  // 메신저 상세에서 숨겼던 "나 ↔ 상대방" 페어링 UI + 통계 탭 제목/범례 복원, 메신저 전용 설명 숨김
  document.querySelector(".mp-detail-self-info").style.display = "";
  document.getElementById("mp-detail-avatar-self").style.display = "";
  document.querySelector(".mp-detail-relation").style.display = "";
  document.getElementById("mp-stats-title").style.display = "";
  document.getElementById("mp-stats-legend").style.display = "";
  document.getElementById("mp-detail-messenger-desc")?.classList.remove("show");
  document
    .getElementById("mp-detail-namewrap")
    .classList.remove("mp-detail-namewrap-wide");

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

  // 설명 탭 프로필
  const profileEl = document.getElementById("mp-desc-profile-content");
  if (profileEl)
    profileEl.innerHTML = '<p class="mp-desc-profile-empty">로딩 중...</p>';
  loadDescriptions(gmailId).then((descs) => renderDescription(person, descs));

  await refreshDetailStats(person);
}

/* ── 메신저 탭 사람 상세: 메일 탭과 같은 #mp-detail 패널을 재사용하되, 탭 3개의 역할은
 * 메일과 다르게 분리한다 — 1번은 월별 메시지 그래프, 2번은 이 방 안에서의 관계 방사형
 * 다이어그램, 3번은 키워드. 이메일/친밀도 링처럼 메신저에 없는 개념은 비워둔다. ── */
async function openMessengerDetail(person) {
  closeEmailDrawer();

  currentDetailMode = "messenger";
  currentDetailPerson = null; // 메일 전용 refreshDetailStats가 슬라이더 조작 시 안 걸리게 분리
  currentMessengerPerson = person;

  document.getElementById("mp-tab-stats").textContent = "메시지 통계";
  document.getElementById("mp-tab-desc").textContent = "관계";
  document.getElementById("mp-tab-kw").textContent = "키워드";

  // 메일 탭의 "나 ↔ 상대방" 페어링 UI(내 아바타/관계선)는 메신저에선 의미가 없어서
  // 통째로 숨기고, 선택한 참여자 이름/부제 옆에 그 사람 설명을 대신 보여줌
  document.querySelector(".mp-detail-self-info").style.display = "none";
  document.getElementById("mp-detail-avatar-self").style.display = "none";
  document.querySelector(".mp-detail-relation").style.display = "none";
  // 통계 탭 안의 "이메일 교환" 제목 + "보낸 메일/받은 메일" 범례도 메일 전용 문구라 숨김
  document.getElementById("mp-stats-title").style.display = "none";
  document.getElementById("mp-stats-legend").style.display = "none";
  // 이름/설명 칸이 헤더의 남는 폭을 다 가져가게 해서, 설명을 스크롤 없이 옆으로 넓게 펼침
  document
    .getElementById("mp-detail-namewrap")
    .classList.add("mp-detail-namewrap-wide");

  const avatarEl = document.getElementById("mp-detail-avatar");
  avatarEl.style.background = "linear-gradient(150deg,#cfe9df,#a9d4c4)";
  avatarEl.style.color = "#1a6e4a";
  if (person.avatar_url) {
    avatarEl.innerHTML = `<img src="${person.avatar_url}" alt="${esc(person.name)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.parentElement.textContent='${initials(person.name)}'">`;
  } else {
    avatarEl.innerHTML = "";
    avatarEl.textContent = initials(person.name);
  }

  const ringFill = document.getElementById("mp-detail-avatar-ring-fill");
  const ringLabel = document.getElementById("mp-detail-avatar-ring-label");
  if (ringFill) ringFill.style.strokeDashoffset = String(2 * Math.PI * 46); // 친밀도 개념 없음 → 항상 빈 링
  if (ringLabel) ringLabel.innerHTML = "";

  document.getElementById("mp-detail-name").textContent =
    person.name || "(알 수 없음)";
  document.getElementById("mp-detail-email").textContent =
    `단톡방 참여자 · 메시지 ${person.message_count || 0}건`;

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

  // 관계 탭 — 이 방의 /chatroom-relationships(전체 기간)에서 이 사람이 낀 관계만 추려
  // strength 상위 8개까지 방사형 다이어그램으로
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

/* 통계 탭(월별 그래프)+키워드 탭 — 메일의 refreshDetailStats()와 같은 자리: 둘 다
 * selMin/selMax(타임슬라이더 기간)를 쓰고, openMessengerDetail()이 처음 열 때도,
 * 슬라이더를 움직였을 때(updateFill())도 이 함수 하나로 같이 새로고침한다. 관계 탭은
 * 메일의 "설명" 탭처럼 기간과 무관하게 상세보기를 열 때만 한 번 불러온 걸 유지(여기서
 * 다시 안 부름). */
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

loadPeople();

setTimeout(_initMiniGraph, 2500);
