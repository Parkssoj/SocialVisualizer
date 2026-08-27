// src/utils/filterSync.js
import { renderAppSidebar, refreshSidebarList } from "../layout/appSidebar.js";
import { store } from "../store/globalStore.js";

let indexingPollTimer = null;

// 아직 인덱싱이 끝나지 않은 계정이 있으면 주기적으로 목록을 다시 불러와서
// "(생성 중)" 배지가 실제 인덱싱 완료 시점에 맞춰 사라지게 한다(페이지를
// 새로고침해야만 갱신되던 걸 비동기로 고침). 전부 인덱싱 완료되면 폴링을 멈춘다.
function scheduleIndexingPoll() {
  if (indexingPollTimer) return;
  const { mails = [] } = store.getCollectedLists() || {};
  if (!mails.some((m) => !m.indexed)) return;
  indexingPollTimer = setInterval(async () => {
    await store.fetchCollectedLists();
    const { mails: refreshed = [] } = store.getCollectedLists() || {};
    if (!refreshed.some((m) => !m.indexed)) {
      clearInterval(indexingPollTimer);
      indexingPollTimer = null;
    }
  }, 8000);
}

export async function initGlobalFilter(onFilterChangeCallback) {
  // 1. 공통 사이드바 HTML 렌더링
  renderAppSidebar("app-sidebar");

  // 2. 스토어 상태 변경 감지 — refreshSidebarList()보다 먼저 등록해야 한다.
  // 예전엔 이 리스너를 refreshSidebarList() 호출 "뒤"에 등록했는데, 페이지를
  // 처음 열 때 저장된 선택값이 유효하지 않아서 refreshSidebarList() 안에서
  // 기본값을 고르며 store.setFilter(...)를 부르면 그 즉시 gwStoreStateChanged가
  // 발생한다 — 근데 리스너가 아직 안 붙어있으니 그 이벤트를 통째로 놓쳤다.
  // 그러면 페이지는 (아래 4번의) { isInitial: true } 콜백만 받는데, My
  // People/My Time/Recap은 그 호출을 무시하도록 짜여있어서 결국 "지금 사이드바가
  // 실제로 뭘 선택하고 있는지" 페이지가 끝까지 못 받는 경우가 생겼다 — 그 상태에서
  // 각 페이지가 갖고 있던 별도의 userIdPromise(메일 전용, 채널 구분 없이 항상 메일
  // 데이터를 불러옴)만 살아남아 렌더링을 주도하니, "메신저를 선택했는데 메일이
  // 뜬다" 같은 게 순전히 두 비동기 흐름 중 뭐가 먼저 끝나느냐(타이밍)에 달려있었다.
  // 리스너를 먼저 등록해두면 이 초기 이벤트도 절대 안 놓친다.
  window.addEventListener("gwStoreStateChanged", (e) => {
    refreshSidebarList();
    onFilterChangeCallback(e.detail, { isInitial: false });
  });

  // 3. 백엔드 DB에서 수집 목록 가져오기 후 사이드바 갱신
  await store.fetchCollectedLists();
  refreshSidebarList();
  scheduleIndexingPoll();

  // 4. 지금 사이드바가 실제로 선택하고 있는 상태를 페이지에 무조건 한 번 더
  // 알려준다. 위 3번의 refreshSidebarList()가 (저장된 선택값이 이미 유효해서)
  // store.setFilter를 다시 안 부른 경우엔 2번 리스너도 안 울렸을 것이므로, 이
  // 호출이 페이지가 받는 유일한 신호가 된다. isInitial:false로 보내서 페이지가
  // 무조건 반영하게 한다 — 사이드바 상태가 유일한 진실 공급원이라 "처음 vs 나중"을
  // 구분할 이유가 이제 없다(반영 로직은 멱등이라 3번 이벤트와 겹쳐 두 번 불려도
  // 안전함).
  onFilterChangeCallback(store.getFilterState(), { isInitial: false });
}
