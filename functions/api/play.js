// functions/api/play.js - 流媒体播放代理（带缓存优化）
// 职责：代理 m3u8 请求，重写内部 .ts 分片与加密 KEY 地址，短期缓存加速秒开；非 m3u8 内容流式透传
//
// seg=direct：分片直连模式。清单仍由本函数取回并重写（可注入请求头、把相对路径补成绝对地址），
// 但分片/子清单的地址原样留给浏览器直连 CDN，省掉每个分片绕 Worker 的一跳。
// 只有确认该 CDN 允许跨域（ACAO 为 * 或回显本站 Origin）时才用，否则自动退回全代理。

const CACHE_MAX_AGE = 10; // 缓存10秒，平衡新鲜度和速度
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 同一 isolate 内按「分片主机 + 站点 Origin」缓存探测结果，避免每个清单都去探一次
const CORSA_CACHE = new Map();
const CORSA_TTL = 5 * 60 * 1000;

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');
    const wantDirectSeg = url.searchParams.get('seg') === 'direct';

    // 1. 验证参数
    if (!targetUrl) {
        return new Response('缺少 url 参数', { status: 400 });
    }

    // 2. 验证 URL 格式
    let parsed;
    try {
        parsed = new URL(targetUrl);
    } catch (e) {
        return new Response('无效的 URL 格式', { status: 400 });
    }

    // 客户端的请求范围（拖动进度条时浏览器只想要那一小段）。
    // 清单要整体重写地址，带 Range 请求清单会让重写结果与字节区间不符，故只给分片/媒体透传。
    const rangeHeader = request.headers.get('Range');
    const looksLikePlaylist = targetUrl.includes('.m3u8') || targetUrl.includes('.m3u');
    const forwardRange = rangeHeader && !looksLikePlaylist;

    // ============================================================
    // 3. 尝试从缓存获取（带 Range 的请求不走缓存，避免部分响应污染缓存）
    // ============================================================
    // 直连模式与全代理模式的重写结果不同，必须分开缓存，否则两种模式会互相串味
    const cacheKeyUrl = targetUrl + (targetUrl.includes('?') ? '&' : '?') +
        '__seg=' + (wantDirectSeg ? 'direct' : 'proxy');
    const cacheKey = new Request(cacheKeyUrl, { method: 'GET' });
    const cache = caches.default;
    let response = rangeHeader ? undefined : await cache.match(cacheKey);

    if (response) {
        // 缓存命中，直接返回（保留原响应的全部响应头，只补命中与 CORS 标记）
        console.log('✅ 缓存命中:', targetUrl);
        const hitHeaders = new Headers(response.headers);
        hitHeaders.set('X-Cache', 'HIT');
        hitHeaders.set('Access-Control-Allow-Origin', '*');
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: hitHeaders,
        });
    }

    // ============================================================
    // 4. 缓存未命中，发起代理请求
    // ============================================================
    console.log('🔄 缓存未命中，代理请求:', targetUrl);

    try {
        const proxyRequest = new Request(targetUrl, {
            method: request.method,
            headers: {
                // 模拟浏览器请求头，绕过防盗链
                'User-Agent': UA,
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': parsed.origin + '/',
                'Origin': parsed.origin,
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                // 透传请求区间：源站据此返回 206，拖动进度条不必重下整片
                ...(forwardRange ? { Range: rangeHeader } : {}),
            },
            // 跟随重定向
            redirect: 'follow',
        });

        response = await fetch(proxyRequest);

        // 5. 检查响应状态
        if (!response.ok) {
            return new Response(`源站返回错误: ${response.status} ${response.statusText}`, {
                status: response.status,
            });
        }

        const contentType = response.headers.get('content-type') || '';
        const isM3u8 = contentType.includes('mpegurl') ||
                       contentType.includes('vnd.apple.mpegurl') ||
                       targetUrl.includes('.m3u8') ||
                       targetUrl.includes('.m3u8?');

        // ============================================================
        // 6a. m3u8：读取文本、重写内部地址（分片 + 加密 KEY）、写入缓存
        // ============================================================
        if (isM3u8) {
            let content = await response.text();
            let segMode = 'proxy';

            if (content.trim().startsWith('#EXTM3U')) {
                if (wantDirectSeg) {
                    segMode = await detectSegMode(content, targetUrl, url.origin);
                }
                content = rewriteM3u8(content, targetUrl, segMode);
            }

            const headers = new Headers(response.headers);
            headers.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE}`);
            headers.set('X-Cache', 'MISS');
            headers.set('X-Seg-Mode', segMode);
            headers.set('Access-Control-Allow-Origin', '*');
            headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
            headers.set('Access-Control-Expose-Headers', 'X-Seg-Mode, X-Cache');
            headers.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');

            const cachedResponse = new Response(content, {
                status: response.status,
                headers: headers,
            });

            // 使用 context.waitUntil 异步缓存，不阻塞响应
            context.waitUntil(cache.put(cacheKey, cachedResponse.clone()));

            return cachedResponse;
        }

        // ============================================================
        // 6b. 非 m3u8（TS/MP4/KEY 等）：流式透传，不读入内存
        // ============================================================
        const passHeaders = new Headers(response.headers);
        passHeaders.set('Access-Control-Allow-Origin', '*');
        passHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        passHeaders.delete('Content-Security-Policy');
        passHeaders.delete('X-Content-Type-Options');

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: passHeaders,
        });

    } catch (error) {
        // 7. 错误处理
        console.error('代理请求失败:', error.message);
        return new Response(`代理请求失败: ${error.message}`, { status: 500 });
    }
}

// ============================================================
// 判定分片能不能让浏览器直连
// 取清单里第一个媒体分片，带本站 Origin 去要前 1 字节，看 CDN 回不回跨域头。
// 拿不到分片地址（纯 master 清单）就返回 direct，交给子清单自己再判一次。
// ============================================================
async function detectSegMode(content, baseUrl, playerOrigin) {
    let sample = null;
    try {
        sample = await pickProbeUrl(content, baseUrl);
    } catch (e) {
        sample = null;
    }
    if (!sample) return 'direct';

    let host;
    try {
        host = new URL(sample).host;
    } catch (e) {
        return 'proxy';
    }

    const key = host + '|' + playerOrigin;
    const hit = CORSA_CACHE.get(key);
    if (hit && Date.now() - hit.ts < CORSA_TTL) return hit.mode;

    let mode = 'proxy';
    try {
        const probe = await fetch(new Request(sample, {
            method: 'GET',
            headers: {
                'User-Agent': UA,
                'Accept': '*/*',
                'Origin': playerOrigin,
                'Referer': new URL(sample).origin + '/',
                'Range': 'bytes=0-0',
            },
            redirect: 'follow',
        }));
        const acao = probe.headers.get('access-control-allow-origin') || '';
        const statusOk = probe.status === 200 || probe.status === 206;
        if (statusOk && (acao === '*' || acao === playerOrigin)) mode = 'direct';
        // 只要头，别把整片下下来：直接取消响应流
        try { if (probe.body) await probe.body.cancel(); } catch (e) {}
    } catch (e) {
        mode = 'proxy';
    }

    CORSA_CACHE.set(key, { mode, ts: Date.now() });
    return mode;
}

// 找一个真正是媒体分片的地址；如果第一条是子清单，就进去看它自己的第一条分片
async function pickProbeUrl(content, baseUrl) {
    const lines = content.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    if (!lines.length) return null;

    let candidate = resolveUrl(lines[0], baseUrl);
    if (!candidate) return null;

    if (/\.m3u8?(\?|$)/i.test(candidate)) {
        const r = await fetch(new Request(candidate, {
            headers: {
                'User-Agent': UA,
                'Accept': '*/*',
                'Referer': baseUrl,
            },
            redirect: 'follow',
        }));
        if (!r.ok) return null;
        const text = await r.text();
        const seg = text.split('\n').map(s => s.trim()).find(s => s && !s.startsWith('#'));
        return seg ? resolveUrl(seg, candidate) : null;
    }
    return candidate;
}

// ============================================================
// 重写 m3u8 内部地址
// mode=proxy ：分片与 KEY 全部走本函数代理（老行为）
// mode=direct：分片留绝对地址给浏览器直连；子清单与 KEY 仍走代理（子清单要带上 seg=direct 继续判）
// ============================================================
function rewriteM3u8(content, baseUrl, mode) {
    const lines = content.split('\n');
    const rewritten = [];
    const direct = mode === 'direct';

    for (let line of lines) {
        const trimmed = line.trim();

        // 空行直接保留
        if (!trimmed) {
            rewritten.push(line);
            continue;
        }

        // ===== 处理 #EXT-X-KEY 加密标签（URI 内地址重写为代理） =====
        if (trimmed.startsWith('#EXT-X-KEY')) {
            rewritten.push(line.replace(/URI="([^"]+)"/g, (match, uri) => {
                const absoluteUri = resolveUrl(uri, baseUrl);
                if (!absoluteUri) return match;
                return 'URI="/api/play?url=' + encodeURIComponent(absoluteUri) + '"';
            }));
            continue;
        }

        // ===== fMP4 的初始化片段：和分片同源同权限，直连模式下也直连 =====
        if (trimmed.startsWith('#EXT-X-MAP')) {
            rewritten.push(line.replace(/URI="([^"]+)"/g, (match, uri) => {
                const absoluteUri = resolveUrl(uri, baseUrl);
                if (!absoluteUri) return match;
                if (direct) return 'URI="' + absoluteUri + '"';
                return 'URI="/api/play?url=' + encodeURIComponent(absoluteUri) + '"';
            }));
            continue;
        }

        // 保留其他 #EXT 标签
        if (trimmed.startsWith('#')) {
            rewritten.push(line);
            continue;
        }

        const absoluteUrl = /^https?:\/\//i.test(trimmed)
            ? trimmed
            : resolveUrl(trimmed, baseUrl);

        if (!absoluteUrl) {
            // 拼接失败，保持原样
            rewritten.push(line);
            continue;
        }

        // 子清单必须继续过本函数，才能把 seg=direct 传到下一层
        if (/\.m3u8?(\?|$)/i.test(absoluteUrl)) {
            rewritten.push('/api/play?url=' + encodeURIComponent(absoluteUrl) +
                (direct ? '&seg=direct' : ''));
            continue;
        }

        rewritten.push(direct ? absoluteUrl : '/api/play?url=' + encodeURIComponent(absoluteUrl));
    }

    return rewritten.join('\n');
}

function resolveUrl(path, baseUrl) {
    try {
        return new URL(path, baseUrl).href;
    } catch (e) {
        return null;
    }
}
