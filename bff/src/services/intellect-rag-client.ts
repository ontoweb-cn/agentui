import { fetchWithRagToken } from './rag-fetch';
import { getRagBaseUrl } from '../utils/rag-base-url';

// ---------------------------------------------------------------------------
// Transparent reverse proxy (Multi-Harness P0-前置, Constitution Principle I)
// ---------------------------------------------------------------------------
// 透传前端请求到 Intellect RAG /api/v1/*,支持 SSE 流式透传。
// Authorization 统一由 fetchWithRagToken 注入(动态 token 优先,降级 env var),
// 不透传客户端 Authorization 头,防止客户端伪造任意用户 JWT 绕过 BFF 身份校验。
// 返回 fetch Response 原样,路由层用 response.body ReadableStream 构造 BFF Response。

export interface ProxyRequest {
  /** HTTP method (GET/POST/PUT/DELETE/PATCH...) */
  method: string;
  /** 原始请求 headers(含 Authorization) */
  headers: Headers;
  /** 请求 body stream(可选,GET 无 body) */
  body?: ReadableStream<Uint8Array> | null;
  /** 原始 query string(已含 ?,如 "?page=1&size=10") */
  query: string;
  /**
   * BFF-P0-1: 解析后的 member_id (来自 token → /api/members/me 解析)。
   * 设置后注入 X-Intellect-User header,让 intellect-rag-app 获知调用方身份。
   * 仅企业版 (authMode=intellect-enterprise) 下传入,RAG 版为 undefined。
   */
  intellectUserId?: string;
  /**
   * 方案 A (V1): 解析后的 member role (来自 token → /api/members/me 的 role 字段)。
   * 设置后注入 X-Intellect-Role header,让 intellect-rag 首次建 membership 时写正确角色。
   * 仅企业版下传入,RAG 版为 undefined。
   */
  intellectRole?: string;
  /**
   * D1.2 B (identity-model-migration): 实例内 Team 组织隔离 ID。
   * 来自 BffTenant.intellectTenantId(经 backend-context 中间件过滤 "0" 缺省值)。
   * 设置后注入 X-Intellect-Team header,让 intellect-rag-app 在 KB ownership
   * 字段写入时使用正确的 team_id(visibility=team)。
   */
  intellectTeamId?: string;
  /**
   * D1.2 B (identity-model-migration): 实例内 Project 组织隔离 ID。
   * 来自 BffTenant.intellectProjectId(可选,project 隶属于 team)。
   * 设置后注入 X-Intellect-Project header。
   */
  intellectProjectId?: string;
  /**
   * 方案 B: 实例级 Tenant ID (来自 HarnessBackend.intellectTenantId)。
   * 注入到 X-Intellect-Tenant header,让 intellect-rag 的 SubjectContext.tenant_id
   * 正确解析(避免走 legacy current_user.id 回退)。
   * 与 intellectTeamId (实例内 Team 组织隔离) 不同,这是实例级标识。
   */
  intellectTenantId?: string;
  /**
   * 方案 B: 用户会话 token (imt_ 前缀,来自 cookie)。
   * 优先于 admin JWT 传递给 intellect-rag,实现真实身份透传。
   */
  sessionToken?: string;
  /** 方案 A: 按租户解析的 RAG origin,缺省回退 INTELLECT_RAG_URL */
  ragBaseUrl?: string;
  /** 伴生 RAG backend 的 API Key / adminToken */
  ragAdminToken?: string;
  /**
   * P1-b(§4.1): 强制以 ragAdminToken(服务账号)鉴权——跳过会话/动态令牌注入
   * 与全部 X-Intellect-* 身份头(服务令牌本身就是身份,混入成员身份头会让 RAG
   * 归属判断混乱)。仅模型管理路径 + flag 开 + ragAdminToken 存在时由 proxy.ts
   * 置 true(三条件缺一不可,ragAdminToken 缺失自动退回成员令牌)。
   */
  forceServiceToken?: boolean;
}

/**
 * 透明代理到 Intellect RAG /api/v1/${path}。
 *
 * @param path 已剥离 /api/bff/proxy/v1 前缀的相对路径,如 "agents" 或 "agents/123"
 * @param req 请求组成部分(method/headers/body/query/intellectUserId)
 * @returns 上游 fetch Response(不调用 .json()/.text(),保留 body ReadableStream)
 */
export async function proxy(path: string, req: ProxyRequest): Promise<Response> {
  const origin = (req.ragBaseUrl || getRagBaseUrl()).replace(/\/$/, '');
  const url = `${origin}/api/v1/${path}${req.query}`;

  // 复制请求头,删除 host 与客户端可能注入的 X-Intellect-* / Authorization 头。
  // Authorization 由 fetchWithRagToken 统一注入(动态 token 优先,降级 env var),
  // 不透传客户端 Authorization,防止客户端伪造任意用户 JWT 绕过 BFF 身份校验。
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('X-Intellect-User');
  headers.delete('X-Intellect-Team');
  headers.delete('X-Intellect-Project');
  headers.delete('X-Intellect-Tenant');
  headers.delete('X-Intellect-Role');
  headers.delete('Authorization');

  // BFF-P0-1 / D1.2 B / 方案 B: 注入服务端解析的 member_id / team_id / project_id / tenant_id
  // (intellect-rag-app 据此设置 KB ownership 字段,避免静默降级为 private)
  // P1-b(§4.1): 强制服务令牌时跳过全部身份注入——租户/团队隔离由服务令牌
  // 自己的上下文决定,成员身份头与令牌身份不一致会让 RAG 归属判断混乱。
  if (!req.forceServiceToken) {
    if (req.intellectUserId) {
      headers.set('X-Intellect-User', req.intellectUserId);
    }
    if (req.intellectRole) {
      headers.set('X-Intellect-Role', req.intellectRole);
    }
    if (req.intellectTeamId) {
      headers.set('X-Intellect-Team', req.intellectTeamId);
    }
    if (req.intellectProjectId) {
      headers.set('X-Intellect-Project', req.intellectProjectId);
    }
    if (req.intellectTenantId) {
      headers.set('X-Intellect-Tenant', req.intellectTenantId);
    }
  } else if (req.ragAdminToken) {
    // P1-b(§4.1): 服务令牌显式 Authorization,走 fetchWithRagToken 的既有
    // explicit 分支(不覆盖、不重试,见 rag-fetch.ts token 优先级)。
    headers.set('Authorization', `Bearer ${req.ragAdminToken}`);
  }

  // fetchWithRagToken 处理:token 注入(会话优先,降级动态/env var)+ 401 重试 + body 缓冲
  return fetchWithRagToken(url, {
    method: req.method,
    headers,
    body: req.body ?? undefined,
  }, { sessionToken: req.sessionToken, fallbackStaticToken: req.ragAdminToken });
}
