import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import Header from './Header.jsx';
import Footer from './Footer.jsx';
import MailStatsCard from './recap/MailStatsCard.jsx';
import KeywordCloudCard from './recap/KeywordCloudCard.jsx';
import AffinityDonutCard from './recap/AffinityDonutCard.jsx';
import SyncStatsCard from './recap/SyncStatsCard.jsx';
import { initAccountPicker } from '../features/accountPicker.js';
import { store } from '../store/globalStore.js';
import { refreshSidebarList } from './appSidebar.js';
import { initGlobalFilter } from '../utils/filterSync.js';
import { postStat, rankMailStats } from '../features/recapStats.js';

/**
"Recap" 페이지(recap.html) 전체를 감싸는 최상위 React 컴포넌트 — 히어로, 발신자/수신자·키워드·친밀도·
동기화 통계 카드, 사이드바(공용 vanilla 모듈)까지 한 번에 마운트한다. 사이드바 선택이 바뀌면 다섯 개
통계 API를 병렬로 다시 불러오되, 그 사이 또 다른 선택으로 바뀌면 늦게 도착한 결과는 화면에 반영하지
않는다(React 이펙트의 표준 ignore-flag 패턴 — 기존의 수동 generation 카운터와 동일한 효과).

Top-level React component wrapping the entire Recap page (recap.html) — mounts the hero, the
sender/keyword/affinity/sync stat cards, and the shared sidebar (vanilla module) in one place.
When the sidebar selection changes, the five stat APIs are re-fetched in parallel; if the
selection changes again before they resolve, the stale results are ignored (React's standard
effect ignore-flag pattern — equivalent to the original's manual generation counter).
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 캐시 유효시간(5분) — recapDataCache와 동일

const LOADING_STATE = { status: 'loading' };
const NO_ACCOUNT_ERROR = '인덱싱된 계정이 없습니다. 먼저 메일을 수집해주세요.';

function loadingCardStates() {
  return { sender: LOADING_STATE, mysent: LOADING_STATE, keyword: LOADING_STATE, affinity: LOADING_STATE, sync: LOADING_STATE };
}

function messageCardStates(message) {
  const state = { status: 'error', error: message };
  return { sender: state, mysent: state, keyword: state, affinity: state, sync: state };
}

// Promise.allSettled 결과 5개를 각 카드가 바로 쓸 수 있는 state로 변환
function buildCardStates([mailStatsResult, keywordResult, affinityResult, syncResult]) {
  const mailData = mailStatsResult.status === 'fulfilled' ? mailStatsResult.value.data || {} : {};
  const sender = { status: 'done', ranked: rankMailStats(mailData, 'received') };
  const mysent = { status: 'done', ranked: rankMailStats(mailData, 'sent') };

  const keyword = { status: 'done', data: keywordResult.status === 'fulfilled' ? keywordResult.value.data : null };
  const affinity = { status: 'done', data: affinityResult.status === 'fulfilled' ? affinityResult.value.data : null };

  const sync =
    syncResult.status === 'fulfilled' && syncResult.value.data
      ? { status: 'done', data: syncResult.value.data }
      : {
          status: 'error',
          error: syncResult.status === 'rejected' ? '불러오기 실패: ' + syncResult.reason.message : '데이터가 없습니다.',
        };

  return { sender, mysent, keyword, affinity, sync };
}

function resolveName() {
  const params = new URLSearchParams(window.location.search);
  const nameParam = params.get('name');
  const name = nameParam ? decodeURIComponent(nameParam) : sessionStorage.getItem('gw_user_name') || '-';
  if (nameParam) sessionStorage.setItem('gw_user_name', decodeURIComponent(nameParam));
  const gmailIdParam = params.get('gmail_id');
  if (gmailIdParam) localStorage.setItem('gw_user_id', decodeURIComponent(gmailIdParam));
  return name;
}

function RecapApp() {
  const [name] = useState(resolveName);
  const [filterState, setFilterState] = useState(null);
  const [cardStates, setCardStates] = useState(loadingCardStates);
  const cacheRef = useRef(new Map()); // gmailId -> { timestamp, results }

  // 사이드바 + 계정 선택 상태 동기화는 공용 vanilla 모듈(filterSync.js/appSidebar.js)이 전담 —
  // #app-sidebar placeholder에 마운트만 해주고, 선택이 바뀔 때마다 넘어오는 콜백을 state로 받는다.
  useEffect(() => {
    initGlobalFilter((fs) => setFilterState(fs));

    // 예전 페이지 상단 계정 토글의 잔재 — 지금은 #account-picker-mount가 recap.html에 없어서
    // 드롭다운은 렌더링되지 않지만, 최초 진입 시 기본 계정을 localStorage(gw_user_id)에 채워주는
    // 부수효과는 그대로 유지한다(사이드바가 유일한 진실 공급원이라 onChange는 사실상 호출되지 않음).
    initAccountPicker(document.getElementById('account-picker-mount'), (selectedMail) => {
      if (selectedMail) {
        store.setFilter('mail', selectedMail);
        refreshSidebarList();
      }
    });
  }, []);

  useEffect(() => {
    if (!filterState) return;

    if (filterState.room) {
      // Recap은 아직 메일 전용 기능 — 다섯 API 전부 메일 계정만 지원하므로 메신저 채팅방
      // 선택 시엔 "준비 중" 안내만 띄운다.
      setCardStates(messageCardStates('메신저 Recap 기능은 아직 준비 중입니다.'));
      return;
    }

    const gmailId = filterState.mail;
    if (!gmailId) {
      setCardStates(messageCardStates(NO_ACCOUNT_ERROR));
      return;
    }

    setCardStates(loadingCardStates());

    const cached = cacheRef.current.get(gmailId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      setCardStates(buildCardStates(cached.results));
      return;
    }

    let ignore = false;
    Promise.allSettled([
      postStat('/mail-stats', gmailId),
      postStat('/keyword-stats', gmailId),
      postStat('/high_affinity_person_stats', gmailId),
      postStat('/mail_sync_stats', gmailId),
      postStat('/user_rating_stats', gmailId),
    ]).then((results) => {
      // 다섯 API를 기다리는 동안 다른 계정이 또 선택됐으면(=ignore) 이 결과는 이미 화면에
      // 안 맞는 낡은 데이터다. 캐시에는 넣어 두되(나중에 이 계정으로 돌아왔을 때 재사용)
      // 화면에는 반영하지 않는다.
      cacheRef.current.set(gmailId, { timestamp: Date.now(), results });
      if (ignore) return;
      setCardStates(buildCardStates(results));
    });

    return () => {
      ignore = true;
    };
  }, [filterState]);

  const heroSub = name !== '-' ? `${name}님의 전체적인 통계를 보여줍니다` : '내 메일함 통계 한눈에 보기';

  return (
    <>
      <Header activePage="recap" />
      <div id="app-sidebar"></div>
      <main className="right_col" role="main" style={{ padding: 0, overflowY: 'auto' }}>
        <div className="rc-hero">
          <div className="rc-hero-inner">
            <div className="rc-hero-label">Mail Analytics</div>
            <div className="rc-hero-title">📊 Recap</div>
            <div className="rc-hero-sub">{heroSub}</div>
          </div>
          <a href="graphviz.html" className="rc-hero-graph-link">
            <span>knowledge graph</span>
            <span className="rc-hero-graph-arrow">→</span>
          </a>
        </div>

        <div className="rc-content">
          <div className="rc-grid2">
            <MailStatsCard
              icon="📨" iconBg="#fff9e6" title="나에게 많이 보낸 사람"
              tag="TOP RECEIVER" unit="통 받음" state={cardStates.sender}
            />
            <MailStatsCard
              icon="📤" iconBg="#e8f4fd" title="내가 많이 보낸 사람"
              tag="TOP SENT" unit="통 보냄" state={cardStates.mysent}
            />
          </div>

          <div className="rc-grid2">
            <KeywordCloudCard state={cardStates.keyword} />
            <AffinityDonutCard state={cardStates.affinity} />
          </div>

          <SyncStatsCard state={cardStates.sync} />
        </div>
      </main>
      <Footer />
    </>
  );
}

// #containerId 엘리먼트에 RecapApp을 React 루트로 마운트
export function mountRecapApp(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  createRoot(el).render(<RecapApp />);
}
