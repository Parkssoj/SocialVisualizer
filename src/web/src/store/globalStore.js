// src/store/globalStore.js

/**
선택된 메일/채팅방 필터와 수집된 계정·채팅방 목록을 관리하는 전역 스토어(싱글턴). 백엔드 /accounts, /messenger-chatrooms를 호출해 목록을 갱신하고,
선택 상태가 실제로 바뀔 때만 gwStoreStateChanged 이벤트를 쏴서 사이드바/각 페이지를 동기화한다.

Singleton global store for the selected mail/room filter and the fetched account/chatroom lists.
Refreshes lists via the backend's /accounts and /messenger-chatrooms, and fires a
gwStoreStateChanged event only when the selection actually changes.
 */

const STORAGE_KEYS = {
  MAIL: "gw_selected_mail",
  ROOM: "gw_selected_room",
  MAILS_LIST: "gw_collected_mails",
  ROOMS_LIST: "gw_collected_rooms",
};

// My People/My Time/Recap 각 페이지 상단에 이미 있던 "계정 선택 토글"
// (features/accountPicker.js)이 실제로 쓰는 키. 사이드바 전용 키(gw_selected_mail/
// gw_selected_room)와 이 값이 서로 다른 채로 남아있으면 "페이지 상단 토글에서 고른
// 계정"과 "사이드바에서 고른 계정"이 어긋나 보이므로, setFilter에서 항상 같이 갱신해서
// 두 UI가 하나의 값을 공유하게 만든다.
const LEGACY_KEYS = {
  MAIL: "gw_user_id",
  ROOM: "gw_chatroom_id",
};

class GlobalStore {
  constructor() {
    this.state = {
      selectedMail:
        localStorage.getItem(STORAGE_KEYS.MAIL) ||
        localStorage.getItem(LEGACY_KEYS.MAIL) ||
        "",
      selectedRoom:
        localStorage.getItem(STORAGE_KEYS.ROOM) ||
        localStorage.getItem(LEGACY_KEYS.ROOM) ||
        "",
      collectedMails: JSON.parse(
        localStorage.getItem(STORAGE_KEYS.MAILS_LIST) || "[]",
      ),
      collectedRooms: JSON.parse(
        localStorage.getItem(STORAGE_KEYS.ROOMS_LIST) || "[]",
      ),
    };

    this.debounceTimer = null;
  }

  // [백엔드 DB 실제 연동] 80번 포트 Flask API 동시 호출
  // 계정 토글(accountPicker.js)이 쓰는 것과 완전히 같은 엔드포인트/파싱을 그대로
  // 가져와서 쓴다 — 예전엔 메일은 도메인 없이 /accounts를 불러 응답이
  // {accounts:[{user_id,indexed}, ...]} 객체 배열인데도 문자열 배열인 것처럼
  // 다뤄서 사이드바에 "[object Object]"가 찍혔고, 메신저는 /messenger-chatrooms
  // 응답이 {data:{chatrooms:[...]}}로 한 겹 더 감싸져 있는데 res.chatrooms를
  // 바로 읽어서 항상 빈 배열로만 떨어졌었다 — 그게 "사이드바가 이상하게
  // 연결되어 있다"의 실제 원인.
  async fetchCollectedLists() {
    try {
      // 1. 메일 계정 — 계정 토글과 동일하게 GET /accounts?domain=mail
      const mailPromise = fetch("/accounts?domain=mail")
        .then((res) => (res.ok ? res.json() : { accounts: [] }))
        .catch(() => ({ accounts: [] }));

      // 2. 메신저 채팅방 — /messenger-chatrooms는 방마다 chatroom_name을 이미
      //    서버(list_indexed_chatrooms)에서 resolve해서 내려주므로, 계정 토글처럼
      //    방 하나하나 /chatroom-name을 또 부를 필요 없이 그 이름을 그대로 쓴다.
      const roomPromise = fetch("/messenger-chatrooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
        .then((res) => (res.ok ? res.json() : { data: { chatrooms: [] } }))
        .catch(() => ({ data: { chatrooms: [] } }));

      const [mailsData, roomsData] = await Promise.all([
        mailPromise,
        roomPromise,
      ]);

      // {id, label, indexed} 형태로 통일 — id: data-value/필터에 쓰는 실제 값,
      // label: 화면에 보여줄 이름.
      const mails = (mailsData.accounts || []).map((acc) => ({
        id: acc.user_id,
        label: acc.user_id,
        indexed: !!acc.indexed,
      }));

      const chatrooms = (roomsData.data && roomsData.data.chatrooms) || [];
      const rooms = chatrooms.map((r) => ({
        id: r.chatroom_id,
        label: r.chatroom_name || r.chatroom_id,
        // 예전엔 항상 true로 고정돼 있었음(그땐 list_indexed_chatrooms가 완료된 방만
        // 돌려줬으니 항상 맞는 값이었음) — 이제 인덱싱 중인 방도 같이 내려오므로
        // 서버가 준 실제 값을 그대로 써야 사이드바 "생성 중" 배지가 맞게 뜬다.
        indexed: r.indexed !== false,
      }));

      // DB 데이터로 스토어 상태 갱신
      this.setCollectedLists(mails, rooms);
    } catch (err) {
      console.error("DB 수집 목록 조회 중 오류 발생:", err);
    }
  }

  setCollectedLists(mails = [], rooms = []) {
    // 인덱싱 상태를 주기적으로 다시 불러올 때(filterSync.js의 폴링) 목록 내용이
    // 실제로는 그대로인데도 매번 gwStoreStateChanged를 쏘면, 이 이벤트를 듣는
    // 페이지들이 "사용자가 계정을 바꿨다"고 착각하고 데이터를 계속 처음부터 다시
    // 불러온다(화면이 몇 초마다 "불러오는 중..."으로 되돌아가는 버그). 실제로
    // 목록 내용이 달라졌을 때만 이벤트를 쏘도록 비교한다.
    const nextMailsJson = JSON.stringify(mails);
    const nextRoomsJson = JSON.stringify(rooms);
    const changed =
      nextMailsJson !== JSON.stringify(this.state.collectedMails) ||
      nextRoomsJson !== JSON.stringify(this.state.collectedRooms);

    this.state.collectedMails = mails;
    this.state.collectedRooms = rooms;

    localStorage.setItem(STORAGE_KEYS.MAILS_LIST, nextMailsJson);
    localStorage.setItem(STORAGE_KEYS.ROOMS_LIST, nextRoomsJson);

    if (!changed) return;

    window.dispatchEvent(
      new CustomEvent("gwStoreStateChanged", {
        detail: this.getFilterState(),
      }),
    );
  }

  getFilterState() {
    return {
      mail: this.state.selectedMail,
      room: this.state.selectedRoom,
    };
  }

  // 메일/메신저 선택을 하나의 트랜잭션으로 원자적으로 갱신한다.
  //
  // 예전엔 "메일 선택 → 메신저 해제"를 store.setFilter("room", null) 직후
  // store.setFilter("mail", value) 이렇게 두 번 연달아 호출하는 방식이었다.
  // setFilter는 호출될 때마다 무조건 gwStoreStateChanged를 동기적으로 쐈기
  // 때문에, 그 두 호출 "사이"에 mail도 room도 없는 중간 상태가 실제로 한 번
  // 발생했고 그 상태로도 이벤트가 나갔다. filterSync.js가 이 이벤트 리스너를
  // (초기 이벤트를 놓치지 않기 위해) refreshSidebarList()보다 먼저 등록해두면서,
  // 이 중간 상태 이벤트가 리스너를 통해 refreshSidebarList()를 다시 부르고,
  // 그 안에서 "선택값이 둘 다 없다"고 판단해 또 같은 두 단계 setFilter를
  // 반복하며 재진입(reentrant)했다 — 이게 Recap에서 카드 하나 클릭했는데
  // /mail-stats 등 5개 API가 10번 넘게 중복 호출되던 진짜 원인이었다.
  //
  // 이제 mail/room 값을 한 번에 같이 넘겨서 중간 상태 자체가 생기지 않게
  // 하고, 실제로 값이 바뀌었을 때만(변화 없으면 재호출돼도 무시) 이벤트를
  // 딱 한 번만 쏘도록 한다.
  applySelection(mail, room) {
    const nextMail = mail || null;
    const nextRoom = room || null;
    const changed =
      nextMail !== (this.state.selectedMail || null) ||
      nextRoom !== (this.state.selectedRoom || null);

    this.state.selectedMail = nextMail;
    this.state.selectedRoom = nextRoom;

    if (nextMail) {
      localStorage.setItem(STORAGE_KEYS.MAIL, nextMail);
      localStorage.setItem(LEGACY_KEYS.MAIL, nextMail); // 페이지 상단 계정 토글과 동기화
      localStorage.removeItem(STORAGE_KEYS.ROOM);
    } else if (nextRoom) {
      localStorage.setItem(STORAGE_KEYS.ROOM, nextRoom);
      localStorage.setItem(LEGACY_KEYS.ROOM, nextRoom); // 페이지 상단 채팅방 토글과 동기화
      localStorage.removeItem(STORAGE_KEYS.MAIL);
    } else {
      localStorage.removeItem(STORAGE_KEYS.MAIL);
      localStorage.removeItem(STORAGE_KEYS.ROOM);
    }

    // 값이 실제로 안 바뀌었으면(같은 항목을 다시 클릭했거나, 위에서 설명한
    // 재진입 상황) 굳이 이벤트를 또 쏘지 않는다 — 이게 재귀적 중복 호출을
    // 막는 마지막 안전장치.
    if (!changed) return;

    // 요청 — 03yeah03@gmail.com을 누르면(또는 기본 선택되면) 화면 데이터가
    // 바로 뜨도록. 예전엔 클릭할 때마다 300ms 지연 후에야 페이지가 데이터를
    // 다시 불러오는 이벤트가 발생해서, 누르고 나서 잠깐 멈칫하는 느낌이
    // 있었다 — 디바운스 없이 즉시 이벤트를 쏘도록 바꿈.
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    window.dispatchEvent(
      new CustomEvent("gwStoreStateChanged", {
        detail: this.getFilterState(),
      }),
    );
  }

  // 기존 호출부(appSidebar.js 등)와의 호환을 위해 남겨둔 래퍼 — 내부적으로는
  // applySelection()으로 위임해서 항상 원자적으로 처리된다.
  setFilter(type, value) {
    if (type === "mail") {
      this.applySelection(value, null);
    } else if (type === "room") {
      this.applySelection(null, value);
    }
  }

  getCollectedLists() {
    return {
      mails: this.state.collectedMails,
      rooms: this.state.collectedRooms,
    };
  }
}

export const store = new GlobalStore();
