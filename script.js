// plugins/metadata/ym_brunch/script.js
//
// 코어가 new Function('pluginId', 'container', js)(pluginId, container)로 실행한다.
// 목록은 서버(ym_brunch.py run_context_menu_action 'list')가 brunch API를 대신 받아
// message에 JSON 문자열로 돌려준다. 바디는 type/plugin_id/action_id/context만 읽힌다.
// 카드를 누르면 'article'로 본문을 받아 같은 탭 안의 읽기 화면에 띄운다(브런치는 iframe 금지).
// 본문 HTML은 서버에서 허용 태그만 남긴 것이라 그대로 innerHTML로 넣는다.
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
        } catch (e) {
            if (!alive() || seq !== reader.seq) return;
            $('#bs-reader-status').className = 'bs-status bs-error';
            $('#bs-reader-status').textContent = e.message || String(e);
            $('#bs-origin').href = 'https://brunch.co.kr/@@' + encodeURIComponent(uid) + '/' + encodeURIComponent(no);
        }
    }

    function closeReader() {
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
