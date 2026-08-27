# _Social Visualizer_
소셜 데이터를 지식 그래프로 구조화하여, 인물 간 관계와 시간의 흐름을 분석·시각화하고 자연어 검색이 가능한 오픈소스 플랫폼

---

## Video

<a href="https://youtu.be/RDueDD39eTI?si=E3ReXJa3mdewYrBK">
    <img width="50%" alt="video-thumbnail" src="./docs/images/video-thumbnail.png">
    <div>👉 시연영상 보러가기</div>
</a>

## Guides
Social Visualizer 실행하거나 (수정/확장)하려면 다음 문서를 참고하세요.

---

## 목차

---

## 1. 시스템 소개
### 1.1 개발 배경
사람들은 일상과 업무 속에서 방대한 규모의 소셜 데이터(메일·메신저 등)를 축적한다. 이러한 소셜 데이터에는 단순한 대화 내용뿐만 아니라 사람 간 관계, 사건, 시간에 따른 변화 등 개인의 사회적 행적을 보여주는 다양한 정보가 포함되어 있다. 이를 활용해 인간관계·사건 변화 등을 추적하거나 지능적으로 분석하고자 하는 수요가 존재한다.

현재는 소셜 서비스에서의 단순 검색 또는 대화형 LLM을 통한 질의나 분석이 보편적이다. 이러한 방식의 문제점은 다음과 같다:

- 이러한 방식은 사용자가 요청한 검색이나 질의에 대해 매우 단편적인 결과만 출력
- 매번 데이터를 전달해야 하는 불편함
- 개인정보 유출 우려와 할루시네이션 가능성 존재
- 세밀한 시각화의 어려움

따라서 본 팀은 소셜 데이터를 문맥 분석이 가능한 구조로 만들어, 사람 간의 관계, 사건, 시간에 따른 변화 등 개인의 사회적 기록을 가시화하는 도구가 필요하다고 판단한다.

---

### 1.2 개발 목표
- 메일·메신저·회의록·통화녹음 등 유형과 관계없이 어떤 소셜 데이터라도 문맥 분석이 가능한 지식 그래프로 구축
- 개인이나 조직의 관심사, 인물·시간 관계 등을 세밀하게 분석하여 시각화

---

## 2. 시스템 구성 및 아키텍쳐

<img width=100% alt="system-architecture" src="./docs/images/system-architecture.png">
<br>

<b><u>Social Visualizer 서버</u></b>
- 데이터 수집 모듈: IMAP 프로토콜로 메일 수집. 파일 업로드 방식으로 메신저 수집
- 데이터 전처리 모듈: 정제·정렬·첨부파일 텍스트 추출 등 원문 소셜 데이터 전처리
- 지식 그래프 생성 모듈: 인물·관계·사건 등의 엔티티·관계 추출. GraphRAG/LightRAG 중 선택 가능하도록 모듈화
- 데이터 분석 모듈: 기간별 키워드·인물별 어조·소통 패턴 분석 및 친밀도 산출
- 자연어 검색 모듈: 지식 그래프 기반 의미·맥락 검색 수행
- 이미지 생성 모듈: 인물 정보(관계·어조·성별 등) 기반 이미지 생성 프롬프트 작성

<b><u>오픈소스 AI 서버</b></u>: 기능별로 역할을 분담해 모델 구성
- Llama: 엔티티·관계 추출 및 자연어 질의응답
- BGE-M3: 자연어 질의 임베딩
- Qwen: 인물 특성 및 활동·주제·사건·키워드 분석
- Flux: 이미지 생성 모듈이 구성한 프롬프트로 인물별 아바타 프로필 이미지 생성

<b><u>데이터베이스</b></u>
- 지식 그래프 DB: 엔티티·관계·커뮤니티 등의 지식 그래프 생성 결과물 저장
- 분석 DB: 지식 그래프에서 분석한 결과(인물·관계·시간·친밀도·키워드 등) 저장

---

## 3. 시스템 주요 기능
### 3.1 핵심 기능 및 특징

<b><u>My People: 인물 간 관계 분석</u></b>

- 소통 인물 분석: 대화를 나눈 인물과 인물별 소통량·상호작용 정보 분석
- 관계·친밀도 분석: 인물 간 관계와 친밀도를 분석하여 시각화
- 기간별 관계 분석: 타임슬라이더로 기간을 설정하고 시점에 따른 관계·소통 변화 분석
- 아바타 프로필 생성: 인물별 주요 특성 기반으로 프로필 이미지 생성
- 인물 상세 정보: 소통량·관계·주요 주제·키워드 등 인물별 상세 분석 결과 확인

<img width="80%" alt="mypeople-1" src="./docs/images/mypeople-1.png">
<img width="80%" alt="mypeople-2" src="./docs/images/mypeople-2.png">

---

<b><u>My Time: 시간 기반 분석</u></b>

- 주요 사건 하이라이트: 월/연별 주요 사건을 추출하여 핵심 활동과 변화 요약
- 기간별 사건 분석: 타임슬라이더로 설정한 기간의 주된 활동·주제·키워드·주요 연락처·일별 키워드 언급 횟수 등 시각화

<td><img width="80%" alt="mytime-1" src="./docs/images/mytime-1.png"></td>
<td><img width="80%" alt="mytime-2" src="./docs/images/mytime-2.png"></td>

---

<b><u>Recap: 소셜 데이터를 분석한 통계치 가시화</u></b>

- 통합 가시화: 전체 소셜 데이터를 요약한 통계들을 한 페이지로 시각화
- 최다 소통 인물: 나와 최다 송·수신한 사람들을 소통량 기준으로 정렬
- 주요 키워드: 반복적으로 등장한 핵심 키워드 가시화
- 친밀도: 전체 인물에 대한 친밀도 분석 및 시각화

<img width="737" alt="mypeople-2" src="./docs/images/recap.png">

---

### 3.2 개발 과정
<b><u>설계 과정</u></b>
- 문제 인식 및 연구 노트 작성 시작
- GraphRAG와 LightRAG의 성능 분석 후 지식 그래프로 GraphRAG를 선정
- 다른 지식 그래프 생성 모듈도 활용 가능하도록 모듈화 
- Flask 기반 웹 서비스 구축 및 React 기반 UI 구현
- 자연어 검색 기능 구현
- 지식 그래프 생성 및 자연어 검색을 위해 오픈웨이트 Llama 학습·튜닝 
- 오픈소스 Qwen을 활용한 소셜 데이터 분석 기능 구현
- 오픈소스 FLUX를 활용한 이미지 생성 기능 구현

<b><u>테스트 과정</u></b>
- Gmail의 메일을 활용하여 지식 그래프 생성 및 분석 기능 1차 검증 
- Gmail·Naver·iCloud 등 다양한 메일 데이터를 수집할 수 있도록 IMAP 기반 메일 클라이언트 작성. 다양한 메일 데이터 확보 및 검색·분석 테스트
- 3MB, 8GB 등 여러 크기의 카카오톡 데이터 확보 및 검색·분석 테스트
- 자연어 검색 기능 성능 평가: 평균 정확도 93%, 평균 검색 시간 5.4초

---`

## 4. 기대효과 및 활용 분야
- 방대한 소셜 데이터에 담긴 과거/현재의 인간관계·시간의 흐름·활동 파악용으로 활용
- 개인이나 조직에서 사건·범죄 등의 특수한 이벤트 추적용으로 활용
- 개인이나 조직에서 사건의 흐름을 시간·인물별로 파악하는 도구로 수정 및 확장 가능
- 개인의 모든 소셜 데이터를 한 곳에 모으는 디지털 아카이브 용도로 활용

---

## 사용 모델

| 구분 | 모델 | 용도 | 라이선스 |
|---|---|---|---|
| Llama — Index | [`meta-llama/Llama-3.1-8B-Instruct`](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct) + [Index LoRA Adapter](https://huggingface.co/Golden-Olive/llama-3.1-8b-socialvisualizer-index-lora) | GraphRAG 그래프 인덱싱 (`extract_graph`, `community_reports`) | Meta Llama License |
| Llama — Query | `meta-llama/Llama-3.1-8B-Instruct` + [Query LoRA Adapter](https://huggingface.co/Golden-Olive/llama-3.1-8b-socialvisualizer-query-lora) | GraphRAG 질의응답 (`local_search`, `global_search`) | Meta Llama License |
| Qwen | [`Qwen/Qwen2.5-7B-Instruct`](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct) | 범용 서브태스크 수행 | Apache-2.0 |
| FLUX | [`black-forest-labs/FLUX.1-schnell`](https://huggingface.co/black-forest-labs/FLUX.1-schnell) | 이미지 및 아바타 생성 | Apache-2.0 |
| Embedding | [`BAAI/bge-m3`](https://huggingface.co/BAAI/bge-m3) | 텍스트 임베딩 및 벡터 검색 | MIT |

Llama LoRA Adapter의 학습·서빙에 대한 자세한 내용은 [`llama-finetune/README.md`](./llama-finetune/README.md)를 참고.