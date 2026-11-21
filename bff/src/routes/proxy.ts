import { Hono } from 'hono';
import { proxy as proxyToUpstream, type ProxyRequest } from '../services/intellect-rag-client';
import { streamResponse } from '../utils/response';
import { resolveMemberInfoFromContext } from '../services/member-id-resolver';
import { getAuthSession } from '../middleware/auth-session';
import type { BackendStore, HarnessStore } from '../types';
import { resolveRagBackendId } from '../services/rag-plugin-backend';
import {
  isImtCanvasAgentsEnabled,
  isModelMgmtServiceTokenEnabled,
} from '../utils/feature-flags';

interface ProxyVariables {
  backendStore: BackendStore;
  harnessStore: HarnessStore;
}

// 模型管理路径:providers 目录与实例 CRUD、models 列表与默认模型。
// 不含 users/me/models(身份绑定语义,"当前用户的租户信息"不适用服务视角)。
// 消费方:上游 401 的诚实透传(P1-a)与后续服务令牌强制/写门控(P1-b),
// 见 docs/model-provider-empty-models-fix-design.md §4。
export const MODEL_MANAGEMENT_PATH_RE = /^(providers|models)(\/|$)/;

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

  const isModelMgmtPath = MODEL_MANAGEMENT_PATH_RE.test(relativePath);

  // 构造 query string(保留原始 ? 前缀)
  const queryString = c.req.url.includes('?')
    ? '?' + c.req.url.split('?')[1]
    : '';

  // BFF-P0-1: 解析 member_id + role (仅企业版,解析失败不阻塞)
  let intellectUserId: string | undefined;
  let intellectRole: string | undefined;
  try {
    const info = await resolveMemberInfoFromContext(c);
    intellectUserId = info?.memberId;
    intellectRole = info?.role;
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
  // 全 0 是向导的占位租户值,注入只会误导 RAG 的租户解析。
  // 与 backend-context 对缺省值 "0" 的过滤语义对齐(设计文档 §4.3)。
  const injectableTenantId =
    intellectTenantId && !/^0+$/.test(intellectTenantId)
      ? intellectTenantId
      : undefined;

  // R5.1: chat 路由已迁移到 Rust Gateway。前端 use-chat-request.ts 已全部转向
  // gatewayChatService(BFF /agents/* 路由),不再调用 /proxy/v1/chats。
  // 对 chats/sessions 路径返回 410 Gone,作为明确的废弃信号。
  // 其他 chat 子路径(chat/audio/speech, chat/mindmap, chat/recommendation)保留透传,
  // 因为前端 useFetchMindMap/useFetchRelatedQuestions/useSpeech 仍在使用。
  const deprecatedChatPaths = ['chats', 'sessions'];
  const isDeprecatedChatPath = deprecatedChatPaths.some((p) =>
    relativePath.startsWith(p),
  );
  if (isDeprecatedChatPath) {
    console.warn(
      `[proxy] R5.1 deprecated: ${method} /proxy/v1/${relativePath} — use Gateway native API (/api/bff/agents/chat/sessions) instead`,
    );
    return c.json(
      {
        code: 410,
        message:
          'Chat routes have migrated to Gateway native API. Use /api/bff/agents/chat/sessions instead.',
      },
      410,
    );
  }

  // 方案 B: 从 AuthSession 提取会话 token (imt_*),优先于 admin JWT 传递给 intellect-rag。
  const authSession = getAuthSession(c);
  // 审计缺陷 B 修复:与 feature-flags 的默认语义统一(默认开)。
  // 原判定 === 'true' 与 isImtCanvasAgentsEnabled() 的 !== 'false' 相反,
  // member token 透传在实践中永不生效,上游用户级验证缺位。
  const sessionToken = isImtCanvasAgentsEnabled()
    ? authSession?.token
    : undefined;

  let ragBaseUrl: string | undefined;
  let ragAdminToken: string | undefined;
  if (backendStore && harnessStore) {
    const tenant = backendStore.getBackend(backendId);
    const ragId = resolveRagBackendId(tenant, backendId, harnessStore);
    if (ragId) {
      const ragBackend = harnessStore.get(ragId);
      ragBaseUrl = ragBackend?.endpoint;
      ragAdminToken = ragBackend?.adminToken;
    }
  }
  if (!ragBaseUrl) {
    return c.json(
      {
        code: 503,
        // 稳定机器标记:前端据此静默该状态(能力门控的兜底安全网),
        // 避免依赖人类可读的 message 文案做字符串匹配
        error: 'RAG_UNAVAILABLE',
        message: `Tenant ${backendId} has no canvas backend bound`,
      },
      503,
    );
  }

  // P1-b(§4.1): 模型管理路径在 flag 开启且服务令牌可用时,强制以 ragAdminToken 鉴权。
  // 三条件缺一不可;ragAdminToken 缺失时自动退回成员令牌,不阻断(设计 §4.1)。
  // flag 默认关(BFF_MODEL_MGMT_SERVICE_TOKEN≠'true')时本批零行为变化。
  const forceServiceToken =
    isModelMgmtPath && isModelMgmtServiceTokenEnabled() && !!ragAdminToken;

  // P1-b(§4.4): 写权限门控(仅强制服务令牌时生效)。
  // fail-closed:role 解析失败(resolver 对缺失 role 兜底 'member'/undefined)
  // 一律 403——不允许无法确权者以服务身份改租户配置。60s 角色缓存缓解 TEAM 抖动。
  // flag 关闭时门控整体不生效,写请求由上游按成员令牌鉴权,与现状完全一致。
  const ADMIN_ROLES = new Set(['admin', 'owner']); // 与 llm-auth.ts、MemberRole(domain.ts) 口径一致
  if (
    forceServiceToken &&
    method !== 'GET' &&
    !ADMIN_ROLES.has(intellectRole ?? '')
  ) {
    return c.json(
      { code: 403, message: 'Model management write requires admin role' },
      403,
    );
  }

  // 构造透传请求
  const proxyReq: ProxyRequest = {
    method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
    query: queryString,
    intellectUserId,
    intellectRole,
    intellectTeamId,
    intellectProjectId,
    intellectTenantId: injectableTenantId,
    sessionToken,
    forceServiceToken,
    ragBaseUrl,
    ragAdminToken,
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

  // 上游 401 处理(docs/model-provider-empty-models-fix-design.md §4.2):
  // - 一律记录诊断日志(上游响应体;信封不含令牌,日志语句本身不含 Authorization)
  // - 成员身份(sessionToken 存在)发出的模型管理请求:诚实透传 401 与上游信封,
  //   由模型页以错误横幅/mutation toast 呈现。企业模式下前端拦截器对 401
  //   静默(request.ts 企业分支跳过登出与提示),透传不会引发跳登录。
  // - 其余场景维持改写为空数据:社区模式下 code:401 会触发前端登出跳转,而 RAG
  //   管理令牌失效无法靠重新登录解决,透传会形成登出循环;非模型路径的全局
  //   诚实化见设计文档 §7(后续项)。
  if (upstream.status === 401) {
    const bodyText = await upstream.clone().text().catch(() => '');
    console.warn(
      `[proxy] upstream 401 ${method} ${fullPath}: ${bodyText.slice(0, 500)}`,
    );
    if (sessionToken && isModelMgmtPath) {
      return streamResponse(upstream);
    }
    // 返回 null data,前端 hooks 通过 data?.data ?? fallback 自动使用默认值
    // (如 { chats: [], total: 0 }, [] 等),避免 data:[] 导致 .chats.slice() 崩溃
    return c.json({ code: 0, data: null, message: 'success' });
  }

  // 透传上游响应:共享 streamResponse 工具(hono/node-server 处理 transfer-encoding)
  return streamResponse(upstream);
});
