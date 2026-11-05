// plugins/metadata/ym_brunch/script.js
//
// 코어가 new Function('pluginId', 'container', js)(pluginId, container)로 실행한다.
// 목록은 서버(ym_brunch.py run_context_menu_action 'list')가 brunch API를 대신 받아
// message에 JSON 문자열로 돌려준다. 바디는 type/plugin_id/action_id/context만 읽힌다.
// 카드를 누르면 'article'로 본문을 받아 같은 탭 안의 읽기 화면에 띄운다(브런치는 iframe 금지).
// 본문 HTML은 서버에서 허용 태그만 남긴 것이라 그대로 innerHTML로 넣는다.
// 읽기 화면의 "듣기"는 브라우저 음성(speechSynthesis) 또는 서버가 만든 Edge 음성(mp3)으로 본문을 읽어 준다.
(function () {
    var ACTION_URL = '/api/media/context-menu/book/plugins/action';
    var DAY_KEYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    var STORAGE_KEY = 'ym_brunch_view';

    var root = (typeof container !== 'undefined' && container) ? container : document;
    var pid = (typeof pluginId !== 'undefined' && pluginId) ? pluginId : 'ym_brunch';
    var dbType = (root.dataset && root.dataset.dbType) || window.currentDbType || 'general';

    // 탭 재진입으로 스크립트가 두 번 돌면 가장 최근 실행만 동작하게 한다
    var host = root.querySelector ? (root.querySelector('#bs-root') || root) : document.body;
    var inst = {};
    host.__bsInst = inst;
    function alive() { return host.__bsInst === inst; }

    function $(sel) { return root.querySelector(sel); }
    function $all(sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (e) { saved = {}; }

    var state = {
        day: DAY_KEYS[new Date().getDay()],
        sort: saved.sort || 'PUBLISH_TIME',
        nextUrl: '',
        loading: false,
        seq: 0
    };

    function remember() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ sort: state.sort })); } catch (e) { /* 저장 못 해도 동작엔 지장 없음 */ }
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function safeUrl(u) {
        return /^https:\/\//.test(u || '') ? u : '';
    }

    function fmtDate(ms) {
        if (!ms) return '';
        var d = new Date(ms);
        var diff = (Date.now() - ms) / 1000;
        if (diff < 3600) return Math.max(1, Math.floor(diff / 60)) + '분 전';
        if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
        return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
    }

    function fmtNum(n) { return Number(n || 0).toLocaleString('ko-KR'); }

    async function callAction(actionId, ctx) {
        var resp = await fetch(ACTION_URL, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: dbType, plugin_id: pid, action_id: actionId, context: ctx || {} })
        });
        var text = await resp.text();
        var data;
        try { data = JSON.parse(text); } catch (e) { throw new Error('서버 응답을 읽지 못했습니다 (HTTP ' + resp.status + ')'); }
        // 코어는 success=false면 HTTP 400을 내리므로 resp.ok가 아니라 data.success로 판단
        if (!data.success) throw new Error(data.error || data.message || ('HTTP ' + resp.status));
        return JSON.parse(data.message || '{}');
    }

    function setStatus(msg, isError) {
        var el = $('#bs-status');
        el.textContent = msg || '';
        el.className = 'bs-status' + (isError ? ' bs-error' : '');
    }

    function card(it) {
        var url = safeUrl(it.url);
        var img = safeUrl(it.image);
        var badges = (it.is_new ? '<span class="bs-badge bs-new">NEW</span>' : '') +
            (it.status === 'COMPLETE' ? '<span class="bs-badge">완결</span>' : '');
        return '<a class="bs-card" target="_blank" rel="noopener noreferrer" href="' + esc(url || 'https://brunch.co.kr') + '"' +
            ' data-uid="' + esc(it.user_id) + '" data-no="' + esc(it.article_no) + '">' +
            '<div class="bs-cover">' +
            (img ? '<img loading="lazy" referrerpolicy="no-referrer" src="' + esc(img) + '" alt="">' : '<div class="bs-cover-empty"><i class="fa-solid fa-book"></i></div>') +
            badges + '</div>' +
            '<div class="bs-body">' +
            '<div class="bs-book">' + esc(it.book_title) + '</div>' +
            '<div class="bs-ep">' + esc(it.title) + (it.subtitle ? ' <span class="bs-sub">' + esc(it.subtitle) + '</span>' : '') + '</div>' +
            '<p class="bs-summary">' + esc(it.summary) + '</p>' +
            '<div class="bs-meta">' +
            '<span class="bs-author">by ' + esc(it.author) + '</span>' +
            '<span>' + esc(fmtDate(it.publish_time)) + '</span>' +
            '</div>' +
            '<div class="bs-meta bs-counts">' +
            '<span title="라이킷"><i class="fa-regular fa-heart"></i> ' + fmtNum(it.like_count) + '</span>' +
            '<span title="응원 금액"><i class="fa-solid fa-hand-holding-heart"></i> ' + fmtNum(it.donation_amount) + '원</span>' +
            '</div>' +
            '</div></a>';
    }

    function renderTabs() {
        $all('.bs-tab').forEach(function (b) {
            var on = b.getAttribute('data-day') === state.day;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        $all('.bs-sort').forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-sort') === state.sort);
        });
        // 완결 목록은 브런치도 정렬을 받지 않는다
        $('#bs-sorts').style.visibility = state.day === 'COMPLETE' ? 'hidden' : 'visible';
    }

    async function load(append) {
        if (state.loading && append) return;
        var seq = ++state.seq;
        state.loading = true;
        var grid = $('#bs-grid');
        var more = $('#bs-more');
        if (!append) { grid.innerHTML = ''; state.nextUrl = ''; }
        more.style.display = 'none';
        setStatus('불러오는 중...');
        try {
            var res = await callAction('list', {
                day: state.day,
                sort: state.sort,
                next_url: append ? state.nextUrl : ''
            });
            if (!alive() || seq !== state.seq) return;  // 그 사이 다른 탭을 눌렀으면 버린다
            var items = res.items || [];
            grid.insertAdjacentHTML('beforeend', items.map(card).join(''));
            state.nextUrl = res.more ? (res.next_url || '') : '';
            more.style.display = state.nextUrl ? '' : 'none';
            setStatus(grid.children.length ? '' : '이 요일에 올라온 연재가 없습니다.');
        } catch (e) {
            if (!alive() || seq !== state.seq) return;
            setStatus(e.message || String(e), true);
        } finally {
            if (seq === state.seq) state.loading = false;
        }
    }

    // ---- 읽기 화면 ----
    var reader = { seq: 0, prev: null, next: null, listScroll: 0 };

    function scrollBox() {
        // BookOasis 본문 영역이 스크롤되는 경우와 창 전체가 스크롤되는 경우 둘 다 처리
        var el = host.parentElement;
        while (el && el !== document.body) {
            var oy = getComputedStyle(el).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
            el = el.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    }

    function showReader(on) {
        $('#bs-list-view').style.display = on ? 'none' : '';
        $('#bs-reader').style.display = on ? '' : 'none';
    }

    function epButton(ep) {
        if (!ep || !ep.user_id) return null;
        return { uid: ep.user_id, no: ep.article_no, title: ep.title, num: ep.num };
    }

    function renderArticle(a) {
        var eps = a.episodes || [];
        var cur = -1;
        for (var i = 0; i < eps.length; i++) { if (eps[i].current) cur = i; }
        reader.prev = cur > 0 ? epButton(eps[cur - 1]) : null;
        reader.next = cur >= 0 && cur < eps.length - 1 ? epButton(eps[cur + 1]) : null;

        var bookUrl = safeUrl(a.book_url);
        var html = '<header class="bs-art-head">' +
            (a.book_title ? '<a class="bs-art-book"' + (bookUrl ? ' href="' + esc(bookUrl) + '" target="_blank" rel="noopener noreferrer"' : '') + '>' + esc(a.book_title) + '</a>' : '') +
            '<h1 class="bs-art-title">' + esc(a.title) + '</h1>' +
            (a.subtitle ? '<p class="bs-art-sub">' + esc(a.subtitle) + '</p>' : '') +
            '<div class="bs-art-meta">by ' + esc(a.author) + ' · ' + esc(fmtDate(a.publish_time)) +
            ' · <i class="fa-regular fa-heart"></i> ' + fmtNum(a.like_count) +
            ' · <i class="fa-regular fa-comment"></i> ' + fmtNum(a.comment_count) + '</div>' +
            '</header>' +
            (a.restricted ? '<div class="bs-art-notice">멤버십(유료) 글이라 앞부분만 보입니다. 전체는 <a href="' + esc(safeUrl(a.url)) + '" target="_blank" rel="noopener noreferrer">브런치 원문</a>에서 읽을 수 있습니다.</div>' : '') +
            '<div class="bs-art-body bs-align-' + esc(a.align || 'left') + '">' + (a.body || '') + '</div>';

        if (eps.length) {
            html += '<section class="bs-eps"><h3 class="bs-eps-title">이 브런치북의 글</h3><ol class="bs-eps-list">';
            eps.forEach(function (ep) {
                var label = '<span class="bs-ep-num">' + esc(ep.num) + '</span><span class="bs-ep-title">' + esc(ep.title) + '</span>' +
                    (ep.upcoming ? '<span class="bs-ep-upcoming">' + esc(ep.upcoming) + '</span>' : '');
                if (ep.user_id && !ep.current) {
                    html += '<li><button type="button" class="bs-epi" data-uid="' + esc(ep.user_id) + '" data-no="' + esc(ep.article_no) + '">' + label + '</button></li>';
                } else {
                    html += '<li><div class="bs-epi' + (ep.current ? ' current' : ' disabled') + '">' + label + '</div></li>';
                }
            });
            html += '</ol></section>';
        }
        html += '<nav class="bs-art-nav">' +
            '<button type="button" class="bs-btn" id="bs-prev"' + (reader.prev ? '' : ' disabled') + '><i class="fa-solid fa-chevron-left"></i> ' +
            (reader.prev ? esc(reader.prev.num + '화 ' + reader.prev.title) : '이전 화 없음') + '</button>' +
            '<button type="button" class="bs-btn" id="bs-next"' + (reader.next ? '' : ' disabled') + '>' +
            (reader.next ? esc(reader.next.num + '화 ' + reader.next.title) : '다음 화 없음') + ' <i class="fa-solid fa-chevron-right"></i></button>' +
            '</nav>';

        $('#bs-article').innerHTML = html;
        $('#bs-origin').href = safeUrl(a.url) || 'https://brunch.co.kr';
        $('#bs-prev-top').disabled = !reader.prev;
        $('#bs-next-top').disabled = !reader.next;
    }

    async function openArticle(uid, no, fromList) {
        if (!uid || !no) return;
        var autoStart = tts.autoStart;  // 다음 화 이어 듣기로 열린 경우
        tts.autoStart = false;
        ttsStop();
        var seq = ++reader.seq;
        var box = scrollBox();
        if (fromList) reader.listScroll = box.scrollTop;
        showReader(true);
        $('#bs-article').innerHTML = '';
        $('#bs-reader-status').className = 'bs-status';
        $('#bs-reader-status').textContent = '글을 불러오는 중...';
        host.scrollIntoView({ block: 'start' });
        try {
            var a = await callAction('article', { user_id: uid, article_no: no });
            if (!alive() || seq !== reader.seq) return;
            $('#bs-reader-status').textContent = '';
            renderArticle(a);
            if (autoStart) ttsPlay(0);
        } catch (e) {
            if (!alive() || seq !== reader.seq) return;
            $('#bs-reader-status').className = 'bs-status bs-error';
            $('#bs-reader-status').textContent = e.message || String(e);
            $('#bs-origin').href = 'https://brunch.co.kr/@@' + encodeURIComponent(uid) + '/' + encodeURIComponent(no);
        }
    }

    // ---- 소리 내어 읽기 ----
    // 목소리는 두 종류다.
    //  - 브라우저 음성(b:이름): 기기에 깔린 speechSynthesis. 기기마다 1~2개뿐.
    //  - 서버 음성(e:ID): 서버(ym_brunch.py 'tts')가 Edge 무료 음성으로 만든 mp3를 받아 <audio>로 재생.
    //    한 문장에 1~2초 걸려서 지금 문장을 읽는 동안 다음 두 문장을 미리 받아 둔다.
    // 문단을 문장 단위 조각(최대 ~180자)으로 나눠 하나씩 읽는다(크롬 speechSynthesis는 긴 문장을 15초쯤에서 끊음).
    // 브라우저 음성의 일시정지는 pause()가 기기마다 불안정해서 cancel 후 그 조각부터 다시 읽는다.
    var TTS_KEY = 'ym_brunch_tts';
    var synth = window.speechSynthesis || null;
    var hasSynth = !!(synth && typeof SpeechSynthesisUtterance !== 'undefined');
    var tts = {
        chunks: [], idx: 0, playing: false, gen: 0, utter: null, autoStart: false, cur: null, ttsCfg: {},
        audio: null, fetches: {}, resumeIdx: -1, resumeTime: 0, serverVoices: [], serverNote: ''
    };
    try { tts.ttsCfg = JSON.parse(localStorage.getItem(TTS_KEY) || '{}') || {}; } catch (e) { tts.ttsCfg = {}; }
    // 0.3.x는 브라우저 음성 이름을 그대로 저장했다
    if (tts.ttsCfg.voice && !/^[be]:/.test(tts.ttsCfg.voice)) tts.ttsCfg.voice = 'b:' + tts.ttsCfg.voice;

    function ttsSave() {
        try { localStorage.setItem(TTS_KEY, JSON.stringify(tts.ttsCfg)); } catch (e) { /* 저장 못 해도 동작엔 지장 없음 */ }
    }

    function splitText(text) {
        var out = [];
        // 문장 끝 부호 뒤에서 자른다 (lookbehind는 옛 사파리에서 스크립트 전체가 깨져서 쓰지 않음)
        var sentences = (text.replace(/\s+/g, ' ').trim().match(/[^.!?。…~”"’]+[.!?。…~”"’]*/g) || [])
            .map(function (x) { return x.trim(); }).filter(Boolean);
        var buf = '';
        sentences.forEach(function (s) {
            while (s.length > 180) {  // 마침표 없이 긴 문장은 띄어쓰기에서 자른다
                var cut = s.lastIndexOf(' ', 180);
                if (cut < 60) cut = 180;
                if (buf) { out.push(buf); buf = ''; }
                out.push(s.slice(0, cut));
                s = s.slice(cut).trim();
            }
            if (buf && (buf + ' ' + s).length > 180) { out.push(buf); buf = ''; }
            buf = buf ? buf + ' ' + s : s;
        });
        if (buf) out.push(buf);
        return out.filter(function (t) { return /[\p{L}\p{N}]/u.test(t); });
    }

    function buildChunks() {
        var chunks = [];
        var head = $('.bs-art-head');
        if (head) {
            var t = $('.bs-art-title'), sub = $('.bs-art-sub');
            var intro = (t ? t.textContent : '') + (sub ? '. ' + sub.textContent : '');
            splitText(intro).forEach(function (s) { chunks.push({ el: head, text: s }); });
        }
        var body = $('.bs-art-body');
        if (body) {
            // 본문 맨 위 블록 하나(문단·제목·인용·사진 설명 등)가 강조 단위
            Array.prototype.forEach.call(body.children, function (el) {
                splitText(el.innerText || el.textContent || '').forEach(function (s) { chunks.push({ el: el, text: s }); });
            });
        }
        return chunks;
    }

    function koVoices() {
        var all = hasSynth ? synth.getVoices() : [];
        var ko = all.filter(function (v) { return /^ko/i.test(v.lang); });
        return ko.length ? ko : all;
    }

    // 목소리 이름은 브라우저마다 제각각이다: 크롬 "Google 한국의", 엣지 "Microsoft SunHi Online (Natural) - Korean (Korea)",
    // 윈도우 "Microsoft Heami - Korean (Korean)", 애플 "Yuna". 회사 이름은 남기고 뒤의 언어 꼬리만 뗀다.
    function voiceLabel(v) {
        var n = String(v.name || '').trim();
        if (/^Google 한국의$/.test(n)) n = 'Google 한국어';
        n = n.replace(/\s*[-–]\s*(Korean|한국어).*$/i, '').replace(/\s+Online \(Natural\)/i, ' (자연스러운 음성)');
        if (!/^ko/i.test(v.lang || '')) n += ' (' + v.lang + ')';
        if (v.localService === false) n += ' · 온라인';
        return n || v.lang || '기본 음성';
    }

    function fillVoices() {
        var sel = $('#bs-tts-voice');
        var html = '';
        var browser = koVoices();
        if (browser.length) {
            html += '<optgroup label="브라우저 음성">' + browser.map(function (v) {
                return '<option value="b:' + esc(v.name) + '" title="' + esc(v.name) + '">' + esc(voiceLabel(v)) + '</option>';
            }).join('') + '</optgroup>';
        }
        if (tts.serverVoices.length) {
            html += '<optgroup label="Edge 음성 (서버)">' + tts.serverVoices.map(function (v) {
                return '<option value="e:' + esc(v.id) + '" title="' + esc(v.id) + '">' + esc(v.name) + '</option>';
            }).join('') + '</optgroup>';
        } else if (tts.serverNote) {
            html += '<optgroup label="Edge 음성 (서버)"><option disabled>' + esc(tts.serverNote) + '</option></optgroup>';
        }
        sel.innerHTML = html;
        var values = Array.prototype.map.call(sel.options, function (o) { return o.disabled ? null : o.value; }).filter(Boolean);
        if (tts.ttsCfg.voice && values.indexOf(tts.ttsCfg.voice) >= 0) sel.value = tts.ttsCfg.voice;
        else if (values.length) sel.value = values[0];
        sel.style.display = values.length > 1 || tts.serverNote ? '' : 'none';
        $('#bs-tts-play').disabled = !values.length;
    }

    function voiceValue() { return $('#bs-tts-voice').value || ''; }
    function isServerVoice() { return voiceValue().indexOf('e:') === 0; }
    function rateValue() { return parseFloat($('#bs-tts-rate').value) || 1; }

    function pickVoice() {
        var name = voiceValue().replace(/^b:/, '');
        var voices = koVoices();
        for (var i = 0; i < voices.length; i++) { if (voices[i].name === name) return voices[i]; }
        return voices[0] || null;
    }

    function ttsMark(el) {
        if (tts.cur === el) return;
        if (tts.cur) tts.cur.classList.remove('bs-tts-on');
        tts.cur = el;
        if (!el) return;
        el.classList.add('bs-tts-on');
        var r = el.getBoundingClientRect();
        // 화면 밖으로 나간 문단만 가운데로 (읽는 중 사용자가 스크롤해도 매번 끌어오지 않게)
        if (r.top < 80 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function ttsUi(note) {
        var play = $('#bs-tts-play');
        if (!play) return;
        var paused = !tts.playing && tts.chunks.length && tts.idx > 0;
        play.querySelector('span').textContent = tts.playing ? '일시정지' : (paused ? '이어 듣기' : '듣기');
        var icon = play.querySelector('i');
        if (icon) icon.className = tts.playing ? 'fa-solid fa-pause' : 'fa-solid fa-volume-high';
        play.classList.toggle('active', tts.playing);
        $('#bs-tts-stop').disabled = !tts.playing && !paused;
        var pos = $('#bs-tts-pos');
        pos.classList.toggle('bs-error', !!note);
        pos.textContent = note || (tts.chunks.length && (tts.playing || tts.idx > 0)
            ? Math.min(tts.idx + 1, tts.chunks.length) + ' / ' + tts.chunks.length : '');
    }

    // 서버 음성 한 조각을 data: URL로 받는다 (같은 글·목소리 안에서는 한 번만)
    function fetchAudio(i) {
        var c = tts.chunks[i];
        if (!c) return null;
        var key = voiceValue() + '|' + i;
        if (!tts.fetches[key]) {
            tts.fetches[key] = callAction('tts', { voice: voiceValue().slice(2), text: c.text }).then(function (r) {
                return 'data:' + (r.mime || 'audio/mpeg') + ';base64,' + r.audio;
            });
            tts.fetches[key].catch(function () { delete tts.fetches[key]; });  // 실패한 건 다음에 다시 받게
        }
        return tts.fetches[key];
    }

    function finishChunk(gen) {
        if (gen !== tts.gen || !tts.playing) return;  // 멈췄거나 다른 조각으로 넘어간 뒤의 옛 이벤트
        tts.idx++;
        speakNext();
    }

    function speakServer(c, gen) {
        var idx = tts.idx;
        fetchAudio(idx + 1); fetchAudio(idx + 2);  // 미리 받기
        fetchAudio(idx).then(function (url) {
            if (gen !== tts.gen || !tts.playing) return;
            var a = tts.audio;
            a.onended = function () { finishChunk(gen); };
            a.onerror = null;
            a.src = url;
            a.playbackRate = rateValue();
            if (tts.resumeIdx === idx && tts.resumeTime) { try { a.currentTime = tts.resumeTime; } catch (e) { /* 처음부터 */ } }
            tts.resumeIdx = -1; tts.resumeTime = 0;
            var p = a.play();
            if (p && p.catch) p.catch(function (e) {
                if (gen !== tts.gen) return;
                tts.playing = false;
                ttsUi(e && e.name === 'NotAllowedError' ? '브라우저가 자동 재생을 막았습니다. 듣기를 다시 눌러 주세요.' : '재생하지 못했습니다.');
            });
        }, function (e) {
            if (gen !== tts.gen) return;
            tts.playing = false;
            ttsUi(e.message || String(e));
        });
    }

    function speakBrowser(c, gen) {
        var u = new SpeechSynthesisUtterance(c.text);
        u.lang = 'ko-KR';
        var v = pickVoice();
        if (v) { u.voice = v; u.lang = v.lang; }
        u.rate = rateValue();
        u.onend = function () { finishChunk(gen); };
        u.onerror = function (e) {
            if (e.error === 'interrupted' || e.error === 'canceled') return;
            finishChunk(gen);  // 한 조각이 실패해도 다음으로
        };
        tts.utter = u;  // 참조를 안 잡아 두면 크롬이 onend 전에 수거하는 일이 있다
        synth.speak(u);
    }

    function speakNext() {
        // 다른 글로 넘어갔거나 플러그인 탭을 벗어났으면(컨테이너가 DOM에서 빠짐) 멈춘다
        if (!alive() || !host.isConnected) { ttsStop(); return; }
        if (tts.idx >= tts.chunks.length) {
            var auto = tts.ttsCfg.autoNext && reader.next;
            ttsStop();
            if (auto) {
                tts.autoStart = true;
                openArticle(reader.next.uid, reader.next.no);
            }
            return;
        }
        var c = tts.chunks[tts.idx];
        ttsMark(c.el);
        ttsUi();
        if (isServerVoice()) speakServer(c, tts.gen); else speakBrowser(c, tts.gen);
    }

    function silence() {
        if (hasSynth) synth.cancel();
        if (tts.audio) { tts.audio.onended = null; tts.audio.pause(); }
    }

    function ttsPlay(fromIdx) {
        if (!tts.chunks.length || fromIdx === 0) { tts.chunks = buildChunks(); tts.fetches = {}; }
        if (!tts.chunks.length) { ttsUi('읽을 글이 없습니다'); return; }
        if (typeof fromIdx === 'number') { tts.idx = fromIdx; tts.resumeIdx = -1; }
        if (tts.idx >= tts.chunks.length) tts.idx = 0;
        tts.gen++;
        silence();
        tts.playing = true;
        speakNext();
    }

    function ttsPause() {
        // 서버 음성은 멈춘 자리부터, 브라우저 음성은 그 문장 처음부터 이어 듣는다
        if (isServerVoice() && tts.audio && tts.audio.src) { tts.resumeIdx = tts.idx; tts.resumeTime = tts.audio.currentTime; }
        tts.gen++;
        tts.playing = false;
        silence();
        ttsUi();
    }

    function ttsStop() {
        tts.gen++;
        tts.playing = false;
        tts.chunks = [];
        tts.idx = 0;
        tts.fetches = {};
        tts.resumeIdx = -1;
        silence();
        ttsMark(null);
        ttsUi();
    }

    function initTts() {
        tts.audio = new Audio();
        tts.audio.preload = 'auto';
        var rate = $('#bs-tts-rate');
        rate.value = String(tts.ttsCfg.rate || '1');
        if (!rate.value) rate.value = '1';
        $('#bs-tts-next').checked = !!tts.ttsCfg.autoNext;
        fillVoices();
        if (hasSynth && synth.addEventListener) synth.addEventListener('voiceschanged', function () { if (alive()) fillVoices(); });
        callAction('tts_voices', {}).then(function (r) {
            if (!alive()) return;
            tts.serverVoices = r.voices || [];
            tts.serverNote = r.available ? '' : (r.reason || '');
            fillVoices();
        }, function () { /* 서버 음성 없이 브라우저 음성만 */ });

        $('#bs-tts-play').addEventListener('click', function () {
            if (tts.playing) ttsPause(); else ttsPlay();
        });
        $('#bs-tts-stop').addEventListener('click', ttsStop);
        rate.addEventListener('change', function () {
            tts.ttsCfg.rate = rate.value; ttsSave();
            if (!tts.playing) return;
            if (isServerVoice()) tts.audio.playbackRate = rateValue();  // 재생 중인 소리에 바로 적용
            else ttsPlay(tts.idx);  // 브라우저 음성은 읽던 조각부터 새 속도로
        });
        $('#bs-tts-voice').addEventListener('change', function () {
            tts.ttsCfg.voice = voiceValue(); ttsSave();
            tts.fetches = {};
            tts.resumeIdx = -1;  // 다른 목소리는 길이가 달라서 멈춘 시각을 이어 쓸 수 없다
            if (tts.playing) ttsPlay(tts.idx);
        });
        $('#bs-tts-next').addEventListener('change', function () {
            tts.ttsCfg.autoNext = $('#bs-tts-next').checked; ttsSave();
        });
        // 듣는 중(또는 일시정지 중)에 문단을 누르면 거기서부터 읽는다. 링크/버튼은 원래 동작대로.
        $('#bs-article').addEventListener('click', function (ev) {
            if (!tts.chunks.length || (ev.target.closest && ev.target.closest('a, button'))) return;
            var body = $('.bs-art-body');
            var el = ev.target;
            while (el && el.parentElement !== body) el = el.parentElement;
            if (!el) return;
            for (var i = 0; i < tts.chunks.length; i++) {
                if (tts.chunks[i].el === el) { ttsPlay(i); return; }
            }
        });
        ttsUi();
    }

    function closeReader() {
        ttsStop();
        reader.seq++;
        showReader(false);
        var box = scrollBox();
        box.scrollTop = reader.listScroll;
    }

    $('#bs-grid').addEventListener('click', function (ev) {
        var a = ev.target.closest ? ev.target.closest('.bs-card') : null;
        // 가운데 클릭/Ctrl+클릭은 원래대로 브런치 새 탭
        if (!a || ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
        if (!a.getAttribute('data-uid')) return;
        ev.preventDefault();
        openArticle(a.getAttribute('data-uid'), a.getAttribute('data-no'), true);
    });
    $('#bs-article').addEventListener('click', function (ev) {
        var t = ev.target.closest ? ev.target.closest('.bs-epi[data-uid], #bs-prev, #bs-next') : null;
        if (!t) return;
        if (t.id === 'bs-prev' && reader.prev) openArticle(reader.prev.uid, reader.prev.no);
        else if (t.id === 'bs-next' && reader.next) openArticle(reader.next.uid, reader.next.no);
        else if (t.getAttribute('data-uid')) openArticle(t.getAttribute('data-uid'), t.getAttribute('data-no'));
    });
    $('#bs-prev-top').addEventListener('click', function () { if (reader.prev) openArticle(reader.prev.uid, reader.prev.no); });
    $('#bs-next-top').addEventListener('click', function () { if (reader.next) openArticle(reader.next.uid, reader.next.no); });
    $('#bs-back').addEventListener('click', closeReader);
    initTts();

    $all('.bs-tab').forEach(function (b) {
        b.addEventListener('click', function () {
            state.day = b.getAttribute('data-day');
            renderTabs();
            load(false);
        });
    });
    $all('.bs-sort').forEach(function (b) {
        b.addEventListener('click', function () {
            state.sort = b.getAttribute('data-sort');
            remember();
            renderTabs();
            load(false);
        });
    });
    $('#bs-more').addEventListener('click', function () { load(true); });
    $('#bs-refresh').addEventListener('click', function () { load(false); });

    renderTabs();
    load(false);
})();
