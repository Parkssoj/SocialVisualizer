"use client";
import React, { memo, useEffect, useState } from "react";

// --- 타입 정의 ---
type IconType = "kakao" | "naver" | "gmail" | "appleNotes" | "icloud" | "line";
type GlowColor = "amber" | "orange";

interface SkillConfig {
  id: string;
  orbitRadius: number;
  size: number;
  /** 시간(time)에 speed를 곱한 값에 더해지는 시작 각도(라디안) */
  phaseShift: number;
  /** 초당 회전 속도(라디안). 부호가 반대면 반대 방향으로 돎 */
  speed: number;
  iconType: IconType;
  glowColor: GlowColor;
  label: string;
}

interface OrbitingSkillProps {
  config: SkillConfig;
  angle: number;
}

interface GlowingOrbitPathProps {
  radius: number;
  glowColor?: GlowColor;
}

// --- 로고 이미지 매핑 (지구본 마커에 쓰는 것과 같은 /images/logos/ 파일 재사용) ---
const iconMeta: Record<IconType, { src: string; color: string }> = {
  kakao: { src: "/images/logos/kakao.png", color: "#F4C60B" },
  naver: { src: "/images/logos/naver.png", color: "#F97316" },
  gmail: { src: "/images/logos/gmail.png", color: "#FB923C" },
  appleNotes: { src: "/images/logos/apple-notes.png", color: "#EAB308" },
  icloud: { src: "/images/logos/icloud.png", color: "#F59E0B" },
  line: { src: "/images/logos/line.png", color: "#D97706" },
};

const SkillIcon = memo(({ type }: { type: IconType }) => {
  const meta = iconMeta[type];
  if (!meta) return null;
  return (
    <img
      src={meta.src}
      alt=""
      className="h-full w-full rounded-full object-cover"
      draggable={false}
    />
  );
});
SkillIcon.displayName = "SkillIcon";

// --- 안쪽 궤도 3개(시계 방향) + 바깥 궤도 3개(반시계 방향, 더 느리게) ---
const skillsConfig: SkillConfig[] = [
  {
    id: "kakao",
    orbitRadius: 143,
    size: 69,
    phaseShift: 0,
    speed: 0.4,
    iconType: "kakao",
    glowColor: "amber",
    label: "카카오톡",
  },
  {
    id: "naver",
    orbitRadius: 143,
    size: 77,
    phaseShift: (2 * Math.PI) / 3,
    speed: 0.4,
    iconType: "naver",
    glowColor: "amber",
    label: "네이버",
  },
  {
    id: "gmail",
    orbitRadius: 241,
    size: 69,
    phaseShift: Math.PI / 6 + (4 * Math.PI) / 3,
    speed: -0.25,
    iconType: "gmail",
    glowColor: "orange",
    label: "Gmail",
  },
  {
    id: "apple-notes",
    orbitRadius: 241,
    size: 81,
    phaseShift: Math.PI / 6,
    speed: -0.25,
    iconType: "appleNotes",
    glowColor: "orange",
    label: "Apple 메모",
  },
  {
    id: "icloud",
    orbitRadius: 241,
    size: 73,
    phaseShift: Math.PI / 6 + (2 * Math.PI) / 3,
    speed: -0.25,
    iconType: "icloud",
    glowColor: "orange",
    label: "iCloud",
  },
  {
    id: "line",
    orbitRadius: 143,
    size: 69,
    phaseShift: (4 * Math.PI) / 3,
    speed: 0.4,
    iconType: "line",
    glowColor: "amber",
    label: "Line",
  },
];

const OrbitingSkill = memo(({ config, angle }: OrbitingSkillProps) => {
  const { orbitRadius, size, iconType, label } = config;
  const x = Math.cos(angle) * orbitRadius;
  const y = Math.sin(angle) * orbitRadius;
  const accent = iconMeta[iconType]?.color ?? "#F59E0B";

  return (
    <div
      className="group absolute top-1/2 left-1/2"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        transform: `translate(calc(${x}px - 50%), calc(${y}px - 50%))`,
      }}
    >
      <div
        className="relative flex h-full w-full items-center justify-center rounded-full bg-white p-[4px] shadow-lg transition-transform duration-200 ease-out group-hover:scale-125"
        style={{
          boxShadow: `0 4px 14px -4px ${accent}66, 0 0 0 1px ${accent}33`,
        }}
      >
        <SkillIcon type={iconType} />
        <div className="pointer-events-none absolute -bottom-[47px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[#2d2410]/90 px-[13px] py-[5px] text-[14px] text-amber-50 opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100">
          {label}
        </div>
      </div>
    </div>
  );
});
OrbitingSkill.displayName = "OrbitingSkill";

// --- 궤도 링: pulse 애니메이션 제거, 고정된 정적 링 ---
const GlowingOrbitPath = memo(
  ({ radius, glowColor = "amber" }: GlowingOrbitPathProps) => {
    const glowColors: Record<
      GlowColor,
      { primary: string; secondary: string; border: string }
    > = {
      amber: {
        primary: "rgba(245, 158, 11, 0.35)",
        secondary: "rgba(245, 158, 11, 0.16)",
        border: "rgba(245, 158, 11, 0.35)",
      },
      orange: {
        primary: "rgba(249, 115, 22, 0.32)",
        secondary: "rgba(249, 115, 22, 0.14)",
        border: "rgba(249, 115, 22, 0.32)",
      },
    };
    const colors = glowColors[glowColor] ?? glowColors.amber;

    return (
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ width: `${radius * 2}px`, height: `${radius * 2}px` }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle, transparent 55%, ${colors.secondary} 80%, ${colors.primary} 100%)`,
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{ border: `1px dashed ${colors.border}` }}
        />
      </div>
    );
  },
);
GlowingOrbitPath.displayName = "GlowingOrbitPath";

const orbitConfigs: Array<{ radius: number; glowColor: GlowColor }> = [
  { radius: 143, glowColor: "amber" },
  { radius: 241, glowColor: "orange" },
];

// --- 메인 컴포넌트: 서비스 로고들이 지구본 바로 위에서 궤도를 도는 클러스터 ---
export default function OrbitingSkills() {
  const [time, setTime] = useState(0);

  useEffect(() => {
    let animationId: number;
    let lastTime = performance.now();
    const animate = (now: number) => {
      const deltaTime = (now - lastTime) / 1000;
      lastTime = now;
      setTime((prev) => prev + deltaTime);
      animationId = requestAnimationFrame(animate);
    };
    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <div className="relative h-[546px] w-[546px] shrink-0">
      {/* 중앙 아이콘 — 우리 서비스 로고, 흰 배경 원 위에 */}
      <div className="absolute top-1/2 left-1/2 z-10 flex h-[125px] w-[125px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-2xl ring-[5px] ring-amber-400/40">
        {/* <div className="absolute inset-0 rounded-full bg-amber-400/30 blur-[31px]" /> */}
        <img
          src="/images/logos/socialvisualizer.png"
          alt="Social Visualizer"
          className="relative z-10 h-[73px] w-[73px] rounded-full object-contain"
          draggable={false}
        />
      </div>

      {orbitConfigs.map((config) => (
        <GlowingOrbitPath
          key={`path-${config.radius}`}
          radius={config.radius}
          glowColor={config.glowColor}
        />
      ))}

      {skillsConfig.map((config) => (
        <OrbitingSkill
          key={config.id}
          config={config}
          angle={time * config.speed + config.phaseShift}
        />
      ))}
    </div>
  );
}
