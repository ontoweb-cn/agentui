import { fetchWithRagToken } from './rag-fetch';

const INTELLECT_RAG_HOST = process.env.INTELLECT_RAG_HOST || 'localhost';
const INTELLECT_PORT = process.env.PYTHON_API_PORT || '9380';
const BASE_URL = `http://${INTELLECT_RAG_HOST}:${INTELLECT_PORT}`;

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
}

/**
 * 透明代理到 Intellect RAG /api/v1/${path}。
 *
 * @param path 已剥离 /api/bff/proxy/v1 前缀的相对路径,如 "agents" 或 "agents/123"
 * @param req 请求组成部分(method/headers/body/query/intellectUserId)
 * @returns 上游 fetch Response(不调用 .json()/.text(),保留 body ReadableStream)
 */
export async function proxy(path: string, req: ProxyRequest): Promise<Response> {
  // 构造上游 URL:BASE_URL + /api/v1/ + path + query
  const url = `${BASE_URL}/api/v1/${path}${req.query}`;

  // 复制请求头,删除 host 与客户端可能注入的 X-Intellect-* / Authorization 头。
  // Authorization 由 fetchWithRagToken 统一注入(动态 token 优先,降级 env var),
  // 不透传客户端 Authorization,防止客户端伪造任意用户 JWT 绕过 BFF 身份校验。
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('X-Intellect-User');
  headers.delete('X-Intellect-Team');
  headers.delete('X-Intellect-Project');
  headers.delete('X-Intellect-Tenant');
  headers.delete('Authorization');

  // BFF-P0-1 / D1.2 B / 方案 B: 注入服务端解析的 member_id / team_id / project_id / tenant_id
  // (intellect-rag-app 据此设置 KB ownership 字段,避免静默降级为 private)
  if (req.intellectUserId) {
    headers.set('X-Intellect-User', req.intellectUserId);
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

  // fetchWithRagToken 处理:token 注入(会话优先,降级动态/env var)+ 401 重试 + body 缓冲
  return fetchWithRagToken(url, {
    method: req.method,
    headers,
    body: req.body ?? undefined,
  }, { sessionToken: req.sessionToken });
}
