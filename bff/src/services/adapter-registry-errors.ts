// @see specs/002-multi-harness-p1/contracts/adapter-registry.ts (authority source)
/**
 * AdapterRegistry error types.
 *
 * Authority source: specs/002-multi-harness-p1/contracts/adapter-registry.ts
 * Runtime copy: bff/src/services/adapter-registry-errors.ts
 *
 * Constitution references (v1.2.0):
 * - Principle II (Adapter Abstraction): Registry 按 tenantId 选择 Adapter,路由层不感知后端
 * - Principle V (Tenant Isolation): tenantId 不存在时抛 TenantNotFoundError,不静默
 */

/**
 * tenantId 在 TenantStore 中不存在。
 */
export class TenantNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`Tenant not found: ${tenantId}`);
    this.name = 'TenantNotFoundError';
  }
}

/**
 * Tenant 绑定的 backendId 在 HarnessStore 中不存在(配置不一致)。
 */
export class BackendNotConfiguredError extends Error {
  constructor(backendId: string) {
    super(`Backend not configured: ${backendId}`);
    this.name = 'BackendNotConfiguredError';
  }
}

/**
 * backendType 无对应 Adapter 工厂(未注册)。
 */
export class AdapterFactoryNotRegisteredError extends Error {
  constructor(backendType: string) {
    super(`Adapter factory not registered for backend type: ${backendType}`);
    this.name = 'AdapterFactoryNotRegisteredError';
  }
}

/**
 * Store 未加载完成,Registry 不可用。
 * 路由层应返回 503。
 */
export class RegistryNotReadyError extends Error {
  constructor() {
    super('AdapterRegistry not ready: stores not loaded');
    this.name = 'RegistryNotReadyError';
  }
}
