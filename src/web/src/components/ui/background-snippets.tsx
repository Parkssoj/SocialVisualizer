/**
 * 히어로 배경용 컴포넌트. 원래는 "Bloom Field" 메쉬 그라데이션 배경이었으나 흰 배경으로 보이도록 현재는 내용이 통째로 주석 처리되어 있어 빈 div만 렌더링한다.
 *
 * Hero background component. Originally rendered a "Bloom Field" mesh gradient, but that markup is
 * currently commented out to show a plain white background, so it renders an empty div.
 */
export const Component = () => {
  return (
    <div className="absolute inset-0 -z-10 h-full w-full bg-white">
      {/* 21st.dev "Bloom Field" 메쉬 그라데이션 — 하얀 배경으로 보려고 잠깐 주석 처리함.
          다시 켜려면 아래 블록의 {/* * / 만 지우고 이 줄들을 주석 밖으로 꺼내면 됨.
      <style>{`
        .gw-bloom-field {
          background-color: #FCF2E7;
          background-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.065'/></svg>"),
            radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0) 52%, rgba(0, 0, 0, 0.08000000000000002) 100%),
            radial-gradient(circle at 64.25% 49.89%, rgba(253, 236, 222, 1) 0%, rgba(253, 236, 222, 0.844) 10.28%, rgba(253, 236, 222, 0.5) 20.55%, rgba(253, 236, 222, 0.156) 30.83%, rgba(253, 236, 222, 0) 41.1%),
            radial-gradient(circle at 28.22% 71.84%, rgba(250, 213, 186, 1) 0%, rgba(250, 213, 186, 0.844) 12.81%, rgba(250, 213, 186, 0.5) 25.63%, rgba(250, 213, 186, 0.156) 38.44%, rgba(250, 213, 186, 0) 51.25%),
            radial-gradient(circle at 47.66% 15.52%, rgba(250, 223, 232, 1) 0%, rgba(250, 223, 232, 0.844) 16.14%, rgba(250, 223, 232, 0.5) 32.27%, rgba(250, 223, 232, 0.156) 48.41%, rgba(250, 223, 232, 0) 64.55%),
            radial-gradient(circle at 77.83% 80.04%, rgba(252, 244, 234, 1) 0%, rgba(252, 244, 234, 0.844) 19.02%, rgba(252, 244, 234, 0.5) 38.05%, rgba(252, 244, 234, 0.156) 57.07%, rgba(252, 244, 234, 0) 76.1%);
          background-size: 120px 120px, auto, auto, auto, auto, auto;
          background-blend-mode: overlay, normal, normal, normal, normal, normal;
        }
      `}</style>
      <div className="gw-bloom-field absolute inset-0 h-full w-full" />
      */}
    </div>
  );
};
