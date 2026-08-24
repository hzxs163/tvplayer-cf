// functions/api/proxy.js

/**
 * 检查是否为内网地址（防 SSRF）
 */
function isInternalHost(hostname) {
  const lower = hostname.toLowerCase();
  
  // 精确匹配
  const forbidden = new Set([
    '127.0.0.1', 'localhost', '::1', '0.0.0.0',
    '10.0.0.0', '172.16.0.0', '192.168.0.0', '169.254.0.0'
  ]);
  if (forbidden.has(lower)) return true;
  
  // 127.0.0.0/8
  if (lower.startsWith('127.')) return true;
  
  // 10.0.0.0/8
  if (lower.startsWith('10.')) return true;
  
  // 172.16.0.0/12
  if (lower.startsWith('172.')) {
    const parts = lower.split('.');
    if (parts.length === 4) {
      const second = parseInt(parts[1]);
      if (second >= 16 && second <= 31) return true;
    }
  }
  
  // 192.168.0.0/16
  if (lower.startsWith('192.168.')) return true;
  
  // 169.254.0.0/16
  if (lower.startsWith('169.254.')) return true;
  
  return false;
}

/**
 * 返回 JSON 响应（带 CORS 头）
 */
function jsonResponse(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    }
  });
}

/**
 * 主请求处理
 */
export async function onRequest(context) {
  const { request } = context;
  
  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Max-Age': '86400',
      }
    });
  }

  // 只允许 GET
  if (request.method !== 'GET') {
    return jsonResponse({ code: 405, msg: 'Method Not Allowed' }, 405);
  }

  // 获取目标 URL
  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  
  if (!target || target.trim() === '') {
    return jsonResponse({ code: 400, msg: '缺少 url 参数' }, 400);
  }

  // 解析目标 URL
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return jsonResponse({ code: 400, msg: '无效的 URL 格式' }, 400);
  }

  // 仅允许 http/https
  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    return jsonResponse({ code: 400, msg: '仅支持 http/https 协议' }, 400);
  }

  // SSRF 防护
  if (isInternalHost(targetUrl.hostname)) {
    return jsonResponse({ code: 403, msg: '禁止访问内网地址' }, 403);
  }

  // ============================================================
  // ⚠️ 端口限制 - 已放开所有端口（仅屏蔽高危端口）
  // ============================================================
  const port = targetUrl.port || (targetUrl.protocol === 'https:' ? '443' : '80');
  // 仅屏蔽极少数高危端口，其他全部放行
  const blockedPorts = ['25', '465', '587', '3389', '5900'];
  if (blockedPorts.includes(port)) {
    return jsonResponse({ code: 403, msg: '端口 ' + port + ' 被禁止' }, 403);
  }
  // 其他端口全部放行
  // ============================================================

  try {
    const resp = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': targetUrl.origin + '/',
      }
    });

    const data = await resp.arrayBuffer();

    return new Response(data, {
      status: resp.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': resp.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store',
        'Content-Length': data.byteLength.toString(),
      }
    });

  } catch (error) {
    return jsonResponse({
      code: 502,
      msg: '请求失败: ' + error.message
    }, 502);
  }
}
