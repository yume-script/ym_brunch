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

글 본문(action 'article'): 브런치 글 페이지는 X-Frame-Options: DENY라 iframe으로 못 띄운다.
그래서 https://brunch.co.kr/@@{userId}/{articleNo} 페이지를 받아
  - <script id="ARTICLE_DATA"> JSON -> 제목/작가/브런치북 정보
  - <div id="ArticleView"> 안 서버 렌더링 HTML -> 허용한 태그만 남겨(_Sanitizer) 본문
  - <ul class="list_magazine"> -> 같은 브런치북의 앞뒤 회차 목록
을 뽑아 화면에 넘긴다.
화면(script.js) -> /api/media/context-menu/book/plugins/action -> run_context_menu_action()
반환은 {'success': bool, 'message'|'error': str} dict여야 하고(튜플이면 코어가 400),
목록은 message에 JSON 문자열로 담아 보냅니다.
"""
import json
import re
import threading
import time
from html import escape, unescape
from html.parser import HTMLParser
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from plugins.metadata.base import BaseMetadataProvider

API_URL = "https://api.brunch.co.kr/v2/serial-brunchbook/all"
WEB_URL = "https://brunch.co.kr"
DAYS = ("MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY")
SORTS = ("PUBLISH_TIME", "DONATION_TOTAL_AMOUNT", "LIKE_COUNT")
USER_AGENT = "Mozilla/5.0 (BookOasis ym_brunch plugin)"
TIMEOUT_SEC = 10
CACHE_SEC = 300  # 같은 목록을 탭 전환마다 다시 받지 않게 5분 보관
ARTICLE_CACHE_SEC = 600

_cache = {}
_cache_lock = threading.Lock()


def _https(url):
    # 브런치 이미지 주소가 http://로 와서 https 페이지에선 혼합 콘텐츠로 막힌다 (CDN은 https도 받음)
    if isinstance(url, str) and url.startswith("http://"):
        return "https://" + url[len("http://"):]
    if isinstance(url, str) and url.startswith("//"):
        return "https:" + url
    return url or ""


def _cached(key, ttl):
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    return None


def _store(key, value):
    with _cache_lock:
        if len(_cache) > 200:
            _cache.clear()
        _cache[key] = (time.time(), value)


def _get(url, accept):
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept, "Referer": WEB_URL + "/"})
    resp = urlopen(req, timeout=TIMEOUT_SEC)
    try:
        return resp.read().decode("utf-8", "replace")
    finally:
        resp.close()


def _fetch_json(url):
    hit = _cached(url, CACHE_SEC)
    if hit is not None:
        return hit
    body = json.loads(_get(url, "application/json"))
    if body.get("code") != 200 or not isinstance(body.get("data"), dict):
        raise RuntimeError(body.get("title") or body.get("desc") or "브런치 응답 오류")
    _store(url, body["data"])
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
        "user_id": user_id,
        "article_no": article_no or 0,
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


# ── 글 본문 ──
_ALLOWED = {"p", "br", "b", "strong", "i", "em", "u", "s", "strike", "del", "sub", "sup",
            "h1", "h2", "h3", "h4", "blockquote", "ul", "ol", "li", "hr", "a", "img", "div",
            "figure", "figcaption", "table", "thead", "tbody", "tr", "td", "th", "small"}
_VOID = {"br", "hr", "img"}
_DROP = {"script", "style", "noscript", "button", "svg", "iframe", "object", "embed", "form",
         "input", "select", "textarea", "video", "audio", "template"}
# 브런치 본문 블록(wrap_item item_type_X ...)에서 화면 모양에 필요한 것만 class로 옮긴다
_KEEP_CLASS = re.compile(r"^(item_type_\w+|blockquote_type\d|hr_type_\d|img_align_\w+)$")


class _Sanitizer(HTMLParser):
    """허용한 태그만 남기고 속성은 href/src/class(브런치 블록 종류)만. 결과는 화면이 innerHTML로 넣는다."""

    def __init__(self):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.out = []
        self.drop_depth = 0
        self.stack = []

    def handle_starttag(self, tag, attrs):
        if self.drop_depth:
            if tag in _DROP:
                self.drop_depth += 1
            return
        if tag in _DROP:
            self.drop_depth = 1
            return
        if tag not in _ALLOWED:
            return
        a = dict(attrs)
        parts = [tag]
        classes = [c for c in (a.get("class") or "").split() if _KEEP_CLASS.match(c)]
        if classes:
            parts.append('class="%s"' % escape(" ".join("bb-" + c for c in classes)))
        if tag == "a":
            href = _https(a.get("href") or "")
            if href.startswith("/"):
                href = WEB_URL + href
            if href.startswith("https://"):
                parts.append('href="%s" target="_blank" rel="noopener noreferrer"' % escape(href))
        elif tag == "img":
            src = _https(a.get("src") or a.get("data-src") or "")
            if not src.startswith("https://"):
                return
            parts.append('src="%s" loading="lazy" referrerpolicy="no-referrer" alt="%s"'
                         % (escape(src), escape(a.get("alt") or "")))
        self.out.append("<%s>" % " ".join(parts))
        if tag not in _VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in _VOID and self.stack and self.stack[-1] == tag:
            self.stack.pop()
            self.out.append("</%s>" % tag)

    def handle_endtag(self, tag):
        if self.drop_depth:
            if tag in _DROP:
                self.drop_depth -= 1
            return
        if tag in _VOID or tag not in self.stack:
            return
        while self.stack:  # 브런치 HTML이 짝이 안 맞아도 열린 태그를 정리하며 닫는다
            t = self.stack.pop()
            self.out.append("</%s>" % t)
            if t == tag:
                break

    def handle_data(self, data):
        if not self.drop_depth:
            self.out.append(escape(data, quote=False))

    def result(self):
        self.close()
        while self.stack:
            self.out.append("</%s>" % self.stack.pop())
        return "".join(self.out)


def sanitize(html_text):
    p = _Sanitizer()
    p.feed(html_text)
    return p.result()


def _between(text, start_marker, end_markers):
    i = text.find(start_marker)
    if i < 0:
        return ""
    i = text.find(">", i) + 1
    ends = [j for j in (text.find(m, i) for m in end_markers) if j >= 0]
    return text[i:min(ends)] if ends else text[i:]


_EP_RE = re.compile(r'<li class="item_magazine">(.*?)</li>', re.S)


def _episodes(page):
    block = _between(page, 'class="list_magazine"', ["</ul>"])
    eps = []
    for li in _EP_RE.findall(block):
        num = re.search(r'class="txt_num">(?:\s*<span[^>]*>.*?</span>)?\s*([^<]*?)\s*<', li, re.S)
        title = re.search(r'class="txt_magazine">([^<]*)<', li)
        link = re.search(r'href="/@@([A-Za-z0-9]+)/(\d+)"', li)
        info = re.search(r'class="info_tobe">\s*([^<]*?)\s*<', li, re.S)
        eps.append({
            "num": num.group(1).strip() if num else "",
            "title": unescape(title.group(1).strip()) if title else "",
            "user_id": link.group(1) if link else "",
            "article_no": int(link.group(2)) if link else 0,
            "current": "magazine_current" in li,
            "upcoming": unescape(info.group(1)) if info else "",
        })
    return eps


_ID_RE = re.compile(r"^[A-Za-z0-9]{1,40}$")


def fetch_article(user_id, article_no):
    user_id = str(user_id or "")
    if not _ID_RE.match(user_id) or not str(article_no or "").isdigit():
        raise ValueError("잘못된 글 주소입니다.")
    url = "%s/@@%s/%s" % (WEB_URL, user_id, int(article_no))
    hit = _cached(url, ARTICLE_CACHE_SEC)
    if hit is not None:
        return hit
    page = _get(url, "text/html")
    m = re.search(r'<script type="application/json" id="ARTICLE_DATA">(.*?)</script>', page, re.S)
    meta = json.loads(m.group(1)) if m else {}
    if not meta:
        raise RuntimeError("글을 찾을 수 없습니다(삭제됐거나 비공개일 수 있음).")
    view = re.search(r'<div id="ArticleView" class="([^"]*)"', page)
    align = ""
    if view:
        for a in ("center", "right", "left"):
            if "text_align_" + a in view.group(1):
                align = a
    body = _between(page, 'id="ArticleView"', ['<div class="info_keyword"', 'class="info_article magazine_article"'])
    book = re.search(r'class="link_magazinetit[^"]*">\s*(?:<span class="tag_state">[^<]*</span>)?\s*([^<]*?)\s*</a>', page)
    result = {
        "title": meta.get("title") or "",
        "subtitle": meta.get("subTitle") or "",
        "author": meta.get("authorName") or "",
        "publish_time": meta.get("publishTime") or 0,
        "like_count": meta.get("likeCount") or 0,
        "comment_count": meta.get("commentCount") or 0,
        "book_title": unescape(book.group(1)) if book else "",
        "book_url": WEB_URL + meta["magazineAddressUri"] if meta.get("magazineAddressUri") else "",
        "cover": _https(meta.get("articleImageUrl")),
        "url": url,
        "align": align,
        # 멤버십(유료) 글은 페이지에 앞부분만 있어서 원문 링크를 같이 안내한다
        "restricted": bool(meta.get("isMembershipContent") or meta.get("isRestrict")),
        "body": sanitize(body),
        "episodes": _episodes(page),
    }
    _store(url, result)
    return result


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
        try:
            if action_id == "list":
                result = fetch_list(context.get("day") or "", context.get("sort") or "",
                                    context.get("next_url") or None)
            elif action_id == "article":
                result = fetch_article(context.get("user_id"), context.get("article_no"))
            else:
                return {"success": False, "error": "알 수 없는 동작입니다: %s" % action_id}
        except Exception as e:  # noqa: BLE001 - 네트워크/브런치 오류는 화면에 그대로 보여준다
            return {"success": False, "error": "브런치에서 가져오지 못했습니다: %s" % e}
        return {"success": True, "message": json.dumps(result, ensure_ascii=False)}
