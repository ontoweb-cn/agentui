import { ragTokenProvider } from './rag-token-provider';

const INTELLECT_RAG_HOST = process.env.INTELLECT_RAG_HOST || 'localhost';
const INTELLECT_PORT = process.env.PYTHON_API_PORT || '9380';
const BASE_URL = `http://${INTELLECT_RAG_HOST}:${INTELLECT_PORT}`;

async function request<T = unknown>(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<T> {
  const url = new URL(path, BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = token;
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Intellect RAG API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

export const intellectRagClient = {
  get: <T = unknown>(path: string, token: string, query?: Record<string, string>) =>
    request<T>('GET', path, token, undefined, query),
  post: <T = unknown>(path: string, token: string, body: unknown) =>
    request<T>('POST', path, token, body),
  put: <T = unknown>(path: string, token: string, body: unknown) =>
    request<T>('PUT', path, token, body),
  delete: <T = unknown>(path: string, token: string) =>
    request<T>('DELETE', path, token),
};

// ---------------------------------------------------------------------------
// Transparent reverse proxy (Multi-Harness P0-前置, Constitution Principle I)
// ---------------------------------------------------------------------------
// 透传前端请求到 Intellect RAG /api/v1/*,不缓冲 body,支持 SSE 流式透传。
// 不重复注入 admin token(透传前端 Authorization 即可,避免双重鉴权)。
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

  // 透传 headers(含 Authorization),不重复注入 admin token
  const headers = new Headers(req.headers);
  // 删除 host 头避免上游冲突(fetch 会自动设置)
  headers.delete('host');

  // BFF-P0-1: 注入解析后的 member_id 为 X-Intellect-User header。
  // intellect-rag-app 据此设置 KB/Chunk ownership 的 owner_user_id,
  // 替代之前的 current_user.id (RAG UUID) 回退。
  // 安全: member_id 来自服务端 token→/api/members/me 解析,非客户端 X-User-Id header。
  if (req.intellectUserId) {
    headers.set('X-Intellect-User', req.intellectUserId);
  }

  // 企业版兜底:前端无 Authorization header 时(非 JWT 模式),
  // 使用 BFF 自动登录获取的动态 token 鉴权,确保企业版用户也能访问 RAG 功能
  if (!headers.has('Authorization') || !headers.get('Authorization')) {
    const token = await resolveRagToken();
    if (token) {
      headers.set('Authorization', token);
    }
  }

  // Buffer the request body upfront so the 401 retry can safely re-send it.
  // ReadableStream is single-consumption; buffering avoids "body already
  // disturbed" errors on retry for POST/PUT/PATCH/DELETE requests.
  let bodyBuffer: Buffer | undefined;
  if (req.body) {
    const chunks: Uint8Array[] = [];
    const reader = req.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    bodyBuffer = Buffer.concat(chunks);
  }

  let response = await fetch(url, {
    method: req.method,
    headers,
    body: bodyBuffer,
    // @ts-expect-error Node fetch 支持 duplex:'half' 用于 stream body
    duplex: 'half',
  });

  // token 过期时自动重新登录重试一次。
  // 仅当 token 是由自动登录产生的(非 env var 降级)且不是由 find-env-token 路径提供的过期静态 token 时才重试。
  if (response.status === 401 && ragTokenProvider.getToken()) {
    ragTokenProvider.invalidate();
    const newToken = await resolveRagToken();
    if (newToken) {
      headers.set('Authorization', newToken);
      response = await fetch(url, {
        method: req.method,
        headers,
        body: bodyBuffer,  // 使用缓冲的 body,不再消费 req.body stream
        // @ts-expect-error Node fetch 支持 duplex:'half' 用于 stream body
        duplex: 'half',
      });
    }
  }

  return response;
}

/**
 * 解析 RAG token:优先用自动登录的动态 token,
 * 降级到环境变量 HARNESS_INTELLECT_RAG_ADMIN_TOKEN(向后兼容)。
 */
async function resolveRagToken(): Promise<string | null> {
  try {
    return await ragTokenProvider.login();
  } catch {
    // 自动登录失败,尝试环境变量降级
    const adminToken = process.env.HARNESS_INTELLECT_RAG_ADMIN_TOKEN;
    if (adminToken) {
      return `Bearer ${adminToken}`;
    }
    return null;
  }
}

