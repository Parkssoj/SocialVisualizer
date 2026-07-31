import { bootstrapApp } from '../main-app.js';
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

window.addEventListener('load', function() {
  var gmailId = localStorage.getItem('gw_user_id') || '';
  _loadScript('https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js')
    .then(function() { return _loadScript('/graph-render.js'); })
    .then(function() {
      return fetch('/graph-data?user_id=' + encodeURIComponent(gmailId));
    })
    .then(function(res) { return res.json(); })
    .then(function(data) { renderGraph(document.getElementById('graph'), data); })
    .catch(function(err) { console.error('[graph] 로드 실패:', err); });
});
