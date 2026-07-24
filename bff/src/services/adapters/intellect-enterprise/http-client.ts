// @see specs/004-intellect-enterprise-adapter/data-model.md (实体 2)
/**
 * IntellectEnterprise HTTP 客户端 + 错误类型。
 *
 * Authority source: specs/004-intellect-enterprise-adapter/data-model.md
 * Runtime: bff/src/services/adapters/intellect-enterprise/http-client.ts
 *
 * Constitution references (v1.2.0):
 * - Principle V (Tenant Isolation): 注入 X-Intellect-Team / X-Intellect-Project 头
 * - Principle VIII (BFF ↔ Intellect Enterprise Access Contract): 鉴权用 API_SERVER_KEY
 * - Principle VII (YAGNI + Test-First): 错误转换集中在此,Adapter 方法不重复处理
 */

import type { BackendContext } from '../../../types/tenant';

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/**
 * intellect-team 资源不存在(404)。
 * Adapter 层捕获后按方法降级(listMessages 返回空数组)。
 */
export class IntellectNotFoundError extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = 'IntellectNotFoundError';
  }
}

/**
 * intellect-team 后端错误(5xx / 网络错误 / 超时)。
 */
export class IntellectBackendError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'IntellectBackendError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// HTTP 客户端
// ---------------------------------------------------------------------------

const REST_TIMEOUT_MS = 30_000;

/**
 * intellect-team HTTP 客户端封装。
 * 统一注入鉴权头 + Team/Project 组织隔离头 + 错误转换。
 */
export class IntellectEnterpriseHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiServerKey: string,
  ) {}

  /**
   * REST 请求(30s 超时)。
   * @throws IntellectNotFoundError 404
   * @throws IntellectBackendError 5xx / 网络错误 / 超时
   */
  async request<T>(
    method: string,
    path: string,
    ctx: BackendContext,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        headers: this.buildHeaders(ctx),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (response.status === 404) {
        throw new IntellectNotFoundError(`${method} ${path} → 404`);
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new IntellectBackendError(
          `${method} ${path} → ${response.status}: ${text}`,
          response.status,
        );
      }

      // 204 或 DELETE 可能无 body
      if (response.status === 204 || method === 'DELETE') {
        return undefined as T;
      }
      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof IntellectNotFoundError || err instanceof IntellectBackendError) {
        throw err;
      }
      if (
        err &&
        typeof err === 'object' &&
        (err as { name?: string }).name === 'AbortError'
      ) {
        throw new IntellectBackendError(`${method} ${path} timeout`, 408);
      }
      // 网络错误(fetch rejected)
      throw new IntellectBackendError(
        `${method} ${path} network error: ${(err as Error).message}`,
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * SSE 流请求(不超时,流式长连接)。
   * @returns ReadableStream<Uint8Array>(SSE 格式)
   * @throws IntellectBackendError 非 2xx
   */
  async requestStream(
    path: string,
    ctx: BackendContext,
    body: unknown,
  ): Promise<ReadableStream<Uint8Array>> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(ctx),
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new IntellectBackendError(
        `POST ${path} → ${response.status}: ${text}`,
        response.status,
      );
    }
    return response.body;
  }

  /**
   * 构建请求头(Constitution Principle V + VIII)。
   * 注入:Authorization(API_SERVER_KEY)+ X-Intellect-Team/Project(可选)+ Content-Type。
   */
  private buildHeaders(ctx: BackendContext): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiServerKey) {
      headers['Authorization'] = `Bearer ${this.apiServerKey}`;
    }
    // BFF-P0-1: 注入解析后的 member_id 为 X-Intellect-User header。
    // 让下游 intellect-rag-app 在 KB/Chunk 创建时设置正确的 owner_user_id。
    // 安全: member_id 来自服务端 token→/api/members/me 解析,非客户端 X-User-Id header。
    if (ctx.intellectUserId) {
      headers['X-Intellect-User'] = ctx.intellectUserId;
    }
    // Principle V:Team/Project 组织隔离头,仅在 BackendContext 提供时注入
    // (注意:真正的租户隔离通过多实例部署实现,非此头)
    if (ctx.intellectTeamId) {
      headers['X-Intellect-Team'] = ctx.intellectTeamId;
    }
    if (ctx.intellectProjectId) {
      headers['X-Intellect-Project'] = ctx.intellectProjectId;
    }
    if (ctx.intellectSessionId) {
      headers['X-Intellect-Session-Id'] = ctx.intellectSessionId;
    }
    if (ctx.intellectSessionKey) {
      headers['X-Intellect-Session-Key'] = ctx.intellectSessionKey;
    }
    return headers;
  }
}
