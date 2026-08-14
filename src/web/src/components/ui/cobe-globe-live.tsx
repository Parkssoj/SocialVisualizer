"use client"

import { useEffect, useRef, useCallback } from "react"
import createGlobe from "cobe"

interface LiveMarker {
  id: string
  location: [number, number]
  /** public/images/logos/ 안의 로고 파일명 (예: "kakao.svg") */
  logo: string
  /** 뱃지 라벨. "Message"면 사각형 대신 말풍선 모양 박스로 표시됨 */
  label: string
  /** 뱃지에 보여줄 문구 */
  message: string
}

interface GlobeLiveProps {
  markers?: LiveMarker[]
  className?: string
  speed?: number
}

// 위치는 전부 지구본 위에서 서로 겹치지 않고 골고루 흩어지도록
// 대륙/경도를 최대한 다르게 잡음 (실제 지사 위치와 대략적으로만 맞춤)
const defaultMarkers: LiveMarker[] = [
  { id: "kakao", location: [37.57, 126.98], logo: "kakao.svg", label: "Message", message: "작년에 우리 어디서 만났어?" },
  { id: "naver", location: [45.19, 5.72], logo: "naver.svg", label: "Mail", message: "보고서 보내드립니다." },
  { id: "gmail", location: [37.42, -122.08], logo: "gmail.svg", label: "Gmail", message: "문의 드립니다." },
  { id: "apple-memo", location: [-23.55, -46.63], logo: "apple-notes.svg", label: "Memo", message: "오늘 하루 기록" },
  { id: "icloud", location: [-33.87, 151.21], logo: "icloud.svg", label: "Mail", message: "Social Visualizer 추천합니다." },
  { id: "line", location: [35.68, 139.65], logo: "line.svg", label: "Message", message: "2시에 학교에서 만나" },
]

export function GlobeLive({
  markers = defaultMarkers,
  className = "",
  speed = 0.003,
}: GlobeLiveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointerInteracting = useRef<{ x: number; y: number } | null>(null)
  const dragOffset = useRef({ phi: 0, theta: 0 })
  const phiOffsetRef = useRef(0)
  const thetaOffsetRef = useRef(0)
  const isPausedRef = useRef(false)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerInteracting.current = { x: e.clientX, y: e.clientY }
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing"
    isPausedRef.current = true
  }, [])

  const handlePointerUp = useCallback(() => {
    if (pointerInteracting.current !== null) {
      phiOffsetRef.current += dragOffset.current.phi
      thetaOffsetRef.current += dragOffset.current.theta
      dragOffset.current = { phi: 0, theta: 0 }
    }
    pointerInteracting.current = null
    if (canvasRef.current) canvasRef.current.style.cursor = "grab"
    isPausedRef.current = false
  }, [])

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (pointerInteracting.current !== null) {
        dragOffset.current = {
          phi: (e.clientX - pointerInteracting.current.x) / 300,
          theta: (e.clientY - pointerInteracting.current.y) / 1000,
        }
      }
    }
    window.addEventListener("pointermove", handlePointerMove, { passive: true })
    window.addEventListener("pointerup", handlePointerUp, { passive: true })
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }
  }, [handlePointerUp])

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    let globe: ReturnType<typeof createGlobe> | null = null
    let animationId: number
    let phi = 0

    function init() {
      const width = canvas.offsetWidth
      if (width === 0 || globe) return
      globe = createGlobe(canvas, {
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        width, height: width,
        phi: 0, theta: 0.2, dark: 0, diffuse: 1.5,
        mapSamples: 16000, mapBrightness: 10,
        baseColor: [0.95, 0.95, 0.95],
        markerColor: [0.9, 0.2, 0.2],
        glowColor: [0.94, 0.93, 0.91],
        markerElevation: 0.01,
        markers: markers.map((m) => ({ location: m.location, size: 0.02, id: m.id })),
        arcs: [], arcColor: [0.9, 0.3, 0.3],
        arcWidth: 0.5, arcHeight: 0.25, opacity: 0.7,
      })
      function animate() {
        if (!isPausedRef.current) phi += speed
        globe!.update({
          phi: phi + phiOffsetRef.current + dragOffset.current.phi,
          theta: 0.2 + thetaOffsetRef.current + dragOffset.current.theta,
        })
        animationId = requestAnimationFrame(animate)
      }
      animate()
      setTimeout(() => canvas && (canvas.style.opacity = "1"))
    }

    if (canvas.offsetWidth > 0) {
      init()
    } else {
      const ro = new ResizeObserver((entries) => {
        if (entries[0]?.contentRect.width > 0) {
          ro.disconnect()
          init()
        }
      })
      ro.observe(canvas)
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId)
      if (globe) globe.destroy()
    }
  }, [markers, speed])

  return (
    <div className={`relative aspect-square select-none ${className}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        style={{
          width: "100%", height: "100%", cursor: "grab", opacity: 0,
          transition: "opacity 1.2s ease", borderRadius: "50%", touchAction: "none",
        }}
      />
      {markers.map((m) => {
        const isMessage = m.label === "Message"
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
                gap: "0.5rem",
                padding: "0.55rem 0.85rem",
                background: "linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)",
                // 말풍선(Message)은 더 둥글게, 나머지는 각진 뱃지 형태 유지
                borderRadius: isMessage ? 16 : 8,
                boxShadow: "0 4px 14px rgba(0,0,0,0.28)",
                whiteSpace: "nowrap" as const,
              }}
            >
              <img
                src={`/images/logos/${m.logo}`}
                alt=""
                width={20}
                height={20}
                style={{ borderRadius: 5, flexShrink: 0, display: "block" }}
              />
              {!isMessage && (
                <span style={{
                  fontFamily: "monospace", fontSize: "0.68rem", fontWeight: 600,
                  letterSpacing: "0.06em", color: "#ffffff", textTransform: "uppercase" as const,
                }}>{m.label}</span>
              )}
              <span style={{
                fontFamily: "system-ui, sans-serif",
                fontSize: "0.78rem",
                color: "rgba(255,255,255,0.9)",
                ...(isMessage
                  ? {}
                  : { paddingLeft: "0.45rem", borderLeft: "1px solid rgba(255,255,255,0.2)" }),
              }}>
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
                    borderTop: "7px solid #2d2d2d",
                  }}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
