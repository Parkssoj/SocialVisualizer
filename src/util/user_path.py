import re,os
import json
import shutil
from config.settings import GRAPHRAG_SETTINGS_DIR, GRAPHRAG_PROMPTS_DIR, RAG_ENGINE

ACCOUNT_META_FILENAME = "account.json"

_MAX_MAILS_CONFIG = {
    "ddyr1554@gmail.com": 200,
    "inhist44@gmail.com": 1000,
    "cjiyou1090@gmail.com": 1500,
    "csi10186@gmail.com": 500,
    "03yeah03@gmail.com": 300,
}

# 카카오톡 방 이름(한글 포함) 뒤에 build_room_id()가 붙여주는 "[msg_xxxxxxxx]" 해시 식별자.
# 방 이름을 그대로 폴더명에 넣으면 한글이 전부 언더바로 뭉개져서 이름 길이만큼 폴더명이
# 들쭉날쭉해지므로, 이 패턴이 있으면 해시 부분만 폴더명으로 쓴다(짧고 항상 일관된 길이).
_MSG_ROOM_ID_RE = re.compile(r"\[msg_([0-9a-f]{8})\]\s*$")

def _mail_to_dir_name(user_id: str) -> str:
    m = _MSG_ROOM_ID_RE.search(user_id)
    if m:
        return f"msg_{m.group(1)}"
    s = user_id.strip().lower()
    s = s.replace("@", "_at_")
    s = s.replace(".", "_")
    s = s.replace("+", "_plus_")
    s = re.sub(r"[^a-z0-9_]", "_", s)
    return s

class UserPaths:
    def __init__(self, base_dir: str, user_id: str, domain: str):
        self.BASE_DIR = base_dir
        self.USER_ID = user_id
        self.DOMAIN = domain

        dir_name = _mail_to_dir_name(user_id)

        # user_data/<domain>/<계정 또는 단톡방>/ 구조 — 도메인(메일/카카오)별로 먼저 나누고
        # 그 밑에 계정 폴더를 둔다. list_accounts()/list_indexed_user_ids()가 이 구조를 그대로
        # 훑으면서 계정 목록을 찾는다.
        self.USER_ROOT = os.path.join(base_dir, "user_data", domain, dir_name)

        # RAG_ENGINE별로 저장 위치를 완전히 분리한다: user_data/<domain>/<계정>/graphrag/...,
        # user_data/<domain>/<계정>/lightrag/... 이렇게 엔진 세그먼트를 하나 더 두었다.
        # domain은 이미 USER_ROOT 경로에 반영돼 있으므로 여기서 다시 붙이지 않는다(중복 방지).
        # 예전엔 엔진 세그먼트가 없어서 LightRAG가 working_dir로 GRAPHRAG_ROOT를 그대로
        # 재사용할 수밖에 없었고, 그 결과 LightRAG의 그래프/벡터/KV 저장소 파일들이 GraphRAG의
        # parquet 출력 폴더 안에 섞여 저장됐다. 지금은 아예 다른 폴더를 쓰므로 이 문제가 없다.
        self.DOMAIN_ROOT = os.path.join(self.USER_ROOT, "graphrag")     # GraphRAG 데이터 저장 위치
        self.GRAPHRAG_ROOT = os.path.join(self.DOMAIN_ROOT, "parquet")

        # LightRAG 저장소(rag_storage에 해당) 전용 루트. LightRAG()의 working_dir로 그대로 쓴다
        # (job_run_lightrag.py의 _lightrag_ainsert, lightrag_engine.py의 get_lightrag_instance 참고).
        # domain은 이미 USER_ROOT에 반영돼 있으므로 여기서 다시 붙이지 않는다.
        self.LIGHTRAG_ROOT = os.path.join(self.USER_ROOT, "lightrag")

        # GraphRAG 결과 폴더(cache/input/logs/output)와 구조를 맞추기 위한 하위 폴더.
        # LightRAG 라이브러리는 working_dir 하나에 그래프/벡터DB/캐시를 전부 섞어서 저장하고
        # cache/input/output을 따로 나누는 옵션이 없다(라이브러리 코드를 안 건드리는 게 원칙이라
        # 패치 안 함) — 그래서 LightRAG가 실제로 쓰는 파일(그래프, 벡터DB, 캐시 전부 포함)은
        # output/ 하나에 모아 넣고, 그걸 working_dir로 쓴다. input/은 인덱싱 원본(latest.txt 등,
        # 아래 MAIL_DIR 참고)이 실제로 저장되는 곳이고, logs/는 job 로그 파일을 남기는 용도로
        # 우리가 직접 채운다(job_run_lightrag.py 참고).
        self.LIGHTRAG_OUTPUT_DIR = os.path.join(self.LIGHTRAG_ROOT, "output")
        self.LIGHTRAG_INPUT_DIR = os.path.join(self.LIGHTRAG_ROOT, "input")
        self.LIGHTRAG_LOGS_DIR = os.path.join(self.LIGHTRAG_ROOT, "logs")

        # LightRAG용 그래프 시각화 json. GraphRAG의 GRAPH_JSON_PATH(DOMAIN_ROOT/json/...)와
        # 똑같은 스키마({nodes, edges})를 쓰지만, 결과물이 섞이지 않도록 LIGHTRAG_ROOT 밑에
        # 따로 둔다 (util/lightrag_backend/lightrag_graph_json.py가 씀).
        self.LIGHTRAG_GRAPH_JSON_PATH = os.path.join(self.LIGHTRAG_ROOT, "json", "graph_data.json")

        self.USER_GRAPH_SETTINGS_PATH = os.path.join(self.GRAPHRAG_ROOT, "settings.yaml")
        self.USER_GRAPH_PROMPTS_PATH = os.path.join(self.GRAPHRAG_ROOT, "prompts")

        # graphrag_parquet2json.py로 파일명이 바뀐 지 오래된 스크립트라 이쪽(HEAD) 이름을 쓴다 —
        # parquet2json.py는 이제 존재하지 않는 옛날 파일명.
        self.GRAPH_JSON_PATH = os.path.join(self.DOMAIN_ROOT, "json", "graph_data.json")
        self.GRAPH_BUILD_SCRIPT = os.path.join(base_dir, "src", "graphrag_parquet2json.py")

        # 원본 메일/첨부파일(latest.txt, latest.csv, attachments/)이 저장되는 위치.
        # GraphRAG는 GraphRAG CLI(settings.yaml)가 input/을 GRAPHRAG_ROOT 바로 밑에서 찾도록
        # 고정돼 있어서 GRAPHRAG_ROOT를 그대로 쓴다. LightRAG는 그런 제약이 없어서(paths.MAIL_DIR만
        # 일관되게 참조하면 됨) LIGHTRAG_ROOT/input(=LIGHTRAG_INPUT_DIR) 밑으로 완전히 분리했다 —
        # 예전엔 RAG_ENGINE에 상관없이 항상 GRAPHRAG_ROOT/input을 같이 썼는데, 그래서 LightRAG로만
        # 인덱싱해도 graphrag/parquet/input 밑에 latest.txt가 같이 생기는 문제가 있었다.
        if RAG_ENGINE == "lightrag":
            self.MAIL_DIR = self.LIGHTRAG_INPUT_DIR
        else:
            self.MAIL_DIR = os.path.join(self.GRAPHRAG_ROOT, "input")
        # domain이 메일/카카오 둘 다 지원하게 되면서 "mail_" 접두사가 항상 맞진 않아서
        # "latest.txt"로 이름을 바꿨다. 다른 파일들은 전부 이 값을 paths.MAIL_LATEST_PATH로만
        # 참조하고 파일명을 직접 하드코딩하지 않으므로, 여기 한 곳만 바꾸면 전체에 반영된다.
        self.MAIL_LATEST_PATH = os.path.join(self.MAIL_DIR, "latest.txt")
        self.ATTACHMENT_DIR = os.path.join(self.MAIL_DIR, "attachments")

        self.PARQUET_DIR = os.path.join(self.DOMAIN_ROOT, "parquet", "output") # output 폴더: parquet들 저장 (GraphRAG 전용)
        self.ENTITIES_PATH = os.path.join(self.PARQUET_DIR, "entities.parquet") # 노드 데이터: 엔티티 목록
        self.RELATIONSHIPS_PATH = os.path.join(self.PARQUET_DIR, "relationships.parquet") # 엣지 데이터: 엔티티 간 관계
        self.COMMUNITIES_PATH = os.path.join(self.PARQUET_DIR, "communities.parquet") # 커뮤니티 데이터: 군집화한 노드 그룹 정보

        # 연락처/키워드 통계, 요약, 아바타 등은 MAIL_DIR과 같은 이유로 엔진별로 분리한다.
        # PARQUET_DIR(entities/relationships/communities.parquet, GraphRAG 전용 산출물) 밑에
        # 고정해두면, LightRAG만 쓰는 계정은 graphrag/ 폴더 자체가 안 생겨서
        # (lightrag_extract_statics.py 등이 os.makedirs(paths.MAIL_STATICS_PATH)로 알아서
        # 만들어주긴 하지만) 통계 폴더가 GraphRAG 전용 폴더 밑에 딸려 들어가는 게 어색하고,
        # 실제로 mail_contact_stats.json을 못 찾는 FileNotFoundError가 났다.
        if RAG_ENGINE == "lightrag":
            self.MAIL_STATICS_PATH = os.path.join(self.LIGHTRAG_ROOT, "statics")
        else:
            self.MAIL_STATICS_PATH = os.path.join(self.PARQUET_DIR, "statics")
        self.MAIL_CONTACTS_PATH = os.path.join(self.MAIL_STATICS_PATH, "mail_contact_stats.json")
        self.MAIL_KEYWORDS_PATH  = os.path.join(self.MAIL_STATICS_PATH, "mail_keyword_stats.json")
        self.MAIL_SUMMARIES_PATH = os.path.join(self.MAIL_STATICS_PATH, "mail_summaries.json")
        self.MAIL_SUMMARY_IMAGES_DIR = os.path.join(self.MAIL_STATICS_PATH, "mail_summary_images")
        self.MAIL_PHOTOS_PATH    = os.path.join(self.MAIL_STATICS_PATH, "contact_photos.json")
        self.MAIL_AVATARS_PATH  = os.path.join(self.MAIL_STATICS_PATH, "person_avatars.json")
        self.AVATAR_IMAGES_DIR  = os.path.join(self.MAIL_STATICS_PATH, "avatars")
        self.MAIL_MESSAGE_CACHE_PATH = os.path.join(self.MAIL_STATICS_PATH, "mail_message_cache.json")
        # 메신저(messenger) 도메인 전용 중간 통계 JSON — mail_*과 같은 디렉터리를 쓰지만
        # (이미 domain별로 폴더가 나뉘어 있어 파일명 겹칠 일 없음) 별도 이름으로 구분.
        self.CHATROOM_PEOPLE_MESSAGES_PATH = os.path.join(self.MAIL_STATICS_PATH, "chatroom_people_messages.json")
        self.MESSAGE_KEYWORDS_PATH = os.path.join(self.MAIL_STATICS_PATH, "message_keyword_stats.json")
        self.MESSAGE_SUMMARIES_PATH = os.path.join(self.MAIL_STATICS_PATH, "message_summaries.json")
        self.MESSAGE_SUMMARY_IMAGES_DIR = os.path.join(self.MAIL_STATICS_PATH, "message_summary_images")
        self.MESSAGE_MOOD_PATH = os.path.join(self.MAIL_STATICS_PATH, "message_mood.json")
        self.UPDATE_DIR = os.path.join(self.GRAPHRAG_ROOT, "update_output")
        self.MAX_MAILS = _MAX_MAILS_CONFIG.get(user_id, None)
        self.ACCOUNT_META_PATH = os.path.join(self.USER_ROOT, ACCOUNT_META_FILENAME)
        _ensure_account_meta(self)

# 원본 user_id를 메타 파일로 남겨서 나중에 폴더명(디렉터리 sanitize로 인해 원본 문자열이
# 손실됨)만으로도 실제 계정 목록을 복원할 수 있게 한다. (/accounts 엔드포인트에서 사용)
# 계정 폴더가 아직 없어도(=최초 업로드 시점) 여기서 바로 만든다 — 폴더가 생긴 뒤에야 메타를
# 쓰면, 한글처럼 sanitize로 원본이 복구 불가능하게 뭉개지는 이름은 영영 복구할 기회가 없다
# (영문 이메일 계정은 우연히 역추정이 가능해서 이 버그가 가려져 있었을 뿐임).
def _ensure_account_meta(paths: "UserPaths"):
    if os.path.exists(paths.ACCOUNT_META_PATH):
        return
    try:
        os.makedirs(paths.USER_ROOT, exist_ok=True)
        with open(paths.ACCOUNT_META_PATH, "w", encoding="utf-8") as f:
            json.dump({"user_id": paths.USER_ID}, f, ensure_ascii=False)
    except OSError:
        pass

# 계정 하나의 인덱싱 완료 여부를 RAG_ENGINE에 맞는 방식으로 판단한다.
# app.py의 _index_ready()와 같은 분기지만, user_path.py가 app.py를 import할 수 없어서
# (순환 참조) 여기 따로 둔다. RAG_ENGINE이 바뀌어도 이 함수만 보면 되도록 모아뒀다.
def _account_indexed(paths) -> bool:
    from config.settings import RAG_ENGINE
    if RAG_ENGINE == "lightrag":
        from util.lightrag_backend.lightrag_engine import is_index_ready
        return is_index_ready(paths.LIGHTRAG_OUTPUT_DIR)
    elif RAG_ENGINE == "graphrag":
        from util.graphrag import _is_index_ready
        return _is_index_ready(paths)
    return False

# user_data/{domain} 디렉터리를 훑어서 (user_id, 인덱싱 완료 여부) 목록을 반환.
# domain 파라미터는 카카오 등 다른 도메인 지원을 위한 것 — 아래에서 _account_indexed()를
# 통해 RAG_ENGINE에 맞는 방식으로 인덱싱 여부를 판단한다(엔진별 분기는 여기 없음, 위 함수에 모여있음).
def list_accounts(base_dir: str, domain: str = "mail") -> list[dict]:
    user_data_dir = os.path.join(base_dir, "user_data", domain)
    accounts = []

    if os.path.isdir(user_data_dir):
        for dir_name in sorted(os.listdir(user_data_dir)):
            dir_path = os.path.join(user_data_dir, dir_name)
            if not os.path.isdir(dir_path):
                continue
            # user_data/{domain}/ 아래를 훑는 것 자체가 이미 도메인 필터링이라 별도 체크 불필요.

            meta_path = os.path.join(dir_path, ACCOUNT_META_FILENAME)
            user_id = None
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        user_id = (json.load(f).get("user_id") or "").strip()
                except (OSError, json.JSONDecodeError):
                    user_id = None

            if not user_id:
                # 메타 파일이 아직 없는 계정(이 기능 추가 이전에 만들어진 폴더) →
                # 폴더명에서 최선으로 역추정만 하고, 파일에 쓰지는 않는다.
                user_id = dir_name.replace("_at_", "@", 1).replace("_", ".")

            paths = UserPaths(base_dir, user_id, domain)
            accounts.append({
                "user_id": user_id,
                "indexed": _account_indexed(paths),
            })

    return accounts

# 인덱싱까지 완료된 계정의 user_id만 반환 (연합 검색 대상 계정 목록으로 사용)
def list_indexed_user_ids(base_dir: str, domain: str = "mail") -> list[str]:
    return [a["user_id"] for a in list_accounts(base_dir, domain) if a["indexed"]]

# 도메인별 공용 settings.yaml, prompts를 사용자 parquet 폴더에 복사
def user_graphrag_init(paths):
    domain = paths.DOMAIN

    # 1. parquet 폴더 보장
    os.makedirs(paths.GRAPHRAG_ROOT, exist_ok=True)

    # 2. 도메인별 공용 템플릿 존재 확인
    if not os.path.exists(GRAPHRAG_SETTINGS_DIR(domain)):
        raise FileNotFoundError(
            f"[ERROR] {domain} 공용 settings.yaml 없음: {GRAPHRAG_SETTINGS_DIR(domain)}"
        )
    if not os.path.exists(GRAPHRAG_PROMPTS_DIR(domain)):
        raise FileNotFoundError(
            f"[ERROR] {domain} 공용 prompts 폴더 없음: {GRAPHRAG_PROMPTS_DIR(domain)}"
        )

    # 3. settings.yaml복사(있으면 덮어쓰기), 항상 최신 settings.yaml을 사용하기 위함
    shutil.copy2(GRAPHRAG_SETTINGS_DIR(domain), paths.USER_GRAPH_SETTINGS_PATH)
    print(f"[INIT] settings.yaml 복사/덮어쓰기 완료 → {paths.USER_GRAPH_SETTINGS_PATH}")

    # 4. prompts 폴더 전체 복사(있으면 덮어쓰기), 항상 최신 prompts를 사용하기 위함
    shutil.copytree(
        GRAPHRAG_PROMPTS_DIR(domain),
        paths.USER_GRAPH_PROMPTS_PATH,
        dirs_exist_ok=True  # 기존 프롬프트가 있으면 덮어쓰기
    )