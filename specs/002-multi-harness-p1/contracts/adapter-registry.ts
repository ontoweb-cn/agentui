/**
 * Contract: AdapterRegistry + TenantContext Middleware (P1 新增)
 *
 * Authority source: specs/002-multi-harness-p1/contracts/adapter-registry.ts
 * Runtime copy: bff/src/services/adapter-registry.ts + bff/src/middlewares/tenant-context.ts (P1 实现)
 *
 * Constitution references (v1.1.0):
 * - Principle II (Adapter Abstraction): Registry 按 tenantId 选择 Adapter,路由层不感知具体后端
 * - Principle V (Tenant Isolation): TenantContext 中间件构造租户上下文,Adapter 据此注入 Team/Project 组织隔离头
 *
 * Implementation lifecycle:
 * - P0: not implemented
 * - P1: AdapterRegistry (单后端 intellect-rag) + TenantContext 中间件 (X-Tenant-Id header)
 * - P3: AdapterRegistry 扩展多后端切换 + TenantContext 中间件扩展 JWT 解析
 */

import type { IHarnessAdapter } from './harness-adapter';
import type { HarnessBackend, BackendType } from './harness';
import type { TenantContext } from './tenant';

// ---------------------------------------------------------------------------
// AdapterRegistry
// ---------------------------------------------------------------------------

/**
 * Adapter 注册中心。
 * 根据 tenantId 查询 TenantStore 绑定关系,从 HarnessStore 获取后端配置,创建/复用 Adapter 实例。
 *
 * P1: 单后端(intellect-rag)场景
 * P3: 多后端切换(intellect-rag + intellect-enterprise)
 */
export interface IAdapterRegistry {
  /**
   * 按 tenantId 获取 Adapter。
   * 查 TenantStore → intellectBackendId → HarnessStore → backend → Adapter
   *
   * @param tenantId 租户 ID
   * @returns Adapter 实例(复用,不重复创建)
   * @throws TenantNotFoundError tenantId 不存在
   * @throws BackendNotConfiguredError tenant 绑定的 backendId 不存在
   * @throws AdapterFactoryNotRegisteredError backendType 无对应 factory
   * @throws RegistryNotReadyError Store 未加载完成
   */
  getAdapterForTenant(tenantId: string): IHarnessAdapter;

  /**
   * 按 backendId 直接获取 Adapter(用于 canvas 硬绑定场景,Principle III)。
   *
   * @param backendId 后端 ID
   * @returns Adapter 实例
   */
  getAdapterForBackend(backendId: string): IHarnessAdapter;

  /**
   * 注册后端类型对应的 Adapter 工厂。
   * P1 注册 'intellect-rag' → IntellectRagAdapterFactory
   * P3 注册 'intellect-enterprise' → IntellectEnterpriseAdapterFactory
   */
  registerFactory(backendType: BackendType, factory: HarnessAdapterFactory): void;

  /**
   * Store 是否已加载完成。
   * 未就绪时路由层应返回 503。
   */
  isReady(): boolean;
}

/**
 * Adapter 工厂函数签名。
 * Registry 调用此工厂创建 Adapter 实例。
 */
export type HarnessAdapterFactory = (backend: HarnessBackend) => IHarnessAdapter;

// ---------------------------------------------------------------------------
// Registry 错误类型
// ---------------------------------------------------------------------------

export class TenantNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`Tenant not found: ${tenantId}`);
    this.name = 'TenantNotFoundError';
  }
}

export class BackendNotConfiguredError extends Error {
  constructor(backendId: string) {
    super(`Backend not configured: ${backendId}`);
    this.name = 'BackendNotConfiguredError';
  }
}

export class AdapterFactoryNotRegisteredError extends Error {
  constructor(backendType: BackendType) {
    super(`Adapter factory not registered for backend type: ${backendType}`);
    this.name = 'AdapterFactoryNotRegisteredError';
  }
}

export class RegistryNotReadyError extends Error {
  constructor() {
    super('AdapterRegistry not ready: stores not loaded');
    this.name = 'RegistryNotReadyError';
  }
}

// ---------------------------------------------------------------------------
// TenantContext Middleware (Hono)
// ---------------------------------------------------------------------------

/**
 * Hono 中间件: 从请求提取 tenantId/userId 构造 TenantContext,注入 context。
 *
 * P1: 从 X-Tenant-Id / X-User-Id header 提取
 * P3: 优先从 JWT 提取,header 作为 fallback
 *
 * 行为:
 * - 提取 tenantId/userId → 构造 TenantContext → c.set('tenantContext', ctx) → next()
 * - tenantId 缺失 → 返回 400 明确错误(不静默使用默认 tenant)
 */
export type TenantContextMiddleware = (
  c: {
    req: { header(name: string): string | undefined };
    set(key: 'tenantContext', value: TenantContext): void;
    json(body: unknown, status?: number): unknown;
  },
  next: () => Promise<void>,
) => Promise<unknown | void>;
