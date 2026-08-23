/**
 * 공통 상단 헤더/네비게이션. 기존에 페이지마다 복붙되어 있던
 * 사이드바(3종) + 상단바(2종)를 대체하는 단일 소스.
 * `<div id="app-header"></div>` 자리표시자를 가진 페이지에서
 * renderHeader(activePage)를 호출해 마운트한다.
 */

// Header.jsx(React, index.html 전용)와 동일하게 유지해야 함 — React 버전은
// 홈에서만, 이 vanilla JS 버전은 나머지 페이지에서 사용됨.
// 메뉴 순서: 데이터 분석하기 → My People → My Time → 검색 → View knowledge graph.
// 홈은 로고 클릭으로 이동 가능하므로 메뉴에서 제외.
const NAV_ITEMS = [
  { page: "imap-collect", href: "imap-collect.html", label: "Data analysis" },
  {
    page: "analysis-hub",
    href: "analysis-hub.html",
    label: "View analysis results",
    children: [
      { page: "mypeople", href: "mypeople.html", label: "My People" },
      { page: "mytime", href: "mytime.html", label: "My Time" },
      { page: "recap", href: "recap.html", label: "Recap" },
      { page: "search", href: "search.html", label: "Natural language search" },
    ],
  },
  { page: "graph-viz", href: "graph-viz.html", label: "View knowledge graph" },
];

export function renderHeader(activePage) {
  const mountPoint = document.getElementById("app-header");
  if (!mountPoint) return;

  const navLinks = NAV_ITEMS.map((item) => {
    if (item.children) {
      const groupActive =
        item.page === activePage ||
        item.children.some((c) => c.page === activePage);
      const childLinks = item.children
        .map(
          (c) =>
            `<a href="${c.href}"${c.page === activePage ? ' class="active"' : ""}>${c.label}</a>`,
        )
        .join("");
      return `
        <div class="gw-tl-dropdown">
          <a href="${item.href}" class="gw-tl gw-tl-dd-btn${groupActive ? " active" : ""}">${item.label} <i class="bi bi-chevron-down" style="font-size:.65rem;margin-left:2px;"></i></a>
          <div class="gw-tl-dd-menu">${childLinks}</div>
        </div>`;
    }
    return `<a href="${item.href}" class="gw-tl${item.page === activePage ? " active" : ""}">${item.label}</a>`;
  }).join("");

  mountPoint.innerHTML = `
    <div class="top_nav">
      <div class="nav_menu d-flex align-items-center justify-content-between">
        <div class="d-flex align-items-center">
          <a href="index.html" class="gw-brand-logo">
            <img src="/images/logos/socialvisualizer.png" class="gw-brand-logo-icon" alt="">
            <span class="gw-brand-logo-text">Social Visualizer</span>
          </a>
          <nav class="gw-top-links">${navLinks}</nav>
        </div>
        <nav class="nav navbar-nav ms-auto">
          <ul class="navbar-right d-flex align-items-center gap-3 pe-3">
            <!-- 로그인/번역 버튼 비활성화
            <li class="nav-item">
              <button type="button" class="gw-login-btn">로그인</button>
            </li>
            <li class="nav-item dropdown">
              <a href="#" role="button" class="gw-lang-trigger dropdown-toggle" id="langDropdown" data-bs-toggle="dropdown" aria-expanded="false" style="text-decoration:none;">
                <i class="bi bi-translate" style="font-size:1.2rem;vertical-align:middle;"></i>
                <span id="current-lang" style="margin-left:4px;font-size:.9rem;">KO</span>
              </a>
              <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="langDropdown">
                <li><a class="dropdown-item lang-option" href="#" data-lang="ko">🇰🇷 한국어</a></li>
                <li><a class="dropdown-item lang-option" href="#" data-lang="en">🇺🇸 English</a></li>
                <li><a class="dropdown-item lang-option" href="#" data-lang="ja">🇯🇵 日本語</a></li>
              </ul>
            </li>
            -->
          </ul>
        </nav>
      </div>
    </div>
  `;
}

export function renderFooter(brand = "MailGrapher") {
  const mountPoint = document.getElementById("app-footer");
  if (!mountPoint) return;
  mountPoint.innerHTML = `<div class="float-end">${brand}</div><div class="clearfix"></div>`;
}
