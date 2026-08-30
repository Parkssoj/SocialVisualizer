// Security utilities for XSS prevention
/**
 * DOMPurify 기반 XSS 방지 유틸 모음 — HTML/텍스트 정화 및 안전한 innerHTML 대입 함수 제공, 레거시 코드를 위해 window 전역에도 노출한다.
 *
 * DOMPurify-based XSS-prevention helpers — sanitizes HTML/text and provides a safe innerHTML setter;
 * also exposed on window for legacy code.
 */
import DOMPurify from 'dompurify';

// 허용 태그/속성을 화이트리스트로 제한해 HTML을 정화
export function sanitizeHtml(html, options = {}) {
  if (!html || typeof html !== 'string') {
    return '';
  }

  const config = {
    ALLOWED_TAGS: [
      'div',
      'span',
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'strong',
      'em',
      'br',
      'img',
      'a'
    ],
    ALLOWED_ATTR: ['class', 'id', 'src', 'alt', 'href', 'target', 'title'],
    ALLOW_DATA_ATTR: false,
    ...options
  };

  return DOMPurify.sanitize(html, config);
}

// 모든 HTML 태그를 제거하고 순수 텍스트만 반환
export function sanitizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Strip all HTML tags and decode HTML entities
  const div = document.createElement('div');
  div.innerHTML = DOMPurify.sanitize(text, { ALLOWED_TAGS: [] });
  return div.textContent || div.innerText || '';
}

// 정화된 HTML을 곧바로 innerHTML에 대입하는 편의 함수
export function setSafeInnerHTML(element, html, options = {}) {
  if (!element || !html) {
    return;
  }

  element.innerHTML = sanitizeHtml(html, options);
}

// 레거시 코드가 window.sanitizeHtml 등으로 바로 쓸 수 있도록 전역에도 노출
if (typeof window !== 'undefined') {
  window.sanitizeHtml = sanitizeHtml;
  window.sanitizeText = sanitizeText;
  window.setSafeInnerHTML = setSafeInnerHTML;
}

export default {
  sanitizeHtml,
  sanitizeText,
  setSafeInnerHTML
};
