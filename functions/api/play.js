// functions/api/play.js - 流媒体播放代理（完整版）
// 增加防盗链绕过、缓存优化、地址重写

const CACHE_MAX_AGE = 10;

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    // 1. 验证参数
    if (!targetUrl) {
        return new Response('缺少 url 参数', { status: 400 });
    }

    try {
        new URL(targetUrl);
    } catch (e) {
        return new Response('无效的 URL 格式', { status: 400 });
    }

    // 2. 防止无限循环
    if (targetUrl.includes('/api/play')) {
        return new Response('检测到循环请求', { status: 400 });
    }

    // 3. 尝试从缓存获取
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

    // 4. 发起代理请求
    try {
        const targetOrigin = new URL(targetUrl).origin;

        const proxyRequest = new Request(targetUrl, {
            method: request.method,
            headers: {
                // ============================================================
                // 关键：模拟浏览器请求头，绕过防盗链
                // ============================================================
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                // 防盗链关键：Referer 和 Origin 设置为目标站点的域名
                'Referer': targetOrigin + '/',
                'Origin': targetOrigin,
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'cross-site',
            },
            redirect: 'follow',
        });

        response = await fetch(proxyRequest);

        if (!response.ok) {
            return new Response(`源站返回错误: ${response.status} ${response.statusText}`, {
                status: response.status,
            });
        }

        const contentType = response.headers.get('content-type') || '';
        let content = await response.text();

        // 5. 如果是 m3u8 文件，重写内部地址
        if (contentType.includes('mpegurl') || contentType.includes('vnd.apple.mpegurl') || content.trim().startsWith('#EXTM3U')) {
            content = rewriteM3u8(content, targetUrl);
        }

        // 6. 存入缓存
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

        // 将非注释行（.ts 分片地址）重写为代理地址
        try {
            // 处理完整 URL 或相对路径
            const absoluteUrl = new URL(trimmed, baseUrl).href;
            rewritten.push('/api/play?url=' + encodeURIComponent(absoluteUrl));
        } catch (e) {
            // 拼接失败，保持原样
            rewritten.push(line);
        }
    }

    return rewritten.join('\n');
}
