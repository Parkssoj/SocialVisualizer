/**
 * 홈 화면(index.html) 전용 React 푸터 — 브랜드명을 표시하는 최소 컴포넌트.
 *
 * React footer used only on the home page — minimal component that displays the brand name.
 */
export default function Footer({ brand = 'MailGrapher' }) {
  return (
    <footer id="app-footer">
      <div className="float-end">{brand}</div>
      <div className="clearfix"></div>
    </footer>
  );
}
