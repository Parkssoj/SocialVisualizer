import { bootstrapApp } from '../main-app.js';
import { initAccountPicker } from '../features/accountPicker.js';
import '../scss/pages/graph-viz.scss';

bootstrapApp('graph-viz');

// 이름/gmail_id 처리
const params = new URLSearchParams(window.location.search);
const nameParam = params.get('name');
const name = nameParam
  ? decodeURIComponent(nameParam)
  : (sessionStorage.getItem('gw_user_name') || '-');
if (nameParam) sessionStorage.setItem('gw_user_name', decodeURIComponent(nameParam));

const gmailIdParam = params.get('gmail_id');
if (gmailIdParam) localStorage.setItem('gw_user_id', decodeURIComponent(gmailIdParam));
const flaskUrlParam = params.get('flask_url');
if (flaskUrlParam) localStorage.setItem('gw_flask_url', decodeURIComponent(flaskUrlParam));

const profileNameEl = document.getElementById('google-profile-name');
if (profileNameEl) profileNameEl.textContent = name;

// 그래프 로드
function _loadScript(src) {
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// d3 + graph-render.js는 계정 목록 조회와 병렬로 미리 로드해두고, 렌더링 직전에만 대기한다
var rendererReady = _loadScript('https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js')
  .then(function() { return _loadScript('/graph-render.js'); });

// user_id로 해당 계정(또는 카카오 대화방)의 그래프 데이터를 불러와 그린다.
// 계정/도메인 전환 시에도 페이지 새로고침 없이 이 함수만 다시 호출해 그 자리에서 다시 그린다.
var currentDomain = 'mail';

function loadGraphData(userId) {
  var svg = document.getElementById('graph');
  if (!userId) {
    console.warn('[graph] user_id 없음 → 그래프 로드 생략');
    svg.innerHTML = '';
    return Promise.resolve();
  }
  return fetch('/graph-data?user_id=' + encodeURIComponent(userId) + '&domain=' + encodeURIComponent(currentDomain))
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (!data || !Array.isArray(data.nodes)) {
        console.warn('[graph] 그래프 데이터 없음:', data && data.error);
        svg.innerHTML = '';
        return;
      }
      return rendererReady.then(function() {
        svg.innerHTML = '';
        renderGraph(svg, data);
      });
    })
    .catch(function(err) { console.error('[graph] 로드 실패:', err); });
}

// 메일/메신저 토글에 맞춰 계정 선택기를 그 도메인 목록으로 다시 초기화하고 그래프를 새로 불러온다.
// 메일과 카카오는 "마지막 선택"을 서로 다른 localStorage 키에 각자 기억한다.
function loadDomain(domain) {
  currentDomain = domain;
  document.getElementById('domain-btn-mail').classList.toggle('active', domain === 'mail');
  document.getElementById('domain-btn-mail').setAttribute('aria-selected', String(domain === 'mail'));
  document.getElementById('domain-btn-message').classList.toggle('active', domain === 'messenger');
  document.getElementById('domain-btn-message').setAttribute('aria-selected', String(domain === 'messenger'));

  var storageKey = domain === 'mail' ? 'gw_user_id' : 'gw_message_room_id';
  return initAccountPicker(document.getElementById('account-picker-mount'), loadGraphData, { domain, storageKey })
    .then(function(effectiveUserId) { return loadGraphData(effectiveUserId); });
}

document.getElementById('domain-btn-mail').addEventListener('click', function() { loadDomain('mail'); });
document.getElementById('domain-btn-message').addEventListener('click', function() { loadDomain('messenger'); });

window.addEventListener('load', function() {
  loadDomain('mail');
});
