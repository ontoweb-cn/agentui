import { Hono } from 'hono';
import { proxy as proxyToUpstream, type ProxyRequest } from '../services/intellect-rag-client';
import { streamResponse } from '../utils/response';

// ---------------------------------------------------------------------------
// BFF 透明反向代理路由 (Multi-Harness P0-前置, Constitution Principle I)
// ---------------------------------------------------------------------------
// catch-all /proxy/v1/* → Intellect RAG /api/v1/*
// 挂载点:index.ts app.route('/api/bff', proxyRoutes)
// 完整路径:/api/bff/proxy/v1/{path} → intellect-rag /api/v1/{path}
//
// 透传规则:
// - method/headers(含 Authorization)/body/query 全透传
// - 不重复注入 admin token(避免双重鉴权)
// - SSE 响应(text/event-stream)直接用上游 ReadableStream,不缓冲
// - 未授权请求返回 401,不进入 proxy 逻辑(authMiddleware 在 index.ts 已挂载到 /api/*)
//
// 日志:每条请求记录 method/path/status/耗时(SC-003)

export const proxyRoutes = new Hono();

// Hono catch-all:匹配 /proxy/v1/* 任意子路径(含多段,如 /proxy/v1/agents/123/sessions)
proxyRoutes.all('/proxy/v1/*', async (c) => {
  const startedAt = Date.now();
  const method = c.req.method;
  const fullPath = c.req.path; // 如 /proxy/v1/agents/123

  // 提取相对路径:剥离 /proxy/v1/ 前缀
  const prefix = '/proxy/v1/';
  const relativePath = fullPath.startsWith(prefix)
    ? fullPath.slice(prefix.length)
    : fullPath.replace(/^\/proxy\/v1\/?/, '');

  // 安全校验:防止路径遍历攻击
  if (relativePath.includes('..') || relativePath.startsWith('/')) {
    return c.json(
      {
        code: 400,
        message: 'Invalid path: path traversal not allowed',
      },
      400,
    );
  }

  // 构造 query string(保留原始 ? 前缀)
  const queryString = c.req.url.includes('?')
    ? '?' + c.req.url.split('?')[1]
    : '';

  // 构造透传请求
  const proxyReq: ProxyRequest = {
    method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
    query: queryString,
  };

  let upstream: Response;
  try {
    upstream = await proxyToUpstream(relativePath, proxyReq);
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    console.error(
      `[proxy] ERROR ${method} ${fullPath} - ${(err as Error).message} (${elapsed}ms)`,
    );
    return c.json(
      {
        code: 502,
        message: `BFF proxy upstream error: ${(err as Error).message}`,
      },
      502,
    );
  }

  const elapsed = Date.now() - startedAt;
  console.log(`[proxy] ${method} ${fullPath} - ${upstream.status} (${elapsed}ms)`);

  // 透传上游响应:共享 streamResponse 工具(hono/node-server 处理 transfer-encoding)
  return streamResponse(upstream);
});
