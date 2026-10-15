// ============================================================
//  TVBox / TXT 源兼容层
//  原则：不改源数据，只做识别、分流和标注
//  纯函数、不碰 DOM，供 script.js 调用（window.TVB）
// ============================================================
(function (global) {
    'use strict';

    const ADULT_WORDS = ['杏吧', '大奶', '嫩模', '伦理', '理论', '黑料', '国产传媒', '无码', '有码',
        '三级', '成人', '里番', '麻豆', '抖阴', '性情', '陪睡', '鲍鱼', '粉樱', '草民', 'porn', 'av丝',
        '嫩', '技师', '上门服务', '情趣', 'saog'];
    const ADULT_HOSTS = ['ckzy', 'jkun', 'xingba', 'xingbazy', 'danaizi', 'manyou', 'cab6', 'heiapi', 'nsf'];

    const HTTP_API = /^https?:\/\//i;

    const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

    const isAdult = (name, api) => {
        const t = `${clean(name)} ${String(api || '').toLowerCase()}`;
        if (ADULT_HOSTS.some((h) => t.includes(h))) return true;
        return ADULT_WORDS.some((w) => t.toLowerCase().includes(w.toLowerCase()));
    };

    // 去掉尾部的 ?ac=list / /at/xml 等，播放器自己会拼参数
    const cleanApi = (api) => clean(api).replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\/at\/(xml|json)\/?$/i, '');

    const shortHash = (s) => {
        let h = 0;
        const str = String(s || '');
        for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
        return (h >>> 0).toString(36).slice(0, 5);
    };

    const slugKey = (name, api) => {
        const base = clean(name).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 18);
        if (/[a-z0-9\u4e00-\u9fa5]/.test(base)) return base;
        let host = 'x';
        try { host = new URL(api).hostname.replace(/\W+/g, '_').slice(0, 18); } catch (e) { /* 保留默认 */ }
        return host;
    };

    // ---------- 格式识别 ----------

    function isTvboxConfig(o) {
        if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
        return Array.isArray(o.sites) || Array.isArray(o.lives) || Array.isArray(o.parses)
            || Array.isArray(o.urls) || Array.isArray(o.storeHouse);
    }

    function isMultiRepo(o) {
        return !!o && typeof o === 'object' && !Array.isArray(o) && (Array.isArray(o.urls) || Array.isArray(o.storeHouse));
    }

    function looksLikeSourceList(text) {
        const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));
        if (lines.length < 1) return false;
        const hits = lines.filter((l) => /^(\S+\s+)?https?:\/\/\S+$/i.test(l) || /^\S+\s+https?:\/\//i.test(l));
        return hits.length >= Math.max(1, Math.floor(lines.length * 0.4));
    }

    // 输入任意文本，判成 'json' | 'txt' | 'loose' | 'unknown' | 'empty'
    // 具体是 macCMS 数组还是 TVBox 配置，交给解析后的结构判断
    function detectFormat(text) {
        const raw = String(text || '').trim();
        if (!raw) return 'empty';
        if (raw[0] === '{' || raw[0] === '[') {
            try { JSON.parse(raw); return 'json'; } catch (e) { return 'loose'; }
        }
        return looksLikeSourceList(raw) ? 'txt' : 'unknown';
    }

    // 宽松解析：剥掉 // 和 /* */ 注释、尾逗号，单引号不处理（源里没有）
    function looseJsonParse(text) {
        const noComments = String(text).replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const trimmed = noComments.replace(/,(\s*[}\]])/g, '$1').trim();
        const start = trimmed.search(/[{[]/);
        if (start < 0) return null;
        try { return JSON.parse(trimmed.slice(start)); } catch (e) { return null; }
    }

    // ---------- TXT 清单解析 ----------

    function parseTxt(text) {
        const out = [];
        for (const line of String(text || '').split(/\r?\n/)) {
            const t = line.trim();
            if (!t || t.startsWith('#') || t.startsWith('//') || t.startsWith(';')) continue;
            const m = /^(.*?)[ \t]+(https?:\/\/\S+)$/i.exec(t);
            if (m) {
                const name = clean(m[1]);
                if (name && /名称|示例|说明|source|format|^#/.test(name) && !/[a-z0-9\u4e00-\u9fa5]{2,}/i.test(name.replace(/普通资源|资源/g, ''))) continue;
                out.push({ name, url: cleanApi(m[2]) });
                continue;
            }
            const u = /^(https?:\/\/\S+)$/i.exec(t);
            if (u) out.push({ name: hostnameOf(u[1]), url: cleanApi(u[1]) });
        }
        return out;
    }

    const hostnameOf = (u) => { try { return new URL(u).hostname; } catch (e) { return 'source'; } };

    // ---------- 核心：把任意输入转成播放器源（保留原始信息，不改源） ----------

    function toEntries(item, ctx) {
        const rawApi = clean(item.api != null ? item.api : (item.url || item.baseUrl));
        const api = cleanApi(rawApi);
        const name = (clean(item.name || item.title) || (HTTP_API.test(rawApi) ? hostnameOf(rawApi) : rawApi) || '未命名').slice(0, 28);
        const type = Number(item.type != null ? item.type : 0);
        const adult = isAdult(name, rawApi);
        const isHttp = HTTP_API.test(rawApi);
        const boxOnly = !isHttp || type === 3 || type === 4;
        if (!isHttp && boxOnly && !/^[A-Za-z_]/.test(rawApi)) return null;

        let note = '';
        if (boxOnly) note = 'TVBox 爬虫站点（需安卓 jar / JS 运行环境），浏览器里播不了，已默认隐藏';
        else if (adult) note = '成人/伦理内容，默认隐藏';
        else if (type === 2) note = 'XML 接口，本播放器按 JSON 采集协议取数，可能取不到，已默认隐藏';

        // 复用项目原有语义：disabled=true 进「失效」组、不参与聚合搜索；enabled=false 默认隐藏
        const entry = {
            key: `${slugKey(name, rawApi)}_${shortHash(rawApi)}_${ctx.seq()}`,
            name,
            api: isHttp ? api : rawApi,
            type: 0,
            searchable: item.searchable != null ? item.searchable : 1,
            filterable: item.filterable != null ? item.filterable : 1,
            playerType: item.playerType != null ? item.playerType : 1,
            enabled: !(boxOnly || adult || type === 2),
            disabled: boxOnly || !isHttp,
            group: boxOnly ? 'boxonly' : (adult ? 'adult' : (ctx.from || 'imported')),
            from: ctx.from || 'imported',
            origin: ctx.label || '',
            originUrl: ctx.url || '',
            tvboxType: type,
            note: note || undefined,
        };
        if (item.ext != null) entry.hasExt = true;
        if (item.playerConfig != null) entry.hasPlayerConfig = true;
        return entry;
    }

    // cfg: TVBox 配置对象；返回 { entries, meta }
    function fromTvboxConfig(cfg, opts = {}) {
        const ctx = {
            label: opts.label || cfg.sites?.[0]?.name || 'TVBox 配置',
            url: opts.url || '',
            from: 'tvbox',
            _n: 0,
            seq() { return ++this._n; },
        };
        const entries = [];
        const skipped = [];
        if (isMultiRepo(cfg)) {
            const subs = (cfg.urls || cfg.storeHouse || []).map((s) => ({ name: clean(s.name), url: clean(s.url) })).filter((s) => s.url);
            return {
                entries: [], multiRepo: subs,
                meta: { kind: 'multiRepo', subs: subs.length },
            };
        }
        for (const site of Array.isArray(cfg.sites) ? cfg.sites : []) {
            if (!site || typeof site !== 'object') continue;
            const e = toEntries({ ...site, api: site.api }, ctx);
            if (!e) { skipped.push({ name: clean(site.name), reason: '没有 http 接口地址' }); continue; }
            entries.push(e);
        }
        const lives = Array.isArray(cfg.lives) ? cfg.lives.length : (typeof cfg.lives === 'string' ? 1 : 0);
        return {
            entries,
            skipped,
            meta: {
                kind: 'tvbox',
                sites: (cfg.sites || []).length,
                playable: entries.filter((e) => e.enabled).length,
                boxOnly: entries.filter((e) => e.group === 'boxonly').length,
                adult: entries.filter((e) => e.group === 'adult').length,
                xml: entries.filter((e) => e.tvboxType === 2).length,
                lives,
                parses: Array.isArray(cfg.parses) ? cfg.parses.length : 0,
                flags: Array.isArray(cfg.flags) ? cfg.flags.length : 0,
                rules: Array.isArray(cfg.rules) ? cfg.rules.length : 0,
                spider: typeof cfg.spider === 'string' ? cfg.spider.slice(0, 120) : undefined,
                note: lives ? `配置含 ${lives} 组直播源（m3u），本播放器只做点播，未导入` : undefined,
            },
        };
    }

    // 任意文本 → { format, entries, meta, error }
    function ingest(text, opts = {}) {
        const raw = String(text || '');
        const format = detectFormat(raw);
        if (format === 'empty') return { format, entries: [], error: '内容是空的' };

        if (format === 'txt') {
            const list = parseTxt(raw);
            const ctx = { label: opts.label || 'TXT 清单', url: opts.url || '', from: opts.from || 'txt', _n: 0, seq() { return ++this._n; } };
            const entries = list.map((it) => toEntries({ name: it.name, api: it.url }, ctx)).filter(Boolean);
            return { format: 'txt', entries, meta: { kind: 'txt', lines: list.length, playable: entries.filter((e) => e.enabled).length, adult: entries.filter((e) => e.group === 'adult').length } };
        }

        let obj = null;
        if (format === 'json' || format === 'loose' || format === 'tvbox') {
            try { obj = JSON.parse(raw); } catch (e) { obj = looseJsonParse(raw); }
        }
        if (obj == null) return { format, entries: [], error: '解析失败：既不是 JSON/TVBox 配置，也不是「名称 地址」清单' };

        if (isTvboxConfig(obj)) {
            const r = fromTvboxConfig(obj, { label: opts.label, url: opts.url });
            if (r.multiRepo) {
                const ctx = { label: opts.label || 'TVBox 多仓', url: opts.url || '', from: 'subs', _n: 0, seq() { return ++this._n; } };
                const entries = r.multiRepo.map((s) => ({
                    key: `sub_${shortHash(s.url)}_${ctx.seq()}`,
                    name: (s.name || hostnameOf(s.url)).slice(0, 28),
                    api: s.url,
                    type: 0, searchable: 0, filterable: 0, playerType: 1,
                    enabled: false, disabled: false, group: 'subs', from: 'subs',
                    origin: ctx.label, originUrl: opts.url || '',
                    note: '这是多仓里的子接口地址，不是采集接口，需要单独粘贴它的内容再导入',
                }));
                return { format: 'tvbox-multi', entries, meta: { kind: 'multiRepo', subs: entries.length } };
            }
            return { format: 'tvbox', entries: r.entries, skipped: r.skipped, meta: r.meta };
        }

        const arr = Array.isArray(obj) ? obj : [obj];
        const ctx = { label: opts.label || 'JSON 源', url: opts.url || '', from: opts.from || 'imported', _n: 0, seq() { return ++this._n; } };
        const entries = arr.map((it) => toEntries(it, ctx)).filter(Boolean);
        return { format: 'json', entries, meta: { kind: 'json', count: arr.length } };
    }

    global.TVB = {
        isTvboxConfig, isMultiRepo, detectFormat, parseTxt, looseJsonParse, fromTvboxConfig, ingest,
        isAdult, cleanApi, ADULT_WORDS, ADULT_HOSTS,
    };
})(typeof window !== 'undefined' ? window : globalThis);
