// 统一的 RAG fetch 封装:动态 token 注入 + 401 自动重新登录重试。
//
// 抽取自 intellect-rag-client.ts(IntellectRagAdapter.request/proxy/sendMessage
// 与 intellect-rag-client.proxy 三处共用的 token 逻辑)。
//
// 设计:
// - token 优先级:调用方显式 Authorization > 会话 token(sessionToken, imt_*) > 动态 token(ragTokenProvider) > fallbackStaticToken
// - 401 重试:仅当 token 来自动态 token 时才 invalidate + 重新 login + 重试一次
//   (静态 JWT 过期重试无意义;调用方显式 token 由调用方自行管理)
// - body 缓冲到 Buffer 以支持 401 重试(ReadableStream 单次消费,不缓冲无法重发)
// - X-Intellect-* 头由调用方在 init.headers 中预先注入,本函数不感知

import { ragTokenProvider } from './rag-token-provider';

/**
 * 解析 RAG token:优先用自动登录的动态 token,
 * 降级到环境变量 HARNESS_INTELLECT_RAG_ADMIN_TOKEN(向后兼容)。
 *
 * 返回完整 Authorization 头值(如 "Bearer eyJ..." 或 "Bearer static-token")。
 * 失败返回 null(调用方自行兜底)。
 */
export async function resolveRagToken(): Promise<string | null> {
  try {
    return await ragTokenProvider.login();
  } catch (err) {
    // 自动登录失败(未配置 email/password 或登录接口异常)。
    // console.debug 而非 console.warn:避免 prod 日志噪声(ragTokenProvider 内部已 warn),
    // 但保留调试线索便于运维定位配置问题(如 RSA 公钥不匹配、email 格式错误)。
    console.debug(
      `[rag-fetch] dynamic token login failed, falling back to env var: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    // 降级到环境变量 HARNESS_INTELLECT_RAG_ADMIN_TOKEN(向后兼容)。
    const adminToken = process.env.HARNESS_INTELLECT_RAG_ADMIN_TOKEN;
    if (adminToken) {
      return `Bearer ${adminToken}`;
    }
    return null;
  }
}

export interface FetchWithRagTokenOptions {
  /**
   * 静态 admin token(通常是 backend.adminToken,来自 env var JWT)。
   * 当 ragTokenProvider 动态 token 不可用(社区版/未配置 email+password)时回退使用。
   * 用此 token 时 401 不重试(静态 token 过期重试无意义)。
   */
  fallbackStaticToken?: string;
  /**
   * 是否缓冲 body 以支持 401 重试(默认 true)。
   * 设为 false 时仅适用于 GET/HEAD 等无 body 请求,或调用方明确不需要重试的场景。
   */
  bufferBody?: boolean;
  /**
   * 用户会话 token (imt_ 前缀,来自 cookie)。
   * 优先于动态 admin token 和静态 token,实现真实身份透传。
   * 仅企业版有值;RAG 版为 undefined(走 dynamic/static fallback)。
   * 用此 token 时 401 不重试(会话 token 过期由前端拦截器处理登出)。
   */
  sessionToken?: string;
}

/**
 * 用 RAG token 执行 fetch,401 时自动重新登录重试一次。
 *
 * 行为:
 * - 不覆盖调用方显式设置的 Authorization header(优先级最高)
 * - 否则用 resolveRagToken() 获取动态 token,降级到 fallbackStaticToken
 * - 401 时(仅动态 token 场景):invalidate + 重新登录 + 重试一次
 * - body 缓冲到 Buffer 以支持重试(避免 ReadableStream 一次性消费问题)
 *
 * @param url 完整上游 URL(调用方负责拼接 baseUrl+path+query)
 * @param init fetch init(method/headers/body 等)
 * @param options fallbackStaticToken / bufferBody
 * @returns 上游 fetch Response(不调 .json()/.text(),保留 body)
 */
export async function fetchWithRagToken(
  url: string,
  init: RequestInit,
  options?: FetchWithRagTokenOptions,
): Promise<Response> {
  const fallbackStaticToken = options?.fallbackStaticToken;
  const bufferBody = options?.bufferBody ?? true;

  // 构造 headers 副本(避免修改入参),删除 host 避免上游冲突
  const headers = new Headers(init.headers);
  headers.delete('host');

  // token 优先级:显式 > 会话 > 动态 > 静态
  // - explicit: 调用方显式设置 Authorization,不覆盖
  // - session: 用户会话 token (imt_*),优先于 admin JWT 实现真实身份透传
  // - dynamic: ragTokenProvider 动态登录的 admin JWT
  // - static: env var HARNESS_INTELLECT_RAG_ADMIN_TOKEN
  // 仅当调用方未显式设置 Authorization 时才注入
  let tokenSource: 'explicit' | 'session' | 'dynamic' | 'static' | 'none' = 'none';
  const existingAuth = headers.get('Authorization');
  if (existingAuth) {
    tokenSource = 'explicit';
  } else if (options?.sessionToken) {
    // 方案 B: 优先用用户会话 token (imt_*),让 intellect-rag 走 imt_ 路径
    // current_user.id == member_id,消除双 ID 体系
    headers.set('Authorization', `Bearer ${options.sessionToken}`);
    tokenSource = 'session';
  } else {
    const dynamicToken = await resolveRagToken();
    if (dynamicToken) {
      headers.set('Authorization', dynamicToken);
      tokenSource = 'dynamic';
    } else if (fallbackStaticToken) {
      headers.set('Authorization', `Bearer ${fallbackStaticToken}`);
      tokenSource = 'static';
    }
  }

  // Buffer body 以支持 401 重试(ReadableStream 单次消费)
  let bodyBuffer: Buffer | undefined;
  if (bufferBody && init.body) {
    if (init.body instanceof ReadableStream) {
      const chunks: Uint8Array[] = [];
      const reader = init.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      bodyBuffer = Buffer.concat(chunks);
    } else if (typeof init.body === 'string') {
      bodyBuffer = Buffer.from(init.body);
    } else if (init.body instanceof Uint8Array) {
      bodyBuffer = Buffer.from(init.body);
    }
  }

  // 显式列出 fetch 需要的字段,避免 `...init` spread 透传 signal/credentials/cache
  // 等不安全或不必要的字段到上游 fetch(调用方可能为下游请求设置的 credentials
  // 不应自动应用到上游 intellect-rag 调用)。
  // 仅保留 method/headers/body,与上游 fetch 语义对齐。
  // body 类型断言:Node Buffer 是 Uint8Array 子类,运行时兼容 BodyInit,
  // 但 TS 严格模式下 Buffer 类型与 DOM BodyInit 不完全匹配,需断言。
  const fetchInit: RequestInit & { duplex?: 'half' } = {
    method: init.method,
    headers,
    body: (bodyBuffer ?? init.body) as BodyInit | null | undefined,
  };
  // duplex 仅在 body 存在时需要(Node fetch stream body 要求)
  if (init.body) {
    fetchInit.duplex = 'half';
  }

  let response = await fetch(url, fetchInit);

  // 401 重试:仅当 token 来自动态 token 时
  // - explicit:调用方自行管理,不重试
  // - static:静态 JWT 过期重试无意义
  // - dynamic:invalidate + 重新 login + 重试一次
  // - none:无 token,重试也无效
  if (response.status === 401 && tokenSource === 'dynamic' && ragTokenProvider.getToken()) {
    ragTokenProvider.invalidate();
    const newToken = await resolveRagToken();
    if (newToken) {
      // 显式构造新的 fetchInit,避免依赖 headers 引用共享的隐式语义。
      // 重试请求使用新 token,其余字段(method/body/duplex)与首次一致。
      // 注意:new Headers(entries) 是 append 语义,headers 已有 Authorization 会追加,
      // 导致 .get() 返回逗号分隔值。需先复制 headers 再 .set() 覆盖。
      const retryHeaders = new Headers(headers);
      retryHeaders.set('Authorization', newToken);
      const retryInit: RequestInit & { duplex?: 'half' } = {
        method: fetchInit.method,
        headers: retryHeaders,
        body: fetchInit.body,
      };
      if (fetchInit.duplex) {
        retryInit.duplex = fetchInit.duplex;
      }
      response = await fetch(url, retryInit);
    }
  }

  return response;
}
