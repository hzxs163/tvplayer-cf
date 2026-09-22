// functions/api/play.js - 流媒体播放代理（带缓存优化）
// 职责：代理 m3u8 请求，重写内部 .ts 分片与加密 KEY 地址，短期缓存加速秒开；非 m3u8 内容流式透传

const CACHE_MAX_AGE = 10; // 缓存10秒，平衡新鲜度和速度
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

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
                'User-Agent': UA,
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': parsed.origin + '/',
                'Origin': parsed.origin,
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

            if (content.trim().startsWith('#EXTM3U')) {
                content = rewriteM3u8(content, targetUrl);
            }

            const headers = new Headers(response.headers);
            headers.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE}`);
            headers.set('X-Cache', 'MISS');
            headers.set('Access-Control-Allow-Origin', '*');
            headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
// 重写 m3u8 内部地址 - 所有分片与加密 KEY 都走代理
// ============================================================
function rewriteM3u8(content, baseUrl) {
    const lines = content.split('\n');
    const rewritten = [];

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

        // 保留其他 #EXT 标签
        if (trimmed.startsWith('#')) {
            rewritten.push(line);
            continue;
        }

        // 如果行已经是完整 URL，直接代理
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            rewritten.push('/api/play?url=' + encodeURIComponent(trimmed));
            continue;
        }

        // 处理相对路径（包括以 / 开头的绝对路径）
        const absoluteUrl = resolveUrl(trimmed, baseUrl);
        if (absoluteUrl) {
            rewritten.push('/api/play?url=' + encodeURIComponent(absoluteUrl));
        } else {
            // 如果拼接失败，保持原样
            rewritten.push(line);
        }
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
