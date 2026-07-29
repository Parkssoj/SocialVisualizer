# MailGrapher

Gmail 메일 데이터를 분석해 지식 그래프를 만들고, 사람/시간 통계와 자연어 검색을 제공하는 웹앱. [GmailWeaver](https://github.com/s0-yeon/GmailWeaver)의 디자인/기능을 관리자 대시보드 형태에서 벗어나 일반 웹 페이지 구조로 이관한 프로젝트.

- **프론트엔드**: `src/web` — Vite + Bootstrap 5. 공통 헤더는 `src/web/src/layout/appHeader.js` 한 곳에서 관리하며, 각 페이지(`src/web/production/*.html`)는 사이드바 없는 가벼운 다중 페이지 구조.
- **백엔드**: `src/app.py` — Flask 서버. GraphRAG 기반 메일 인덱싱/질의, 통계 조회, 그래프 시각화 데이터 제공.
- Gmail 직접 연동(라벨/캘린더/메일 발송, Apps Script 웹앱 프록시)은 제거됨. My People의 메일 본문 조회(`/mail-person-emails`)는 파일 캐시에 있는 메일만 사용한다.

## 프론트엔드 실행

```bash
cd src/web
npm install
npm run dev      # 개발 서버 (localhost:3000, /production/mylife.html 등)
npm run build    # 프로덕션 빌드 (Flask가 src/web/dist를 서빙)
```

## 백엔드 실행

```bash
py -3.11 -m venv gmailweaver-venv
./gmailweaver-venv/Scripts/activate
pip install -r requirements.txt
```

`src/parquet/.env.example`을 `src/parquet/.env`로 복사하고 값을 채운다 (OpenAI/GraphRAG API 키, MySQL 접속 정보 — 절대 커밋하지 말 것, `.gitignore`에 포함되어 있음):

```bash
cp src/parquet/.env.example src/parquet/.env
```

서버 실행 (반드시 저장소 루트에서 실행 — `.env`/parquet 경로가 상대경로 기준):

```bash
python src/app.py
```

기본적으로 포트 80으로 뜨며, 프론트엔드 빌드 산출물(`src/web/dist`)을 `/dashboard/` 하위 경로로 서빙한다.
