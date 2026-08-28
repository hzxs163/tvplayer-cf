// functions/api/play.js - 流媒体播放代理（完整版）

const CACHE_MAX_AGE = 10;

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
        return new Response('缺少 url 参数', { status: 400 });
    }

    try {
        new URL(targetUrl);
    } catch (e) {
        return new Response('无效的 URL 格式', { status: 400 });
    }

    // 尝试从缓存获取
    const cacheKey = new Request(targetUrl, { method: 'GET' });
    const cache = caches.default;
    let response = await cache.match(cacheKey);

    if (response) {
        return new Response(response.body, {
            status: response.status,
            headers: {
                ...response.headers,
                'X-Cache': 'HIT',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
            },
        });
    }

    try {
        const proxyRequest = new Request(targetUrl, {
            method: request.method,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': targetUrl,
                'Origin': new URL(targetUrl).origin,
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
            },
            redirect: 'follow',
        });

        response = await fetch(proxyRequest);

        if (!response.ok) {
            return new Response(`源站返回错误: ${response.status}`, { status: response.status });
        }

        const contentType = response.headers.get('content-type') || '';
        let content = await response.text();

        // ============================================================
        // 关键：重写 m3u8 内部地址，让 .ts 分片也走代理
        // ============================================================
        if (contentType.includes('mpegurl') || contentType.includes('vnd.apple.mpegurl') || content.trim().startsWith('#EXTM3U')) {
            content = rewriteM3u8(content, targetUrl);
        }

        // 存入缓存
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE}`);
        headers.set('X-Cache', 'MISS');
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');

        const cachedResponse = new Response(content, {
            status: response.status,
            headers: headers,
        });

        context.waitUntil(cache.put(cacheKey, cachedResponse.clone()));

        return cachedResponse;

    } catch (error) {
        console.error('代理请求失败:', error.message);
        return new Response(`代理请求失败: ${error.message}`, { status: 500 });
    }
}

// ============================================================
// 重写 m3u8 内部地址 - 所有 .ts 分片都走代理
// ============================================================
function rewriteM3u8(content, baseUrl) {
    const lines = content.split('\n');
    const rewritten = [];

    for (let line of lines) {
        const trimmed = line.trim();

        // 保留注释和空行
        if (!trimmed || trimmed.startsWith('#')) {
            rewritten.push(line);
            continue;
        }

        // ============================================================
        // 核心：将任何非注释行（.ts 分片地址）重写为代理地址
        // ============================================================

        // 如果已经是完整 URL
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            rewritten.push('/api/play?url=' + encodeURIComponent(trimmed));
            continue;
        }

        // 处理相对路径（包括以 / 开头的路径）
        try {
            const absoluteUrl = new URL(trimmed, baseUrl).href;
            rewritten.push('/api/play?url=' + encodeURIComponent(absoluteUrl));
        } catch (e) {
            // 拼接失败，保持原样
            rewritten.push(line);
        }
    }

    return rewritten.join('\n');
}
