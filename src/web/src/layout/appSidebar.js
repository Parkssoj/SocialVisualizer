import { store } from "../store/globalStore.js";

// 완전히 새로 그린 사이드바(디자인/클래스 전부 새로 작성 — 예전 클래스명과 절대
// 안 겹치도록 "gws-" 접두사 사용. 예전엔 이름이 흔한 .sidebar-header 같은 걸 써서
// custom.scss의 레거시 관리자 템플릿 규칙(.sidebar-header { margin-top: 46px })이
// 몰래 얹혀서 이상하게 밀려 보였음 — 새 접두사로 그 충돌 자체를 원천 차단.
export function renderAppSidebar(containerId = "app-sidebar") {
  const container = document.getElementById(containerId);
  if (!container) return;

  // My People / My Time / Recap 세 페이지 모두 "처음 열 때는 항상 펼쳐진 상태"로
  // 시작해야 한다는 요구사항 — 예전엔 localStorage에 저장된 접힘 상태를 그대로
  // 복원해서, 이전에 접어놨으면 페이지를 새로 열 때마다 접힌 채로 시작했었다.
  // 페이지 로드 시점의 초기 상태는 항상 펼침(false)으로 고정하고, localStorage는
  // 같은 세션 안에서 사용자가 토글 버튼을 눌렀을 때만 참고용으로 갱신한다.
  const isCollapsed = false;

  container.classList.toggle("is-collapsed", isCollapsed);

  container.innerHTML = `
    <aside id="sidebar" class="gws-rail ${isCollapsed ? "is-collapsed" : ""}">
      <div class="gws-rail-inner">
        <div class="gws-rail-top">
          <button type="button" id="sidebar-toggle-btn" class="gws-collapse-btn" title="사이드바 접기/펼치기">
            <i class="bi bi-chevron-left"></i>
          </button>
        </div>

        <!-- "메일 계정 선택" 위에 붙는 전체 섹션 제목 -->
        <div class="gws-panel-title">데이터 선택</div>

        <nav class="gws-group">
          <div class="gws-group-label"><i class="bi bi-envelope"></i><span>메일 계정 선택</span></div>
          <ul class="gws-list" id="sidebar-mail-list"></ul>
        </nav>

        <nav class="gws-group">
          <div class="gws-group-label"><i class="bi bi-chat-dots"></i><span>메신저 데이터 선택</span></div>
          <ul class="gws-list" id="sidebar-msg-list"></ul>
        </nav>
      </div>
    </aside>
    <!-- 그림자를 오른쪽에만 — .gws-rail 자체의 box-shadow는 블러가 위/아래로도
         번져서 헤더(top:60px 바로 위)와 사이드바가 잘려 보이는 문제가 있었다.
         블러 없는 얇은 그라디언트 띠를 별도 엘리먼트로 둬서, 사이드바 높이와
         정확히 같은 범위(top:60px~bottom:0)에만 그림자가 지도록 함. -->
    <div class="gws-rail-shadow" aria-hidden="true"></div>
  `;

  const sidebarEl = document.getElementById("sidebar");
  const toggleBtn = document.getElementById("sidebar-toggle-btn");

  // 사이드바 너비를 CSS 변수(--gw-sidebar-w)로 노출해서, 오른쪽 페이지가 어떤
  // 구조든(position:fixed인 .mp-page, 일반 흐름인 .right_col 등) 이 변수 하나만
  // 보고 자기 폭/패딩을 늘리고 줄이게 한다.
  const SIDEBAR_W = { expanded: "288px", collapsed: "84px" };
  const updateMainLayout = (collapsed) => {
    document.documentElement.style.setProperty(
      "--gw-sidebar-w",
      collapsed ? SIDEBAR_W.collapsed : SIDEBAR_W.expanded,
    );
  };

  updateMainLayout(isCollapsed);

  toggleBtn.onclick = () => {
    const collapsed = sidebarEl.classList.toggle("is-collapsed");
    container.classList.toggle("is-collapsed", collapsed);
    localStorage.setItem("gw_sidebar_collapsed", collapsed);
    updateMainLayout(collapsed);
  };

  refreshSidebarList();
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(str) {
  return String(str || "")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function refreshSidebarList() {
  const mailListEl = document.getElementById("sidebar-mail-list");
  const msgListEl = document.getElementById("sidebar-msg-list");
  if (!mailListEl || !msgListEl) return;

  // store.getCollectedLists()의 mails/rooms는 각각 {id, label, indexed} 형태.
  // (id: 실제 값으로 쓰이는 user_id/chatroom_id, label: 화면에 보여줄 이름 —
  // 메일은 id와 동일, 메신저는 /messenger-chatrooms가 서버에서 이미 resolve해준
  // 실제 대화방 이름)
  const { mails = [], rooms = [] } = store.getCollectedLists() || {};
  let { mail: currentMail, room: currentRoom } = store.getFilterState() || {};

  // 저장된 선택값이 전혀 없으면 가장 최근(첫 번째) 메일을 기본값으로 지정
  if (!currentMail && !currentRoom && mails.length > 0) {
    currentMail = mails[0].id;
    currentRoom = null;
    store.setFilter("room", null);
    store.setFilter("mail", currentMail);
  }

  mailListEl.innerHTML =
    mails.length === 0
      ? `<li class="gws-empty"><i class="bi bi-inbox"></i><span>수집된 메일 계정 없음</span></li>`
      : mails
          .map((m) => {
            const isActive = !currentRoom && m.id === currentMail;
            const badge =
              m.indexed === false
                ? `<span class="gws-item-badge">인덱싱 중</span>`
                : "";
            return `
              <li class="gws-item ${isActive ? "is-active" : ""}" data-type="mail" data-value="${escapeAttr(m.id)}" title="${escapeAttr(m.label)}">
                <span class="gws-item-icon"><i class="bi bi-envelope-fill"></i></span>
                <span class="gws-item-text">${escapeHtml(m.label)}</span>
                ${badge}
              </li>`;
          })
          .join("");

  msgListEl.innerHTML =
    rooms.length === 0
      ? `<li class="gws-empty"><i class="bi bi-inbox"></i><span>수집된 메신저 데이터 없음</span></li>`
      : rooms
          .map((r) => {
            const isActive = !currentMail && r.id === currentRoom;
            return `
              <li class="gws-item ${isActive ? "is-active" : ""}" data-type="room" data-value="${escapeAttr(r.id)}" title="${escapeAttr(r.label)}">
                <span class="gws-item-icon"><i class="bi bi-chat-dots-fill"></i></span>
                <span class="gws-item-text">${escapeHtml(r.label)}</span>
              </li>`;
          })
          .join("");

  if (currentMail && !currentRoom) {
    syncViewButton("mail");
  } else if (currentRoom && !currentMail) {
    syncViewButton("room");
  }

  bindSidebarEvents();
}

// 메인 페이지의 메일/메신저 전환 버튼을 자동 동기화하는 함수
function syncViewButton(targetType) {
  if (targetType === "mail") {
    const mailBtn =
      document.getElementById("mp-mail-btn") ||
      document.getElementById("mt-mail-btn");
    if (mailBtn && !mailBtn.classList.contains("active")) {
      mailBtn.click();
    }
  } else if (targetType === "room") {
    const msgBtn =
      document.getElementById("mp-messenger-btn") ||
      document.getElementById("mt-messenger-btn");
    if (msgBtn && !msgBtn.classList.contains("active")) {
      msgBtn.click();
    }
  }
}

function bindSidebarEvents() {
  document.querySelectorAll(".gws-item").forEach((item) => {
    item.onclick = () => {
      const type = item.getAttribute("data-type");
      const value = item.getAttribute("data-value");

      if (type === "mail") {
        store.setFilter("room", null);
        store.setFilter("mail", value);
      } else if (type === "room") {
        store.setFilter("mail", null);
        store.setFilter("room", value);
      }

      refreshSidebarList();
    };
  });
}
