// XPTV / TVBox 的 csp_* JS 爬虫运行时（浏览器端宿主）
// 源地址写法：api = "spider://<爬虫js的完整URL>"
window.XPTJS = (function () {
    const PROX = (u) => '/api/proxy?url=' + encodeURIComponent(u);
    const codeCache = new Map();
    const playCache = new Map();

    // cheerio/jQuery 专用伪类原生不认识，翻成最近的合法写法；翻不了的靠 catch 兜住
    function normalizeSel(sel) {
        return String(sel)
            .replace(/:eq\((\d+)\)/g, ':nth-child($1)')
            .replace(/:first\b(?!-)/g, ':first-of-type')
            .replace(/:last\b(?!-)/g, ':last-of-type')
            .replace(/:even|:odd/g, '');
    }

    function safeQueryAll(el, sel) {
        sel = normalizeSel(sel);
        const m = sel.match(/:contains\(\s*(['"])((?:[^'"\\]|\\.)*)\1\s*\)/i);
        try {
            if (m) {
                const base = sel.replace(/:contains\(\s*(['"])(?:[^'"]|\\.)*\1\s*\)/gi, '');
                const want = m[2];
                return Array.from(el.querySelectorAll(base || '*')).filter(n => String(n.textContent || '').includes(want));
            }
            return Array.from(el.querySelectorAll(sel));
        } catch (e) {
            try { console.warn('[spider] 选择器不支持:', sel); } catch (e2) { }
            return [];
        }
    }

    function Q(nodes) { this.n = nodes; this.length = nodes.length; }
    Q.prototype = {
        each(fn) { this.n.forEach((el, i) => fn.call(el, i, el)); return this; },
        find(sel) { const out = []; for (const el of this.n) { if (el.querySelectorAll) for (const x of safeQueryAll(el, sel)) out.push(x); } return new Q(out); },
        attr(name) {
            const el = this.n[0];
            if (!el || !el.getAttribute) return undefined;
            if (name === undefined) { const o = {}; for (const a of (el.attributes || [])) o[a.name] = a.value; return o; }
            const v = el.getAttribute(name);
            return v === null ? undefined : v;
        },
        text() { return this.n.map(el => (el.textContent || '')).join(''); },
        html() { const el = this.n[0]; return el ? el.innerHTML : ''; },
        eq(i) { return new Q(this.n[i] ? [this.n[i]] : []); },
        hasClass(c) { const el = this.n[0]; return !!(el && el.classList && el.classList.contains(c)); },
        data(k) { const el = this.n[0]; if (!el || !el.dataset) return undefined; return k === undefined ? el.dataset : el.dataset[k]; },
        first() { return this.eq(0); },
        last() { return this.eq(this.n.length - 1); },
        map(fn) { return this.n.map((el, i) => fn.call(el, i, el)); },
        filter(arg) {
            if (typeof arg === 'function') return new Q(this.n.filter((el, i) => arg.call(el, i, el)));
            const sel = normalizeSel(arg);
            return new Q(this.n.filter(el => { try { return el.matches && el.matches(sel); } catch (e) { return false; } }));
        },
    };

    function loadHtml(html) {
        const doc = new DOMParser().parseFromString(String(html == null ? '' : html), 'text/html');
        const $ = (sel) => {
            if (sel instanceof Q) return sel;
            if (sel && sel.nodeType) return new Q([sel]);
            return new Q(safeQueryAll(doc, sel));
        };
        $.root = doc;
        return $;
    }

    const createCheerio = () => ({ load: loadHtml });

    async function fetchText(url) {
        let host = '?';
        try { host = new URL(url).hostname; } catch (e) { }
        const resp = await fetch(PROX(url), { credentials: 'omit' });
        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            const msg = (body.match(/"msg"\s*:\s*"([^"]{1,60})/) || [])[1] || '';
            throw new Error('取页失败 ' + host + ' → HTTP ' + resp.status + (msg ? '（' + msg + '）' : ''));
        }
        return await resp.text();
    }

    const $fetch = {
        // 爬虫只要 {data}；本站代理不透传自定义头，UA 由 proxy.js 统一伪装
        async get(url) { return { data: await fetchText(url), status: 200 }; },
        async post(url) { return { data: await fetchText(url), status: 200 }; },
    };

    const jsonify = (o) => JSON.stringify(o);
    const argsify = (x) => (typeof x === 'string' ? JSON.parse(x) : x);

    // 爬虫里 $utils.xxx / $print 这些宿主能力：网页侧没有原生浏览器可借，
    // 只能降级成"不崩 + 把意图显示出来"。用 Proxy 兜住任意方法名，避免逐个猜。
    const utilsLog = [];
    const $utils = new Proxy({}, {
        get(_, name) {
            return (...a) => {
                const msg = a.map(x => (typeof x === 'string' ? x : '')).filter(Boolean).join(' ').slice(0, 90);
                utilsLog.push(name + ': ' + msg);
                if (name === 'toastError' || name === 'openSafari') {
                    try { toast('这站要原生浏览器过盾（' + name + '），网页里只能跳过', 'error'); } catch (e) { }
                }
                if (name === 'stringify') return JSON.stringify(a[0]);
                return undefined;
            };
        },
    });
    const $print = (...a) => { try { console.log('[spider]', ...a); } catch (e) { } };

    const enc = (o) => 'k' + btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(String(s).slice(1).replace(/-/g, '+').replace(/_/g, '/')))));

    async function spiderCode(jsUrl) {
        if (codeCache.has(jsUrl)) return codeCache.get(jsUrl);
        const src = await fetchText(jsUrl);
        if (!src || src.length < 200) throw new Error('爬虫脚本是空的');
        const factory = new Function('createCheerio', '$fetch', 'jsonify', 'argsify', 'safeJsonParse', '$utils', '$print', '$config_str', 'createCryptoJS',
            src + '\n;return {getConfig,getCards,getTracks,getPlayinfo,search};');
        // $config_str：XPTV 由 App 注入的源配置串。只给这一个；$config 是脚本自己声明的，注入会撞名。
        const cfgStr = '{}';
        const createCryptoJS = () => { if (typeof CryptoJS === 'undefined') throw new Error('缺 /vendor/crypto-js.min.js'); return CryptoJS; };
        const api = factory(createCheerio, $fetch, jsonify, argsify, (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } }, $utils, $print, cfgStr, createCryptoJS);
        codeCache.set(jsUrl, api);
        return api;
    }

    async function getConfigTabs(jsUrl) {
        const api = await spiderCode(jsUrl);
        const cfg = argsify(await api.getConfig());
        return Array.isArray(cfg.tabs) ? cfg.tabs : [];
    }

    function classOf(tabs) {
        return tabs.map((t, i) => ({ type_id: i + 1, type_name: String(t.name || ('线路' + (i + 1))).slice(0, 20), type_pid: 0 }));
    }

    function toVods(cards, tabs) {
        return (cards || []).map(c => ({
            vod_id: enc(c.ext || {}),
            vod_name: c.vod_name || c.name || '',
            vod_pic: c.vod_pic || c.thumb || '',
            type: c.type_name || '',
            type_id: 0,
            vod_remarks: c.vod_remarks || c.notes || '',
            vod_content: c.vod_blurb || c.blurb || '',
            vod_play_from: '',
            vod_play_url: '',
            _tab: tabs,
        }));
    }

    async function pool(items, size, worker) {
        const out = new Array(items.length);
        let next = 0;
        const runners = Array.from({ length: Math.min(size, items.length || 1) }, async () => {
            while (true) {
                const i = next++;
                if (i >= items.length) break;
                out[i] = await worker(items[i], i);
            }
        });
        await Promise.all(runners);
        return out;
    }

    async function resolveTracks(jsUrl, cardExt) {
        const api = await spiderCode(jsUrl);
        const trackRes = argsify(await api.getTracks(jsonify(cardExt)));
        const groups = (trackRes && trackRes.list) || [];
        const canPlayinfo = typeof api.getPlayinfo === 'function';

        const flat = [];
        groups.forEach((g, gi) => (g.tracks || []).forEach((t, ti) => flat.push({ g: gi, t, ti })));

        const resolved = await pool(flat, 6, async (item) => {
            const t = item.t;
            let play = t.url || t.pan || '';
            let referer = '';
            if (!/^(https?:)?\/\//.test(String(play)) && canPlayinfo) {
                const cacheKey = jsUrl + '|' + JSON.stringify(t.ext || cardExt);
                if (playCache.has(cacheKey)) {
                    ({ play, referer } = playCache.get(cacheKey));
                } else {
                    try {
                        const info = argsify(await api.getPlayinfo(jsonify(t.ext || cardExt)));
                        const u = info && info.urls && info.urls[0];
                        play = typeof u === 'string' ? u : '';
                        // 爬虫会回 headers 指明取流要带的 Referer/UA；XPTV App 会应用它，
                        // 这里也照做：交给 /api/play 代取并转成同源地址，顺带绕开 CDN 的 CORS。
                        const h = Array.isArray(info && info.headers) ? (info.headers[0] || {}) : ((info && info.headers) || {});
                        referer = String(h.Referer || h.referer || '');
                        if (!/^https?:\/\//i.test(referer)) referer = '';
                    } catch (e) { play = ''; }
                    playCache.set(cacheKey, { play, referer });
                }
            }
            if (play && referer && /\.(m3u8|mp4|ts|flv|mkv)([?#]|$)/i.test(String(play))) {
                play = '/api/play?url=' + encodeURIComponent(play) + '&referer=' + encodeURIComponent(referer);
            }
            return { gi: item.g, name: String(t.name || '第' + (item.ti + 1) + '集').slice(0, 24), play };
        });

        const out = [];
        for (const r of resolved) {
            if (!r.play) continue;
            out[r.gi] = out[r.gi] || { from: String(groups[r.gi].title || '默认').slice(0, 16), urls: [] };
            out[r.gi].urls.push(r.name + '$' + r.play);
        }
        return out.filter(Boolean).map(g => ({ from: g.from, url: g.urls.join('#') }));
    }

    function envelope(classList, list, page, pagecount, total) {
        return { code: 1, msg: 'data_ok', page: page || 1, pagecount: pagecount || 1, limit: 24, total: total || 0, list, class: classList };
    }

    async function handle(rawUrl) {
        const cut = rawUrl.indexOf('?ac=');
        const jsUrl = cut < 0 ? rawUrl.slice('spider://'.length) : rawUrl.slice('spider://'.length, cut);
        const q = new URLSearchParams(cut < 0 ? '' : rawUrl.slice(cut + 1));
        const ac = (q.get('ac') || 'list').toLowerCase();
        const pg = parseInt(q.get('pg')) || 1;
        const wd = q.get('wd') || '';
        const ids = q.get('ids') || '';
        const tid = parseInt(q.get('t')) || 0;

        const tabs = await getConfigTabs(jsUrl);
        const cls = classOf(tabs);

        if (ids && (ac === 'detail' || ac === 'videolist')) {
            const cardExt = dec(ids);
            const groups = await resolveTracks(jsUrl, cardExt);
            const one = toVods([{ ...cardExt, vod_name: cardExt.vod_name || cardExt.name || '', ext: cardExt }], tabs)[0];
            one.vod_play_from = groups.map(g => g.from).join('$$$');
            one.vod_play_url = groups.map(g => g.url).join('$$$');
            return envelope(cls, [one], 1, 1, 1);
        }

        const api = await spiderCode(jsUrl);
        let cards = [];
        if (wd) {
            const r = argsify(await api.search(jsonify({ text: wd, page: pg })));
            cards = (r && r.list) || [];
        } else {
            const tab = tid > 0 ? (tabs[tid - 1] || tabs[0] || { ext: {} }) : (tabs[0] || { ext: {} });
            const r = argsify(await api.getCards(jsonify({ ...(tab.ext || {}), page: pg })));
            cards = (r && r.list) || [];
        }
        return envelope(cls, toVods(cards, tabs), pg, 30, cards.length * 30);
    }

    return { handle, enc, dec, Q, createCheerio };
})();
