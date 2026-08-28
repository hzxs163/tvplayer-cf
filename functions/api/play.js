// functions/api/play.js - 流媒体播放代理
// 职责：代理 m3u8 请求，重写内部 .ts 分片地址，解决跨域和防盗链问题

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

    // 3. 构建代理请求
    const proxyRequest = new Request(targetUrl, {
        method: request.method,
        headers: {
            // 转发必要的请求头，模拟浏览器行为
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

    try {
        // 4. 发起代理请求
        const response = await fetch(proxyRequest);

        // 5. 检查响应状态
        if (!response.ok) {
            return new Response(`源站返回错误: ${response.status} ${response.statusText}`, {
                status: response.status,
            });
        }

        // 6. 获取响应内容
        const contentType = response.headers.get('content-type') || '';
        const content = await response.text();

        // 7. 如果是 m3u8 文件，重写内部地址
        let finalContent = content;
        if (contentType.includes('mpegurl') || contentType.includes('vnd.apple.mpegurl') || content.trim().startsWith('#EXTM3U')) {
            finalContent = rewriteM3u8(content, targetUrl);
        }

        // 8. 返回处理后的内容
        return new Response(finalContent, {
            headers: {
                'Content-Type': contentType || 'application/vnd.apple.mpegurl',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Cache-Control': 'public, max-age=60',
            },
        });

    } catch (error) {
        // 9. 错误处理
        return new Response(`代理请求失败: ${error.message}`, { status: 500 });
    }
}

// ============================================================
// 重写 m3u8 内部地址
// ============================================================
function rewriteM3u8(content, baseUrl) {
    const base = new URL(baseUrl);
    const lines = content.split('\n');
    const rewritten = [];

    for (let line of lines) {
        // 跳过空行和注释（除了 EXT 标签）
        if (!line.trim() || line.startsWith('#')) {
            rewritten.push(line);
            continue;
        }

        // 如果行已经是完整 URL，直接代理
        if (line.startsWith('http://') || line.startsWith('https://')) {
            rewritten.push('/api/play?url=' + encodeURIComponent(line));
            continue;
        }

        // 处理相对路径
        try {
            // 拼接完整 URL
            const absoluteUrl = new URL(line, baseUrl).href;
            rewritten.push('/api/play?url=' + encodeURIComponent(absoluteUrl));
        } catch (e) {
            // 如果拼接失败，保持原样
            rewritten.push(line);
        }
    }

    return rewritten.join('\n');
}
