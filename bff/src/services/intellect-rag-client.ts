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
}

/**
 * 透明代理到 Intellect RAG /api/v1/${path}。
 *
 * @param path 已剥离 /api/bff/proxy/v1 前缀的相对路径,如 "agents" 或 "agents/123"
 * @param req 请求组成部分(method/headers/body/query)
 * @returns 上游 fetch Response(不调用 .json()/.text(),保留 body ReadableStream)
 */
export async function proxy(path: string, req: ProxyRequest): Promise<Response> {
  // 构造上游 URL:BASE_URL + /api/v1/ + path + query
  const url = `${BASE_URL}/api/v1/${path}${req.query}`;

  // 透传 headers(含 Authorization),不重复注入 admin token
  const headers = new Headers(req.headers);
  // 删除 host 头避免上游冲突(fetch 会自动设置)
  headers.delete('host');

  const response = await fetch(url, {
    method: req.method,
    headers,
    body: req.body ?? undefined,
    // @ts-expect-error Node fetch 支持 duplex:'half' 用于 stream body
    duplex: 'half',
  });

  return response;
}

