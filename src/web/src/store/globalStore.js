// src/store/globalStore.js

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

  // ── [백엔드 DB 실제 연동] 80번 포트 Flask API 동시 호출 ──
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

      // 요청 — DB/실제 데이터는 절대 안 건드리고 "화면에 뜨는 순서"만 조정.
      // 03yeah03@gmail.com이 항상 맨 위에 오도록(그래야 appSidebar.js가 기본으로
      // 골라주는 mails[0]도 자동으로 이 계정이 됨). 나머지 계정들 순서는 그대로.
      const PINNED_MAIL_FIRST = "03yeah03@gmail.com";
      mails.sort((a, b) => {
        if (a.id === PINNED_MAIL_FIRST) return -1;
        if (b.id === PINNED_MAIL_FIRST) return 1;
        return 0;
      });

      const chatrooms = (roomsData.data && roomsData.data.chatrooms) || [];
      const rooms = chatrooms.map((r) => ({
        id: r.chatroom_id,
        label: r.chatroom_name || r.chatroom_id,
        indexed: true,
      }));

      // DB 데이터로 스토어 상태 갱신
      this.setCollectedLists(mails, rooms);
    } catch (err) {
      console.error("DB 수집 목록 조회 중 오류 발생:", err);
    }
  }

  setCollectedLists(mails = [], rooms = []) {
    this.state.collectedMails = mails;
    this.state.collectedRooms = rooms;

    localStorage.setItem(STORAGE_KEYS.MAILS_LIST, JSON.stringify(mails));
    localStorage.setItem(STORAGE_KEYS.ROOMS_LIST, JSON.stringify(rooms));

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

  setFilter(type, value) {
    if (type === "mail") {
      this.state.selectedMail = value;
      this.state.selectedRoom = null;
      localStorage.setItem(STORAGE_KEYS.MAIL, value || "");
      localStorage.setItem(LEGACY_KEYS.MAIL, value || ""); // 페이지 상단 계정 토글과 동기화
      localStorage.removeItem(STORAGE_KEYS.ROOM);
    } else if (type === "room") {
      this.state.selectedRoom = value;
      this.state.selectedMail = null;
      localStorage.setItem(STORAGE_KEYS.ROOM, value || "");
      localStorage.setItem(LEGACY_KEYS.ROOM, value || ""); // 페이지 상단 채팅방 토글과 동기화
      localStorage.removeItem(STORAGE_KEYS.MAIL);
    }

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

  getCollectedLists() {
    return {
      mails: this.state.collectedMails,
      rooms: this.state.collectedRooms,
    };
  }
}

export const store = new GlobalStore();
