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
import { fetchTenantInfo } from '../../tenant-validator';

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

/**
 * 方案 2 (P2):租户已被禁用或 tenant_id 不一致。
 * errorHandler 转换为 403 响应。
 */
export class TenantDisabledError extends Error {
  readonly status = 403;
  constructor(tenantId: string, reason: string) {
    super(`Tenant "${tenantId}" is not accessible: ${reason}`);
    this.name = 'TenantDisabledError';
  }
}

// ---------------------------------------------------------------------------
// HTTP 客户端
// ---------------------------------------------------------------------------

const REST_TIMEOUT_MS = 30_000;
/** 方案 2:tenant 健康度缓存 TTL(30s),降低 P95 影响 */
const TENANT_CACHE_TTL_MS = 30_000;
/** P2-5:缓存条目上限,防止异常场景下内存无限增长(backend 数量有限,128 足够) */
const TENANT_CACHE_MAX_ENTRIES = 128;

interface TenantCacheEntry {
  valid: boolean;
  reason?: string;
  expiresAt: number;
}

/**
 * intellect-team HTTP 客户端封装。
 * 统一注入鉴权头 + Team/Project 组织隔离头 + 错误转换。
 *
 * 方案 2 (P2):新增 per-request tenant 校验(带 TTL 缓存)。
 * - 缓存 key:`${baseUrl}|${tenantId}`,避免多 backend 实例间共享
 * - 缓存命中:O(1) 检查,不增加 P95
 * - 缓存未命中:调 intellect-team /api/tenant/info,失败时降级放行
 * - 租户被禁用 → 抛 TenantDisabledError,由 errorHandler 转 403
 * - P2-5:缓存大小限制(128 条),超限时清理最早过期条目
 */
export class IntellectEnterpriseHttpClient {
  /** 方案 2:tenant 健康度缓存,实例级隔离 */
  private readonly tenantCache = new Map<string, TenantCacheEntry>();

  constructor(
    private readonly baseUrl: string,
    private readonly apiServerKey: string,
  ) {}

  /**
   * 方案 2:校验 ctx.intellectTenantId 在 intellect-team 侧是否仍有效。
   * - 缓存命中:直接返回/抛错
   * - 缓存未命中:调 /api/tenant/info
   * - endpoint 不可达:降级放行(与 tenant-validator.ts 行为一致)
   */
  private async ensureTenantValid(ctx: BackendContext): Promise<void> {
    if (!ctx.intellectTenantId) return;

    const cacheKey = `${this.baseUrl}|${ctx.intellectTenantId}`;
    const now = Date.now();
    const cached = this.tenantCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      if (!cached.valid) {
        throw new TenantDisabledError(ctx.intellectTenantId, cached.reason ?? 'unknown');
      }
      return;
    }

    // 缓存未命中或已过期:调 intellect-team
    const info = await fetchTenantInfo(this.baseUrl);
    if (!info) {
      // endpoint 不可达 → 降级放行(与 tenant-validator.ts:45 行为一致)
      // 不写入缓存(避免短暂故障导致 30s 内持续拒绝)
      return;
    }

    // tenant_id 不一致 → 拒绝
    if (info.tenant_id && info.tenant_id !== ctx.intellectTenantId) {
      this.setCacheEntry(cacheKey, {
        valid: false,
        reason: `configured="${ctx.intellectTenantId}" != actual="${info.tenant_id}"`,
        expiresAt: now + TENANT_CACHE_TTL_MS,
      });
      throw new TenantDisabledError(ctx.intellectTenantId, `configured="${ctx.intellectTenantId}" != actual="${info.tenant_id}"`);
    }

    // tenant 被禁用 → 拒绝
    if (info.enabled === false) {
      this.setCacheEntry(cacheKey, {
        valid: false,
        reason: 'tenant is disabled (enabled=false)',
        expiresAt: now + TENANT_CACHE_TTL_MS,
      });
      throw new TenantDisabledError(ctx.intellectTenantId, 'tenant is disabled (enabled=false)');
    }

    // 校验通过 → 写入缓存
    this.setCacheEntry(cacheKey, {
      valid: true,
      expiresAt: now + TENANT_CACHE_TTL_MS,
    });
  }

  /**
   * P2-5:写入缓存条目,超限时清理最早过期条目。
   * 策略:超过 MAX_ENTRIES 时,清理过期条目;若仍超限,清理 expiresAt 最小的条目(可能仍未过期)。
   */
  private setCacheEntry(key: string, entry: TenantCacheEntry): void {
    // 容量检查:超限时先清理过期条目
    if (this.tenantCache.size >= TENANT_CACHE_MAX_ENTRIES && !this.tenantCache.has(key)) {
      const now = Date.now();
      // 第一轮:清理已过期条目
      for (const [k, v] of this.tenantCache) {
        if (v.expiresAt <= now) {
          this.tenantCache.delete(k);
        }
      }
      // 第二轮:仍超限 → 清理 expiresAt 最小的条目(可能仍未过期)
      if (this.tenantCache.size >= TENANT_CACHE_MAX_ENTRIES) {
        let oldestKey: string | null = null;
        let oldestExpiry = Infinity;
        for (const [k, v] of this.tenantCache) {
          if (v.expiresAt < oldestExpiry) {
            oldestExpiry = v.expiresAt;
            oldestKey = k;
          }
        }
        if (oldestKey) {
          this.tenantCache.delete(oldestKey);
        }
      }
    }
    this.tenantCache.set(key, entry);
  }

  /**
   * 方案 2:清除 tenant 缓存。
   * 由 AdapterRegistry.invalidate() 调用,管理操作后立即重新校验。
   */
  clearTenantCache(): void {
    this.tenantCache.clear();
  }

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
    // 方案 2:per-request tenant 校验(带 TTL 缓存)
    await this.ensureTenantValid(ctx);

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
    // 方案 2:per-request tenant 校验(带 TTL 缓存),覆盖 SSE 流式请求
    await this.ensureTenantValid(ctx);

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
   * GET SSE 流请求(v1.3.0 新增,用于 /v1/runs/{run_id}/events)。
   *
   * 与 requestStream(POST)的差异:用 GET 方法,无 body。
   * Constitution Principle VIII v1.3.0:GET /v1/runs/{run_id}/events 订阅 SSE 流。
   *
   * @returns ReadableStream<Uint8Array>(SSE 格式)
   * @throws IntellectBackendError 非 2xx
   */
  async requestGetStream(
    path: string,
    ctx: BackendContext,
  ): Promise<ReadableStream<Uint8Array>> {
    // 方案 2:per-request tenant 校验(带 TTL 缓存),覆盖 SSE 流式请求
    await this.ensureTenantValid(ctx);

    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(ctx),
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new IntellectBackendError(
        `GET ${path} → ${response.status}: ${text}`,
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
