/* ── [필수] 사이드바 및 페이지 SCSS 로드 ── */
import "../scss/components/_sidebar.scss";
import "../scss/pages/mytime.scss";

import { bootstrapApp } from "../main-app.js";
import { initAccountPicker } from "../features/accountPicker.js";
import { store } from "../store/globalStore.js";
import { refreshSidebarList } from "../layout/appSidebar.js";
import { initGlobalFilter } from "../utils/filterSync.js";

bootstrapApp("mytime");

/* ── 앱 초기화 및 사이드바 바인딩 ── */
document.addEventListener("DOMContentLoaded", () => {
  // 사이드바 렌더링 + 계정/채팅방 목록 조회는 initGlobalFilter가 전부 처리한다.
  initGlobalFilter((filterState, meta) => {
    // 초기 호출(isInitial)은 이미 아래 userIdPromise/chatroomIdPromise 흐름이
    // 처리 중이므로 무시. 사이드바(또는 상단 계정 토글)에서 실제로 선택이 바뀐
    // 경우에만 반응한다. 예전엔 여기서 location.reload()를 호출했는데, 그러면
    // 사이드바를 포함한 전체 DOM이 통째로 다시 그려져서 "사이드바가 닫혔다가
    // 다시 펼쳐지는" 것처럼 보였다 — 지금은 initMail()/loadMtMessengerData()를
    // 직접 다시 불러서 사이드바는 그대로 둔 채 콘텐츠만 새로고침한다.
    if (meta && meta.isInitial) return;
    if (filterState.mail) {
      setMtChannel("mail");
      initMail(filterState.mail);
    } else if (filterState.room) {
      setMtChannel("messenger");
      currentChatroomId = filterState.room;
      mtMessengerLoaded = true;
      loadMtMessengerData();
    }
  });
});

const userIdPromise = initAccountPicker(
  document.getElementById("account-picker-mount"),
  (selectedMail) => {
    if (selectedMail) {
      store.setFilter("room", null);
      store.setFilter("mail", selectedMail);
      refreshSidebarList();
    }
  },
);

/* 메신저 뷰용 채팅방 선택 토글 */
let currentChatroomId = "";
const chatroomIdPromise = initAccountPicker(
  document.getElementById("chatroom-picker-mount"),
  (chatroomId) => {
    currentChatroomId = chatroomId;
    mtMessengerLoaded = true;
    loadMtMessengerData();
  },
  { domain: "messenger", storageKey: "gw_chatroom_id" },
);
chatroomIdPromise.then((id) => {
  currentChatroomId = id || "";
});

/* ── 공통 fetch 헬퍼 ── */
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

/* ── 공용 툴팁(주요 연락처 설명 / 키워드 언급자) ── */
let mtTooltipEl = null;
function ensureTooltip() {
  if (mtTooltipEl) return mtTooltipEl;
  mtTooltipEl = document.createElement("div");
  mtTooltipEl.className = "mt-tooltip";
  document.body.appendChild(mtTooltipEl);
  return mtTooltipEl;
}
function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
// 주요 연락처 설명이 "이름: ... 관계: ... 자주 주고받은 내용: ..."처럼
// 라벨이 붙은 한 줄 문자열로 오므로, 그 라벨들 앞에 줄바꿈을 넣어 각각
// 한 줄씩 보이게 만든다.
function formatContactDesc(text) {
  let html = escHtml(text);
  ["이름:", "관계:", "자주 주고받은 내용:"].forEach((label) => {
    html = html.split(escHtml(label)).join(`<br>${escHtml(label)}`);
  });
  return html.replace(/^(<br>)+/, "");
}
function showTooltip(anchorEl, html, placement = "top") {
  const t = ensureTooltip();
  t.innerHTML = html;
  const rect = anchorEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - 280, rect.left));
  t.style.left = `${left}px`;
  // 요청 — 주요 연락처(placement="bottom")에 뜨는 설명 창을, 그 연락처
  // 요소가 hover 시 변하는 주황색과 맞추되 더 연하게(mt-tooltip-contact).
  t.classList.toggle("mt-tooltip-contact", placement === "bottom");
  if (placement === "bottom") {
    // 주요 연락처 카드용 — 위가 아니라 카드 밑으로 상세 설명 창이 뜨도록
    t.style.top = `${rect.bottom + 8}px`;
    t.style.transform = "translateY(0)";
  } else {
    t.style.top = `${rect.top - 8}px`;
    t.style.transform = "translateY(-100%)";
  }
  requestAnimationFrame(() => t.classList.add("show"));
}
function hideTooltip() {
  if (mtTooltipEl) mtTooltipEl.classList.remove("show");
}

/* ── 타임라인 컨트롤러 ── */
function createTimeline(ids) {
  let MONTH_DATA = {};
  let YEAR_DATA = {};
  let ALL_KEYS = [];
  let YEAR_KEYS = [];
  let FIRST_NUM = 0;
  let TOTAL = 1;
  let mode = "month";
  let centerIdx = 2;
  let pinnedKey = null;
  // 제목 옆 뱃지("2020.11 ~ 2026.08 데이터")로 옮겨진 전체 기간 텍스트 —
  // buildPointer()에서 계산해두고, 지금 보고 있는 채널(메일/메신저)일 때만
  // 공용 뱃지(#mtDataRangeLbl)에 반영한다(updateSharedRangeBadge 참고).
  let fullRangeText = "";
  // 상단 타임슬라이더 — 연도별 모드는 한 화면에 5개씩 슬라이딩 윈도우로 보여줌.
  // 월별 모드는 슬라이딩 윈도우가 아니라 "지금 선택된 연도에 속한 달"만
  // 모아서 보여준다(getWindowKeys 참고) — 그래서 여기엔 year 값만 남는다.
  const WIN = { year: 5 };

  function monthToNum(k) {
    const [y, m] = k.split("-").map(Number);
    return y * 12 + m;
  }
  function monthToPct(k) {
    return (monthToNum(k) - FIRST_NUM) / TOTAL;
  }
  function yearToPct(y) {
    return (Number(y) * 12 + 1 - FIRST_NUM) / TOTAL;
  }
  // 연도 점(.mt-pm)을 실제 달력상의 시간 간격에 비례해서 찍으면(yearToPct),
  // 데이터가 몰려있을 때 첫 연도가 트랙 맨 끝(0%)에 붙어 원이 잘려 보이는
  // 문제가 있었다 — 요청대로 실제 시간 간격 대신 "연도 하나당 일정한 간격"으로
  // 고정한다. 연도 수가 적으면(=데이터가 적으면) 그만큼 점들 사이 간격도
  // 자연스럽게 좁아진다.
  // 요청 — 트랙 양 끝에 따로 숫자 라벨을 두는 대신, 맨 처음/맨 끝 연도의 점
  // 버튼 자체가 트랙의 양 끝(0%/100%)에 오도록 인셋을 없앰(트랙 좌우
  // 패딩이 이미 있어서 원이 잘리지 않는다).
  const YEAR_DOT_INSET = 0;
  function yearIdxPct(i) {
    if (YEAR_KEYS.length <= 1) return 0.5;
    const clamped = Math.max(0, Math.min(YEAR_KEYS.length - 1, i));
    return (
      YEAR_DOT_INSET +
      (clamped / (YEAR_KEYS.length - 1)) * (1 - YEAR_DOT_INSET * 2)
    );
  }
  function getWindowKeys() {
    if (mode === "month") {
      // 요청 — 예전엔 centerIdx를 중심으로 한 12개짜리 슬라이딩 윈도우라,
      // 연도 경계에 걸치면 다른 연도의 달이 섞여 보였다(예: 2026년을
      // 선택했는데 2020년 12월이 같이 뜸). 지금 선택된(centerIdx가 속한)
      // 연도에 속한 달만 모아서 보여주도록 바꿈 — 다른 연도 달은 절대 안 섞임.
      const k = ALL_KEYS[Math.max(0, Math.min(ALL_KEYS.length - 1, centerIdx))];
      if (!k) return [];
      const year = k.split("-")[0];
      return ALL_KEYS.filter((mk) => mk.split("-")[0] === year);
    }
    const win = WIN.year;
    let start = Math.max(0, centerIdx - Math.floor(win / 2));
    start = Math.min(start, YEAR_KEYS.length - win);
    start = Math.max(0, start);
    return YEAR_KEYS.slice(start, start + win);
  }

  function render() {
    const keys = getWindowKeys();
    const data = mode === "month" ? MONTH_DATA : YEAR_DATA;
    const track = document.getElementById(ids.track);
    track.innerHTML = "";
    pinnedKey = null;
    document.getElementById(ids.panel).classList.remove("pinned");
    hidePanel();

    keys.forEach((k) => {
      const d = data[k];
      if (!d) return;

      const col = document.createElement("div");
      col.className = "mt-node-col";
      col.dataset.key = k;

      const dot = document.createElement("div");
      dot.className = "mt-dot";

      const lbl = document.createElement("div");
      lbl.className = "mt-node-label";
      // 월별 모드는 한 화면에 12개(1년치)를 다 보여줘야 해서 "2026.08"처럼
      // 연도까지 적으면 너무 빽빽함 — 요청대로 월만 "8월" 식으로 표시
      lbl.textContent =
        mode === "month" ? `${parseInt(k.slice(5), 10)}월` : `${k}년`;

      col.appendChild(dot);
      col.appendChild(lbl);
      track.appendChild(col);

      col.addEventListener("mouseenter", () => {
        if (!pinnedKey) showPanel(col, k, d);
      });
      col.addEventListener("mouseleave", () => {
        if (!pinnedKey) hidePanel();
      });
      col.addEventListener("click", () => {
        if (pinnedKey === k) {
          pinnedKey = null;
          col.classList.remove("pinned");
          document.getElementById(ids.panel).classList.remove("pinned");
          hidePanel();
        } else {
          pinKey(col, k, d);
        }
      });
    });

    updatePointerWindow();
  }

  function showPanel(col, key, d) {
    document
      .getElementById(ids.track)
      .querySelectorAll(".mt-node-col")
      .forEach((c) => c.classList.toggle("active", c === col));

    document.getElementById(ids.panelPeriod).textContent =
      mode === "month" ? `${key.slice(0, 4)}년 ${key.slice(5)}월` : `${key}년`;
    if (ids.panelCount) {
      document.getElementById(ids.panelCount).innerHTML = d.count
        ? `<strong>${d.count.toLocaleString()}</strong>건 &nbsp;·&nbsp; ${d.threads}개 대화`
        : "";
    }
    document.getElementById(ids.panelSummary).textContent = d.summary || "";

    const cc = document.getElementById(ids.panelContacts);
    cc.innerHTML = "";
    (d.contacts || []).forEach((c) => {
      const el = document.createElement("div");
      el.className = "mt-panel-contact";
      el.textContent = c;
      // 네모난 연락처 카드에 마우스를 올리면 그 사람에 대한 설명을 툴팁으로 —
      // 새로 API를 만들지 않고 기존에 있던 사람 설명 데이터(메일: /person-descriptions,
      // 메신저: /chatroom-people)를 ids.contactLookup으로 넘겨받아 조회한다.
      if (ids.contactLookup) {
        el.addEventListener("mouseenter", () => {
          const desc = ids.contactLookup(c);
          showTooltip(
            el,
            desc ? formatContactDesc(desc) : "등록된 설명이 없습니다.",
            "bottom",
          );
        });
        el.addEventListener("mouseleave", hideTooltip);
      }
      cc.appendChild(el);
    });

    document.getElementById(ids.panel).classList.add("show");
  }

  // 오른쪽 "월별 키워드" 창에 지금 왼쪽에서 보고 있는 기간을 알려준다 — 사용자가
  // 슬라이더에서 기간을 클릭(고정)하거나, 처음 데이터가 로드되거나, 월별/연별
  // 모드를 바꿀 때 호출된다(마우스만 올렸다 뗀 미리보기 단계에서는 호출하지
  // 않음 — 계속 훑어볼 때마다 오른쪽 창이 깜빡이지 않도록).
  function notifyPeriod(key) {
    if (ids.onPeriod && key) ids.onPeriod(mode, key);
  }

  function hidePanel() {
    document.getElementById(ids.panel).classList.remove("show");
    document
      .getElementById(ids.track)
      .querySelectorAll(".mt-node-col")
      .forEach((c) => c.classList.remove("active"));
  }

  // 슬라이더에서 기간 하나를 "고정(pin)" — 클릭했을 때와, 페이지 로드 시 가장
  // 최근 달을 기본으로 띄울 때 둘 다 이 함수를 쓴다.
  function pinKey(col, k, d) {
    pinnedKey = k;
    document
      .getElementById(ids.track)
      .querySelectorAll(".mt-node-col")
      .forEach((c) => c.classList.remove("pinned"));
    col.classList.add("pinned");
    showPanel(col, k, d);
    document.getElementById(ids.panel).classList.add("pinned");
    centerIdx = (mode === "month" ? ALL_KEYS : YEAR_KEYS).indexOf(k);
    updatePointerCursor();
    notifyPeriod(k);
  }

  // 페이지를 처음 열었을 때(아직 아무 기간도 클릭 안 한 상태)도 왼쪽 요약/주요
  // 연락처 패널과 오른쪽 키워드 창이 비어있지 않도록, 가장 최근 달을 기본으로
  // 고정해서 보여준다.
  function pinDefaultLast() {
    if (!ALL_KEYS.length) return;
    const key = ALL_KEYS[ALL_KEYS.length - 1];
    const d = MONTH_DATA[key];
    const col = document
      .getElementById(ids.track)
      .querySelector(`.mt-node-col[data-key="${key}"]`);
    if (!col || !d) {
      notifyPeriod(key);
      return;
    }
    pinKey(col, key, d);
  }

  function buildPointer() {
    const pointerTrack = document.getElementById(ids.pointerTrack);
    pointerTrack.querySelectorAll(".mt-pm").forEach((el) => el.remove());

    // 예전엔 달(ALL_KEYS)마다 점을 하나씩 찍어서, 데이터가 1년치(한 해)만
    // 있어도 점이 12개나 생겨 "연도 하나가 여러 개로 쪼개진" 것처럼 보였다 —
    // 요청대로 "연도 하나당 동그라미 하나"가 되도록 YEAR_KEYS 기준으로 점을
    // 찍는다. 연도가 하나뿐이면 그 점을 처음부터 선택된 상태로 고정해서
    // 보여준다.
    YEAR_KEYS.forEach((y, i) => {
      const pm = document.createElement("div");
      pm.className = "mt-pm";
      pm.dataset.year = y;
      if (YEAR_KEYS.length === 1) pm.classList.add("is-only");
      pm.style.left = `${yearIdxPct(i) * 100}%`;
      pm.addEventListener("click", (e) => {
        e.stopPropagation();
        if (mode === "year") {
          centerIdx = Math.max(0, YEAR_KEYS.indexOf(y));
        } else {
          const idx = ALL_KEYS.findIndex((k) => k.startsWith(`${y}-`));
          centerIdx = Math.max(0, idx === -1 ? 0 : idx);
        }
        updatePointerCursor();
        render();
      });
      pointerTrack.insertBefore(pm, document.getElementById(ids.pointerWindow));
    });

    // 요청 — "2020.11 ~ 2026.08 데이터" 문구는 이제 트랙 위가 아니라 제목
    // ("My Time") 옆 뱃지로 옮겨간다. 여기 있던 트랙 위 자리에는 대신
    // "선택된 연도는 2026년도 입니다" 같은, 지금 선택 상태를 보여주는 문구를
    // 띄운다(updateYearDotSelection에서 매번 갱신).
    const fmtYm = (k) => `${k.slice(0, 4)}.${k.slice(5)}`;
    fullRangeText =
      ALL_KEYS.length > 1
        ? `${fmtYm(ALL_KEYS[0])} ~ ${fmtYm(ALL_KEYS[ALL_KEYS.length - 1])} 데이터`
        : ALL_KEYS.length
          ? `${fmtYm(ALL_KEYS[0])} 데이터`
          : "";
    if (ids.channel === mtActiveChannel) updateSharedRangeBadge(fullRangeText);

    const axis = document.getElementById(ids.pointerAxis);
    axis.innerHTML = "";

    const MIN_GAP_PX = 64;
    const axisWidth =
      axis.offsetWidth || axis.getBoundingClientRect().width || 0;
    const withPct = YEAR_KEYS.map((y, i) => ({
      y,
      pct: yearIdxPct(i) * 100,
    }));

    let filtered = withPct.length ? [withPct[0]] : [];
    for (let i = 1; i < withPct.length; i++) {
      const prev = filtered[filtered.length - 1];
      const gapPx = ((withPct[i].pct - prev.pct) / 100) * axisWidth;
      if (gapPx >= MIN_GAP_PX || i === withPct.length - 1) {
        filtered.push(withPct[i]);
      }
    }
    if (filtered.length >= 2) {
      const last = filtered[filtered.length - 1];
      const beforeLast = filtered[filtered.length - 2];
      const gapPx = ((last.pct - beforeLast.pct) / 100) * axisWidth;
      if (gapPx < MIN_GAP_PX) {
        filtered.splice(filtered.length - 2, 1);
      }
    }

    filtered.forEach(({ y, pct }) => {
      const tick = document.createElement("div");
      tick.className = "mt-pa-tick";
      tick.style.left = pct + "%";
      const line = document.createElement("div");
      line.className = "mt-pa-tick-line";
      const lbl = document.createElement("div");
      lbl.className = "mt-pa-lbl";
      lbl.textContent = y;
      tick.appendChild(line);
      tick.appendChild(lbl);
      axis.appendChild(tick);
    });

    updatePointerCursor();
    updatePointerWindow();
  }

  // 선택된 연도 점 위에 화살표를 띄우기 위한 표시 갱신 — 월별 모드에서는 지금
  // 보고 있는 달이 속한 연도, 연도별 모드에서는 지금 선택된 연도를 기준으로
  // 판단해서 그 점에만 "selected" 클래스를 붙인다.
  function updateYearDotSelection() {
    const track = document.getElementById(ids.pointerTrack);
    if (!track) return;
    let selectedYear = null;
    if (mode === "year") {
      selectedYear =
        YEAR_KEYS[Math.max(0, Math.min(YEAR_KEYS.length - 1, centerIdx))];
    } else {
      const mk = ALL_KEYS[Math.max(0, Math.min(ALL_KEYS.length - 1, centerIdx))];
      selectedYear = mk ? mk.split("-")[0] : null;
    }
    track.querySelectorAll(".mt-pm").forEach((el) => {
      el.classList.toggle("selected", !!selectedYear && el.dataset.year === selectedYear);
    });

    const rangeLbl = document.getElementById(ids.rangeLbl);
    if (rangeLbl) {
      rangeLbl.textContent = selectedYear
        ? `선택된 연도는 ${selectedYear}년도 입니다`
        : "—";
    }
  }

  function updatePointerCursor() {
    const keys = mode === "month" ? ALL_KEYS : YEAR_KEYS;
    const k = keys[Math.max(0, Math.min(keys.length - 1, centerIdx))];
    // 요청 — "나" 아바타가 연도 점(.mt-pm)과 다른 좌표계(monthToPct = 실제 시간
    // 비례)를 쓰고 있어서 월별 모드에서 해당 연도 점 위치와 어긋나 보이던 문제.
    // 연도 점은 yearIdxPct(균등 간격)로 찍히므로, 월별 모드에서도 지금 보고 있는
    // 달이 속한 연도의 점과 정확히 같은 좌표(yearIdxPct)를 쓰도록 맞춘다.
    let pct;
    if (mode === "month") {
      const y = k.split("-")[0];
      const yIdx = YEAR_KEYS.indexOf(y);
      pct = (yIdx === -1 ? monthToPct(k) : yearIdxPct(yIdx)) * 100;
    } else {
      pct = yearIdxPct(YEAR_KEYS.indexOf(k)) * 100;
    }
    document.getElementById(ids.pointerCursor).style.left =
      Math.max(0, Math.min(100, pct)) + "%";
    updateYearDotSelection();
  }

  function updatePointerWindow() {
    const wKeys = getWindowKeys();
    if (!wKeys.length) return;
    let s, e;
    if (mode === "month") {
      s = monthToPct(wKeys[0]);
      e = monthToPct(wKeys[wKeys.length - 1]);
    } else {
      const startIdx = YEAR_KEYS.indexOf(wKeys[0]);
      const endIdx = YEAR_KEYS.indexOf(wKeys[wKeys.length - 1]);
      const step =
        YEAR_KEYS.length > 1 ? (1 - YEAR_DOT_INSET * 2) / (YEAR_KEYS.length - 1) : 0;
      s = yearIdxPct(startIdx);
      e = yearIdxPct(endIdx) + step * 0.6;
    }
    const win = document.getElementById(ids.pointerWindow);
    win.style.left = `${Math.max(0, s * 100)}%`;
    win.style.width = `${Math.min(100, (e - s) * 100)}%`;
  }

  document.getElementById(ids.pointerTrack).addEventListener("click", (e) => {
    if (e.target.classList.contains("mt-pm")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    if (mode === "month") {
      const totalIdx = Math.round(pct * ALL_KEYS.length);
      centerIdx = Math.max(0, Math.min(ALL_KEYS.length - 1, totalIdx));
    } else {
      // 연도 점이 이제 실제 시간 간격이 아니라 일정한 간격(yearIdxPct)으로
      // 찍히므로, 트랙을 눌렀을 때도 같은 간격 기준으로 가장 가까운 연도를 찾는다.
      const rawIdx =
        YEAR_KEYS.length > 1
          ? ((pct - YEAR_DOT_INSET) / (1 - YEAR_DOT_INSET * 2)) *
            (YEAR_KEYS.length - 1)
          : 0;
      centerIdx = Math.max(
        0,
        Math.min(YEAR_KEYS.length - 1, Math.round(rawIdx)),
      );
    }
    updatePointerCursor();
    render();
  });

  function setData(monthData, yearData, emptyMessage) {
    MONTH_DATA = monthData || {};
    YEAR_DATA = yearData || {};
    ALL_KEYS = Object.keys(MONTH_DATA).sort();
    YEAR_KEYS = Object.keys(YEAR_DATA).sort();

    const track = document.getElementById(ids.track);
    if (!ALL_KEYS.length) {
      track.innerHTML = `<div style="color:#a8a8a8;font-size:.78rem;padding:20px 0;">${emptyMessage}</div>`;
      return false;
    }

    FIRST_NUM = monthToNum(ALL_KEYS[0]);
    const LAST_NUM = monthToNum(ALL_KEYS[ALL_KEYS.length - 1]);
    TOTAL = LAST_NUM - FIRST_NUM || 1;
    centerIdx = Math.min(2, ALL_KEYS.length - 1);

    buildPointer();
    render();
    // 가장 최근 달을 기본으로 고정 — 요약/주요 연락처(왼쪽)와 월별 키워드
    // (오른쪽) 둘 다 처음부터 채워져 보이도록 한다.
    pinDefaultLast();
    return true;
  }

  function setMode(m) {
    mode = m;
    centerIdx = mode === "month" ? Math.min(3, ALL_KEYS.length - 1) : 0;
    render();
    updatePointerCursor();
    const keys = mode === "month" ? ALL_KEYS : YEAR_KEYS;
    notifyPeriod(keys[Math.max(0, Math.min(keys.length - 1, centerIdx))]);
  }

  return { setData, setMode, getRangeText: () => fullRangeText };
}

/* ── 오른쪽 "월별 키워드" 창 컨트롤러 ──
   ids: { body, hint, backBtn } — DOM id 문자열
   api: { monthlyUrl, dailyUrl, mentionersUrl, idField } — 메일/메신저별로 다른
        엔드포인트·요청 필드명(user_id vs chatroom_id)을 여기서 갈아끼운다. */
function createKeywordPanel(ids, api) {
  let idValue = "";
  let monthlyMap = {};
  const dailyCache = {}; // monthKey -> {date: [{word,count}]}
  const mentionersCache = {}; // "date|word" -> data[]
  let view = "list"; // 'list' | 'daily'
  let currentMonthKey = null;
  let currentYear = null;
  let currentKeyword = null;

  const bodyEl = () => document.getElementById(ids.body);
  const hintEl = () => document.getElementById(ids.hint);
  const backBtnEl = () => document.getElementById(ids.backBtn);
  const titleEl = () => (ids.title ? document.getElementById(ids.title) : null);

  // "월별 키워드"라는 고정 문구 대신, 지금 왼쪽에서 선택된 기간에 맞춰
  // "2026년 08월 키워드" / "2026년 키워드"처럼 제목을 매번 바꿔준다.
  function updateTitle(mode, key) {
    const el = titleEl();
    if (!el || !key) return;
    el.textContent =
      mode === "year" ? `${key}년 키워드` : `${key.slice(0, 4)}년 ${key.slice(5)}월 키워드`;
  }

  function daysInMonth(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }

  // 계정/채팅방이 바뀔 때(초기 로드 포함) 호출 — 그 기간의 월별 키워드 통계를
  // 통째로 한 번만 받아두고, 이후 왼쪽 슬라이더에서 어느 달을 보든 이 맵에서
  // 바로 꺼내 쓴다(달마다 다시 API를 부르지 않음).
  async function init(newIdValue) {
    idValue = newIdValue || "";
    monthlyMap = {};
    Object.keys(dailyCache).forEach((k) => delete dailyCache[k]);
    Object.keys(mentionersCache).forEach((k) => delete mentionersCache[k]);
    view = "list";
    currentMonthKey = null;
    currentYear = null;
    currentKeyword = null;
    if (backBtnEl()) backBtnEl().style.display = "none";
    if (titleEl()) titleEl().textContent = "키워드";

    if (!idValue) {
      renderEmpty("연결된 계정이 없습니다.");
      return;
    }
    try {
      const j = await postJSON(api.monthlyUrl, { [api.idField]: idValue });
      monthlyMap = j.data || {};
    } catch (e) {
      console.error("keyword-monthly-stats 오류:", e);
      monthlyMap = {};
    }
  }

  function renderEmpty(msg) {
    if (hintEl()) hintEl().textContent = "";
    if (bodyEl())
      bodyEl().innerHTML =
        `<div class="mt-empty"><i class="bi bi-chat-square-text"></i><p>${escHtml(msg)}</p></div>`;
  }

  function renderList() {
    view = "list";
    currentKeyword = null;
    if (backBtnEl()) backBtnEl().style.display = "none";
    if (!bodyEl()) return;

    let keywords = [];
    const yearMode = !!currentYear;
    if (yearMode) {
      // 연도별 보기: 그 해에 속한 모든 달의 키워드 카운트를 합산해서 보여준다
      // (월별 키워드 API 자체는 달 단위로만 내려주기 때문).
      const merged = {};
      Object.keys(monthlyMap).forEach((mk) => {
        if (!mk.startsWith(`${currentYear}-`)) return;
        (monthlyMap[mk] || []).forEach((kw) => {
          merged[kw.word] = (merged[kw.word] || 0) + kw.count;
        });
      });
      keywords = Object.entries(merged).map(([word, count]) => ({
        word,
        count,
      }));
    } else if (currentMonthKey) {
      keywords = monthlyMap[currentMonthKey] || [];
    }

    keywords = keywords
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    if (hintEl()) {
      hintEl().textContent = yearMode
        ? "연도별 보기에서는 키워드 집계만 볼 수 있어요 — 일별 그래프는 월별 보기에서 확인해보세요."
        : "키워드를 클릭하시면 일별 그래프가 나타납니다.";
    }

    if (!keywords.length) {
      bodyEl().innerHTML =
        `<div class="mt-empty"><i class="bi bi-chat-square-text"></i><p>이 기간에는 추출된 키워드가 없습니다.</p></div>`;
      return;
    }

    const max = keywords[0].count || 1;
    const list = document.createElement("div");
    list.className = "mt-kw-list";
    keywords.forEach((kw) => {
      const row = document.createElement("div");
      row.className = "mt-kw-row";
      row.innerHTML = `
        <div class="mt-kw-row-word" title="${escHtml(kw.word)}">${escHtml(kw.word)}</div>
        <div class="mt-kw-row-track"><div class="mt-kw-row-fill" style="width:0%"></div></div>
        <div class="mt-kw-row-count">${kw.count.toLocaleString()}</div>`;
      if (!yearMode) {
        row.addEventListener("click", () => showDaily(kw.word));
      } else {
        row.style.cursor = "default";
      }
      list.appendChild(row);
    });
    bodyEl().innerHTML = "";
    bodyEl().appendChild(list);

    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        list.querySelectorAll(".mt-kw-row-fill").forEach((el, i) => {
          el.style.width =
            Math.max(4, Math.round((keywords[i].count / max) * 100)) + "%";
        });
      }),
    );
  }

  async function showDaily(word) {
    if (!currentMonthKey || !bodyEl()) return;
    view = "daily";
    currentKeyword = word;
    if (backBtnEl()) backBtnEl().style.display = "";
    if (hintEl())
      hintEl().textContent =
        "막대에 마우스를 올리면 그 날 이 키워드를 언급한 사람을 볼 수 있어요.";
    bodyEl().innerHTML =
      `<div class="mt-empty"><i class="bi bi-hourglass-split"></i><p>불러오는 중...</p></div>`;

    const monthKey = currentMonthKey;
    let dayData = dailyCache[monthKey];
    if (!dayData) {
      try {
        const j = await postJSON(api.dailyUrl, {
          [api.idField]: idValue,
          month: monthKey,
        });
        dayData = j.data || {};
        dailyCache[monthKey] = dayData;
      } catch (e) {
        console.error("keyword-daily-stats 오류:", e);
        dayData = {};
      }
    }
    // 응답이 오는 사이 사용자가 다른 키워드를 클릭했거나 목록으로 돌아갔으면
    // 이 결과는 이제 화면과 안 맞으니 버린다.
    if (view !== "daily" || currentKeyword !== word || !bodyEl()) return;

    const total = daysInMonth(monthKey);
    const allCounts = [];
    for (let d = 1; d <= total; d++) {
      const dateKey = `${monthKey}-${String(d).padStart(2, "0")}`;
      const found = (dayData[dateKey] || []).find((x) => x.word === word);
      allCounts.push({ date: dateKey, day: d, count: found ? found.count : 0 });
    }
    // 요청 — x축에 그 달의 모든 날짜가 다 나와서 너무 빽빽했던 걸, 실제로
    // 이 키워드가 언급된 날짜만 표시하도록 필터링.
    const counts = allCounts.filter((c) => c.count > 0);
    const max = Math.max(1, ...counts.map((c) => c.count));

    const wrap = document.createElement("div");
    wrap.className = "mt-kw-daily-box";
    // 막대그래프 색(주황 그라데이션)과 같은 색 스와치를 제목 앞에 붙여서, 이
    // 색의 막대그래프가 이 키워드를 나타낸다는 걸 바로 알 수 있게 함 —
    // 제목+그래프+날짜줄 전체를 하나의 박스(.mt-kw-daily-box)로 감싸서
    // 시각적으로 분리했다.
    wrap.innerHTML = `<div class="mt-kw-daily-title"><span class="mt-kw-daily-swatch"></span>"${escHtml(word)}" 일별 언급 횟수 — ${escHtml(monthKey)}</div>`;

    if (!counts.length) {
      wrap.innerHTML += `<p class="mt-kw-daily-empty">이 달에는 "${escHtml(word)}"가 언급된 날짜가 없습니다.</p>`;
      bodyEl().innerHTML = "";
      bodyEl().appendChild(wrap);
      return;
    }

    // Y축 — 그 달의 실제 최댓값(max)에 맞춰 0 / max÷2 / max 눈금을 매번 다시
    // 계산해서 넣는다("데이터 표본에 따라 Y축이 자체적으로 조정"). 이게 없으면
    // 하루이틀만 값이 있고 나머지가 전부 0인 달에서는 막대가 얼마나 되는지
    // 기준을 알 수 없어 거의 안 보이는 것처럼 느껴졌다.
    // 요청 — X축/Y축이 각각 무엇을 나타내는지 라벨을 붙임.
    const chartWrap = document.createElement("div");
    chartWrap.className = "mt-kw-daily-chart-wrap";
    const yAxis = document.createElement("div");
    yAxis.className = "mt-kw-daily-y";
    yAxis.innerHTML = `<span>${max.toLocaleString()}</span><span>${Math.round(max / 2).toLocaleString()}</span><span>0</span>`;
    const yAxisTitle = document.createElement("div");
    yAxisTitle.className = "mt-kw-daily-y-title";
    yAxisTitle.textContent = "언급 횟수";

    // 요청 — 막대 수가 적을 때 flex:1로 다 늘어나 막대가 너무 굵고 간격만
    // 벌어져 보이던 문제. 막대 폭/간격을 고정값으로 맞추고, 막대 수가 많아
    // 고정 폭 합이 넘칠 때만 이 스크롤 영역 안에서 가로 스크롤되게 한다
    // (Y축은 스크롤 밖에 고정).
    const scrollArea = document.createElement("div");
    scrollArea.className = "mt-kw-daily-scroll";
    const chart = document.createElement("div");
    chart.className = "mt-kw-daily-chart";
    const daysRow = document.createElement("div");
    daysRow.className = "mt-kw-daily-days";

    counts.forEach((c) => {
      const bar = document.createElement("div");
      bar.className = "mt-kw-daily-bar" + (c.count > 0 ? " has-count" : "");
      bar.title = `${c.date}: ${c.count}건`;
      const fill = document.createElement("div");
      fill.className = "mt-kw-daily-bar-fill";
      // 값이 있는 막대는 최소 8%는 확보해서(예전엔 4%라 값이 작을 때 거의
      // 안 보였음) 눈에 띄게 함 — 실제 값은 Y축과 title(hover)로 확인 가능.
      fill.style.height =
        c.count > 0
          ? Math.max(8, Math.round((c.count / max) * 100)) + "%"
          : "1px";
      bar.appendChild(fill);

      if (c.count > 0) {
        bar.addEventListener("mouseenter", () =>
          showMentioners(bar, c.date, word),
        );
        bar.addEventListener("mouseleave", hideTooltip);
      }
      chart.appendChild(bar);

      const dayLbl = document.createElement("div");
      dayLbl.className = "mt-kw-daily-day";
      dayLbl.textContent = c.day;
      daysRow.appendChild(dayLbl);
    });

    scrollArea.appendChild(chart);
    scrollArea.appendChild(daysRow);
    chartWrap.appendChild(yAxis);
    chartWrap.appendChild(scrollArea);
    wrap.appendChild(yAxisTitle);
    wrap.appendChild(chartWrap);
    const xAxisTitle = document.createElement("div");
    xAxisTitle.className = "mt-kw-daily-x-title";
    xAxisTitle.textContent = "날짜(언급 있는 날만 표시)";
    wrap.appendChild(xAxisTitle);
    bodyEl().innerHTML = "";
    bodyEl().appendChild(wrap);
  }

  async function showMentioners(anchorEl, date, word) {
    const cacheKey = `${date}|${word}`;
    if (mentionersCache[cacheKey]) {
      renderMentionersTooltip(anchorEl, mentionersCache[cacheKey]);
      return;
    }
    showTooltip(anchorEl, `<div class="mt-tooltip-row">불러오는 중...</div>`);
    try {
      const j = await postJSON(api.mentionersUrl, {
        [api.idField]: idValue,
        date,
        keyword: word,
      });
      const data = j.data || [];
      mentionersCache[cacheKey] = data;
      renderMentionersTooltip(anchorEl, data);
    } catch (e) {
      console.error("keyword-mentioners 오류:", e);
    }
  }

  function renderMentionersTooltip(anchorEl, data) {
    if (!data.length) {
      showTooltip(
        anchorEl,
        `<div class="mt-tooltip-row">이 날 언급한 사람이 없어요.</div>`,
      );
      return;
    }
    const html = data
      .map((p) => {
        const name = p.name || p.person_id || p.participant_id || "";
        const avatarHtml = p.avatar_url
          ? `<img src="${escHtml(p.avatar_url)}" alt="">`
          : escHtml((name || "?").slice(0, 1));
        return `<div class="mt-tooltip-row">
          <span class="mt-tooltip-avatar">${avatarHtml}</span>
          <span>${escHtml(name)} · ${p.count}회</span>
        </div>`;
      })
      .join("");
    showTooltip(anchorEl, html);
  }

  // createTimeline의 notifyPeriod가 호출해주는 진입점 — mode는 'month'|'year'.
  function setPeriod(mode, key) {
    if (!idValue) return;
    if (mode === "year") {
      currentYear = key;
      currentMonthKey = null;
    } else {
      currentMonthKey = key;
      currentYear = null;
    }
    updateTitle(mode, key);
    renderList();
  }

  if (backBtnEl()) {
    backBtnEl().addEventListener("click", () => renderList());
  }

  return { init, setPeriod };
}

/* ══════════════════════ 메일 뷰 ══════════════════════ */
const mailKwPanel = createKeywordPanel(
  { body: "mtKwBody", hint: "mtKwHint", backBtn: "mtKwBackBtn", title: "mtKwTitle" },
  {
    monthlyUrl: "/mail-keyword-monthly-stats",
    dailyUrl: "/mail-keyword-daily-stats",
    mentionersUrl: "/mail-keyword-mentioners",
    idField: "user_id",
  },
);

// 주요 연락처 hover 설명 — 새 API 없이, 이미 있는 /person-descriptions(메일 계정
// 기준 사람 설명)를 계정이 바뀔 때마다 한 번씩 받아서 캐시해두고 동기로 조회한다.
let mailDescCache = [];
async function loadMailDescriptions(gmailId) {
  mailDescCache = [];
  if (!gmailId) return;
  try {
    const j = await postJSON("/person-descriptions", { user_id: gmailId });
    mailDescCache = j.data || [];
  } catch (e) {
    console.error("person-descriptions 오류:", e);
  }
}
function mailContactLookup(contactId) {
  const found = mailDescCache.find(
    (d) =>
      (d.person_account_id || "").toLowerCase() ===
      String(contactId).toLowerCase(),
  );
  return found ? found.description : null;
}

const mailTimeline = createTimeline({
  track: "track",
  panel: "infoPanel",
  panelPeriod: "panelPeriod",
  panelCount: "panelCount",
  panelSummary: "panelSummary",
  panelContacts: "panelContacts",
  pointerTrack: "pointerTrack",
  pointerWindow: "pointerWindow",
  pointerCursor: "pointerCursor",
  pointerAxis: "pointerAxis",
  rangeLbl: "mtPointerRangeLbl",
  channel: "mail",
  onPeriod: (mode, key) => mailKwPanel.setPeriod(mode, key),
  contactLookup: mailContactLookup,
});

// 계정이 바뀔 때(사이드바에서 다른 메일 계정 선택) 새로고침 없이 다시 부를 수
// 있도록 이름 있는 함수로 뺐다 — 원래는 즉시실행 IIFE라 페이지 로드 시 딱 한 번만
// 돌고 끝이라, 계정을 바꿔도 다시 그릴 방법이 없어서 새로고침에 의존했었다.
async function initMail(gmailId) {
  async function fetchSummaries(type) {
    try {
      const j = await postJSON("/mail-summaries", { user_id: gmailId, type });
      return j[type] || {};
    } catch (e) {
      console.error(`mail-summaries(${type}) 오류:`, e);
      return {};
    }
  }

  const [MONTH_DATA, YEAR_DATA] = await Promise.all([
    fetchSummaries("monthly"),
    fetchSummaries("yearly"),
  ]);
  // mailTimeline.setData()가 끝나자마자 가장 최근 달을 오른쪽 키워드 창에
  // 자동으로 띄우므로(notifyPeriod), 그보다 먼저 키워드/연락처-설명 데이터를
  // 받아둬야 한다 — 순서가 바뀌면 오른쪽 창이 빈 상태로 멈춰 있는다.
  await Promise.all([mailKwPanel.init(gmailId), loadMailDescriptions(gmailId)]);
  mailTimeline.setData(
    MONTH_DATA,
    YEAR_DATA,
    "아직 생성된 요약이 없습니다. 데이터 분석하기를 먼저 실행해주세요.",
  );

  async function initSelfAvatar() {
    if (!gmailId) return;
    // "My" 프로필 박스는 없앴지만, 전체 타임라인 위를 이동하는 작은 "나" 커서
    // 아이콘(pointerCursor/msgPointerCursor)에는 계속 내 아바타를 써준다.
    const applyAvatar = (url) => {
      if (!url) return;
      const cursorEl = document.getElementById("pointerCursor");
      const msgCursorEl = document.getElementById("msgPointerCursor");
      if (cursorEl) cursorEl.innerHTML = `<img src="${url}" alt="나">`;
      if (msgCursorEl) msgCursorEl.innerHTML = `<img src="${url}" alt="나">`;
    };
    try {
      const cache = await postJSON("/self-avatar", { user_id: gmailId });
      if (cache.url) {
        applyAvatar(cache.url);
        return;
      }
      const myName = sessionStorage.getItem("gw_user_name") || "나";
      const gen = await postJSON("/generate-self-avatar", {
        user_id: gmailId,
        name: myName,
      });
      if (gen.url) applyAvatar(gen.url);
    } catch (e) {
      console.error("내 아바타 로드 오류:", e);
    }
  }
  initSelfAvatar();
}

userIdPromise.then((gmailId) => initMail(gmailId || ""));

/* ══════════════════════ 메신저 뷰 ══════════════════════ */
const msgKwPanel = createKeywordPanel(
  { body: "msgKwBody", hint: "msgKwHint", backBtn: "msgKwBackBtn", title: "msgKwTitle" },
  {
    monthlyUrl: "/chatroom-keyword-monthly-stats",
    dailyUrl: "/chatroom-keyword-daily-stats",
    mentionersUrl: "/chatroom-keyword-mentioners",
    idField: "chatroom_id",
  },
);

// 주요 연락처 hover 설명 — 메신저는 새 API 없이 이미 있는 /chatroom-people(참여자
// 전체 목록 + description)을 채팅방이 바뀔 때마다 한 번씩 받아서 캐시해두고
// 동기로 조회한다. 참여자 id는 이메일이 아니라 이름이라 대소문자 없이 그대로 비교.
let msgPeopleCache = [];
async function loadMsgPeople(chatroomId) {
  msgPeopleCache = [];
  if (!chatroomId) return;
  try {
    const j = await postJSON("/chatroom-people", { chatroom_id: chatroomId });
    msgPeopleCache = (j.data && j.data.people) || [];
  } catch (e) {
    console.error("chatroom-people 오류:", e);
  }
}
function msgContactLookup(contactId) {
  const found = msgPeopleCache.find(
    (p) => p.participant_id === contactId || p.name === contactId,
  );
  return found ? found.description : null;
}

const msgTimeline = createTimeline({
  track: "msgTrack",
  panel: "msgInfoPanel",
  panelPeriod: "msgPanelPeriod",
  panelCount: null,
  panelSummary: "msgPanelSummary",
  panelContacts: "msgPanelContacts",
  pointerTrack: "msgPointerTrack",
  pointerWindow: "msgPointerWindow",
  pointerCursor: "msgPointerCursor",
  pointerAxis: "msgPointerAxis",
  rangeLbl: "msgPointerRangeLbl",
  channel: "messenger",
  onPeriod: (mode, key) => msgKwPanel.setPeriod(mode, key),
  contactLookup: msgContactLookup,
});

function summariesToMap(summaries) {
  const map = {};
  (summaries || []).forEach((s) => {
    map[s.summary_period] = {
      summary: s.summarized_context,
      contacts: s.contacts || [],
      image_url: s.image_url || null,
    };
  });
  return map;
}

async function fetchChatroomSummaries(chatroomId, unit) {
  const j = await postJSON("/chatroom-summaries", {
    chatroom_id: chatroomId,
    summarize_unit: unit,
  });
  return summariesToMap(j.data.summaries);
}

async function loadMtMessengerData() {
  const chatroomId = currentChatroomId || (await chatroomIdPromise) || "";
  if (!chatroomId) {
    await msgKwPanel.init("");
    return msgTimeline.setData(
      {},
      {},
      "연결된 채팅방이 없습니다. 채팅방을 먼저 선택해주세요.",
    );
  }
  try {
    const [monthData, yearData] = await Promise.all([
      fetchChatroomSummaries(chatroomId, "monthly"),
      fetchChatroomSummaries(chatroomId, "yearly"),
    ]);
    // mailTimeline과 마찬가지로, setData가 부르는 notifyPeriod보다 먼저 오른쪽
    // 키워드 창/연락처 설명 데이터를 받아둬야 한다.
    await Promise.all([
      msgKwPanel.init(chatroomId),
      loadMsgPeople(chatroomId),
    ]);
    return msgTimeline.setData(
      monthData,
      yearData,
      "아직 생성된 메신저 요약이 없습니다.",
    );
  } catch (e) {
    console.error("chatroom-summaries 오류:", e);
    await msgKwPanel.init("");
    return msgTimeline.setData(
      {},
      {},
      "메신저 요약을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
    );
  }
}

/* ── 메일 / 메신저 채널 전환 ──
   예전엔 페이지에 있는 메일/메신저 버튼을 눌러야 전환됐는데, 이제 계정·방
   선택은 사이드바가 전담하므로 버튼은 없앴다 — 사이드바에서 메일 계정을
   고르면 자동으로 이 뷰가 뜨고, 메신저 방을 고르면 저 뷰가 뜬다(아래
   DOMContentLoaded의 initGlobalFilter 콜백에서 setMtChannel을 직접 호출). */
const mtMailView = document.getElementById("mt-mail-view");
const mtMessengerView = document.getElementById("mt-messenger-view");
let mtMessengerLoaded = false;
let mtActiveChannel = "mail";

// My People 옆 사람 명수 뱃지처럼, My Time 제목 옆에도 전체 기간 뱃지를
// 하나만 둔다(메일/메신저 뷰가 따로 있어도 제목은 하나뿐이므로). 지금 보고
// 있는 채널의 타임라인이 갖고 있는 기간 텍스트로 채운다.
function updateSharedRangeBadge(text) {
  const el = document.getElementById("mtDataRangeLbl");
  if (el) el.textContent = text || "";
}

function setMtChannel(channel) {
  mtActiveChannel = channel;
  const isMail = channel === "mail";
  mtMailView.style.display = isMail ? "" : "none";
  mtMessengerView.style.display = isMail ? "none" : "";
  const active = isMail ? mailTimeline : msgTimeline;
  updateSharedRangeBadge(active.getRangeText());
}
