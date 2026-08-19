import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { changeLanguage } from "../utils/i18n.js";

/**
 * 예전 appHeader.js의 NAV_ITEMS와 동일한 데이터. 이 배열만 고치면
 * 메뉴 항목이 늘거나 줄어도 화면이 자동으로 갱신됩니다.
 */
// 요청 순서: 홈 → 데이터 업로드 → My People → My Time → 검색 → 지식 그래프.
// 예전엔 My People/My Time이 "My Life" 드롭다운 안에 숨어있고 Recap도 같이
// 있었는데, 이번 요청으로 두 페이지를 최상위 메뉴로 바로 꺼내고(Recap은 삭제
// 요청에 따라 메뉴에서 제외 — 관련 코드는 vite.config.js에서 주석 처리함)
// 순서도 요청대로 재배열함.
const NAV_ITEMS = [
  { page: "home", href: "index.html", label: "홈" },
  { page: "imap-collect", href: "imap-collect.html", label: "데이터 업로드" },
  { page: "mypeople", href: "mypeople.html", label: "My People" },
  { page: "mytime", href: "mytime.html", label: "My Time" },
  { page: "search", href: "search.html", label: "검색" },
  { page: "graph-viz", href: "graph-viz.html", label: "지식 그래프" },
];

/** 언어 드롭다운 데이터 — 옵션을 추가/삭제하려면 이 배열만 고치면 됨 */
const LANG_OPTIONS = [
  { code: "ko", label: "🇰🇷 한국어", short: "KO" },
  { code: "en", label: "🇺🇸 English", short: "EN" },
  { code: "ja", label: "🇯🇵 日本語", short: "JA" },
];

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

export default function Header({ activePage }) {
  // 현재 언어 — 이 state가 바뀌면 아래 <span id="current-lang">가 자동으로 갱신됨
  const [lang, setLang] = useState("ko");

  function handleSelectLang(code) {
    setLang(code); // React가 화면(KO→EN 표시)을 즉시 갱신
    changeLanguage(code); // i18next가 실제 번역 텍스트를 페이지 전체에 적용
  }

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
          <ul className="navbar-right d-flex align-items-center gap-3 pe-3">
            {/* "로그인 버튼이랑 번역 버튼 주석 처리" 요청에 따라 둘 다 주석 처리함
                (완전 삭제 대신 나중에 필요하면 바로 되살릴 수 있도록 주석으로 남김).
            <li className="nav-item">
              <button type="button" className="gw-login-btn">
                로그인
              </button>
            </li>
            <li className="nav-item dropdown">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <a
                    href="#"
                    role="button"
                    className="gw-lang-trigger"
                    style={{
                      textDecoration: "none",
                      cursor: "pointer",
                    }}
                  >
                    <i
                      className="bi bi-translate"
                      style={{ fontSize: "1.2rem", verticalAlign: "middle" }}
                    ></i>
                    <span
                      id="current-lang"
                      style={{ marginLeft: "4px", fontSize: ".9rem" }}
                    >
                      {LANG_OPTIONS.find((o) => o.code === lang)?.short}
                    </span>
                  </a>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="dropdown-menu show"
                    align="end"
                    sideOffset={6}
                  >
                    {LANG_OPTIONS.map((opt) => (
                      <DropdownMenu.Item
                        key={opt.code}
                        className="dropdown-item"
                        style={{ cursor: "pointer" }}
                        onSelect={() => handleSelectLang(opt.code)}
                      >
                        {opt.label}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </li>
            */}
          </ul>
        </nav>
      </div>
    </div>
  );
}
