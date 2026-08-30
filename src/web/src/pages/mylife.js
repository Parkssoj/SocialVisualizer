/**
 * "My Life" 랜딩 페이지 진입점 — 공통 헤더/푸터만 초기화하고 페이지 자체 콘텐츠는 정적 HTML.
 *
 * Entry point for the "My Life" landing page — only wires up the shared header/footer; the page
 * content itself is static HTML.
 */
import { bootstrapApp } from "../main-app.js";
import "../scss/pages/mylife.scss";

bootstrapApp("mylife");
