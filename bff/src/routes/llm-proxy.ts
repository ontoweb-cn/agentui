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
// /proxy/v1/providers/* 覆盖 providers CRUD + key + verify + models
// /proxy/v1/health/keys 覆盖 key 健康摘要(GatewayProviderPanel 使用)
const llmPaths = [
  '/proxy/v1/providers',
  '/proxy/v1/providers/*',
  '/proxy/v1/health/keys',
];

for (const p of llmPaths) {
  llmProxyRoutes.all(p, async (c) => {
    const start = Date.now();
    const method = c.req.method;
    // 路径映射:/proxy/v1/providers... → /v1/admin/providers...
    // intellect-team LLM Gateway 的 admin 端点均在 /v1/admin/ 下
    const upstreamPath = c.req.path.replace('/proxy/v1/', '/v1/admin/');
    const query = c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : '';
    const url = `${LLM_BASE}${upstreamPath}${query}`;

    // 始终使用 BFF 的 admin token 与 Rust gateway 通信，不透传前端的 JWT/cookie。
    // Rust gateway 的 auth 体系独立(intellect-team profile token / imt_* member token)，
    // 不认识 intellect-rag 签发的 JWT。
    const headers = new Headers();
    if (LLM_API_KEY) {
      headers.set('Authorization', `Bearer ${LLM_API_KEY}`);
    }

    let body: BodyInit | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      headers.set('Content-Type', 'application/json');
      body = await c.req.arrayBuffer();
    }

    try {
      const upstream = await fetch(url, { method, headers, body });
      if (!upstream.ok) {
        // 错误响应不透明传 — 改为标准 {code, data, message} 信封格式，
        // 避免前端 axios 拦截器收到 {error:{code,message}} 时 data.code === undefined。
        let errorMessage = `Upstream returned ${upstream.status}`;
        try {
          const errData = await upstream.json() as Record<string, unknown>;
          const err = (errData.error as Record<string, unknown> | undefined);
          if (err?.message) errorMessage = String(err.message);
        } catch {
          // 非 JSON 响应体：尝试读文本
          try { errorMessage = await upstream.text().catch(() => ''); } catch { /**/ }
        }
        return c.json(
          { code: upstream.status, data: null, message: errorMessage },
          upstream.status as any,
        );
      }

      // 安全解析 JSON body:空 body(204)或非 JSON 响应会在这里安全降级
      let upstreamData: unknown = null;
      const contentLength = upstream.headers.get('content-length');
      if (contentLength !== '0') {
        try {
          upstreamData = await upstream.json();
        } catch {
          // 非 JSON 成功响应视为 null data
        }
      }
      // intellect-team Rust gateway 返回 {providers:[...], models:[...]} 等扁平对象，
      // 但前端 hooks 期望 data 直接是数组（与 intellect-rag {code:0,data:[...]} 对齐）。
      // 仅对列表端点提取数组(避免 /health/keys 等含 providers 字段的非列表响应被误提取)。
      let data: unknown = upstreamData;
      const isListEndpoint =
        method === 'GET' &&
        (upstreamPath === '/v1/admin/providers' ||
          upstreamPath.endsWith('/models'));
      if (isListEndpoint && typeof upstreamData === 'object' && upstreamData !== null) {
        for (const key of ['providers', 'models']) {
          if (Array.isArray((upstreamData as Record<string, unknown>)[key])) {
            data = (upstreamData as Record<string, unknown>)[key];
            break;
          }
        }
      }
      return c.json({ code: 0, data, message: 'success' });
    } catch (err) {
      const elapsed = Date.now() - start;
      console.error(
        `[llm-proxy] ERROR ${method} ${upstreamPath} → ${url} - ${(err as Error).message} ` +
        `(${elapsed}ms, req ${c.req.path})`,
      );
      return c.json(
        {
          code: 502,
          message: `LLM gateway upstream error: ${(err as Error).message}`,
        },
        502,
      );
    }
  });
}
