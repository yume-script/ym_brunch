// plugins/metadata/ym_brunch/script.js
//
// 코어가 new Function('pluginId', 'container', js)(pluginId, container)로 실행한다.
// 목록은 서버(ym_brunch.py run_context_menu_action 'list')가 brunch API를 대신 받아
// message에 JSON 문자열로 돌려준다. 바디는 type/plugin_id/action_id/context만 읽힌다.
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
        return '<a class="bs-card" target="_blank" rel="noopener noreferrer" href="' + esc(url || 'https://brunch.co.kr') + '">' +
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
