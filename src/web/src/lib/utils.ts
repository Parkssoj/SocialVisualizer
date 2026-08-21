/**
 * shadcn/ui 계열 컴포넌트들이 공통으로 쓰는 클래스네임 병합 유틸("@/lib/utils"의 cn).
 * components.json에 alias는 이미 등록돼 있었지만("utils": "@/lib/utils") 정작
 * src/lib 폴더 자체가 이 프로젝트에 없어서, coverflow-carousel.tsx를 붙이면서
 * 새로 만듦. 원래 shadcn 템플릿은 clsx + tailwind-merge 두 패키지를 쓰는데, 이
 * 프로젝트 package.json엔 아직 둘 다 설치돼 있지 않아서(확인 완료) 별도 npm
 * install 없이 바로 동작하도록 같은 인터페이스의 가벼운 버전을 직접 구현함.
 * 문자열/배열/조건부 객체 형태의 인자를 받아 falsy 값은 걸러내고 공백으로
 * 이어붙임 — tailwind-merge처럼 서로 충돌하는 유틸리티 클래스(예: px-4와 px-6가
 * 동시에 들어오는 경우)를 마지막 값으로 똑똑하게 정리해주진 않지만, 이 프로젝트의
 * shadcn 컴포넌트들이 쓰는 방식(조건부로 클래스를 통째로 갈아 끼우는 정도)에서는
 * 충분함.
 */
type ClassValue =
  | string
  | number
  | null
  | boolean
  | undefined
  | ClassValue[]
  | Record<string, boolean | undefined | null>;

export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = [];

  for (const input of inputs) {
    if (!input) continue;

    if (typeof input === "string" || typeof input === "number") {
      classes.push(String(input));
    } else if (Array.isArray(input)) {
      const nested = cn(...input);
      if (nested) classes.push(nested);
    } else if (typeof input === "object") {
      for (const key in input) {
        if (input[key]) classes.push(key);
      }
    }
  }

  return classes.join(" ");
}
