const UPSTREAM = 'https://avdbapi.com/api.php/provide/vod';
const UPSTREAM_PAGE_SIZE = 100;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CLASS_TTL = 6 * 60 * 60 * 1000;

let classCache = { list: [], at: 0 };

function jsonError(message) {
    return new Response(JSON.stringify({ code: 0, msg: message, list: [], class: [], total: 0, page: 1, pagecount: 1, limit: 24 }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...CACHE },
    });
}

const CACHE = { 'Cache-Control': 'no-store' };

async function upFetch(query, env) {
    const url = UPSTREAM + '?' + query;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': UA, Accept: 'application/json' },
            signal: ctrl.signal,
            cf: { cacheTtl: 60, cacheKey: url },
        });
        if (!res.ok) throw new Error('upstream http ' + res.status);
        const text = await res.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error('upstream 非 JSON: ' + text.slice(0, 60));
        }
    } finally {
        clearTimeout(timer);
    }
}

async function loadClass() {
    if (Date.now() - classCache.at < CLASS_TTL && classCache.list.length) return classCache.list;
    try {
        const j = await upFetch('ac=list&pg=1');
        if (Array.isArray(j.class) && j.class.length) classCache = { list: j.class, at: Date.now() };
    } catch (e) { /* 保留旧缓存或空表 */ }
    return classCache.list;
}

function playPairs(episodes) {
    const out = [];
    const serverData = (episodes && episodes.server_data) || null;
    if (!serverData || typeof serverData !== 'object') return out;
    const pickLink = (v) => (typeof v === 'string' ? v : (v && (v.link_embed || v.link || v.url || v.embed)));
    for (const [serverKey, val] of Object.entries(serverData)) {
        const label = (val && val.server_name) || serverKey;
        const body = (val && val.server_data) || val;
        if (!body || typeof body !== 'object') continue;

        const single = pickLink(body);
        if (typeof single === 'string' && /^https?:\/\//i.test(single)) {
            out.push({ from: String(label).slice(0, 20), url: `正片$${single}` });
            continue;
        }

        const eps = [];
        for (const [epName, epVal] of Object.entries(body)) {
            const direct = pickLink(epVal);
            if (typeof direct === 'string' && /^https?:\/\//i.test(direct)) eps.push(`${epName}$${direct}`);
        }
        if (eps.length) out.push({ from: String(label).slice(0, 20), url: eps.join('#') });
    }
    return out;
}

function typeNameToId(classList) {
    const map = new Map();
    for (const c of classList) map.set(String(c.type_name).toLowerCase(), c.type_id);
    return map;
}

function mapRecord(r, nameToId) {
    const pairs = playPairs(r.episodes);
    const pic = r.thumb_url || r.poster_url || '';
    const nameKey = String(r.type_name || '').toLowerCase();
    return {
        vod_id: r.id,
        vod_name: r.name || r.origin_name || '',
        type: r.type_name || '',
        type_id: nameToId.get(nameKey) || 0,
        type_1: 0,
        vod_pic: pic,
        vod_pic_slide: r.poster_url || pic,
        vod_blurb: String(r.description || '').slice(0, 200),
        vod_content: r.description || '',
        vod_actor: r.actor || '',
        vod_director: r.director || '',
        vod_class: r.category || '',
        vod_lang: r.country || '',
        vod_year: String(r.year || '').slice(0, 4),
        vod_area: r.country || '',
        vod_status: r.status || '',
        vod_duration: r.time || '',
        vod_remarks: r.quality ? `${r.quality}/${r.movie_code || ''}` : (r.movie_code || ''),
        vod_pubdate: r.vod_pubdate || '',
        vod_time: r.vod_time || '',
        vod_play_from: pairs.map(p => p.from).join('$$$'),
        vod_play_url: pairs.map(p => p.url).join('$$$'),
    };
}

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const q = url.searchParams;
    const ac = (q.get('ac') || 'list').toLowerCase();
    const limit = Math.max(1, Math.min(100, parseInt(q.get('limit')) || 24));
    const reqPage = Math.max(1, parseInt(q.get('pg')) || 1);
    const wd = q.get('wd') || '';
    const ids = q.get('ids') || '';
    const tid = q.get('t') || '';

    const classList = await loadClass();
    const nameToId = typeNameToId(classList);

    const build = (data, page, size) => {
        const total = parseInt(data.total) || 0;
        const list = (data.list || []).map(r => mapRecord(r, nameToId));
        return {
            code: 1,
            msg: 'data_ok',
            page,
            pagecount: size ? Math.max(1, Math.ceil(total / size)) : 1,
            limit: size,
            total,
            list,
            class: classList,
        };
    };

    try {
        // 详情 / 按 id 取一条：上游支持 ids=，且返回里已含播放数据
        if (ac === 'detail' || (ac === 'videolist' && ids)) {
            const data = await upFetch(`ac=videolist&ids=${encodeURIComponent(ids)}`);
            return respond(build(data, 1, limit));
        }

        // 搜索：上游 ac=videolist&wd= 可用
        if (wd) {
            const data = await upFetch(`ac=videolist&wd=${encodeURIComponent(wd)}&pg=${reqPage}`);
            return respond(sliceTo(build(data, reqPage, limit), limit));
        }

        // 分类浏览 + 首页列表：把「播放器要的 limit 分页」映射到「上游固定 100 条/页」
        const start = (reqPage - 1) * limit;
        const upPage = Math.floor(start / UPSTREAM_PAGE_SIZE) + 1;
        const offset = start % UPSTREAM_PAGE_SIZE;
        const tpart = tid ? `&t=${encodeURIComponent(tid)}` : '';
        const first = await upFetch(`ac=videolist&pg=${upPage}${tpart}`);

        let records = (first.list || []).slice(offset, offset + limit);
        if (records.length < limit && offset + limit > UPSTREAM_PAGE_SIZE) {
            const second = await upFetch(`ac=videolist&pg=${upPage + 1}${tpart}`);
            records = records.concat((second.list || []).slice(0, limit - records.length));
        }

        const out = build(first, reqPage, limit);
        out.list = records.map(r => mapRecord(r, nameToId));
        return respond(out);
    } catch (e) {
        return jsonError(String(e && e.message || e));
    }
}

function sliceTo(obj, limit) {
    obj.list = (obj.list || []).slice(0, limit);
    return obj;
}

function respond(obj) {
    return new Response(JSON.stringify(obj), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...CACHE },
    });
}
