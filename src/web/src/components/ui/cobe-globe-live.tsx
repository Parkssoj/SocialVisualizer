"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import createGlobe from "cobe";

// ─── cobe가 대륙 점무늬를 그릴 때 쓰는 것과 "완전히 동일한" 피보나치 격자 계산 ───
// cobe(node_modules/cobe/dist/index.esm.js)의 프래그먼트 셰이더를 직접 뜯어보면,
// 점 하나의 위치는 인덱스 j(0 ~ mapSamples-1)에 대해
//   y = 1 - 2j/mapSamples
//   방위각 = 2π × frac(j × 0.6180339887…)   (골든비율 conjugate)
// 로 정해지고, 점 하나의 반지름은 8e-3(= 0.008) 고정값으로 하드코딩돼 있음.
// 그래서 이 공식을 그대로 복사해서, 원하는 위도/경도에서 "실제로 존재하는" 점들 중
// 가장 가까운 걸 찾아 마커를 그 점 위치에 정확히 겹치게 스냅시키면(+반지름도 0.008로 맞추면)
// 새 원을 얹는 게 아니라 "그 점 자체가 빨개진" 것처럼 보이게 됨.
const MAP_SAMPLES = 16000;
const GLOBE_DOT_RADIUS = 0.008; // cobe 셰이더의 smoothstep(8e-3, 0., g) 하드코딩 값과 동일
const PHI_INV = 0.6180339887498949; // golden ratio conjugate

function latLngToVec3(lat: number, lng: number): [number, number, number] {
  const r = (lat * Math.PI) / 180;
  const a = (lng * Math.PI) / 180 - Math.PI;
  const cosR = Math.cos(r);
  return [-cosR * Math.cos(a), Math.sin(r), cosR * Math.sin(a)];
}

function vec3ToLatLng([x, y, z]: [number, number, number]): [number, number] {
  const lat = (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI;
  let lng = (Math.atan2(z, -x) * 180) / Math.PI + 180;
  lng = (((lng + 180) % 360) + 360) % 360 - 180;
  return [lat, lng];
}

function fibonacciLatticePoint(j: number, total: number): [number, number, number] {
  const y = 1 - (2 * j) / total;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const azimuth = 2 * Math.PI * ((j * PHI_INV) % 1);
  return [Math.cos(azimuth) * radius, y, Math.sin(azimuth) * radius];
}

/** 원하는 위도/경도에서, cobe가 실제로 그리는 점들 중 가장 가까운 점의 위도/경도를 찾음 */
function snapToNearestGlobeDot(
  lat: number,
  lng: number,
  totalSamples: number,
): [number, number] {
  const target = latLngToVec3(lat, lng);
  let bestJ = 0;
  let bestDistSq = Infinity;
  for (let j = 0; j < totalSamples; j++) {
    const [px, py, pz] = fibonacciLatticePoint(j, totalSamples);
    const dx = px - target[0];
    const dy = py - target[1];
    const dz = pz - target[2];
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestJ = j;
    }
  }
  return vec3ToLatLng(fibonacciLatticePoint(bestJ, totalSamples));
}

interface LiveMarker {
  id: string;
  location: [number, number];
  /** public/images/logos/ 안의 로고 파일명 (예: "kakao.png") */
  logo: string;
  /** 뱃지 라벨. "Message"면 사각형 대신 말풍선 모양 박스로 표시됨 */
  label: string;
  /** 뱃지에 보여줄 문구 */
  message: string;
}

interface GlobeLiveProps {
  markers?: LiveMarker[];
  className?: string;
  speed?: number;
}

// 로고 파일명 → 브랜드 포인트 컬러. 뱃지 위쪽 얇은 라인/그림자 톤으로만 살짝 씀
// (배경 전체를 브랜드 색으로 칠하지 않고 화이트 글래스 카드로 통일해서 조화롭게)
const LOGO_ACCENT: Record<string, string> = {
  "kakao.png": "#F4C60B",
  "naver.png": "#03C75A",
  "gmail.png": "#EA4335",
  "apple-notes.png": "#E0A72E",
  "icloud.png": "#3A9DF3",
  "line.png": "#06C755",
};
const FALLBACK_ACCENT = "#a3823f";

// 위치는 전부 지구본 위에서 서로 겹치지 않고 골고루 흩어지도록
// 대륙/경도를 최대한 다르게 잡음 (실제 지사 위치와 대략적으로만 맞춤)
const defaultMarkers: LiveMarker[] = [
  {
    id: "santiago",
    location: [-33.45, -70.67],
    logo: "kakao.png",
    label: "Message",
    message: "이번 주말에 시간 돼?",
  },
  {
    id: "naver",
    location: [-1.29, 36.82],
    logo: "naver.png",
    label: "Mail",
    message: "보고서 보내드립니다.",
  },
  {
    id: "gmail",
    location: [37.42, -122.08],
    logo: "gmail.png",
    label: "Gmail",
    message: "문의 드립니다.",
  },
  {
    id: "apple-memo",
    location: [-23.55, -46.63],
    logo: "apple-notes.png",
    label: "Memo",
    message: "오늘 하루 기록",
  },
  {
    id: "icloud",
    location: [-33.87, 151.21],
    logo: "icloud.png",
    label: "Mail",
    message: "Social Visualizer 추천합니다.",
  },
  {
    id: "line",
    location: [35.68, 139.65],
    logo: "line.png",
    label: "Message",
    message: "2시에 학교에서 만나",
  },
  {
    id: "london",
    location: [51.51, -0.13],
    logo: "kakao.png",
    label: "Message",
    message: "이따 저녁에 통화 가능해?",
  },
  {
    id: "cairo",
    location: [30.04, 31.24],
    logo: "naver.png",
    label: "Mail",
    message: "견적서 확인 부탁드립니다.",
  },
  {
    id: "mumbai",
    location: [19.08, 72.88],
    logo: "gmail.png",
    label: "Gmail",
    message: "회의 일정 조율 드립니다.",
  },

  {
    id: "lima",
    location: [-12.05, -77.04],
    logo: "apple-notes.png",
    label: "Memo",
    message: "운동 루틴 기록",
  },

  {
    id: "moscow",
    location: [55.76, 37.62],
    logo: "icloud.png",
    label: "Mail",
    message: "사진 백업 완료했어요.",
  },
  {
    id: "cape-town",
    location: [-33.92, 18.42],
    logo: "line.png",
    label: "Message",
    message: "출발했어, 곧 도착해!",
  },
  {
    id: "buenos-aires",
    location: [-34.6, -58.38],
    logo: "kakao.png",
    label: "Message",
    message: "생일 축하해 🎉",
  },
  {
    id: "mexico-city",
    location: [19.43, -99.13],
    logo: "naver.png",
    label: "Mail",
    message: "계약서 검토 부탁드려요.",
  },
  {
    id: "toronto",
    location: [43.65, -79.38],
    logo: "gmail.png",
    label: "Gmail",
    message: "인터뷰 일정 안내드립니다.",
  },
];

export function GlobeLive({
  markers = defaultMarkers,
  className = "",
  speed = 0.003,
}: GlobeLiveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerInteracting = useRef<{ x: number; y: number } | null>(null);
  const dragOffset = useRef({ phi: 0, theta: 0 });
  const phiOffsetRef = useRef(0);
  const thetaOffsetRef = useRef(0);
  const isPausedRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerInteracting.current = { x: e.clientX, y: e.clientY };
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
    isPausedRef.current = true;
  }, []);

  const handlePointerUp = useCallback(() => {
    if (pointerInteracting.current !== null) {
      phiOffsetRef.current += dragOffset.current.phi;
      thetaOffsetRef.current += dragOffset.current.theta;
      dragOffset.current = { phi: 0, theta: 0 };
    }
    pointerInteracting.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
    isPausedRef.current = false;
  }, []);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (pointerInteracting.current !== null) {
        dragOffset.current = {
          phi: (e.clientX - pointerInteracting.current.x) / 300,
          theta: (e.clientY - pointerInteracting.current.y) / 1000,
        };
      }
    };
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerUp]);

  // markers prop에 들어온 위도/경도를 cobe가 실제로 그리는 점무늬 중
  // 가장 가까운 점 위치로 스냅. 이걸로 만든 좌표를 createGlobe에 그대로 넘기면
  // "새 원을 얹는" 게 아니라 "이미 있는 점 하나가 빨개지는" 결과가 됨.
  const snappedMarkers = useMemo(
    () =>
      markers.map((m) => ({
        location: snapToNearestGlobeDot(m.location[0], m.location[1], MAP_SAMPLES),
        // cobe 셰이더가 그리는 낱개 점과 정확히 같은 반지름(8e-3)
        size: GLOBE_DOT_RADIUS,
        id: m.id,
      })),
    [markers],
  );

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    let globe: ReturnType<typeof createGlobe> | null = null;
    let animationId: number;
    let phi = 0;

    function init() {
      const width = canvas.offsetWidth;
      if (width === 0 || globe) return;
      globe = createGlobe(canvas, {
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        width,
        height: width,
        phi: 0,
        theta: 0.2,
        dark: 0,
        diffuse: 1.5,
        mapSamples: MAP_SAMPLES,
        mapBrightness: 10,
        baseColor: [0.95, 0.95, 0.95],
        markerColor: [0.96, 0.08, 0.08],
        glowColor: [0.94, 0.93, 0.91],
        markerElevation: 0,
        markers: snappedMarkers,
        arcs: [],
        arcColor: [0.9, 0.3, 0.3],
        arcWidth: 0.5,
        arcHeight: 0.25,
        opacity: 0.7,
      });
      function animate() {
        if (!isPausedRef.current) phi += speed;
        globe!.update({
          phi: phi + phiOffsetRef.current + dragOffset.current.phi,
          theta: 0.2 + thetaOffsetRef.current + dragOffset.current.theta,
        });
        animationId = requestAnimationFrame(animate);
      }
      animate();
      setTimeout(() => canvas && (canvas.style.opacity = "1"));
    }

    if (canvas.offsetWidth > 0) {
      init();
    } else {
      const ro = new ResizeObserver((entries) => {
        if (entries[0]?.contentRect.width > 0) {
          ro.disconnect();
          init();
        }
      });
      ro.observe(canvas);
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (globe) globe.destroy();
    };
  }, [snappedMarkers, speed]);

  return (
    <div className={`relative aspect-square select-none ${className}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        style={{
          width: "100%",
          height: "100%",
          cursor: "grab",
          opacity: 0,
          transition: "opacity 1.2s ease",
          borderRadius: "50%",
          touchAction: "none",
        }}
      />
      {markers.map((m) => {
        const isMessage = m.label === "Message";
        const accent = LOGO_ACCENT[m.logo] ?? FALLBACK_ACCENT;
        const radius = isMessage ? 18 : 12;
        return (
          <div
            key={m.id}
            style={{
              position: "absolute",
              positionAnchor: `--cobe-${m.id}`,
              bottom: "anchor(top)",
              left: "anchor(center)",
              translate: "-50% 0",
              marginBottom: 14,
              pointerEvents: "none" as const,
              opacity: `var(--cobe-visible-${m.id}, 0)`,
              filter: `blur(calc((1 - var(--cobe-visible-${m.id}, 0)) * 8px))`,
              transition: "opacity 0.4s, filter 0.4s",
            }}
          >
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: "0.55rem",
                padding: "0.6rem 0.95rem",
                background: "rgba(255,255,255,0.96)",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
                border: `1px solid ${accent}3a`,
                borderRadius: radius,
                boxShadow: `0 16px 32px -10px ${accent}45, 0 3px 10px rgba(30,32,26,0.10)`,
                whiteSpace: "nowrap" as const,
                overflow: "hidden",
              }}
            >
              {/* 브랜드 포인트 컬러 — 카드 위쪽에 얇은 라인으로만 */}
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 3,
                  background: accent,
                  opacity: 0.9,
                }}
              />
              <img
                src={`/images/logos/${m.logo}`}
                alt=""
                width={20}
                height={20}
                style={{
                  borderRadius: 6,
                  flexShrink: 0,
                  display: "block",
                  boxShadow: `0 0 0 2px ${accent}26`,
                }}
              />
              {!isMessage && (
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: "0.66rem",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    color: "#3a4234",
                    textTransform: "uppercase" as const,
                  }}
                >
                  {m.label}
                </span>
              )}
              <span
                style={{
                  fontFamily: "system-ui, sans-serif",
                  fontSize: "0.79rem",
                  fontWeight: 500,
                  color: "#4b5245",
                  ...(isMessage
                    ? {}
                    : {
                        paddingLeft: "0.5rem",
                        borderLeft: "1px solid rgba(47,54,43,0.14)",
                      }),
                }}
              >
                {m.message}
              </span>

              {/* 말풍선 꼬리 — 지구본 위 점을 향해 아래로 뾰족하게 */}
              {isMessage && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    bottom: -6,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 0,
                    height: 0,
                    borderLeft: "6px solid transparent",
                    borderRight: "6px solid transparent",
                    borderTop: "7px solid rgba(255,255,255,0.96)",
                    filter: "drop-shadow(0 2px 2px rgba(30,32,26,0.10))",
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
