// Lean shared entry point for MailGrapher's real feature pages.
// Unlike the old main-minimal.js "kitchen sink", this only loads what the
// 6 feature pages + login actually use: bootstrap/popper, dompurify, i18next, styles.

import * as bootstrap from "bootstrap";
window.bootstrap = bootstrap;
globalThis.bootstrap = bootstrap;

import "./main.scss";

import "./utils/security.js";
import "./js/helpers/smartresize.js";
import "./js/init.js";
import "./utils/i18n.js";

import { renderHeader, renderFooter } from "./layout/appHeader.js";
// 우측 하단 떠 있는 검색 버튼 — side-effect import라 main-app.js를 쓰는 모든 페이지에
// 자동으로 뜬다(로그인 페이지는 main-app.js를 안 쓰므로 자연히 제외됨).
import "./components/floatingSearch.js";

/**
 * Mounts the shared header/footer for a page.
 * Call once at the top of each page's own entry module (src/pages/<name>.js)
 * with the page's key (matches NAV_ITEMS in appHeader.js), then run the
 * page-specific logic that follows.
 */
export function bootstrapApp(activePage) {
  renderHeader(activePage);
  renderFooter();
}
