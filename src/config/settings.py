import os

# 여기서 3번 올라가면 프로젝트 루트
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 도메인별 설정 파일 경로
def GRAPHRAG_SETTINGS_DIR(domain):
    return os.path.join(BASE_DIR, "parquet_template", "rendered", domain, "settings.yaml")

# 도메인별 프롬프트 경로
def GRAPHRAG_PROMPTS_DIR(domain):
    return os.path.join(BASE_DIR, "parquet_template", "rendered", domain, "prompts")

# 메일 블록 구분자
MAIL_BLOCK_SEP = "============================================================"

# 질의 시 GraphRAG/LightRAG 중 무엇을 쓸지 정하는 스위치. "graphrag" 또는 "lightrag".
# .env가 아니라 여기 둔 이유: API 키처럼 배포 환경마다 달라지는 비밀값이 아니라
# "이 서버가 어떤 엔진으로 동작할지"를 정하는 소스코드 레벨 설정이라서다.
# .env는 값이 없으면 조용히 기본값(graphrag)으로 폴백돼서 오타/누락을 눈치채기 어렵지만,
# 여기 있으면 코드를 열어봐야 하니 실수로 잘못된 엔진으로 도는 일이 적다.
RAG_ENGINE = "graphrag"

# 앞으로 다른 RAG 엔진이 추가되면 여기에도 이름을 더하고, RAG_ENGINE을 쓰는 곳들도
# if/elif로 그 이름을 하나 더 분기해주면 된다 (app.py, util/attachment_manager.py 참고).
SUPPORTED_RAG_ENGINES = ("graphrag", "lightrag")
if RAG_ENGINE not in SUPPORTED_RAG_ENGINES:
    raise ValueError(f"지원하지 않는 RAG_ENGINE 값: {RAG_ENGINE!r} (가능한 값: {SUPPORTED_RAG_ENGINES})")

#아래 경로는 사용자 마다 달라지므로 재정의 필요
#GRAPH_BUILD_SCRIPT = os.path.join(BASE_DIR, "src", "graphrag_parquet2json.py")     # 메일 텍스트 → 그래프 JSON 변환 스크립트 경로
#GRAPHRAG_ROOT = os.path.join(BASE_DIR, "src", "parquet")     # GraphRAG 작업 루트 디렉터리
# MAIL_DIR = os.path.join(BASE_DIR, "src", "parquet", "input")  # 업로드된 메일 텍스트 파일들을 저장할 폴더
# MAIL_LATEST_PATH = os.path.join(MAIL_DIR, "mail_latest.txt")    # 최신 메일 스냅샷 파일의 고정 경로
# ATTACHMENT_DIR = os.path.join(MAIL_DIR, "attachments")  # 첨부 원본 파일 저장 폴더
# PARQUET_DIR = os.path.join(BASE_DIR, "src", "parquet", "output") # output 폴더: parquet들 저장
# ENTITIES_PATH = os.path.join(PARQUET_DIR, "entities.parquet") # 노드 데이터: 엔티티 목록
# RELATIONSHIPS_PATH = os.path.join(PARQUET_DIR, "relationships.parquet") # 엣지 데이터: 엔티티 간 관계
# COMMUNITIES_PATH = os.path.join(PARQUET_DIR, "communities.parquet") # 커뮤니티 데이터: 군집화한 노드 그룹 정보


