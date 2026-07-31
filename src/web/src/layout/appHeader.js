/**
 * 공통 상단 헤더/네비게이션. 기존에 페이지마다 복붙되어 있던
 * 사이드바(3종) + 상단바(2종)를 대체하는 단일 소스.
 * `<div id="app-header"></div>` 자리표시자를 가진 페이지에서
 * renderHeader(activePage)를 호출해 마운트한다.
 */

const NAV_ITEMS = [
  { page: 'home', href: 'index.html', label: '홈' },
  { page: 'search', href: 'search.html', label: '검색' },
  { page: 'imap-collect', href: 'imap-collect.html', label: '메일 수집' },
  { page: 'mylife', href: 'mylife.html', label: 'My Life' },
  { page: 'mypeople', href: 'mypeople.html', label: 'My People' },
  { page: 'mytime', href: 'mytime.html', label: 'My Time' },
  { page: 'graph-viz', href: 'graph-viz.html', label: 'Graph Viz' },
  { page: 'recap', href: 'recap.html', label: 'Recap' }
];

export function renderHeader(activePage) {
  const mountPoint = document.getElementById('app-header');
  if (!mountPoint) return;

  const navLinks = NAV_ITEMS.map(
    item =>
      `<a href="${item.href}" class="gw-tl${item.page === activePage ? ' active' : ''}">${item.label}</a>`
  ).join('');

  mountPoint.innerHTML = `
    <div class="top_nav">
      <div class="nav_menu d-flex align-items-center justify-content-between">
        <div class="navbar nav_title border-0" style="border:none;padding-left:16px;">
          <a href="index.html" class="site_title site_title_text">
            <img src="/images/olive-tree.png" style="width:24px;height:24px;object-fit:contain;"> Olive
          </a>
        </div>
        <nav class="gw-top-links">${navLinks}</nav>
        <nav class="nav navbar-nav ms-auto">
          <ul class="navbar-right d-flex align-items-center gap-3 pe-3">
            <li class="nav-item d-none d-lg-flex align-items-center" style="color:#73879C;font-size:.85rem;">
              <span data-i18n="sidebar.welcome">Welcome,</span>&nbsp;<strong id="google-profile-name">-</strong>
            </li>
            <li class="nav-item dropdown">
              <a href="#" role="button" class="dropdown-toggle" id="langDropdown" data-bs-toggle="dropdown" aria-expanded="false" style="text-decoration:none;color:inherit;">
                <i class="bi bi-translate" style="font-size:1.2rem;vertical-align:middle;"></i>
                <span id="current-lang" style="margin-left:4px;font-size:.9rem;">KO</span>
              </a>
              <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="langDropdown">
                <li><a class="dropdown-item lang-option" href="#" data-lang="ko">🇰🇷 한국어</a></li>
                <li><a class="dropdown-item lang-option" href="#" data-lang="en">🇺🇸 English</a></li>
                <li><a class="dropdown-item lang-option" href="#" data-lang="ja">🇯🇵 日本語</a></li>
              </ul>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  `;
}

export function renderFooter(brand = 'MailGrapher') {
  const mountPoint = document.getElementById('app-footer');
  if (!mountPoint) return;
  mountPoint.innerHTML = `<div class="float-end">${brand}</div><div class="clearfix"></div>`;
}
