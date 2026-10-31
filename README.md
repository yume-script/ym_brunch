# ym_brunch

브런치(brunch.co.kr)의 **브런치북 오리지널 연재를 요일별로** 보여주는 BookOasis 플러그인입니다.

- 좌측 사이드바에 **"브런치 연재"** 탭이 생깁니다.
- 월~일 요일 탭 + **완결** 탭, 정렬 **최신순 / 응원순 / 라이킷순** (브런치 홈과 같음)
- 카드: 표지, 브런치북 제목, 최신 회차 제목, 요약, 작가, 발행 시각, 라이킷·응원 금액
- 카드를 누르면 **북오아시스 안에서 바로 읽습니다** (본문·사진·인용·구분선, 같은 브런치북의 앞뒤 회차 이동).
  Ctrl/가운데 클릭은 브런치 원문을 새 탭으로 엽니다. 목록은 20개씩 **더 보기**.
- 처음 열면 오늘 요일 탭이 선택됩니다.

## 설치

1. 이 저장소를 받거나(`git clone https://github.com/yume-script/ym_brunch.git`) 압축을 풀어, `ym_brunch` 폴더를 BookOasis의 `plugins/metadata/` 아래에 넣습니다.
   ```
   plugins/metadata/ym_brunch/
     __init__.py  ym_brunch.py  VERSION  index.html  script.js  style.css  README.md
   ```
   도커라면 예: `docker cp ym_brunch bookoasis:/app/plugins/metadata/`
2. BookOasis를 재시작합니다 (`docker restart bookoasis`).
3. 플러그인 목록에서 "브런치 요일별 연재"를 켭니다.

설정 항목은 없습니다. 추가 패키지도 필요 없습니다(표준 라이브러리만 사용).

## 동작 방식

브라우저에서 브런치 API를 바로 부르면 CORS에 막히므로 서버 쪽 `ym_brunch.py`가 대신 받습니다.

```
script.js ──POST /api/media/context-menu/book/plugins/action──▶ run_context_menu_action('list')
          {type, plugin_id, action_id:"list", context:{day, sort, next_url}}
ym_brunch.py ──GET──▶ https://api.brunch.co.kr/v2/serial-brunchbook/all
          ?dayOfWeek=MONDAY&orderKeyword=PUBLISH_TIME&serialStatus=ONGOING
          (완결: ?serialStatus=COMPLETE)

script.js ──POST (같은 경로)──▶ run_context_menu_action('article')  context:{user_id, article_no}
ym_brunch.py ──GET──▶ https://brunch.co.kr/@@{user_id}/{article_no}
          ARTICLE_DATA JSON(제목/작가) + #ArticleView 본문 + list_magazine(앞뒤 회차)
```

- 브런치 글 페이지는 `X-Frame-Options: DENY`라 iframe으로 띄울 수 없어서, 서버가 페이지를 받아
  본문만 뽑습니다. 본문은 허용한 태그(p, b, img, blockquote, hr, a …)와 href/src만 남기고
  스크립트·스타일·이벤트 속성은 모두 버립니다(`_Sanitizer`). 글은 10분 보관합니다.
- 멤버십(유료) 글은 브런치 페이지에 앞부분만 있어서, 앞부분과 함께 원문 링크를 안내합니다.

- `orderKeyword`: `PUBLISH_TIME`(최신순) / `DONATION_TOTAL_AMOUNT`(응원순) / `LIKE_COUNT`(라이킷순)
- 응답의 `nextUrl`로 다음 20개를 받습니다. 서버는 `api.brunch.co.kr` 주소만 따라갑니다.
- 같은 목록은 서버 메모리에 5분 보관합니다(`CACHE_SEC`).
- 브런치가 주는 `http://` 이미지 주소는 `https://`로 바꿔서 혼합 콘텐츠 차단을 피합니다.

브런치의 비공식(화면용) API라 브런치가 바뀌면 깨질 수 있습니다. 그때는 `ym_brunch.py`의
`API_URL`/`_item()`만 고치면 됩니다.

## 업데이트

`update_manifest`가 이 저장소(`main`)를 가리키므로, BookOasis 플러그인 화면의 업데이트 버튼으로
새 버전을 받을 수 있습니다. 새 버전을 올릴 땐 `VERSION`의 `plugin version`을 올려 주세요.
