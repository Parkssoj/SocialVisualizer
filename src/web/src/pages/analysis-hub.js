/**
 * "분석 결과 보기" 허브 페이지 진입점 — 공통 헤더/푸터 초기화만 담당(콘텐츠는 정적 HTML의 My People/My Time/Recap/검색 바로가기 카드들).
 *
 * Entry point for the "view results" hub page — only wires up the shared header/footer; the page
 * content is static HTML linking to My People/My Time/Recap/Search.
 */
import { bootstrapApp } from "../main-app.js";
import "../scss/pages/analysis-hub.scss";

// 공통 헤더/사이드바 등 초기화
bootstrapApp("analysis-hub");
