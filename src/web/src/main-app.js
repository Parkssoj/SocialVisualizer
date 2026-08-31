/**
실제 기능 페이지 8개 + 로그인이 공통으로 쓰는 전역 초기화(부트스트랩/팝퍼, 전역 스타일, 플로팅 검색)를 모아둔 얇은 공용 진입점.
예전엔 여기서 vanilla appHeader.js의 renderHeader/renderFooter도 #app-header/#app-footer에 마운트했지만,
8개 페이지가 전부 React로 전환되면서 각 페이지의 <PageName>App.jsx가 Header.jsx/Footer.jsx를 직접 그리게 됐다.
그 결과 renderHeader/renderFooter는 어떤 페이지에도 없는 #app-header/#app-footer를 찾다 조용히 no-op하는
죽은 코드가 되어, appHeader.js와 함께 정리했다(bootstrapApp() 자체도 제거 — 각 페이지는 이제
import "../main-app.js"만으로 이 파일의 side-effect 초기화를 그대로 받는다).

Lean shared entry point loading only what the 8 feature pages + login actually need —
bootstrap/popper, global styles, and the floating search widget.
This used to also mount the vanilla appHeader.js's renderHeader/renderFooter into
#app-header/#app-footer, but now that all 8 pages are React, each page's <PageName>App.jsx
renders Header.jsx/Footer.jsx directly instead. That left renderHeader/renderFooter as dead code
silently no-op'ing against #app-header/#app-footer elements that no longer exist on any page, so
they were removed along with appHeader.js (bootstrapApp() itself is gone too — pages now just do
`import "../main-app.js"` for this file's side-effect init, same as home.js already did).

번역(i18next) 관련 코드도 여기서 같이 걷어냈다 — utils/i18n.js가 초기화 시 data-i18n
속성/#current-lang/#home-greeting/.lang-option 요소를 찾아 번역을 적용하려 했지만, 로그인/언어
드롭다운이 Header.jsx에서 완전히 빠지면서 그 요소들이 화면 어디에도 없어 실질적으로 죽은 기능이었다.
utils/i18n.js와 src/i18n/(ko·en·ja.json)를 함께 제거했다.
i18next-related code was removed here too — utils/i18n.js initialized i18next and looked for
data-i18n/#current-lang/#home-greeting/.lang-option elements to translate, but since the login/
language dropdown was fully removed from Header.jsx those elements no longer exist anywhere,
making it dead in practice. Removed utils/i18n.js and src/i18n/(ko·en·ja.json) along with it.

DOMPurify 기반 sanitizeHtml/setSafeInnerHTML을 담당하던 utils/security.js도 같이 제거했다 — window
전역에 함수를 노출하기만 할 뿐 실제로 innerHTML을 직접 대입하는 mypeopleEngine.js 등 어디에서도
이 함수들을 부르지 않아 완전히 죽은 코드였다.
Also removed utils/security.js, which exposed DOMPurify-based sanitizeHtml/setSafeInnerHTML on
window — nothing anywhere actually called them (the code that sets innerHTML directly, like
mypeopleEngine.js, never routed through it), so it was dead code.
 */

import * as bootstrap from "bootstrap";
window.bootstrap = bootstrap;
globalThis.bootstrap = bootstrap;

import "./main.scss";

import "./utils/smartresize.js";
import "./utils/init.js";

// 우측 하단 떠 있는 검색 버튼 — side-effect import라 main-app.js를 쓰는 모든 페이지에
// 자동으로 뜬다(로그인 페이지는 main-app.js를 안 쓰므로 자연히 제외됨).
import "./components/floatingSearch.js";
