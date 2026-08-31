/**
공통 상단 헤더 React 컴포넌트 — 상단 네비게이션(NAV_ITEMS)을 렌더링하며 8개 페이지 전부가
activePage prop만 바꿔서 공유한다. 예전엔 아직 React로 전환되지 않은 페이지가 vanilla JS
appHeader.js 버전을 따로 썼지만, 이제 모든 페이지가 React로 전환되면서 appHeader.js는 삭제됐고
이 컴포넌트가 유일한 헤더 구현이다.

Shared top header React component — renders the top nav (NAV_ITEMS) and is reused by all 8 pages
via the activePage prop. Pages not yet converted to React used to fall back to a vanilla-JS
appHeader.js version, but now that every page is React, appHeader.js has been removed and this is
the only header implementation.
 */

/**
예전 appHeader.js의 NAV_ITEMS와 동일한 데이터. 이 배열만 고치면
메뉴 항목이 늘거나 줄어도 화면이 자동으로 갱신됩니다.
 */
// 메뉴 순서: data analysis → My People → My Time → 검색 → View knowledge graph.
// 홈은 로고 클릭으로 이동 가능하므로 메뉴에서 제외. Recap은 빌드 대상에서 제외됨(vite.config.js 참고).
const NAV_ITEMS = [
  {
    page: "imap-collect",
    href: "imap-collect.html",
    label: "Social data analysis",
  },
  {
    page: "analysis-hub",
    href: "analysishub.html",
    label: "View results",
    children: [
      { page: "mypeople", href: "mypeople.html", label: "My People" },
      { page: "mytime", href: "mytime.html", label: "My Time" },
      { page: "recap", href: "recap.html", label: "Recap" },
      { page: "search", href: "search.html", label: "Natural language search" },
    ],
  },
  { page: "graph-viz", href: "graphviz.html", label: "Knowledge graph" },
];

// 메뉴 항목 하나를 렌더링 — children이 있으면 드롭다운 그룹으로 표시
function NavItem({ item, activePage }) {
  if (item.children) {
    const groupActive =
      item.page === activePage ||
      item.children.some((c) => c.page === activePage);
    return (
      <div className="gw-tl-dropdown">
        <a
          href={item.href}
          className={`gw-tl gw-tl-dd-btn${groupActive ? " active" : ""}`}
        >
          {item.label}{" "}
          <i
            className="bi bi-chevron-down"
            style={{ fontSize: ".65rem", marginLeft: "2px" }}
          ></i>
        </a>
        <div className="gw-tl-dd-menu">
          {item.children.map((c) => (
            <a
              key={c.page}
              href={c.href}
              className={c.page === activePage ? "active" : ""}
            >
              {c.label}
            </a>
          ))}
        </div>
      </div>
    );
  }
  return (
    <a
      href={item.href}
      className={`gw-tl${item.page === activePage ? " active" : ""}`}
    >
      {item.label}
    </a>
  );
}

// 상단 헤더 전체(로고 + 네비게이션) 렌더링
export default function Header({ activePage }) {
  return (
    <div className="top_nav">
      <div className="nav_menu d-flex align-items-center justify-content-between">
        <div className="d-flex align-items-center">
          <a href="index.html" className="gw-brand-logo">
            <img
              src="/images/logos/socialvisualizer.png"
              className="gw-brand-logo-icon"
              alt=""
            />
            <span className="gw-brand-logo-text">Social Visualizer</span>
          </a>
          <nav className="gw-top-links">
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.page} item={item} activePage={activePage} />
            ))}
          </nav>
        </div>
        <nav className="nav navbar-nav ms-auto">
          <ul className="navbar-right d-flex align-items-center gap-3 pe-3"></ul>
        </nav>
      </div>
    </div>
  );
}
