import { useEffect } from "react";
import { Component as HeroGridBackground } from "./ui/background-snippets.tsx";

/* 미니 프리뷰 카드 — 실제 페이지(mypeople.html/mytime.html)를 iframe으로 그대로
   불러온 뒤 CSS transform: scale로 축소해서 보여준다(캡처 이미지 아님, 진짜 화면).
   iframe 안쪽은 실제 폭(FRAME_W)으로 렌더링되고, 바깥 wrapper는 카드 크기만큼만
   보이도록 overflow:hidden으로 잘라낸다. pointer-events:none으로 iframe 내부와의
   상호작용은 막고, 카드 전체를 감싸는 <a>가 클릭/이동을 담당한다. */
const FRAME_W = 1600;
const FRAME_H = 1020;
function PagePreviewFrame({ src }) {
  return (
    <div className="gw-preview-frame">
      <iframe
        src={src}
        title={src}
        tabIndex={-1}
        scrolling="no"
        style={{ width: FRAME_W, height: FRAME_H }}
      />
    </div>
  );
}

export default function HeroOrbit() {
  // React가 화면을 다 그린 "다음"에 실행됨 — 그래서 .gw-anim 요소들이
  // 실제로 DOM에 존재하는 시점에 안전하게 .visible 클래스를 붙일 수 있음
  useEffect(() => {
    const els = document.querySelectorAll(".gw-orbit-hero .gw-anim");
    requestAnimationFrame(() => {
      els.forEach((el) => el.classList.add("visible"));
    });
  }, []);

  return (
    <div className="gw-orbit-hero">
      <HeroGridBackground />

      <div className="gw-orbit-left">
        <h1
          className="gw-hero-headline gw-anim"
          style={{ transitionDelay: "0.05s" }}
        >
          Social Visualizer
          <br />
        </h1>
        {/* shadcnspace "illuminated-hero" 데모의 글로우 필터를 그대로 가져옴 —
            .gw-hero-headline-glow가 filter: url(#glow-4)로 참조함 (텍스트 디자인만 차용, 나머지 레이아웃/애니메이션은 안 씀) */}
        <svg
          className="absolute -z-1 h-0 w-0"
          width="0"
          height="0"
          aria-hidden="true"
        >
          <defs>
            <filter
              id="glow-4"
              colorInterpolationFilters="sRGB"
              x="-50%"
              y="-200%"
              width="200%"
              height="500%"
            >
              <feGaussianBlur
                in="SourceGraphic"
                stdDeviation="4"
                result="blur4"
              />
              <feGaussianBlur
                in="SourceGraphic"
                stdDeviation="19"
                result="blur19"
              />
              <feGaussianBlur
                in="SourceGraphic"
                stdDeviation="9"
                result="blur9"
              />
              <feGaussianBlur
                in="SourceGraphic"
                stdDeviation="30"
                result="blur30"
              />
              <feColorMatrix
                in="blur4"
                result="color-0-blur"
                type="matrix"
                values="1 0 0 0 0
                        0 0.9803921568627451 0 0 0
                        0 0 0.9647058823529412 0 0
                        0 0 0 0.3 0"
              />
              <feOffset
                in="color-0-blur"
                result="layer-0-offsetted"
                dx="0"
                dy="0"
              />
              <feColorMatrix
                in="blur19"
                result="color-1-blur"
                type="matrix"
                values="0.8156862745098039 0 0 0 0
                        0 0.49411764705882355 0 0 0
                        0 0 0.2627450980392157 0 0
                        0 0 0 0.2 0"
              />
              <feOffset
                in="color-1-blur"
                result="layer-1-offsetted"
                dx="0"
                dy="2"
              />
              <feColorMatrix
                in="blur9"
                result="color-2-blur"
                type="matrix"
                values="1 0 0 0 0
                        0 0.6666666666666666 0 0 0
                        0 0 0.36470588235294116 0 0
                        0 0 0 0.15 0"
              />
              <feOffset
                in="color-2-blur"
                result="layer-2-offsetted"
                dx="0"
                dy="2"
              />
              <feColorMatrix
                in="blur30"
                result="color-3-blur"
                type="matrix"
                values="1 0 0 0 0
                        0 0.611764705882353 0 0 0
                        0 0 0.39215686274509803 0 0
                        0 0 0 0.12 0"
              />
              <feOffset
                in="color-3-blur"
                result="layer-3-offsetted"
                dx="0"
                dy="2"
              />
              <feColorMatrix
                in="blur30"
                result="color-4-blur"
                type="matrix"
                values="0.4549019607843137 0 0 0 0
                        0 0.16470588235294117 0 0 0
                        0 0 0 0 0
                        0 0 0 0.08 0"
              />
              <feOffset
                in="color-4-blur"
                result="layer-4-offsetted"
                dx="0"
                dy="16"
              />
              <feColorMatrix
                in="blur30"
                result="color-5-blur"
                type="matrix"
                values="0.4235294117647059 0 0 0 0
                        0 0.19607843137254902 0 0 0
                        0 0 0.11372549019607843 0 0
                        0 0 0 0.06 0"
              />
              <feOffset
                in="color-5-blur"
                result="layer-5-offsetted"
                dx="0"
                dy="64"
              />
              <feColorMatrix
                in="blur30"
                result="color-6-blur"
                type="matrix"
                values="0.21176470588235294 0 0 0 0
                        0 0.10980392156862745 0 0 0
                        0 0 0.07450980392156863 0 0
                        0 0 0 0.05 0"
              />
              <feOffset
                in="color-6-blur"
                result="layer-6-offsetted"
                dx="0"
                dy="64"
              />
              <feMerge>
                <feMergeNode in="layer-0-offsetted" />
                <feMergeNode in="layer-1-offsetted" />
                <feMergeNode in="layer-2-offsetted" />
                <feMergeNode in="layer-3-offsetted" />
                <feMergeNode in="layer-4-offsetted" />
                <feMergeNode in="layer-5-offsetted" />
                <feMergeNode in="layer-6-offsetted" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
        </svg>
        <p
          className="gw-hero-desc gw-anim"
          style={{ transitionDelay: "0.15s" }}
        >
          흩어진 소셜 데이터를 하나로.
          <br></br>
          Social Visualizer는 메일, 메신저를 연결하여 당신의 인간관계와 삶의
          흐름을 시각화합니다.
        </p>
        <div
          className="gw-hero-cta gw-anim"
          style={{ transitionDelay: "0.22s" }}
        >
          <a href="search.html" className="gw-hero-cta-primary">
            시작하기
          </a>
        </div>
      </div>

      <div className="gw-hero-previews gw-anim" style={{ transitionDelay: "0.28s" }}>
        <a href="mypeople.html" className="gw-preview-card">
          <PagePreviewFrame src="mypeople.html" />
          <div className="gw-preview-overlay">
            <span>My People 바로가기</span>
            <i className="bi bi-arrow-right-short"></i>
          </div>
        </a>
        <a href="mytime.html" className="gw-preview-card">
          <PagePreviewFrame src="mytime.html" />
          <div className="gw-preview-overlay">
            <span>My Time 바로가기</span>
            <i className="bi bi-arrow-right-short"></i>
          </div>
        </a>
      </div>
    </div>
  );
}
