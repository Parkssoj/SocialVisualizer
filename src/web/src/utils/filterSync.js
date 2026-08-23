// src/utils/filterSync.js
import { renderAppSidebar, refreshSidebarList } from "../layout/appSidebar.js";
import { store } from "../store/globalStore.js";

export async function initGlobalFilter(onFilterChangeCallback) {
  // 1. 공통 사이드바 HTML 렌더링
  renderAppSidebar("app-sidebar");

  // 2. 백엔드 DB에서 수집 목록 가져오기 후 사이드바 갱신
  await store.fetchCollectedLists();
  refreshSidebarList();

  // 3. 초기 필터 상태 전달 — { isInitial: true }로 "페이지가 막 열려서 처음
  // 알려주는 값"과 "사용자가 실제로 사이드바/토글에서 선택을 바꿔서 알려주는 값"을
  // 콜백 쪽에서 구분할 수 있게 한다. (My People/My Time/Recap은 이미
  // userIdPromise/chatroomIdPromise로 페이지를 처음부터 그리므로, 초기 호출까지
  // 또 반응하면 안 됨 — 실제 변경일 때만 반응하도록)
  onFilterChangeCallback(store.getFilterState(), { isInitial: true });

  // 4. 스토어 상태 변경 감지
  window.addEventListener("gwStoreStateChanged", (e) => {
    refreshSidebarList();
    onFilterChangeCallback(e.detail, { isInitial: false });
  });
}
