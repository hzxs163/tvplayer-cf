// functions/api/play.js - 流媒体播放代理（带缓存优化）
// 职责：代理 m3u8 请求，重写内部 .ts 分片地址，短期缓存加速秒开

const CACHE_MAX_AGE = 10; // 缓存10秒，平衡新鲜度和速度

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    // 1. 验证参数
    if (!targetUrl) {
        return new Response('缺少 url 参数', { status: 400 });
    }

    // 2. 验证 URL 格式
    try {
        new URL(targetUrl);
    } catch (e) {
        return new Response('无效的 URL 格式', { status: 400 });
    }

    // ============================================================
    // 3. 尝试从缓存获取
    // ============================================================
    const cacheKey = new Request(targetUrl, { method: 'GET' });
    const cache = caches.default;
    let response = await cache.match(cacheKey);

    if (response) {
        // 缓存命中，直接返回
        console.log('✅ 缓存命中:', targetUrl);
        return new Response(response.body, {
            status: response.status,
            headers: {
                ...response.headers,
                'X-Cache': 'HIT',
                'Access-Control-Allow-Origin': '*',
            },
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': targetUrl,
                'Origin': new URL(targetUrl).origin,
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
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

        // 6. 获取响应内容
        const contentType = response.headers.get('content-type') || '';
        let content = await response.text();

        // 7. 如果是 m3u8 文件，重写内部地址
        if (contentType.includes('mpegurl') || contentType.includes('vnd.apple.mpegurl') || content.trim().startsWith('#EXTM3U')) {
            content = rewriteM3u8(content, targetUrl);
        }

        // 8. 存入缓存（仅缓存成功的响应）
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE}`);
        headers.set('X-Cache', 'MISS');
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');

        const cachedResponse = new Response(content, {
            status: response.status,
            headers: headers,
        });

        // 使用 context.waitUntil 异步缓存，不阻塞响应
        context.waitUntil(cache.put(cacheKey, cachedResponse.clone()));

        return cachedResponse;

    } catch (error) {
        // 9. 错误处理
        console.error('代理请求失败:', error.message);
        return new Response(`代理请求失败: ${error.message}`, { status: 500 });
    }
}

// ============================================================
// 重写 m3u8 内部地址 - 所有分片都走代理
// ============================================================
function rewriteM3u8(content, baseUrl) {
    const base = new URL(baseUrl);
    const lines = content.split('\n');
    const rewritten = [];

    for (let line of lines) {
        const trimmed = line.trim();

        // 跳过空行和注释（保留 #EXT 标签）
        if (!trimmed || trimmed.startsWith('#')) {
            rewritten.push(line);
            continue;
        }

        // 如果行已经是完整 URL，直接代理
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            rewritten.push('/api/play?url=' + encodeURIComponent(trimmed));
            continue;
        }

        // 处理相对路径（包括以 / 开头的绝对路径）
        try {
            const absoluteUrl = new URL(trimmed, baseUrl).href;
            rewritten.push('/api/play?url=' + encodeURIComponent(absoluteUrl));
        } catch (e) {
            // 如果拼接失败，保持原样
            rewritten.push(line);
        }
    }

    return rewritten.join('\n');
}
