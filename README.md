# ym_brunch

브런치(brunch.co.kr)의 **브런치북 오리지널 연재를 요일별로** 보여주는 BookOasis 플러그인입니다.

- 좌측 사이드바에 **"브런치 연재"** 탭이 생깁니다.
- 월~일 요일 탭 + **완결** 탭, 정렬 **최신순 / 응원순 / 라이킷순** (브런치 홈과 같음)
- 카드: 표지, 브런치북 제목, 최신 회차 제목, 요약, 작가, 발행 시각, 라이킷·응원 금액
- 카드를 누르면 **북오아시스 안에서 바로 읽습니다** (본문·사진·인용·구분선, 같은 브런치북의 앞뒤 회차 이동).
  Ctrl/가운데 클릭은 브런치 원문을 새 탭으로 엽니다. 목록은 20개씩 **더 보기**.
- 처음 열면 오늘 요일 탭이 선택됩니다.
- 읽기 화면의 **듣기** 버튼으로 글을 소리 내어 읽어 줍니다 (TTS). 읽는 문단을 강조하고 따라 내려가며,
  일시정지/이어 듣기, 속도(0.8~2.0x), 목소리 선택(브라우저 음성 + Edge 음성 14개), 문단을 눌러 그 자리부터 듣기,
  **다음 화 이어 듣기**를 지원합니다. 설정은 브라우저에 기억됩니다.

## 설치

### 1. 플러그인 넣기

1. 이 저장소를 받거나(`git clone https://github.com/yume-script/ym_brunch.git`) 압축을 풀어, `ym_brunch` 폴더를 BookOasis의 `plugins/metadata/` 아래에 넣습니다.
   ```
   plugins/metadata/ym_brunch/
     __init__.py  ym_brunch.py  VERSION  index.html  script.js  style.css  requirements.txt  README.md
   ```
   도커라면 예: `docker cp ym_brunch bookoasis:/app/plugins/metadata/`
2. BookOasis를 재시작합니다 (`docker restart bookoasis`).
3. 플러그인 목록에서 "브런치 요일별 연재"를 켭니다.

여기까지만 해도 연재 목록, 글 읽기, 브라우저 음성 듣기는 모두 동작합니다. 설정 항목은 없습니다.

### 2. Edge 음성 설치 (목소리 14개 추가, 선택)

'듣기'의 목소리 목록에 **Edge 음성 (서버)** 14개(선히·인준·현수 + 다국어 11개)를 추가하려면
BookOasis 컨테이너에 `edge-tts` 패키지를 설치해야 합니다. 컨테이너 이름이 `bookoasis`가 아니면 바꿔서 입력하세요.

1. 패키지 설치
   ```
   docker exec bookoasis pip install edge-tts
   ```
   `pip`를 찾지 못하면 `docker exec bookoasis python3 -m pip install edge-tts`로 설치합니다.
2. 설치 확인 (버전 숫자가 나오면 성공)
   ```
   docker exec bookoasis python3 -c "import edge_tts; print(edge_tts.__version__)"
   ```
3. BookOasis 재시작 (플러그인이 시작할 때 `edge-tts`를 찾기 때문에 꼭 재시작해야 합니다)
   ```
   docker restart bookoasis
   ```
4. 브런치 연재 탭에서 아무 글이나 열고, 목소리 목록에 **Edge 음성 (서버)** 묶음이 보이는지 확인합니다.
   목록에 "서버에 edge-tts가 없습니다"라는 안내가 보이면 1~3단계가 안 된 것입니다.

**컨테이너를 새로 만들면 설치가 사라집니다.** `docker restart`는 괜찮지만, 이미지 업데이트나
`docker compose up --force-recreate`, `docker rm` 후 다시 만들면 1~3단계를 다시 해야 합니다.
매번 하기 번거로우면 BookOasis 이미지를 바탕으로 `edge-tts`를 넣은 이미지를 만들어 쓰면 됩니다.

```dockerfile
# Dockerfile (BookOasis 이미지 이름은 docker-compose.yml의 image: 값으로)
FROM <BookOasis 이미지>
RUN pip install --no-cache-dir edge-tts
```

```yaml
# docker-compose.yml 의 bookoasis 서비스에서 image: 대신
    build: .
```

**필요한 것과 주의할 점**
- BookOasis 서버에서 `speech.platform.bing.com`(HTTPS)으로 나가는 인터넷 연결이 필요합니다.
- 마이크로소프트 Edge의 "소리 내어 읽기"가 쓰는 무료 서버를 부르는 방식이라 키·요금은 없지만 **공식 API가 아닙니다**.
  막히면 Edge 음성만 안 되고, 브라우저 음성은 그대로 쓸 수 있습니다.
- 설치를 되돌리려면 `docker exec bookoasis pip uninstall -y edge-tts` 후 재시작합니다.

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

## 소리 내어 읽기(TTS)

목소리는 두 종류에서 고릅니다.

| 종류 | 목소리 | 필요한 것 |
|---|---|---|
| 브라우저 음성 | 기기에 깔린 한국어 음성 (보통 1~2개: 크롬 Google 한국어, 윈도우 Heami, 엣지 SunHi, iOS Yuna 등) | 없음 |
| Edge 음성 (서버) | 선히·인준·현수(한국어) + Ava·Emma·Andrew·Brian·William·Seraphina·Florian·Vivienne·Remy·Giuseppe·Thalita(다국어, 한국어도 읽음) 14개 | BookOasis 컨테이너에 `edge-tts` |

Edge 음성 설치 방법은 위 [설치 → 2. Edge 음성 설치](#2-edge-음성-설치-목소리-14개-추가-선택)를 보세요.
설치가 안 돼 있으면 목록에 설치 안내만 보이고, 브라우저 음성은 그대로 쓸 수 있습니다.

- Edge 음성은 마이크로소프트 Edge의 "소리 내어 읽기"가 쓰는 무료 서버를 `edge-tts`로 부릅니다. 키·요금은
  없지만 **공식 API가 아니라서** 마이크로소프트가 막으면 안 될 수 있습니다. BookOasis 서버에서
  `speech.platform.bing.com`으로 나가는 인터넷이 필요합니다.
- 서버가 문장마다 mp3(약 20~30KB, 처음 1~2초)를 만들어 넘기고, 화면은 지금 문장을 읽는 동안 다음 두 문장을
  미리 받아 둡니다. 만든 음성은 서버 메모리에 최대 30MB 보관합니다.
- 다국어 목소리는 영어권 등의 억양이 섞일 수 있습니다.
- 크롬 브라우저 음성은 긴 문장을 한 번에 넘기면 15초쯤에서 끊어서, 문장 단위(최대 약 180자)로 나눠 읽습니다.
- 일시정지 후 이어 들으면 Edge 음성은 멈춘 자리부터, 브라우저 음성은 그 문장 처음부터 읽습니다.
- 목록으로 돌아가거나 다른 글을 열거나 플러그인 탭을 벗어나면 멈춥니다.
- 휴대폰은 화면이 꺼지면 브라우저가 읽기를 멈출 수 있습니다.

## 업데이트

`update_manifest`가 이 저장소(`main`)를 가리키므로, BookOasis 플러그인 화면의 업데이트 버튼으로
새 버전을 받을 수 있습니다. 새 버전을 올릴 땐 `VERSION`의 `plugin version`을 올려 주세요.
