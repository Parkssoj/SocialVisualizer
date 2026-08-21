import os
import io
import re
import json
import base64
import hashlib
import threading
import requests
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image, ImageChops
from util.database.db_reader import get_person_descriptions, get_all_persons
from util.database.chatroom_reader import get_chatroom_people

load_dotenv("src/parquet/.env")

# text_client: 성별/기업 판별, 관계 힌트 번역 등 텍스트 판단(SUB_TASK_CHAT_MODEL, 로컬 Qwen)
text_client = OpenAI(
    api_key=os.getenv("LLM_API_KEY"),
    base_url=os.getenv("SUB_TASK_API_BASE") or None,
)
client = text_client  # 하위 호환용 별칭(아래 텍스트 판별 호출부에서 계속 사용)

# 아바타 이미지 생성 — GPU 서버에 직접 띄운 FLUX.1-schnell 서버(flux_server.py) 호출.
# vLLM과 달리 OpenAI 호환 API가 아니라 우리가 만든 규격(POST /generate)이라
# OpenAI 클라이언트가 아닌 requests로 직접 호출한다.
IMAGE_API_BASE = os.getenv("IMAGE_API_BASE", "http://localhost:8005")
AVATAR_SIZE = 512
AVATAR_STEPS = 4
AVATAR_GUIDANCE_SCALE = 0.0

_map_lock = threading.Lock()

# AI 일러스트 아바타는 FLUX 호출+후처리로 십수 초가 걸리는데, 그 사이 사용자가 페이지를
# 새로고침하면 이전 요청이 아직 person_avatars.json에 저장을 못 끝낸 상태라 "아직 캐시
# 없음"으로 보여서 같은 이메일에 대해 또 새 생성 요청이 들어온다(생성이 끝날 때까지
# 계속 반복). (email, user_id) 단위로 "지금 생성 중"임을 표시해서, 이미 진행 중인 요청이
# 있으면 새 요청은 그 결과를 기다리지 않고 그냥 건너뛴다 — 곧 끝날 이전 요청이 캐시를
# 채워줄 것이므로 다음 새로고침(또는 다음 배치)에서 정상적으로 캐시 히트된다. 로고
# 이미지(브랜드)는 순식간에 끝나서 이 문제가 사실상 발생하지 않는다.
_in_progress_lock = threading.Lock()
_in_progress = set()  # {(user_id, email)}

# 본인 아바타(generate_self_avatar)는 호출자가 URL을 바로 반환받아야 하므로, 위의
# "그냥 건너뛰기"가 아니라 이미 진행 중인 요청이 끝날 때까지 기다렸다가 그 결과를
# 같이 반환한다 — 그래야 새로고침이 겹쳐도 매번 별도로 FLUX를 호출하지 않는다.
_self_avatar_events = {}  # (user_id, key) -> threading.Event
_self_avatar_events_lock = threading.Lock()


def _avatar_filename(email: str) -> str:
    return hashlib.md5(email.strip().lower().encode("utf-8")).hexdigest() + ".png"


def _load_avatar_map(paths) -> dict:
    if not os.path.exists(paths.MAIL_AVATARS_PATH):
        return {}
    with open(paths.MAIL_AVATARS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _avatar_url_file_exists(paths, url: str) -> bool:
    """person_avatars.json엔 캐시 항목이 남아있는데 실제 png 파일은 없는 경우(수동으로
    avatars 폴더만 지웠거나, 파일이 유실된 경우)를 걸러낸다. 이걸 안 하면 프론트는 죽은
    URL로 <img>를 그려서 계속 404가 나고, 서버는 "이미 캐시됨"으로 착각해 영원히
    재생성하지 않는다."""
    if not url:
        return False
    filename = url.rstrip("/").rsplit("/", 1)[-1]
    if not filename:
        return False
    return os.path.exists(os.path.join(paths.AVATAR_IMAGES_DIR, filename))


def _save_avatar_map(paths, avatar_map: dict):
    os.makedirs(paths.MAIL_STATICS_PATH, exist_ok=True)
    with open(paths.MAIL_AVATARS_PATH, "w", encoding="utf-8") as f:
        json.dump(avatar_map, f, ensure_ascii=False, indent=2)


def _chatroom_avatar_filename(participant_id: str) -> str:
    return hashlib.md5(participant_id.strip().encode("utf-8")).hexdigest() + ".png"


def _load_chatroom_avatar_map(paths) -> dict:
    if not os.path.exists(paths.MESSAGE_AVATARS_PATH):
        return {}
    with open(paths.MESSAGE_AVATARS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_chatroom_avatar_map(paths, avatar_map: dict):
    os.makedirs(paths.MAIL_STATICS_PATH, exist_ok=True)
    with open(paths.MESSAGE_AVATARS_PATH, "w", encoding="utf-8") as f:
        json.dump(avatar_map, f, ensure_ascii=False, indent=2)


def _extract_relationship_hint(description: str) -> str:
    """person.description 텍스트(이름/관계/자주 주고받은 내용)에서 '관계' 줄만 추출해
    아바타 스타일에 참고할 짧은 컨텍스트로 사용한다. 메일 내용 자체는 노출하지 않는다."""
    if not description:
        return ""
    m = re.search(r"관계:\s*(.+)", description)
    return m.group(1).strip() if m else ""


def _extract_tone_hint(description: str) -> str:
    """chatroom_people.description 텍스트(참여 패턴/자주 하는 이야기/말투)에서 '말투' 줄만
    추출해 아바타 스타일에 참고할 짧은 컨텍스트로 사용한다. 메일 쪽 '관계' 줄과 같은 역할."""
    if not description:
        return ""
    m = re.search(r"말투:\s*(.+)", description)
    return m.group(1).strip() if m else ""


# 사람마다 시각적으로 뚜렷이 구분되도록, 이메일 해시로 결정적으로 고르는 속성 풀.
# (같은 이메일 → 항상 같은 조합, 다른 이메일 → 대부분 다른 조합)
_BG_COLORS = [
    ("warm coral pink", "#F4B8B8"), ("sky blue", "#AEDFF7"), ("sage green", "#BFE3C8"),
    ("soft lavender", "#D8C6F0"), ("warm sand", "#F4D9A6"), ("seafoam teal", "#A8E0D8"),
    ("dusty rose", "#F0C4D6"), ("pale sunflower yellow", "#F6E2A0"), ("powder blue", "#C7D9F0"),
    ("muted mint", "#BEEBD9"), ("warm peach", "#F6CBA6"), ("soft periwinkle", "#C9CCF4"),
]
_HAIR_STYLES = [
    "short and neatly combed", "medium-length with a side part", "long and straight reaching the shoulders",
    "long and gently wavy", "tied back in a low ponytail", "a short bob cut",
    "tousled and slightly messy", "tied back in a neat bun", "shoulder-length with bangs",
]
_HAIR_COLORS = ["jet black", "dark brown", "warm chestnut brown", "soft ash brown"]
_ACCESSORIES = ["no accessories", "simple round glasses", "small stud earrings", "a thin headband", "rectangular glasses"]
_CLOTHING_COLORS = [
    "coral red", "navy blue", "olive green", "mustard yellow", "plum purple",
    "burnt orange", "deep teal", "rose pink", "charcoal gray", "warm brown",
]


def _hex_to_rgb(hex_color: str) -> tuple:
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _pick_style_attributes(seed_key: str) -> dict:
    n = int(hashlib.md5((seed_key or "").strip().lower().encode("utf-8")).hexdigest(), 16)
    bg_name, bg_hex = _BG_COLORS[n % len(_BG_COLORS)]
    return {
        "bg_name": bg_name,
        "bg_hex": bg_hex,
        "bg_rgb": _hex_to_rgb(bg_hex),
        "hair_style": _HAIR_STYLES[(n // 7) % len(_HAIR_STYLES)],
        "hair_color": _HAIR_COLORS[(n // 13) % len(_HAIR_COLORS)],
        "accessory": _ACCESSORIES[(n // 29) % len(_ACCESSORIES)],
        "clothing_color": _CLOTHING_COLORS[(n // 41) % len(_CLOTHING_COLORS)],
    }


def _infer_gender_presentation(name: str) -> str:
    """
    이미지 모델(gpt-image-1)에게 "이름 보고 알아서 성별 추론해"라고 맡기면 부정확할 때가 많아
    (예: '최지유' → 남성으로 잘못 생성), 텍스트 추론에 강한 {SUB_TASK_CHAT_MODEL}로 먼저 판별해
    이미지 프롬프트에 명시적으로 박아 넣는다. 한국어 이름뿐 아니라 영어 등 다른 언어권 이름도
    함께 판단할 수 있도록 특정 문화권에 한정하지 않는다.
    반환: 'female' | 'male' | 'unknown'
    """
    try:
        result = client.chat.completions.create(
            model=os.getenv("SUB_TASK_CHAT_MODEL"),
            messages=[
                {
                    "role": "system",
                    "content": "주어진 사람 이름만 보고 일반적으로 인지되는 성별을 판단하는 AI입니다. "
                                "이름은 한국어, 영어 등 다양한 언어/문화권에서 올 수 있으니 이름의 언어/문화권에 맞는 "
                                "통상적인 성별 인식 관습을 적용하세요. "
                                "반드시 female, male, unknown 중 하나만 정확히 출력하세요. 판단이 애매하면 unknown.",
                },
                {"role": "user", "content": f"이름: {name}"},
            ],
            temperature=0,
        )
        answer = result.choices[0].message.content.strip().lower()
        if "female" in answer:
            return "female"
        if "male" in answer:
            return "male"
    except Exception as e:
        print(f"[AVATAR] 성별 추론 실패 ({name}): {e}")
    return "unknown"


# 초대형 브랜드는 LLM 판별이 흔들릴 수 있어(도메인이 발송대행사인 경우 등) 확정 매핑을 우선 사용한다.
_KNOWN_BRAND_DOMAINS = {
    "instagram": "instagram.com", "pinterest": "pinterest.com", "google": "google.com",
    "google play": "google.com", "mcafee": "mcafee.com", "twitter": "x.com", "x": "x.com",
    "discord": "discord.com", "microsoft": "microsoft.com", "xbox": "xbox.com",
    "neo4j": "neo4j.com", "the neo4j team": "neo4j.com", "facebook": "facebook.com",
    "linkedin": "linkedin.com", "naver": "naver.com", "kakao": "kakaocorp.com",
    "amazon": "amazon.com", "apple": "apple.com", "netflix": "netflix.com",
    "youtube": "youtube.com", "spotify": "spotify.com", "slack": "slack.com",
    "zoom": "zoom.us", "adobe": "adobe.com", "dropbox": "dropbox.com",
    "paypal": "paypal.com", "ebay": "ebay.com", "samsung": "samsung.com",
    "lg": "lg.com", "steam": "steampowered.com", "playstation": "playstation.com",
    "nintendo": "nintendo.com", "airbnb": "airbnb.com", "uber": "uber.com",
    "github": "github.com", "figma": "figma.com", "notion": "notion.so",
}


def _classify_sender(name: str, domain: str) -> str | None:
    """
    표시 이름/이메일 도메인만 보고 이 발신자가 실제로 존재하는 기업/서비스의
    자동 발송(알림, 뉴스레터, 영수증 등) 계정인지 판별한다.
    실제 기업이면 로고를 찾을 공식 웹사이트 도메인을 반환하고, 실제 개인이거나
    어떤 기업인지 확실하지 않으면 None을 반환한다(→ 일러스트 아바타로 대체).
    """
    known = _KNOWN_BRAND_DOMAINS.get((name or "").strip().lower())
    if known:
        return known
    try:
        result = client.chat.completions.create(
            model=os.getenv("SUB_TASK_CHAT_MODEL"),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "이메일 발신자 정보를 보고 이것이 실제로 존재하는 기업/서비스가 보낸 "
                        "자동 발송 계정(알림, 뉴스레터, 영수증, 마케팅 메일 등)인지 판단하는 AI입니다. "
                        "표시 이름이 유명 기업/서비스 이름과 일치하면, 이메일 도메인이 발송대행사 "
                        "도메인(예: sendgrid.net, mailgun.org, amazonses.com 등)이라서 그 기업의 "
                        "공식 도메인과 달라 보여도 표시 이름을 우선 신뢰해 그 기업으로 판단하세요. "
                        "실제로 존재하는 기업/서비스라면 그 기업의 공식 웹사이트 도메인만 "
                        "(예: google.com) 정확히 출력하세요. 실제 사람 개인 계정이거나 "
                        "어느 기업인지 확실하지 않으면 정확히 'PERSON'이라고만 출력하세요."
                    ),
                },
                {"role": "user", "content": f"표시 이름: {name}\n이메일 도메인: {domain}"},
            ],
            temperature=0,
        )
        answer = (result.choices[0].message.content or "").strip()
        if not answer or answer.upper() == "PERSON":
            return None
        m = re.search(r"[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", answer)
        return m.group(0).lower() if m else None
    except Exception as e:
        print(f"[AVATAR] 기업 판별 실패 ({name}): {e}")
        return None


def _logo_content_mask(logo: Image.Image) -> Image.Image:
    """로고 이미지에서 실제로 눈에 보이는 도형 픽셀만 표시하는 "L" 모드 마스크를 만든다.

    단순히 `alpha.getbbox()`만 쓰면 눈에는 안 보이는 극히 옅은 알파(1~수십 수준)나
    안티에일리어싱으로 생긴 아주 옅은 회색조 픽셀까지 "내용물"로 잡혀 마스크가
    이미지 가장자리까지 부풀어버리는 경우가 있었다. 실제로 눈에 뚜렷이 보이는
    픽셀만 기준으로 삼도록 임계값을 둔다."""
    alpha = logo.split()[-1]
    if alpha.getextrema()[0] < 250:  # 투명 배경이 있는 이미지 → 알파 기준
        return alpha.point(lambda a: 255 if a >= 32 else 0)
    # 불투명(흰 배경) 이미지 → 흰색과 뚜렷이 다른 영역 기준
    rgb = logo.convert("RGB")
    diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, (255, 255, 255))).convert("L")
    return diff.point(lambda d: 255 if d >= 24 else 0)


def _trim_logo_padding(logo: Image.Image) -> tuple[Image.Image, Image.Image] | tuple[None, None]:
    """로고를 실제 도형 경계까지 크롭하고, 그 도형의 내용 마스크를 함께 반환한다."""
    w, h = logo.size
    mask = _logo_content_mask(logo)
    bbox = mask.getbbox()
    if not bbox:
        return logo, mask
    # 임계값 처리 과정에서 실제 형상 가장자리의 부드러운 픽셀 한두 줄이 잘려나갈 수 있으니
    # 소폭 여유를 되돌려준다(과도한 크롭으로 로고 윤곽이 뭉개지는 것을 방지).
    pad = max(1, round(max(w, h) * 0.01))
    left, top, right, bottom = bbox
    bbox = (max(0, left - pad), max(0, top - pad), min(w, right + pad), min(h, bottom + pad))
    return logo.crop(bbox), mask.crop(bbox)


def _logo_badge_color(logo: Image.Image, mask: Image.Image) -> tuple[int, int, int] | None:
    """
    로고 도형이 이미 그 자체로 꽉 찬 색깔 배지(예: Pinterest의 빨간 원+흰 P, Discord의
    블러플 원+흰 아이콘)인지, 아니면 배경 없이 심볼만 있는 얇은 단색 마크(예: McAfee의
    방패)인지 판별한다. 후자라면 그 마크의 실제 색을 배지 배경색으로 뽑아 반환하고,
    이미 배지 형태이거나 다색(Instagram/Google처럼)이면 None을 반환해 원본 그대로 둔다.
    """
    rgb = logo.convert("RGB")
    pixels = list(rgb.getdata())
    mask_data = list(mask.getdata())
    content = [px for px, m in zip(pixels, mask_data) if m]
    if not content:
        return None

    fill_ratio = len(content) / (logo.width * logo.height)
    if fill_ratio >= 0.68:
        # 이미 도형 자체가 원/사각형을 꽉 채운 배지 형태 → 그대로 사용
        return None

    # 색 다양성 검사: 양자화한 색상 버킷 중 하나가 압도적 비중이면 "단색 마크"로 본다.
    buckets = Counter((r // 32, g // 32, b // 32) for r, g, b in content)
    top_bucket, top_count = buckets.most_common(1)[0]
    if top_count / len(content) < 0.75:
        # Instagram/Google처럼 여러 색이 섞인 다색 로고 → 재색칠하지 않고 그대로 사용
        return None

    top_pixels = [
        px for px, m in zip(pixels, mask_data)
        if m and (px[0] // 32, px[1] // 32, px[2] // 32) == top_bucket
    ]
    r = sum(p[0] for p in top_pixels) // len(top_pixels)
    g = sum(p[1] for p in top_pixels) // len(top_pixels)
    b = sum(p[2] for p in top_pixels) // len(top_pixels)
    return (r, g, b)


def _pad_logo_square(image_bytes: bytes, canvas_size: int = 512) -> bytes:
    """
    Figma에서 원 프레임에 이미지를 채우기(Fill)하듯, 로고를 정사각형 캔버스에
    여백 없이 꽉 채운다. 프론트엔드가 이 정사각형을 원형으로 마스킹해서 보여주므로,
    캔버스 네 모서리는 어차피 원 밖이라 안 보인다 — "원 안에 다 들어가게" 크기를
    역산할 필요 없이 그냥 캔버스를 완전히 채우기만 하면 결과적으로 원이 꽉 찬다.

    도형만 있고 배경이 없는 얇은 단색 마크는 채워도 흐릿하게 떠 보이므로, 그 마크의
    실제 색을 배경색으로 쓰고 마크 자체는 흰색으로 바꿔 배지 스타일로 통일한다.
    이미 배지 형태이거나 다색(Instagram/Google 등)이면 원본 그대로 흰 배경에 채운다.
    """
    logo = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    logo, mask = _trim_logo_padding(logo)
    badge_color = _logo_badge_color(logo, mask)

    if badge_color is not None:
        white_glyph = Image.new("RGBA", logo.size, (255, 255, 255, 255))
        white_glyph.putalpha(mask)
        logo = white_glyph
        bg_rgba = badge_color + (255,)
    else:
        bg_rgba = (255, 255, 255, 255)

    # cover(꽉 채우기): 짧은 변을 캔버스 크기에 맞춰 확대해 여백 없이 채운다.
    # 파비콘처럼 아주 작은 원본을 큰 배율로 늘리면 뭉개져 보이므로 배율 자체에 상한을 둔다.
    scale = min(max(canvas_size / logo.width, canvas_size / logo.height), 6.0)
    new_size = (max(1, round(logo.width * scale)), max(1, round(logo.height * scale)))
    logo = logo.resize(new_size, Image.LANCZOS)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), bg_rgba)
    x, y = (canvas_size - logo.width) // 2, (canvas_size - logo.height) // 2
    canvas.paste(logo, (x, y), logo)
    out = io.BytesIO()
    canvas.convert("RGB").save(out, format="PNG")
    return out.getvalue()


_BRAND_LOGOS_DIR = os.path.join(os.path.dirname(__file__), "brand_logos")

# Clearbit/파비콘이 화질이 낮거나 배지 형태가 아닌 로고를 주는 브랜드는
# 직접 준비한 원본 이미지를 우선 사용한다.
_HARDCODED_LOGO_FILES = {
    "pinterest.com": "pinterest.png",
    "mcafee.com": "mcafee.png",
    "neo4j.com": "neo4j.png",
}


def _place_hardcoded_logo(image_bytes: bytes, canvas_size: int = 512) -> bytes:
    """
    직접 고른 완성도 있는 로고 이미지를 위한 단순 배치. 배지 재색칠이나 꽉 채우기(cover)
    크롭 없이, 여백만 다듬어 자르고 잘리지 않게 캔버스 안에 맞춘다(contain) — 이미
    보기 좋은 이미지이므로 재해석하지 않고 그대로 살린다.
    """
    logo = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    logo, _ = _trim_logo_padding(logo)
    target = int(canvas_size * 0.68)
    scale = min(target / max(logo.width, logo.height), 6.0)
    new_size = (max(1, round(logo.width * scale)), max(1, round(logo.height * scale)))
    logo = logo.resize(new_size, Image.LANCZOS)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (255, 255, 255, 255))
    x, y = (canvas_size - logo.width) // 2, (canvas_size - logo.height) // 2
    canvas.paste(logo, (x, y), logo)
    out = io.BytesIO()
    canvas.convert("RGB").save(out, format="PNG")
    return out.getvalue()


def _fetch_company_logo(domain: str) -> bytes | None:
    """공개 로고 서비스에서 실제 기업 로고를 가져온다. 실패 시 None."""
    hardcoded = _HARDCODED_LOGO_FILES.get(domain)
    if hardcoded:
        filepath = os.path.join(_BRAND_LOGOS_DIR, hardcoded)
        if os.path.exists(filepath):
            with open(filepath, "rb") as f:
                return _place_hardcoded_logo(f.read())

    for url in (
        f"https://logo.clearbit.com/{domain}?size=256",
        f"https://www.google.com/s2/favicons?sz=256&domain={domain}",
    ):
        try:
            res = requests.get(url, timeout=8)
            if res.status_code == 200 and res.content and len(res.content) > 200:
                return _pad_logo_square(res.content)
        except Exception as e:
            print(f"[AVATAR] 로고 요청 실패 ({url}): {e}")
    return None


def _translate_hint_to_english(hint: str) -> str:
    """FLUX의 CLIP/T5 텍스트 인코더는 영어 위주로 학습돼 한국어 vocab이 빈약해서,
    한국어 relationship_hint를 그대로 넣으면 토큰이 <unk>로 깨진다. 프롬프트에 넣기 전에
    짧은 영어 한 문장으로 번역해 넣는다. 실패 시 빈 문자열을 반환해 힌트를 생략한다."""
    try:
        result = text_client.chat.completions.create(
            model=os.getenv("SUB_TASK_CHAT_MODEL"),
            messages=[
                {
                    "role": "system",
                    "content": "다음 한 줄짜리 관계 설명을 이미지 생성 프롬프트에 넣을 수 있도록 "
                                "간결한 영어 한 문장으로 번역하세요. 번역 결과 외의 다른 말은 절대 하지 마세요.",
                },
                {"role": "user", "content": hint},
            ],
            temperature=0,
        )
        return (result.choices[0].message.content or "").strip()
    except Exception as e:
        print(f"[AVATAR] 관계 힌트 번역 실패: {e}")
        return ""


def _build_avatar_prompt(name: str, relationship_hint: str = "", seed_key: str = "") -> str:
    context_block = ""
    if relationship_hint:
        translated_hint = _translate_hint_to_english(relationship_hint[:200])
        if translated_hint:
            context_block = f"""

[Persona context — style inspiration only, never literal]
A short note about this person's relationship to the user: "{translated_hint}"
Use this ONLY as soft inspiration for clothing style and mood (e.g. business-casual for a colleague, relaxed casual for a friend/family member). Never depict any text, objects, logos, or literal scenes from this note."""

    attrs = _pick_style_attributes(seed_key or name)
    gender = _infer_gender_presentation(name)
    gender_line = {
        "female": "Depict this person with a clearly feminine gender presentation.",
        "male": "Depict this person with a clearly masculine gender presentation.",
        "unknown": "This person's gender is ambiguous from their name — depict them with a gender-neutral, androgynous presentation.",
    }[gender]

    return f"""You are the illustration engine for a unified corporate contact-avatar system, in the visual language of products like Slack, Notion, or Linear's default member avatars. Every avatar you generate must look like it belongs to the exact same icon set — consistent style, consistent rules, every time. Each person in this set must look like a clearly distinct individual, not a reused default template.

[Hard rule — read first, applies to the whole image]
The ENTIRE image outside the person's head/hair/shoulders must be a single pure flat solid color ({attrs['bg_name']}, hex {attrs['bg_hex']}) — perfectly flat, uniform, edge-to-edge, corner-to-corner, with zero variation. Do NOT draw a picture frame, border, mat/matting, vignette, spotlight, or a circular/oval disc of any other color or shade behind the person. Nothing decorative behind or around the subject, ever — just the one flat color.

[Subject]
A single friendly portrait of one person whose given name is "{name}". {gender_line}{context_block}

[Individual appearance — follow exactly, these make this avatar visually distinct from everyone else in the set]
- Hair: {attrs['hair_color']}, styled {attrs['hair_style']}.
- Accessory: {attrs['accessory']}.
- Clothing: a flat, solid {attrs['clothing_color']} top.
- Background: pure flat {attrs['bg_name']} (hex {attrs['bg_hex']}) filling the entire canvas edge-to-edge behind the person. Completely uniform, no gradient, no vignette, no texture, no shape, no glow, no spotlight. Absolutely NO circular disc, badge, frame, or any shape of a different shade behind the person — the background must be one single flat rectangle of this color, corner to corner.

[Art direction]
- Flat vector illustration, modern corporate-avatar style: clean geometric shapes, confident outlines of uniform stroke width. No gradients, no soft shading, no drop shadows, no textures, no glossy highlights anywhere in the image.
- The face must read clearly even at very small sizes (this renders as a ~40px circular icon): simple but expressive eyes, nose, and a warm closed-mouth smile. Never leave the face blank or featureless.

[Framing & composition]
- The face must look directly at the viewer: a straight-on, frontal head-on pose with both eyes looking straight ahead into the camera. Do NOT draw a 3/4 turned angle, side profile, or head tilted/turned away — the nose must point straight forward at the center of the image, perfectly symmetrical left-to-right.
- Close-up, centered, symmetrical portrait, zoomed in so the face is the clear focal point — tighter than a standard shoulders-up photo, more like a close-up headshot. Still keep a small margin of empty space above the hair and on both sides so the hairstyle silhouette isn't cropped.
- The entire head, the full hairstyle silhouette, and both ears must be completely visible. The head should occupy roughly 70-80% of the image height — the face should read as large and prominent, not small within a wide shot.
- The shoulders and clothing should extend all the way down and bleed off the bottom edge of the canvas, with NO background visible below the body — only the head/hair area needs top and side margin, the torso should fill edge-to-edge at the bottom like a standard cropped profile-picture avatar.

[Technical constraints]
- Square canvas, 1:1 aspect ratio.
- No text, no logos, no watermarks, no signatures, no UI chrome, no photorealism, no 3D rendering, no anime style.
- No border, no frame, no outline, no card edge of any kind around the outer edge of the canvas — the background color must reach all four edges directly.""".strip()




_rembg_session = None
_rembg_session_lock = threading.Lock()


def _get_rembg_session():
    """인물 세그멘테이션 모델을 프로세스당 한 번만 로드해 재사용한다. 최초 호출 시
    모델 파일(~176MB)을 내려받으므로 인터넷 연결이 필요하고 첫 실행이 다소 느릴 수 있다."""
    global _rembg_session
    if _rembg_session is None:
        with _rembg_session_lock:
            if _rembg_session is None:
                from rembg import new_session
                _rembg_session = new_session("u2net")
    return _rembg_session


def _normalize_composition(image_bytes: bytes, bg_rgb: tuple, min_top: float = 0.02, min_side: float = 0.03) -> bytes:
    """
    크로마키(색상 거리 기반) 방식은 사람 윤곽선 가장자리에 배경색(마젠타)이 살짝 섞여
    들어간 픽셀까지 사람 쪽으로 살아남는 경우가 있어(색 스필), 합성 후 머리카락 등
    가장자리에 옅은 배경색 얼룩이 남는 문제가 있었다. 그래서 색상 거리 대신 사람
    세그멘테이션 모델(rembg)로 "이 픽셀이 사람인가"를 직접 판단한다 — 배경이 무슨
    색이든(프롬프트가 요청한 색을 모델이 못 지켜서 은은한 원형 그라데이션 등이 섞여
    나와도) 상관없이 사람 영역만 추출해서 완전히 새 단색 배경 위에 얹기 때문에,
    배경 자체는 100% 순수한 단색이 보장된다. 잘라낸 인물은 얼굴이 크게 보이도록
    여백을 작게 잡아 확대 배치한다.
    """
    from rembg import remove

    subject = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    orig_w, orig_h = subject.size

    session = _get_rembg_session()
    cutout_bytes = remove(image_bytes, session=session)
    alpha = Image.open(io.BytesIO(cutout_bytes)).convert("RGBA").split()[-1]

    # 사진이 아니라 윤곽선이 뚜렷한 평면 일러스트라서 부드러운 반투명 경계가 필요 없다 —
    # 오히려 옷/어깨 같은 큰 단색 영역이 애매한 알파로 남으면 배경색과 섞여 흐릿한
    # "유령" 자국이 생긴다. 그래서 이진화해서 사람 영역은 완전 불투명, 나머지는 완전
    # 투명으로 딱 잘라낸다 — 가장자리에 원본 배경색이 섞인 반투명 픽셀도 이 과정에서
    # 함께 제거되므로 색 스필(색 번짐) 문제가 생기지 않는다.
    alpha = alpha.point(lambda p: 255 if p > 80 else 0)

    r, g, b = subject.split()
    cutout = Image.merge("RGBA", (r, g, b, alpha))

    bbox = alpha.getbbox()
    canvas = Image.new("RGBA", (orig_w, orig_h), bg_rgb + (255,))

    if not bbox:
        # 세그멘테이션이 완전히 실패하면(알파가 전부 비어있음) 원본을 그대로 반환한다
        # (사람 영역을 못 찾았으므로 억지로 자르지 않는다).
        return image_bytes

    left, top, right, bottom = bbox
    content_w, content_h = right - left, bottom - top
    if content_w <= 0 or content_h <= 0:
        return image_bytes

    cropped = cutout.crop(bbox)

    scale = (orig_h * (1 - min_top)) / content_h
    max_w = orig_w * (1 - 2 * min_side)
    if content_w * scale > max_w:
        scale = max_w / content_w

    new_w, new_h = max(1, round(content_w * scale)), max(1, round(content_h * scale))
    resized = cropped.resize((new_w, new_h), Image.LANCZOS)

    canvas.alpha_composite(resized, ((orig_w - new_w) // 2, orig_h - new_h))

    out = io.BytesIO()
    canvas.convert("RGB").save(out, format="PNG")
    return out.getvalue()


def generate_avatar_image_bytes(name: str, relationship_hint: str = "", seed_key: str = "") -> bytes:
    """GPU 서버의 FLUX.1-schnell 서버(flux_server.py)를 호출해 아바타를 생성한다.
    배경색은 프롬프트에도 직접 지정해두지만(_build_avatar_prompt), 모델이 그 지시를
    완벽히 안 지킬 때가 있어(은은한 원형 그라데이션 등) _normalize_composition()으로
    사람 영역만 rembg 세그멘테이션으로 뽑아 완전히 새 단색 배경 위에 다시 앉힌다.
    (색상 거리 기반 크로마키는 가장자리에 배경색이 번지는 문제가 있어 rembg로 대체.)"""
    attrs = _pick_style_attributes(seed_key or name)
    prompt = _build_avatar_prompt(name, relationship_hint, seed_key)
    response = requests.post(
        f"{IMAGE_API_BASE}/generate",
        json={
            "prompt": prompt,
            "steps": AVATAR_STEPS,
            "guidance_scale": AVATAR_GUIDANCE_SCALE,
            "height": AVATAR_SIZE,
            "width": AVATAR_SIZE,
        },
        timeout=240,  # GPU 서버가 동시 요청을 사실상 순차 처리해서, 여러 명을 한꺼번에
        # 생성할 때 뒤에 밀린 요청은 120초를 넘기기 쉬웠다 — 여유를 더 줌
    )
    response.raise_for_status()
    b64 = response.json()["image_base64"]
    raw_bytes = base64.b64decode(b64)
    return _normalize_composition(raw_bytes, attrs["bg_rgb"])


def _load_relationship_hints(user_id: str) -> dict:
    """person.description에서 이메일별 '관계' 한 줄만 뽑아 캐시 없이 즉시 조회한다."""
    hints = {}
    try:
        for row in get_person_descriptions(user_id):
            email = (row.get("person_account_id") or "").strip().lower()
            hint = _extract_relationship_hint(row.get("description") or "")
            if email and hint:
                hints[email] = hint
    except Exception as e:
        print(f"[AVATAR] 관계 설명 조회 실패 (스타일 힌트 없이 진행): {e}")
    return hints


def get_cached_person_avatars(paths) -> dict:
    """캐시된 아바타 맵을 돌려주되, 실제 png 파일이 없는(수동 삭제 등으로 유실된) 항목은
    걸러낸다 — 안 그러면 프론트가 죽은 이미지 URL을 그려 계속 404가 나고, 그 사람은
    "이미 캐시됨"으로 취급돼 영원히 재생성되지 않는다."""
    avatar_map = _load_avatar_map(paths)
    valid = {k: v for k, v in avatar_map.items() if _avatar_url_file_exists(paths, v)}
    if len(valid) != len(avatar_map):
        with _map_lock:
            _save_avatar_map(paths, valid)  # 유실된 항목은 캐시에서도 지워서 재생성 대상이 되게 함
    return valid


_SELF_AVATAR_KEY = "__self__"


def get_cached_self_avatar(paths):
    """로그인한 사용자 본인의 아바타 캐시를 조회한다. 없거나 파일이 유실됐으면 None."""
    url = _load_avatar_map(paths).get(_SELF_AVATAR_KEY)
    return url if _avatar_url_file_exists(paths, url) else None


def generate_self_avatar(paths, name: str) -> str:
    """로그인한 사용자 본인의 아바타를 (없으면) 한 번 생성해 캐시하고 URL을 반환한다.
    사람 카드와 같은 일러스트 아바타 파이프라인을 그대로 재사용하되, 이메일이 아닌
    고정 키(__self__)로 캐시해서 실제 연락처 이메일과 절대 충돌하지 않게 한다."""
    avatar_map = _load_avatar_map(paths)
    cached = avatar_map.get(_SELF_AVATAR_KEY)
    if cached and _avatar_url_file_exists(paths, cached):
        return cached

    lock_key = (paths.USER_ID, _SELF_AVATAR_KEY)
    with _self_avatar_events_lock:
        event = _self_avatar_events.get(lock_key)
        is_owner = event is None
        if is_owner:
            event = threading.Event()
            _self_avatar_events[lock_key] = event

    if not is_owner:
        # 다른 요청이 이미 생성 중 — 새로 FLUX를 호출하지 않고 그 결과가 끝나길 기다린다.
        event.wait(timeout=240)
        return _load_avatar_map(paths).get(_SELF_AVATAR_KEY) or cached

    try:
        os.makedirs(paths.AVATAR_IMAGES_DIR, exist_ok=True)
        image_bytes = generate_avatar_image_bytes(name or "나", "", paths.USER_ID + ":self")
        filename = _avatar_filename(_SELF_AVATAR_KEY + ":" + paths.USER_ID)
        filepath = os.path.join(paths.AVATAR_IMAGES_DIR, filename)
        with open(filepath, "wb") as f:
            f.write(image_bytes)
        url = f"/person-avatar-image/{paths.USER_ID}/{filename}"
        with _map_lock:
            latest = _load_avatar_map(paths)
            latest[_SELF_AVATAR_KEY] = url
            _save_avatar_map(paths, latest)
        return url
    finally:
        with _self_avatar_events_lock:
            _self_avatar_events.pop(lock_key, None)
        event.set()


def generate_person_avatars_batch(paths, people: list) -> dict:
    """
    people: [{ "email": str, "name": str }, ...]
    이미 캐시된 사람은 건너뛰고, 새로운 발신자만 처리한다. 발신자별로 먼저 LLM에게
    실제 존재하는 기업/서비스인지 물어보고, 기업이면 실제 로고 이미지를, 아니면(개인)
    GPT 이미지 API로 생성한 일러스트 아바타를 사용한다.
    반환: { email_lower: "/person-avatar-image/<user_id>/<filename>" } (요청한 사람 전체에 대한 매핑)
    """
    os.makedirs(paths.AVATAR_IMAGES_DIR, exist_ok=True)
    avatar_map = _load_avatar_map(paths)

    targets = []
    seen = set()
    for p in people:
        email = (p.get("email") or "").strip().lower()
        name = (p.get("name") or "").strip()
        if not email or not name or email in seen:
            continue
        seen.add(email)
        if not _avatar_url_file_exists(paths, avatar_map.get(email)):
            key = (paths.USER_ID, email)
            with _in_progress_lock:
                if key in _in_progress:
                    # 다른 요청이 이 이메일을 이미 생성 중 — 중복으로 또 시작하지 않는다.
                    # (그 요청이 끝나면 캐시가 채워지므로 다음 새로고침/배치에서 히트된다.)
                    continue
                _in_progress.add(key)
            domain = email.split("@", 1)[1] if "@" in email else ""
            targets.append((email, name, domain))

    relationship_hints = _load_relationship_hints(paths.USER_ID) if targets else {}

    def _generate_one(email, name, domain):
        try:
            brand_domain = _classify_sender(name, domain)
            image_bytes = _fetch_company_logo(brand_domain) if brand_domain else None
            is_logo = image_bytes is not None
            if image_bytes is None:
                image_bytes = generate_avatar_image_bytes(name, relationship_hints.get(email, ""), email)

            filename = _avatar_filename(email)
            filepath = os.path.join(paths.AVATAR_IMAGES_DIR, filename)
            with open(filepath, "wb") as f:
                f.write(image_bytes)
            url = f"/person-avatar-image/{paths.USER_ID}/{filename}"
            with _map_lock:
                # 저장 직전에 파일을 다시 읽어 병합한다. 요청 시작 시점 스냅샷(avatar_map)을
                # 그대로 덮어쓰면, 동시에 들어온 다른 /generate-person-avatars 요청이 그 사이
                # 새로 추가한 항목을 지워버려 "생성 완료" 로그는 찍히는데 person_avatars.json엔
                # 안 남는(→ 화면에 안 뜨고 다음 로드 때 또 재생성되는) 문제가 생긴다.
                latest = _load_avatar_map(paths)
                latest[email] = url
                _save_avatar_map(paths, latest)
                avatar_map[email] = url
            print(f"[AVATAR] 생성 완료: {email} ({name}){' [기업 로고]' if is_logo else ''}")
            return email, url
        except Exception as e:
            print(f"[AVATAR] 생성 실패 ({email}): {e}")
            return email, None
        finally:
            with _in_progress_lock:
                _in_progress.discard((paths.USER_ID, email))

    if targets:
        # GPU 서버가 하나라 동시 요청을 어차피 순차 처리한다 — 여러 개를 동시에 던지면
        # 뒤에 밀린 요청만 대기 시간이 늘어나 타임아웃 위험만 커지고 실제로는 더 빨라지지
        # 않는다. 게다가 자기 자신(/generate-self-avatar)도 같은 GPU 서버를 같이 쓰므로
        # 부담을 더 줄이려 동시 실행 수를 1로 낮춘다.
        with ThreadPoolExecutor(max_workers=1) as executor:
            futures = [executor.submit(_generate_one, email, name, domain) for email, name, domain in targets]
            for future in as_completed(futures):
                future.result()

    return {email: avatar_map[email] for email in seen if email in avatar_map}


def generate_all_person_avatars(paths) -> dict:
    """인덱싱 완료 직후 이 계정의 연락처 전체를 조회해 일괄 아바타 생성한다(프론트엔드
    지연 생성 대신 서버 사이드 트리거용 진입점). 이미 캐시된 사람은 generate_person_avatars_batch
    내부의 skip 로직이 그대로 걸러준다."""
    persons = get_all_persons(paths.USER_ID)
    people = [
        {"email": p["person_mail_account_id"], "name": p.get("person_name") or ""}
        for p in persons
        if p.get("person_mail_account_id")
    ]
    return generate_person_avatars_batch(paths, people)


def get_cached_chatroom_people_avatars(paths) -> dict:
    return _load_chatroom_avatar_map(paths)


def generate_chatroom_people_avatars_batch(paths) -> dict:
    """
    chatroom_people 테이블에서 이 채팅방(paths.USER_ID)의 참여자 전체를 조회해, 아직
    아바타가 없는 참여자만 GPT 이미지 API로 일러스트 아바타를 생성한다. 메신저 참여자는
    이메일이 없고(캐시 키는 participant_id) 기업/브랜드 로고 판별 대상도 아니므로,
    메일 쪽의 브랜드 로고 분기 없이 항상 일러스트 아바타를 생성한다.
    스타일 힌트는 chatroom_people.description의 '말투' 줄(_extract_tone_hint)을 메일의
    '관계' 줄과 같은 방식으로 재사용해, 메일 아바타와 동일한 프롬프트/아트 스타일을 유지한다.
    반환: { participant_id: "/chatroom-person-avatar-image/<chatroom_id>/<filename>" }
    """
    people = get_chatroom_people(paths.USER_ID)
    if not people:
        return {}

    os.makedirs(paths.MESSAGE_AVATAR_IMAGES_DIR, exist_ok=True)
    avatar_map = _load_chatroom_avatar_map(paths)

    targets = []
    seen = set()
    for p in people:
        participant_id = (p.get("participant_id") or "").strip()
        name = (p.get("name") or "").strip()
        if not participant_id or not name or participant_id in seen:
            continue
        seen.add(participant_id)
        if participant_id not in avatar_map:
            tone_hint = _extract_tone_hint(p.get("description") or "")
            targets.append((participant_id, name, tone_hint))

    def _generate_one(participant_id, name, tone_hint):
        try:
            image_bytes = generate_avatar_image_bytes(name, tone_hint, participant_id)

            filename = _chatroom_avatar_filename(participant_id)
            filepath = os.path.join(paths.MESSAGE_AVATAR_IMAGES_DIR, filename)
            with open(filepath, "wb") as f:
                f.write(image_bytes)
            url = f"/chatroom-person-avatar-image/{paths.USER_ID}/{filename}"
            with _map_lock:
                avatar_map[participant_id] = url
                _save_chatroom_avatar_map(paths, avatar_map)
            print(f"[AVATAR] 참여자 아바타 생성 완료: {participant_id} ({name})")
            return participant_id, url
        except Exception as e:
            print(f"[AVATAR] 참여자 아바타 생성 실패 ({participant_id}): {e}")
            return participant_id, None

    if targets:
        with ThreadPoolExecutor(max_workers=min(len(targets), 3)) as executor:
            futures = [executor.submit(_generate_one, pid, name, hint) for pid, name, hint in targets]
            for future in as_completed(futures):
                future.result()

    return {pid: avatar_map[pid] for pid in seen if pid in avatar_map}
