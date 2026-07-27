import { Hono } from 'hono';
import { proxy as proxyToUpstream, type ProxyRequest } from '../services/intellect-rag-client';
import { streamResponse } from '../utils/response';
import { resolveMemberIdFromContext } from '../services/member-id-resolver';
import { getAuthSession } from '../middleware/auth-session';
import type { BackendStore, HarnessStore } from '../types';

interface ProxyVariables {
  backendStore: BackendStore;
  harnessStore: HarnessStore;
}

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

export const proxyRoutes = new Hono<{ Variables: ProxyVariables }>();

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

  // BFF-P0-1: 解析 member_id (仅企业版,解析失败不阻塞)
  let intellectUserId: string | undefined;
  try {
    intellectUserId = await resolveMemberIdFromContext(c);
  } catch (_err) {
    // 解析失败静默跳过(intellect-rag 单租户场景不需要 member_id)
  }

  // D1.2 B (identity-model-migration): 从 BackendStore 读取 team/project 绑定。
  // proxy 路由未挂载 backendContextMiddleware,此处内联解析(与 backend-context.ts 同逻辑)。
  // getIntellectTeamId 已过滤缺省值 "0"(intellect-team 走全局默认上下文)。
  const backendStore = c.get('backendStore');
  const harnessStore = c.get('harnessStore');
  // Fallback '0' 对应 bff-backends.json 中的 Default Enterprise Backend,
  // 确保 X-Intellect-Tenant header 能正确解析(避免 sync_membership 用
  // current_user.id 作为 tenant_id 创建孤儿 tenant_membership 行)。
  const backendId = c.req.header('X-Backend-Id') || '0';
  const intellectTeamId = backendStore?.getIntellectTeamId(backendId);
  const intellectProjectId = backendStore?.getIntellectProjectId(backendId);

  // 方案 B: 从 HarnessBackend 读取 intellectTenantId (实例级 tenant_id)。
  // 注入到 X-Intellect-Tenant header,让 intellect-rag 的 SubjectContext.tenant_id 正确解析。
  let intellectTenantId: string | undefined;
  if (backendStore && harnessStore) {
    const bffTenant = backendStore.getBackend(backendId);
    if (bffTenant) {
      const harnessBackend = harnessStore.get(bffTenant.intellectBackendId);
      if (harnessBackend?.intellectTenantId) {
        intellectTenantId = harnessBackend.intellectTenantId;
      }
    }
  }

  // R5.1: chat 路由已迁移到 Rust Gateway。企业版 backend 的 chat/agent 请求应通过
  // bff-agents.ts 的 IntellectEnterpriseAdapter 路由，不再走 proxy 透传到 intellect-rag-app。
  const chatPaths = ['chats', 'agents', 'runs', 'sessions'];
  const isChatPath = chatPaths.some((p) => relativePath.startsWith(p));
  if (isChatPath) {
    const bffTenant = backendStore?.getBackend(backendId);
    if (bffTenant) {
      const harnessBackend = harnessStore?.get(bffTenant.intellectBackendId);
      if (harnessBackend?.type === 'intellect-enterprise') {
        console.warn(
          `[proxy] R5.1 deprecated: ${method} /proxy/v1/${relativePath} — chat routes should use Gateway native API (POST /v1/runs, /api/sessions)`,
        );
        return c.json(
          {
            code: 410,
            message:
              'Chat routes have moved to the Gateway native API. Use POST /api/bff/agents/:id/sessions and /api/bff/agents/chat/completions instead.',
            migration_doc: 'https://docs.intellect.run/gateway-chat-migration',
          },
          410,
        );
      }
    }
    // RAG backends: log deprecation warning but still proxy for now
    console.warn(
      `[proxy] R5.1 deprecated: ${method} /proxy/v1/${relativePath} — chat routes via RAG proxy will be removed. Migrate to Gateway native API.`,
    );
  }

  // 方案 B: 从 AuthSession 提取会话 token (imt_*),优先于 admin JWT 传递给 intellect-rag。
  const authSession = getAuthSession(c);
  const sessionToken = authSession?.token;

  // 构造透传请求
  const proxyReq: ProxyRequest = {
    method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
    query: queryString,
    intellectUserId,
    intellectTeamId,
    intellectProjectId,
    intellectTenantId,
    sessionToken,
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

  // 上游返回 401 时,企业版用户降级返回空数据,避免触发前端 401 拦截器跳转登录页
  if (upstream.status === 401) {
    // 返回 null data,前端 hooks 通过 data?.data ?? fallback 自动使用默认值
    // (如 { chats: [], total: 0 }, [] 等),避免 data:[] 导致 .chats.slice() 崩溃
    return c.json({ code: 0, data: null, message: 'success' });
  }

  // 透传上游响应:共享 streamResponse 工具(hono/node-server 处理 transfer-encoding)
  return streamResponse(upstream);
});
