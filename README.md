# _SocialVisualizer_

메일 데이터를 분석해 지식 그래프를 만들고, 사람/시간 통계와 자연어 검색을 제공

## 실행 방법

### 1. 사전 준비

- Python 3.11
- Node.js
- MySQL 서버

### 2. 파이썬 가상환경 & 모듈 설치

```bash
python -m venv socialvisualizer-venv
```

가상환경 활성화

```bash
# Git Bash
source socialvisualizer-venv/Scripts/activate

# Windows cmd
socialvisualizer-venv\Scripts\activate.bat
```

모듈 설치

```bash
pip install -r requirements.txt
```

(참고) `requirements.txt`에는 GraphRAG뿐 아니라 LightRAG 라이브러리가 필요로 하는 패키지도 이미
포함되어 있다. 기본값은 GraphRAG라 이 가상환경만으로 바로 실행되고, 나중에 LightRAG 기능을 켜고
싶어지면 아래 "LightRAG 기능 켜기" 섹션만 추가로 진행하면 된다(가상환경을 새로 만들 필요 없음).

### 3. 환경변수 설정

`src/parquet/.env` : 노션에서 복붙하세요(mail grapher용 .env)

### 4. MySQL 데이터베이스 생성

mail_grapher_db 를 사용. (노션 참고)

### 5. 백엔드 실행 (프로젝트 루트에서)

```bash
python src/app.py
```

→ `http://localhost/dashboard/` 에서 실행됨

### 6. 프론트엔드 실행 (`src/web`에서)

```bash
npm install
npm run build
```

→ 빌드 후 백엔드(80번)만 켜면 `http://localhost` 로 바로 접속 가능

개발 중이라 화면을 수정하며 바로 확인하고 싶다면:

```bash
npm run dev
```

→ `http://localhost:3000` (단, 백엔드(80)도 같이 켜져 있어야 API가 동작함)

## LightRAG 기능 켜기 (선택)

SocialVisualizer는 기본적으로 GraphRAG로 동작한다. 인덱싱/질의 엔진을 LightRAG로 바꾸고 싶을 때만
아래를 추가로 진행하면 된다 — 안 하면 GraphRAG 그대로 동작하니 건너뛰어도 무방하다.

### 1. LightRAG 클론

LightRAG는 pip 패키지로 설치하지 않고 소스를 그대로 클론해서 라이브러리처럼 가져다 쓴다.

백엔드 코드 중 lightrag의 이름이 포함된 파일을 직접 참조하므로, **반드시 프로젝트 루트(`SocialVisualizer/`)
바로 밑에 클론해야 한다.**

위 2번에서 만든 `socialvisualizer-venv`에 이미 필요한 패키지가 설치되어
있으므로 별도 가상환경이나 추가 설치는 필요 없다.

```bash
git clone https://github.com/HKUDS/LightRAG.git
```

클론한 `LightRAG` 폴더 안의 `.git`은 지워도 된다(SocialVisualizer 저장소 안에 중첩 git 저장소가
생기는 걸 방지하기 위함 — 지우지 않아도 동작에는 지장 없음).

```bash
rm -rf LightRAG/.git
```

### 2. LightRAG 엔진 전환

`src/config/settings.py`의 `RAG_ENGINE` 값을 바꾼다.

```python
RAG_ENGINE = "lightrag"   # 기본값은 "graphrag"
```

값을 바꾼 뒤에는 서버를 재시작해야 반영된다(자동 리로드 없음).

## 프롬프트/사용자 편의 설정 고치기 (LightRAG 기준)

### 1. LightRAG 인덱싱/질의 관련 파일

LightRAG 쪽 코드는 GraphRAG 파일을 건드리지 않고 전부 새 파일로 대응시켜서 만들었다. 각 파일이
GraphRAG의 어느 파일에 대응하는지, 뭘 하는 파일인지 정리하면 아래와 같다.

**`src/util/lightrag_backend/` (엔진 전용 로직)**

- `lightrag_engine.py` — LightRAG 인스턴스 생성/캐싱, 인덱스 준비 여부 확인, 토큰 사용량 조회
  (`graphrag_engine.py` 대응)
- `lightrag_query.py` — 단일 계정 질의 + 여러 계정을 합치는 연합 질의, 질의 모드(local/global/
  hybrid/naive/mix/bypass) 자동 분류 (`graphrag_query.py` 대응)
- `lightrag_loop.py` — 질의 경로 전체가 공유하는, 앱이 떠 있는 동안 안 닫히는 이벤트 루프.
  질의마다 루프를 새로 만들었다 닫으면 나던 "Event loop is closed"/"Task was destroyed" 문제를
  없애려고 추가한 파일 (GraphRAG 쪽엔 대응 파일 없음, LightRAG 전용 문제라 여기만 있음)
- `lightrag_mail_summary.py` — 월별/연별 메일 요약 생성 (`graphrag_mail_summary.py` 대응)
- `lightrag_date_query.py` — 날짜 범위로 메일 찾는 질의 (`graphrag_date_query.py` 대응)
- `lightrag_graph_json.py` — LightRAG가 만든 GraphML 지식그래프를 그래프 시각화용 JSON으로 변환
  (`graphrag_parquet2json.py` 대응 — GraphRAG는 parquet 여러 개를 읽지만 LightRAG는 GraphML
  파일 하나만 읽는 차이가 있음)
- `lightrag_extract_statics.py` — 키워드/연락처 통계 추출 (`extract_statics.py` 대응, 3개 함수
  중 앞 2개만 raw-text 버전으로 재작성)
- `lightrag_db_writer.py` — DB 저장 로직 (`database/db_writer.py` 대응 — 대부분 함수는 엔진 무관
  이라 원본을 그대로 재사용하고, LightRAG 전용으로 새로 필요한 부분만 여기 있음)
- `lightrag_mail_parser.py` — 위 통계/요약/DB 저장 코드들이 공통으로 쓰는 메일 텍스트 파싱
  헬퍼 (GraphRAG는 parquet에서 바로 읽어서 이런 파서가 따로 필요 없었음)
- `lightrag_progress.py` — 인덱싱 진행률 표시 (`graphrag_progress.py` 대응)

**그 밖의 위치**

- `src/util/jobs/job_run_lightrag.py` — LightRAG 인덱싱 파이프라인(신규/증분/전체 재인덱싱)
  실행 (`job_run_graphrag.py` 대응)
- `src/config/settings.py` — `RAG_ENGINE`/`SUPPORTED_RAG_ENGINES`, 어느 엔진으로 돌지 정하는
  스위치
- `src/util/user_path.py` — `LIGHTRAG_ROOT`(작업 디렉터리), `LIGHTRAG_GRAPH_JSON_PATH`(그래프
  JSON 저장 경로) 정의
- `LightRAG/` — 벤더 라이브러리 원본(클론해서 그대로 씀, `.gitignore` 처리됨 — 위 "LightRAG
  기능 켜기" 섹션 참고)

### 2. 우리 코드가 직접 짠 프롬프트

전부 `src/util/lightrag_backend/` 안에 있고, 그냥 문자열이라 바로 수정 가능하다.

- **연합 검색(여러 계정 통합) 답변 프롬프트** — `lightrag_query.py`의 `run_federated_search()` 안
  `system_prompt` (270번째 줄 부근). 여러 계정 데이터를 종합해서 어떤 형식/톤으로 답할지, ID·발신인
  필드를 어떻게 표기할지를 여기서 지시한다.
- **질의 모드 분류 프롬프트** — `lightrag_query.py`의 `_classify_query_method()` 안 `prompt` (410번째
  줄 부근). 사용자 질문을 local/global/hybrid/naive/mix/bypass 6개 모드 중 어디로 보낼지 고르는
  기준 문구.
- **월별/연별 메일 요약 프롬프트** — `lightrag_mail_summary.py`의 `_summarize_with_llm()` 안
  system 메시지 (30번째 줄 부근). 요약 문체나 JSON 필드 구성을 바꾸고 싶으면 여기.
- **단일 계정 질의(`run_lightrag_query`)는 자체 프롬프트가 없다** — `rag.aquery()`를 그냥 호출해서
  LightRAG 라이브러리 기본 응답 프롬프트를 그대로 쓴다. 이걸 바꾸고 싶으면 아래 3번을 보거나,
  `QueryParam(mode=method, ...)`에 `user_prompt`/`aquery(..., system_prompt=...)` 인자를 추가해서
  호출부에서 오버라이드할 수 있다.
- **첨부파일 요약 프롬프트는 LightRAG 전용이 아니다** — `job_run_lightrag.py`가 읽는 프롬프트는
  `parquet_template/src/prompts/summarize_attachment.j2`를 렌더링한
  `parquet_template/rendered/{domain}/prompts/summarize_attachment.txt`이며, GraphRAG 쪽 첨부파일
  요약과 같은 파일을 공유한다. 여길 고치면 두 엔진 모두에 반영된다.

### 3. LightRAG 라이브러리 자체 기본 프롬프트

여기부터는 두 갈래다 — 그냥 라이브러리가 원래 갖고 있는 프롬프트를 그대로 쓸지, 우리가 직접 고쳐서
커스터마이징할지.

#### 3-1. 자체 라이브러리 프롬프트 그대로 쓰기

LightRAG 내부 로직(엔티티 추출, 그래프 검색 응답, 키워드 추출 등)은 이미 자체적으로 다듬어진 기본
프롬프트를 갖고 있다. `LightRAG/lightrag/prompt.py`의 `PROMPTS` 딕셔너리
(`entity_extraction_system_prompt`, `rag_response`, `naive_rag_response`, `keywords_extraction` 등)
가 그 실체다. 답변 톤이나 추출 방식을 우리 서비스에 맞게 바꿔야 할 특별한 이유가 없다면 이 파일은
아예 열어볼 필요도 없다 — 손대지 않아도 LightRAG 쪽에서 검증해둔 프롬프트가 그대로 잘 동작한다.

#### 3-2. 우리 프롬프트로 고쳐서 쓰기 (커스터마이징)

답변 톤이나 추출 기준을 우리 서비스 사정에 맞게 바꾸고 싶을 때는 아래 세 방법 중 하나를 쓰면 된다.
위에 있는 방법일수록 더 권장하는 방식이니, 가능하면 위쪽부터 시도해보자.

1. **호출부에서 오버라이드 (가장 권장)** — 답변 생성 프롬프트(`rag_response`/`naive_rag_response`)만
   바꾸고 싶다면, 라이브러리는 안 건드리고 `rag.aquery(message, param, system_prompt="...")`처럼
   호출하는 쪽에서 넘겨주면 된다. `run_lightrag_query()`/`run_federated_search()`에 `system_prompt=`
   인자를 하나 추가해서 우리 코드(2번 섹션) 쪽에 프롬프트를 두는 방식이라, git으로 그대로 공유되고
   팀원 전체에게 똑같이 적용된다. **주의**: 이건 지금 당장 그렇게 쓸 수 있다는 게 아니라, 커스터마이징
   하려면 저 함수들에 `system_prompt=` 인자를 직접 추가해야 한다는 뜻이다 — 지금 코드엔 아직 없다.
2. **라이브러리가 공식 지원하는 오버라이드 경로 쓰기** — 엔티티 추출 프롬프트만 바꾸고 싶다면
   `prompt.py`를 직접 고치는 대신 `LightRAG(..., addon_params={"entity_type_prompt_file": "..."})`로
   외부 파일을 지정하는 방법이 있다. 라이브러리가 공식으로 지원하는 오버라이드 경로라 안전하다.
3. **`prompt.py` 직접 수정 (최후의 수단)** — 위 두 방법으로 커버가 안 되는 부분(`keywords_extraction`,
   `fail_response` 등)을 정말 바꿔야 한다면 `LightRAG/lightrag/prompt.py`를 직접 고쳐도 된다. 단,
   `LightRAG/` 폴더는 `.gitignore`에 등록돼 있어서(직접 클론해서 쓰는 벤더 라이브러리라 레포에
   커밋하지 않음) **여기서 고친 내용은 내 컴퓨터에서만 반영되고, 다른 팀원이나 새로 클론한 환경에는
   전달되지 않는다.** 고쳤다면 바뀐 내용을 팀에 공유하거나(Notion 등), 나중에 다시 클론할 사람을
   위해 diff를 따로 남겨두자.

---

## 다른 RAG 엔진을 새로 붙이고 싶을 때

GraphRAG/LightRAG 두 엔진이 이미 같은 패턴으로 꽂혀 있으니, 세 번째 엔진(예: 다른 RAG 프레임워크)도
같은 패턴을 따라가면 된다. 아래 체크리스트 순서대로 진행하면 된다.

### 1. 엔진 이름 등록

`src/config/settings.py`의 `SUPPORTED_RAG_ENGINES`에 새 엔진 이름을 추가한다(안 하면 앱 시작 시
`ValueError`로 막힌다). `RAG_ENGINE`은 여전히 세 개 중 하나만 값으로 가진다.

### 2. 전용 패키지 만들기

LightRAG를 붙일 때 쓴 최신 방식(`src/util/lightrag_backend/`)을 따라 `src/util/<엔진명>_backend/`
패키지를 새로 만들고, 그 안에 `<엔진명>_` 접두사가 붙은 파일들을 채운다. LightRAG 쪽과 함수 이름을
맞추면 `app.py`가 import 경로만 바꿔서 그대로 재사용할 수 있다:

- `<엔진명>_engine.py` — 인스턴스/엔진 빌드 및 캐싱 (`lightrag_engine.py`의 `get_lightrag_instance`,
  `is_index_ready`, `get_and_reset_usage`에 대응)
- `<엔진명>_query.py` — 단일 계정 질의 + 연합(다계정) 질의 (`run_lightrag_query`,
  `run_federated_search`/`run_federated_local_search`/`run_federated_global_search`에 대응)
- `<엔진명>_mail_summary.py` — 월별/연별 메일 요약 (`generate_mail_summaries_lightrag`에 대응)
- `<엔진명>_date_query.py` — 날짜 범위 질의
- `<엔진명>_graph_json.py` — 그래프 시각화용 JSON 변환기

### 3. 인덱싱 job 작성

`src/util/jobs/job_run_<엔진명>.py`를 만들고 `job_run_lightrag.py`/`job_run_graphrag.py`와 같은
함수 시그니처를 맞춘다: `start_graph_pipeline_background`, `start_graph_update_pipeline_background`,
`build_*_update`, `build_graph_json`. 이름만 맞으면 `app.py`는 `RAG_ENGINE` 값에 따라 import만
바꾸므로 호출부 코드는 안 건드려도 된다.

### 4. 경로 세그먼트 추가

`src/util/user_path.py`에 그 엔진 전용 작업 디렉터리 경로를 추가한다 (`GRAPHRAG_ROOT`/
`LIGHTRAG_ROOT`처럼 `<엔진명>_ROOT`), 그래프 JSON 경로도 하나 더 (`GRAPH_JSON_PATH`/
`LIGHTRAG_GRAPH_JSON_PATH`처럼 `<엔진명>_GRAPH_JSON_PATH`).

### 5. `app.py`에 분기 추가

`RAG_ENGINE`으로 그래프/라이트래그를 나누는 지점마다 새 엔진 분기(`elif`)를 추가해야 한다. 현재
분기 지점은 다음과 같다:

- 모듈 상단 — 인덱싱 시작 함수(`start_graph_pipeline_background` 등) import 스위치
- 날짜 범위 질의 함수(`run_date_range_query`) import 스위치
- `_index_ready` 헬퍼 — 인덱스 생성 여부 확인
- `/run-query-async`, `/run-query` 라우트 — 실제 질의 실행부
- `/upload` 라우트 — 인덱스 준비 마커 파일 삭제, 인덱싱 파이프라인 트리거
- `/graph-data` 라우트 — 그래프 JSON 경로 선택
- `/upload-attachments` 라우트, `util/attachment_manager.py` — 첨부파일 반영 업데이트 함수 선택

### 6. DB 저장은 대부분 그대로 재사용 가능

`src/util/database/db_writer.py`의 `save_query_to_db`, `save_mail_summarize_to_db` 등은 엔진에
상관없이 그냥 행을 저장하는 함수라 새 엔진에서도 그대로 가져다 쓰면 된다. 예외는
`collect_indexing_stats`인데, 이건 GraphRAG의 캐시 폴더 구조(`community_reporting`,
`extract_graph` 등)를 하드코딩하고 있어서 GraphRAG 전용이다 — 새 엔진에서 인덱싱 비용/통계를
집계하고 싶다면 이 함수의 엔진별 버전을 따로 만들어야 한다.

### 7. 프롬프트는 위 섹션 참고

첨부파일 요약처럼 `parquet_template/rendered/`를 공유하는 프롬프트는 그대로 재사용되고, 그 외
엔진 고유 프롬프트(질의 응답, 요약 등)는 바로 위 "프롬프트/사용자 편의 설정 고치기" 섹션과 같은
패턴으로 새 패키지 안에 문자열로 두면 된다.

## LightRAG 자체 웹 UI 따로 띄우기 (선택)

위 "LightRAG 기능 켜기"는 SocialVisualizer 백엔드가 LightRAG를 라이브러리로 불러 쓰는 방식이라 이
섹션 없이도 완전히 동작한다. 아래는 LightRAG가 자체 제공하는 웹 UI(`lightrag-server`, 9621번
포트)를 SocialVisualizer와 별개로 한번 켜보고 싶을 때만 필요한 절차 — SocialVisualizer 실행에는 필요 없다.
이 경우 `socialvisualizer-venv`와 별도로 `lightrag-venv`를 하나 더 만든다(uv가 자체적으로 관리하는
전용 가상환경).

### 1. uv 설치

Windows에는 `make` 명령어가 기본으로 없어서, LightRAG 공식 가이드의 `make dev` 대신
`uv`(파이썬 의존성 관리 도구)를 직접 설치해서 사용.

PowerShell에서 실행, 설치 후 Git Bash 재시작

```powershell
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

- 설치 위치: `C:\Users\2471369\.local\bin`

Git Bash에서 `uv: command not found`가 뜨면(PowerShell/cmd용 PATH 등록이 Git Bash(MINGW64)에는
적용되지 않아서 생기는 문제) 아래로 PATH를 등록한다.

```bash
export PATH="$HOME/.local/bin:$PATH"
uv --version
```

영구 등록 (한 번만 실행):

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
```

### 2. 전용 가상환경(`lightrag-venv`) 생성 + 의존성 설치

`LightRAG` 폴더 안에서 실행.

```bash
cd LightRAG
export UV_PROJECT_ENVIRONMENT=lightrag-venv
uv venv lightrag-venv
uv sync --extra test --extra offline
```

영구 등록 (한 번만 실행):

```bash
echo 'export UV_PROJECT_ENVIRONMENT=lightrag-venv' >> ~/.bashrc
```

### 3. 가상환경 활성화

```bash
source lightrag-venv/Scripts/activate
```

### 4. 웹 UI 빌드

PowerShell에서 실행, 설치 후 Git Bash 재시작

```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

```bash
cd lightrag_webui
bun install --frozen-lockfile
bun run build
cd ..
```

### 5. 설정 파일(.env) 생성

```bash
cp env.example .env
```

### 6. 서버 실행

```bash
lightrag-server
```

브라우저에서 `http://localhost:9621` 접속 → 확인
