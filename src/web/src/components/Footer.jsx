/**
공통 React 푸터 — 브랜드명을 표시하는 최소 컴포넌트로, React로 전환된 페이지들이 함께 쓴다.

Shared React footer — a minimal component that displays the brand name, reused by every
React-converted page.
 */
export default function Footer({ brand = 'MailGrapher' }) {
  return (
    <footer id="app-footer">
      <div className="float-end">{brand}</div>
      <div className="clearfix"></div>
    </footer>
  );
}
