import { bootstrapApp } from "../main-app.js";
import { initAccountPicker } from "../features/accountPicker.js";
import "../scss/pages/mytime.scss";

bootstrapApp("mytime");

const userIdPromise = initAccountPicker(
  document.getElementById("account-picker-mount"),
);

/* 메신저 뷰용 채팅방 선택 토글 — accountPicker.js를 domain:"messenger"로 그대로 재사용.
   선택값은 storageKey("gw_chatroom_id")로 localStorage에 저장됨. */
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

/* ── 타임라인 트랙 + 요약 패널 + 전체 타임라인 포인터를 한 세트로 다루는 컨트롤러.
   메일 뷰와 메신저 뷰가 DOM id만 다르고 동작은 완전히 같아서, id 묶음(ids)을
   받아 그 안에서만 동작하도록 만들어 두 뷰에서 그대로 재사용한다. ── */
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
  const WIN = { month: 8, year: 5 };

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
      cc.appendChild(el);
    });

    document.getElementById(ids.panel).classList.add("show");
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
      pointerTrack.insertBefore(
        pm,
        document.getElementById(ids.pointerWindow),
      );
    });

    // 시작~끝 날짜 표시 — My People 타임슬라이더의 날짜 pill과 동일한 형식(YYYY.MM)
    const fmtYm = (k) => `${k.slice(0, 4)}.${k.slice(5)}`;
    const startLbl = document.getElementById(ids.startLbl);
    const endLbl = document.getElementById(ids.endLbl);
    if (startLbl) startLbl.textContent = fmtYm(ALL_KEYS[0]);
    if (endLbl) endLbl.textContent = fmtYm(ALL_KEYS[ALL_KEYS.length - 1]);

    const axis = document.getElementById(ids.pointerAxis);
    axis.innerHTML = "";

    // My People 타임슬라이더와 동일하게, 라벨 사이 실제 픽셀 간격이
    // MIN_GAP_PX보다 좁으면 뒤 라벨을 건너뛴다(끝 라벨은 항상 유지).
    const MIN_GAP_PX = 64;
    const axisWidth = axis.offsetWidth || axis.getBoundingClientRect().width || 0;
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

  /* 데이터가 준비된 뒤 호출 — monthData/yearData는 {"YYYY-MM"|"YYYY": {summary, contacts, count?, threads?}} 형태 */
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
    return true;
  }

  function setMode(m) {
    mode = m;
    centerIdx = mode === "month" ? Math.min(3, ALL_KEYS.length - 1) : 0;
    render();
    updatePointerCursor();
  }

  return { setData, setMode };
}

/* ══════════════════════ 메일 뷰 ══════════════════════ */
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
  startLbl: "mtPointerStartLbl",
  endLbl: "mtPointerEndLbl",
});

(async function initMail() {
  const gmailId = (await userIdPromise) || "";

  async function fetchSummaries(type) {
    try {
      const j = await postJSON("/mail-summaries", { user_id: gmailId, type });
      return j[type] || {};
    } catch (e) {
      console.error(`mail-summaries(${type}) 오류:`, e);
      return {};
    }
  }

  const MONTH_DATA = await fetchSummaries("monthly");
  const YEAR_DATA = await fetchSummaries("yearly");
  mailTimeline.setData(
    MONTH_DATA,
    YEAR_DATA,
    "아직 생성된 요약이 없습니다. 데이터 업로드를 먼저 실행해주세요.",
  );

  /* ── "나" 아바타: My People과 동일하게 캐시 우선 조회 후 없으면 생성.
     타임슬라이더 커서와 우측 사이드바 프로필, 두 군데에 동시에 채워 넣는다. ── */
  async function initSelfAvatar() {
    if (!gmailId) return;
    const applyAvatar = (url) => {
      if (!url) return;
      const cursorEl = document.getElementById("pointerCursor");
      const msgCursorEl = document.getElementById("msgPointerCursor");
      const sideEl = document.getElementById("mtSideAvatar");
      const msgSideEl = document.getElementById("msgSideAvatar");
      if (cursorEl) cursorEl.innerHTML = `<img src="${url}" alt="나">`;
      if (msgCursorEl) msgCursorEl.innerHTML = `<img src="${url}" alt="나">`;
      if (sideEl) sideEl.innerHTML = `<img src="${url}" alt="나">`;
      if (msgSideEl) msgSideEl.innerHTML = `<img src="${url}" alt="나">`;
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
})();

/* ── 왼쪽 4:3 이미지 박스에 실제 이미지 삽입 ──
   TODO: 시간 클릭 시 이미지 생성 API가 준비되면 그 결과 url로 이 함수를 호출 */
function setSideImage(url) {
  const box = document.getElementById("mtSideImageBox");
  if (box && url) box.innerHTML = `<img src="${url}" alt="">`;
}

/* ── 메신저 뷰 왼쪽 네컷이미지 박스에 실제 이미지 삽입 ──
   TODO: 단톡방 네컷이미지 생성/조회 API가 준비되면 그 결과 url로 이 함수를 호출 */
function setMsgSideImage(url) {
  const box = document.getElementById("msgSideImageBox");
  if (box && url) box.innerHTML = `<img src="${url}" alt="">`;
}

/* ══════════════════════ 메신저 뷰 ══════════════════════
   /chatroom-summaries(월별/연별)를 메일 뷰와 동일한 타임라인 컨트롤러에 꽂아 씀.
   chatroom_id는 위에서 만든 채팅방 토글(chatroomIdPromise/currentChatroomId)에서 가져온다. */
const msgTimeline = createTimeline({
  track: "msgTrack",
  panel: "msgInfoPanel",
  panelPeriod: "msgPanelPeriod",
  panelCount: null, // 메신저 요약엔 count/threads가 없음
  panelSummary: "msgPanelSummary",
  panelContacts: "msgPanelContacts",
  pointerTrack: "msgPointerTrack",
  pointerWindow: "msgPointerWindow",
  pointerCursor: "msgPointerCursor",
  pointerAxis: "msgPointerAxis",
  startLbl: "msgPointerStartLbl",
  endLbl: "msgPointerEndLbl",
});

/* /chatroom-summaries 응답의 summaries 배열을
   { "YYYY-MM": { summary, contacts } } 형태로 변환 */
function summariesToMap(summaries) {
  const map = {};
  (summaries || []).forEach((s) => {
    map[s.summary_period] = {
      summary: s.summarized_context,
      contacts: s.contacts || [],
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
    return msgTimeline.setData(
      monthData,
      yearData,
      "아직 생성된 메신저 요약이 없습니다.",
    );
  } catch (e) {
    console.error("chatroom-summaries 오류:", e);
    return msgTimeline.setData(
      {},
      {},
      "메신저 요약을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
    );
  }
}

/* ── 메일 / 메신저 채널 토글 ──
 * 기본값은 메일 뷰(mt-mail-view). 메신저 버튼을 처음 누르는 순간에만
 * loadMtMessengerData()가 /chatroom-summaries를 불러와 msgTimeline에 채움.
 * 이후엔 채워진 뷰를 토글만 함. 상단 월별/연별 버튼은 현재 보이는 뷰의
 * 타임라인 컨트롤러에 그대로 적용된다.
 */
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
  // 계정 토글 ↔ 채팅방 토글도 뷰에 맞춰 같이 전환
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

/* ── 상단 월별/연별 토글: 현재 보이는 뷰의 타임라인에 적용 ── */
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
