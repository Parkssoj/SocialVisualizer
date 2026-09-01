# web — Vite 프론트엔드

Social Visualizer의 웹 UI로, Vite 멀티페이지 앱(MPA)이며 `production/*.html` 각각이 별도 빌드 진입점이다.
스타일은 Bootstrap 5 + SCSS가 주력이고, 그래프 시각화는 D3, 일부 위젯은 React 19로 만든다.
빌드·실행 명령은 [`docs/EXECUTE.md`](../../docs/EXECUTE.md)를 참고. 여기서는 구조와 배선만 설명한다.

## 구성

| 경로 | 역할 |
|------|------|
| `production/*.html` | 페이지별 HTML 엔트리 (login, search, graph-viz, mypeople, mytime, recap 등). 빌드 진입점 10개 + `imap-start.html`(빌드 제외) |
| `src/pages/` | 각 HTML에 대응하는 페이지 진입 스크립트 |
| `src/components/` | 공용 컴포넌트 (Header, Footer, HeroOrbit, HomeApp, floatingSearch). `ui/`는 React/TSX 위젯 |
| `src/features/` | 기능 단위 모듈 — `accountPicker`(계정·채팅방 선택), `indexingStatus` |
| `src/layout/` | 앱 셸 — `appHeader`, `appSidebar` |
| `src/store/` | `globalStore.js` — 선택된 메일 계정·채팅방 필터를 관리하는 전역 싱글턴. 변경 시 `gwStoreStateChanged` 이벤트로 사이드바·페이지를 동기화 |
| `src/utils/` | 저수준 공용 유틸 — `apiBase`(백엔드 URL 결정), `dom`, `security`(DOMPurify), `filterSync`, `logger`, `i18n` |
| `src/js/`, `src/lib/` | `init.js`(공통 UI 초기화), `helpers/smartresize.js`, `lib/utils.ts`(shadcn 스캐폴딩, 거의 미사용) |
| `src/scss/`, `src/styles/`, `src/main.scss` | 스타일. `scss/`는 전역·테마·`components/`·`pages/`, `styles/tailwind.css`는 랜딩 히어로 shadcn용 Tailwind 진입점 |
| `src/i18n/` | 다국어 리소스 (`ko` / `en` / `ja`, 각 156키). 스위처는 있으나 마크업 미태깅이라 실제 번역은 홈 인사말만 동작 |
| `public/` | 정적 자산 (favicon, 로고, 히어로 이미지, webmanifest). 빌드 시 그대로 복사 |
| `vite.config.js`, `package.json`, `components.json`, `tsconfig.json` | 빌드·의존성·shadcn·TS 설정 |

## 빌드 & 서빙

- `vite.config.js`의 `build.rollupOptions.input`에 `production/*.html` 10개가 각각 빌드 진입점으로 등록돼 있다 (MPA).
- **개발**: `npm run dev` (포트 3000). API 요청은 `vite.config.js`의 `server.proxy` 목록을 통해 백엔드(`127.0.0.1:80`)로 프록시된다 — 백엔드에 새 라우트를 추가하면 이 목록에도 등록해야 개발 서버에서 404가 안 난다.
- **프로덕션**: 백엔드 [`app.py`](../app.py)의 `/dashboard/<path:path>` 라우트가 `dist/` 산출물을 그대로 서빙한다.
- API 기본 URL은 `utils/apiBase.js`의 `getApiBase()`가 결정한다 — `localStorage['gw_flask_url']`(백엔드 핸드오프 값) → 빌드 env → 현재 페이지 origin 순.

## 주의 — 페이지 파일명 ↔ 백엔드 API 이름

`/dashboard/`는 파일명을 하드코딩하지 않으므로 페이지 HTML 파일명은 대체로 자유롭게 바꿀 수 있다.
단, 같은 이름의 백엔드 API 엔드포인트가 있으면 예외다.
예를 들어 `imap-collect.html`은 `app.py`의 실제 엔드포인트(`POST /imap-collect`, `/imap-collect-status/<job_id>`)와 이름이 겹쳐서, 파일명을 바꾸면 메일 수집 기능이 깨질 수 있다.
페이지명을 바꿀 땐 `app.py`에 동명 라우트가 없는지 먼저 확인할 것.

## 관련

- 실행 방법: [`docs/EXECUTE.md`](../../docs/EXECUTE.md)
- 독립 그래프 렌더러: [`src/json/`](../json) (`graph-render.js`)
- 백엔드 API: [`src/app.py`](../app.py)

---

# web — Vite frontend

Social Visualizer's web UI: a Vite multi-page app (MPA) where each `production/*.html` is its own build entry point.
Styling is primarily Bootstrap 5 + SCSS, with D3 for graph visualization and React 19 for a few widgets.
See [`docs/EXECUTE.md`](../../docs/EXECUTE.md) for build/run commands; this file only covers layout and wiring.

## Layout

| Path | Role |
|------|------|
| `production/*.html` | Per-page HTML entries (login, search, graph-viz, mypeople, mytime, recap, …). 10 build entries + `imap-start.html` (excluded from build) |
| `src/pages/` | Page entry scripts matching each HTML |
| `src/components/` | Shared components (Header, Footer, HeroOrbit, HomeApp, floatingSearch); `ui/` holds React/TSX widgets |
| `src/features/` | Feature modules — `accountPicker` (account/chatroom picker), `indexingStatus` |
| `src/layout/` | App shell — `appHeader`, `appSidebar` |
| `src/store/` | `globalStore.js` — global singleton holding the selected mail-account / chatroom filter; emits `gwStoreStateChanged` to sync the sidebar and pages |
| `src/utils/` | Low-level shared utils — `apiBase` (backend URL resolution), `dom`, `security` (DOMPurify), `filterSync`, `logger`, `i18n` |
| `src/js/`, `src/lib/` | `init.js` (common UI init), `helpers/smartresize.js`, `lib/utils.ts` (shadcn scaffolding, barely used) |
| `src/scss/`, `src/styles/`, `src/main.scss` | Styles. `scss/` holds global/theme/`components/`/`pages/`; `styles/tailwind.css` is the Tailwind entry for the landing-hero shadcn components |
| `src/i18n/` | Locale resources (`ko` / `en` / `ja`, 156 keys each). Switcher exists but markup isn't tagged, so only the home greeting is actually translated |
| `public/` | Static assets (favicon, logos, hero images, webmanifest); copied verbatim at build |
| `vite.config.js`, `package.json`, `components.json`, `tsconfig.json` | Build / deps / shadcn / TS config |

## Build & serving

- `build.rollupOptions.input` in `vite.config.js` registers 10 `production/*.html` files as separate build entry points (MPA).
- **Dev**: `npm run dev` (port 3000). API calls are proxied to the backend (`127.0.0.1:80`) via `server.proxy` in `vite.config.js` — add each new backend route here too, or the dev server returns 404.
- **Production**: the backend's `/dashboard/<path:path>` route in [`app.py`](../app.py) serves the `dist/` output as-is.
- The API base URL is resolved by `getApiBase()` in `utils/apiBase.js` — `localStorage['gw_flask_url']` (backend handoff) → build-time env → current page origin.

## Caveat — page filename ↔ backend API name

`/dashboard/` doesn't hardcode filenames, so page HTML filenames can mostly be renamed freely.
The exception is when a backend API endpoint shares the name: `imap-collect.html` collides with real endpoints (`POST /imap-collect`, `/imap-collect-status/<job_id>`) in `app.py`, so renaming it can break mail collection.
Before renaming a page, check that `app.py` has no route of the same name.

## Related

- How to run: [`docs/EXECUTE.md`](../../docs/EXECUTE.md)
- Standalone graph renderer: [`src/json/`](../json) (`graph-render.js`)
- Backend API: [`src/app.py`](../app.py)
