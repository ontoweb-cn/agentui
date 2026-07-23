// LLM Gateway 透明反向代理 — 将模型管理请求转发到 intellect-team
// (providers CRUD 等,与通用 proxy 不同,不走 intellect-rag)。

import { Hono } from 'hono';

const INTELLECT_LLM_HOST = process.env.INTELLECT_TEAM_HOST || 'localhost';
const INTELLECT_LLM_PORT = process.env.INTELLECT_TEAM_PORT || '8642';
const LLM_BASE = `http://${INTELLECT_LLM_HOST}:${INTELLECT_LLM_PORT}`;

// intellect-team 共享 enterprise + llm endpoint,
// 鉴权使用 API_SERVER_KEY (与 HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY 同值)
const LLM_API_KEY = process.env.INTELLECT_LLM_API_KEY
  || process.env.HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY
  || '';

export const llmProxyRoutes = new Hono();

// 匹配 LLM 专用路径,转发到 intellect-team :8642
// 路径前缀 /proxy/v1 映射到 intellect-team /v1
const llmPaths = [
  '/proxy/v1/providers',
  '/proxy/v1/providers/*',
];

for (const p of llmPaths) {
  llmProxyRoutes.all(p, async (c) => {
    const method = c.req.method;
    // 路径映射:/proxy/v1/providers... → /v1/admin/providers...
    // intellect-team LLM Gateway 的 admin 端点均在 /v1/admin/ 下
    const upstreamPath = c.req.path.replace('/proxy/v1/', '/v1/admin/');
    const query = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
    const url = `${LLM_BASE}${upstreamPath}${query}`;

    const headers = new Headers(c.req.raw.headers);
    headers.delete('host');
    if (!headers.has('Authorization') || !headers.get('Authorization')) {
      if (LLM_API_KEY) {
        headers.set('Authorization', `Bearer ${LLM_API_KEY}`);
      }
    }

    let body: BodyInit | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      body = await c.req.arrayBuffer();
    }

    const upstream = await fetch(url, { method, headers, body });
    return new Response(upstream.body, upstream);
  });
}
