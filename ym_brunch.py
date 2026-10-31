# -*- coding: utf-8 -*-
"""
브런치 요일별 연재 (ym_brunch)

브런치(brunch.co.kr) 홈의 "연재 작품 요일별" 목록을 BookOasis 사이드바 탭에서 보여줍니다.
브런치 화면이 쓰는 공개 API를 그대로 부릅니다(로그인 불필요):
  GET https://api.brunch.co.kr/v2/serial-brunchbook/all
      ?dayOfWeek=MONDAY..SUNDAY&orderKeyword=PUBLISH_TIME|DONATION_TOTAL_AMOUNT|LIKE_COUNT&serialStatus=ONGOING
      (완결은 serialStatus=COMPLETE 만)
  응답 data.list(20개씩) / data.moreList / data.nextUrl(다음 페이지 전체 URL)

브라우저에서 바로 부르면 CORS에 막히므로 서버(이 파일)가 대신 받아서 넘깁니다.
화면(script.js) -> /api/media/context-menu/book/plugins/action -> run_context_menu_action()
반환은 {'success': bool, 'message'|'error': str} dict여야 하고(튜플이면 코어가 400),
목록은 message에 JSON 문자열로 담아 보냅니다.
"""
import json
import threading
import time

try:
    from urllib.parse import urlencode
    from urllib.request import Request, urlopen
except ImportError:  # pragma: no cover - 코어는 python3
    from urllib import urlencode
    from urllib2 import Request, urlopen

from plugins.metadata.base import BaseMetadataProvider

API_URL = "https://api.brunch.co.kr/v2/serial-brunchbook/all"
WEB_URL = "https://brunch.co.kr"
DAYS = ("MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY")
SORTS = ("PUBLISH_TIME", "DONATION_TOTAL_AMOUNT", "LIKE_COUNT")
USER_AGENT = "Mozilla/5.0 (BookOasis ym_brunch plugin)"
TIMEOUT_SEC = 10
CACHE_SEC = 300  # 같은 목록을 탭 전환마다 다시 받지 않게 5분 보관

_cache = {}
_cache_lock = threading.Lock()


def _https(url):
    # 브런치 이미지 주소가 http://로 와서 https 페이지에선 혼합 콘텐츠로 막힌다 (CDN은 https도 받음)
    if isinstance(url, str) and url.startswith("http://"):
        return "https://" + url[len("http://"):]
    return url or ""


def _fetch_json(url):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(url)
        if hit and now - hit[0] < CACHE_SEC:
            return hit[1]
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json",
                                "Referer": WEB_URL + "/"})
    resp = urlopen(req, timeout=TIMEOUT_SEC)
    try:
        body = json.loads(resp.read().decode("utf-8"))
    finally:
        resp.close()
    if body.get("code") != 200 or not isinstance(body.get("data"), dict):
        raise RuntimeError(body.get("title") or body.get("desc") or "브런치 응답 오류")
    with _cache_lock:
        if len(_cache) > 200:
            _cache.clear()
        _cache[url] = (now, body["data"])
    return body["data"]


def _item(raw):
    user_id = raw.get("userId") or ""
    article_no = raw.get("articleNo")
    return {
        "book_title": raw.get("magazineTitle") or "",
        "author": raw.get("userName") or "",
        "author_image": _https(raw.get("userImage")),
        "author_url": "%s/@@%s" % (WEB_URL, user_id) if user_id else "",
        "title": raw.get("articleTitle") or "",
        "subtitle": raw.get("articleSubTitle") or "",
        "summary": (raw.get("articleContentSummary") or "").strip(),
        "image": _https(raw.get("articleImage")),
        "url": "%s/@@%s/%s" % (WEB_URL, user_id, article_no) if user_id and article_no else "",
        "publish_time": raw.get("publishTime") or 0,
        "like_count": raw.get("likeCount") or 0,
        "donation_amount": raw.get("donationTotalAmount") or 0,
        "donation_count": raw.get("donationCommentCount") or 0,
        "status": raw.get("serialStatus") or "",
        "is_new": bool(raw.get("new")),
    }


def fetch_list(day, sort, next_url=None):
    """day: MONDAY..SUNDAY 또는 COMPLETE(완결). next_url은 직전 응답의 nextUrl."""
    if next_url:
        # 화면이 넘겨준 값이라 아무 주소나 부르지 않도록 브런치 API로만 제한
        if not str(next_url).startswith(API_URL + "?"):
            raise ValueError("잘못된 다음 페이지 주소입니다.")
        url = next_url
    elif day == "COMPLETE":
        url = API_URL + "?" + urlencode({"serialStatus": "COMPLETE"})
    else:
        if day not in DAYS:
            raise ValueError("알 수 없는 요일: %s" % day)
        if sort not in SORTS:
            sort = SORTS[0]
        url = API_URL + "?" + urlencode({"dayOfWeek": day, "orderKeyword": sort,
                                         "serialStatus": "ONGOING"})
    data = _fetch_json(url)
    return {
        "items": [_item(x) for x in (data.get("list") or []) if isinstance(x, dict)],
        "more": bool(data.get("moreList")),
        "next_url": data.get("nextUrl") or "",
    }


class BrunchSerialProvider(BaseMetadataProvider):
    id = "ym_brunch"
    name = "브런치 요일별 연재"
    is_searchable = False
    config_schema = []

    # 좌측 사이드바 카테고리 탭 (index.html/script.js/style.css 풀페이지)
    category_tab = {
        "title": "브런치 연재",
        "icon": "fa-solid fa-mug-hot",
        "order": 86,
        "sessions": "all",
    }

    # BookOasis 플러그인 화면의 업데이트 버튼이 이 저장소 main의 VERSION과 비교한다
    update_manifest = {
        "enabled": True,
        "provider": "github-raw",
        "raw_base_url": "https://raw.githubusercontent.com/yume-script/ym_brunch/main",
        "files": ["ym_brunch.py", "__init__.py", "VERSION", "index.html", "style.css", "script.js"],
        "version_file": "VERSION",
        "version_key": "plugin version",
    }

    # --- 필수 계약: 메타데이터 검색/적용은 하지 않음 ---
    def search(self, db_type, query):
        return {"success": True, "items": []}

    def apply(self, db_type, book_id, item_data):
        return False, "이 플러그인은 메타데이터 검색/적용 기능이 없습니다."

    def get_context_menu_items(self, db_type, context):
        return []

    def run_context_menu_action(self, db_type, action_id, context):
        context = context or {}
        if action_id != "list":
            return {"success": False, "error": "알 수 없는 동작입니다: %s" % action_id}
        try:
            result = fetch_list(context.get("day") or "", context.get("sort") or "",
                                context.get("next_url") or None)
        except Exception as e:  # noqa: BLE001 - 네트워크/브런치 오류는 화면에 그대로 보여준다
            return {"success": False, "error": "브런치 목록을 가져오지 못했습니다: %s" % e}
        return {"success": True, "message": json.dumps(result, ensure_ascii=False)}
