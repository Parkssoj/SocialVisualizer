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
      initMail(filterState.mail);
    } else if (filterState.room) {
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
function showTooltip(anchorEl, html) {
  const t = ensureTooltip();
  t.innerHTML = html;
  const rect = anchorEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - 280, rect.left));
  t.style.left = `${left}px`;
  t.style.top = `${rect.top - 8}px`;
  t.style.transform = "translateY(-100%)";
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
  // 상단 타임슬라이더 — 월별 모드일 때 한 화면에 12개(1년치)를 보여줘서 "달"을
  // 나타내는 슬라이더가 되도록 함(예전엔 8개 슬라이딩 윈도우).
  const WIN = { month: 12, year: 5 };

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
  function getWindowKeys() {
    const keys = mode === "month" ? ALL_KEYS : YEAR_KEYS;
    const win = WIN[mode];
    let start = Math.max(0, centerIdx - Math.floor(win / 2));
    start = Math.min(start, keys.length - win);
    start = Math.max(0, start);
    return keys.slice(start, start + win);
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
      lbl.textContent =
        mode === "month" ? `${k.slice(0, 4)}.${k.slice(5)}` : `${k}년`;

      const cnt = document.createElement("div");
      cnt.className = "mt-node-count";
      cnt.textContent = d.count ? `${d.count.toLocaleString()}건` : "";

      col.appendChild(dot);
      col.appendChild(lbl);
      col.appendChild(cnt);
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
          pinnedKey = k;
          track
            .querySelectorAll(".mt-node-col")
            .forEach((c) => c.classList.remove("pinned"));
          col.classList.add("pinned");
          showPanel(col, k, d);
          document.getElementById(ids.panel).classList.add("pinned");
          centerIdx = (mode === "month" ? ALL_KEYS : YEAR_KEYS).indexOf(k);
          updatePointerCursor();
          notifyPeriod(k);
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
          showTooltip(el, desc ? escHtml(desc) : "등록된 설명이 없습니다.");
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

  function buildPointer() {
    const pointerTrack = document.getElementById(ids.pointerTrack);
    pointerTrack.querySelectorAll(".mt-pm").forEach((el) => el.remove());

    ALL_KEYS.forEach((k, idx) => {
      const pm = document.createElement("div");
      pm.className = "mt-pm";
      pm.style.left = `${monthToPct(k) * 100}%`;
      pm.addEventListener("click", (e) => {
        e.stopPropagation();
        centerIdx =
          mode === "month"
            ? idx
            : Math.floor(idx / (ALL_KEYS.length / YEAR_KEYS.length));
        centerIdx = Math.max(
          0,
          Math.min(
            (mode === "month" ? ALL_KEYS : YEAR_KEYS).length - 1,
            centerIdx,
          ),
        );
        updatePointerCursor();
        render();
      });
      pointerTrack.insertBefore(pm, document.getElementById(ids.pointerWindow));
    });

    // 시작~끝 날짜를 양 끝에 따로 두지 않고 한 줄로 합쳐서 트랙 위 가운데에 표시.
    const fmtYm = (k) => `${k.slice(0, 4)}.${k.slice(5)}`;
    const rangeLbl = document.getElementById(ids.rangeLbl);
    if (rangeLbl) {
      rangeLbl.textContent =
        ALL_KEYS.length > 1
          ? `${fmtYm(ALL_KEYS[0])} ~ ${fmtYm(ALL_KEYS[ALL_KEYS.length - 1])} 데이터`
          : `${fmtYm(ALL_KEYS[0])} 데이터`;
    }

    const axis = document.getElementById(ids.pointerAxis);
    axis.innerHTML = "";

    const MIN_GAP_PX = 64;
    const axisWidth =
      axis.offsetWidth || axis.getBoundingClientRect().width || 0;
    const withPct = YEAR_KEYS.map((y) => ({
      y,
      pct: Math.max(0, Math.min(98, yearToPct(y) * 100)),
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

  function updatePointerCursor() {
    const keys = mode === "month" ? ALL_KEYS : YEAR_KEYS;
    const k = keys[Math.max(0, Math.min(keys.length - 1, centerIdx))];
    const pct = mode === "month" ? monthToPct(k) * 100 : yearToPct(k) * 100;
    document.getElementById(ids.pointerCursor).style.left =
      Math.max(0, Math.min(100, pct)) + "%";
  }

  function updatePointerWindow() {
    const wKeys = getWindowKeys();
    if (!wKeys.length) return;
    const s = mode === "month" ? monthToPct(wKeys[0]) : yearToPct(wKeys[0]);
    const e =
      mode === "month"
        ? monthToPct(wKeys[wKeys.length - 1])
        : yearToPct(wKeys[wKeys.length - 1]) + 12 / TOTAL;
    const win = document.getElementById(ids.pointerWindow);
    win.style.left = `${Math.max(0, s * 100)}%`;
    win.style.width = `${Math.min(100, (e - s) * 100)}%`;
  }

  document.getElementById(ids.pointerTrack).addEventListener("click", (e) => {
    if (e.target.classList.contains("mt-pm")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const totalIdx = Math.round(pct * ALL_KEYS.length);
    if (mode === "month") {
      centerIdx = Math.max(0, Math.min(ALL_KEYS.length - 1, totalIdx));
    } else {
      centerIdx = Math.max(
        0,
        Math.min(
          YEAR_KEYS.length - 1,
          Math.floor(totalIdx / (ALL_KEYS.length / YEAR_KEYS.length)),
        ),
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
    renderYearStrip();
    // 페이지를 처음 열었을 때(아직 아무 기간도 클릭 안 한 상태)도 오른쪽 키워드
    // 창이 비어있지 않도록, 가장 최근 달을 기본 기간으로 알려준다.
    notifyPeriod(ALL_KEYS[ALL_KEYS.length - 1]);
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

  return { setData, setMode };
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
    const counts = [];
    for (let d = 1; d <= total; d++) {
      const dateKey = `${monthKey}-${String(d).padStart(2, "0")}`;
      const found = (dayData[dateKey] || []).find((x) => x.word === word);
      counts.push({ date: dateKey, day: d, count: found ? found.count : 0 });
    }
    const max = Math.max(1, ...counts.map((c) => c.count));

    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="mt-kw-daily-title">"${escHtml(word)}" 일별 언급 횟수 — ${escHtml(monthKey)}</div>`;
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
      fill.style.height =
        c.count > 0
          ? Math.max(4, Math.round((c.count / max) * 100)) + "%"
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

    wrap.appendChild(chart);
    wrap.appendChild(daysRow);
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
    renderList();
  }

  if (backBtnEl()) {
    backBtnEl().addEventListener("click", () => renderList());
  }

  return { init, setPeriod };
}

/* ══════════════════════ 메일 뷰 ══════════════════════ */
const mailKwPanel = createKeywordPanel(
  { body: "mtKwBody", hint: "mtKwHint", backBtn: "mtKwBackBtn" },
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
  { body: "msgKwBody", hint: "msgKwHint", backBtn: "msgKwBackBtn" },
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

/* ── 메일 / 메신저 채널 토글 ── */
const mtMailBtn = document.getElementById("mt-mail-btn");
const mtMessengerBtn = document.getElementById("mt-messenger-btn");
const mtMailView = document.getElementById("mt-mail-view");
const mtMessengerView = document.getElementById("mt-messenger-view");
const accountPickerMount = document.getElementById("account-picker-mount");
const chatroomPickerMount = document.getElementById("chatroom-picker-mount");
let mtMessengerLoaded = false;
let mtActiveChannel = "mail";

function setMtChannel(channel) {
  mtActiveChannel = channel;
  const isMail = channel === "mail";
  mtMailBtn.classList.toggle("active", isMail);
  mtMessengerBtn.classList.toggle("active", !isMail);
  mtMailView.style.display = isMail ? "" : "none";
  mtMessengerView.style.display = isMail ? "none" : "";
  accountPickerMount.style.display = isMail ? "" : "none";
  chatroomPickerMount.style.display = isMail ? "none" : "";
}

mtMailBtn.addEventListener("click", () => setMtChannel("mail"));
mtMessengerBtn.addEventListener("click", async () => {
  setMtChannel("messenger");
  if (!mtMessengerLoaded) {
    mtMessengerLoaded = true;
    await loadMtMessengerData();
  }
});

/* ── 상단 월별/연별 토글 ── */
document.querySelectorAll(".mt-mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".mt-mode-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const timeline = mtActiveChannel === "mail" ? mailTimeline : msgTimeline;
    timeline.setMode(btn.dataset.mode);
  });
});
