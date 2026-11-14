// hiedu 传输客户端工厂(shared 层):两个宿主以配置注入各自通道——
//  - hiedu-web: 同源/子路径(VITE_API_BASE_PATH)+ X-Backend-Id 租户头
//  - agentui:  /api/bff/hiedu 断言代理(无租户头)
// 契约(复用方案评审 §8.2):① basePath 在本层拼接,资源方法传裸路径(防双重前缀);
// ② extraHeaders 每请求求值;③ 401 继续派发 UNAUTHORIZED_EVENT(宿主监听零改动);
// ④ 宿主环境读取(import.meta.env、localStorage、SSO 深链)不得进 shared;
//    浏览器平台 API(事件派发/超时/Blob 下载)属传输本体,允许在本层使用。

import { ApiError, ApiResult, QueryParams } from './contract';

/** 统一认证会话失效事件;宿主监听并切换到未登录态。 */
export const UNAUTHORIZED_EVENT = 'hiedu:unauthorized';

export interface HieduClientConfig {
  /** API 基址前缀:独立门户 '' 或 VITE_API_BASE_PATH;agentui '/api/bff/hiedu'。 */
  basePath: string;
  /** 每请求求值的附加头(如租户 X-Backend-Id);返回空对象表示无。 */
  extraHeaders?: () => Record<string, string>;
  /** 请求超时毫秒;缺省 60s。 */
  timeoutMs?: number;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  params?: QueryParams;
  /** 强校验 If-Match(来自上一次 GET 的 ETag)。 */
  ifMatch?: string;
}

export interface HieduClient {
  requestJSON<T>(path: string, options?: RequestOptions): Promise<ApiResult<T>>;
  /** 触发浏览器下载;path 为裸路径,基址在本方法内部拼接。 */
  downloadFile(path: string, fallbackName: string): Promise<void>;
  /** 纯 URL 拼接(query 编码),供需要动态 query 的下载方法使用(裸路径)。 */
  buildURL(path: string, params?: QueryParams): string;
}

export function createHieduClient(config: HieduClientConfig): HieduClient {
  const apiBase = config.basePath.replace(/\/+$/, '');
  // basePath 形态守卫(评审 R2):只允许空串或以单个 / 开头的站内路径——
  // 拒绝 '//host'(协议相对跨源)与绝对 URL,防止 credentials:'include' 被引向外部源。
  if (apiBase !== '' && !/^\/[^/]/.test(apiBase)) {
    throw new Error(`hiedu client: basePath must be an in-site path, got: ${JSON.stringify(config.basePath)}`);
  }
  const timeoutMs = config.timeoutMs ?? 60_000;

  function withBase(path: string): string {
    return apiBase ? apiBase + path : path;
  }

  function baseHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'X-Request-Id': createRequestId(),
      ...(config.extraHeaders ? config.extraHeaders() : {}),
    };
  }

  function buildURL(path: string, params?: QueryParams): string {
    if (!params) return path;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      search.append(key, String(value));
    }
    const query = search.toString();
    return query ? path + '?' + query : path;
  }

  async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError(0, '请求超时，请稍后重试', 'timeout');
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function requestJSON<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
    const method = options.method ?? 'GET';
    const headers = baseHeaders();
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.ifMatch) {
      headers['If-Match'] = options.ifMatch;
    }

    const response = await fetchWithTimeout(buildURL(withBase(path), options.params), {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      }
      const body = payload as ErrorBody | null;
      throw new ApiError(
        response.status,
        body?.error || '请求失败（HTTP ' + response.status + '）',
        body?.code,
      );
    }

    const rawTotal = response.headers.get('X-Total-Count');
    const total = rawTotal && /^\d+$/.test(rawTotal) ? Number(rawTotal) : null;

    return {
      data: payload as T,
      total,
      status: response.status,
      etag: response.headers.get('ETag'),
    };
  }

  function fileNameFrom(response: Response, fallback: string): string {
    const disposition = response.headers.get('Content-Disposition') || '';
    const match =
      /filename\*=UTF-8''([^;]+)/i.exec(disposition) || /filename="?([^";]+)"?/i.exec(disposition);
    if (!match) return fallback;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return fallback;
    }
  }

  /** 以 fetch + Blob 触发下载:需要携带租户头,因此不能直接用 <a href>。 */
  async function downloadFile(path: string, fallbackName: string): Promise<void> {
    const headers = { ...baseHeaders(), Accept: '*/*' };
    const response = await fetch(withBase(path), { credentials: 'include', cache: 'no-store', headers });
    if (!response.ok) {
      if (response.status === 401) {
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      }
      throw new ApiError(response.status, '下载失败（HTTP ' + response.status + '）');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileNameFrom(response, fallbackName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return { requestJSON, downloadFile, buildURL };
}

interface ErrorBody {
  error?: string;
  code?: string;
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 兼容不支持 randomUUID 的环境。
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const random = Math.floor(Math.random() * 16);
    const value = ch === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
