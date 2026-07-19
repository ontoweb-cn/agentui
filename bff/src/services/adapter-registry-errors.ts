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

// ---------------------------------------------------------------------------
// spec-008: CanvasService 专属错误(Constitution Principle III + V)
// ---------------------------------------------------------------------------

/**
 * 租户未绑定画布后端(canvasBackendId 未设置且 tenantId !== 'default')。
 * 路由层返回 503。
 */
export class CanvasBackendNotBoundError extends Error {
  constructor(tenantId: string) {
    super(`Tenant ${tenantId} has no canvas backend bound`);
    this.name = 'CanvasBackendNotBoundError';
  }
}

/**
 * 租户绑定的 canvasBackendId 指向非 intellect-rag 类型的后端。
 * Constitution Principle III: 画布硬绑定 IntellectRagAdapter。
 * 路由层返回 503。
 */
export class InvalidCanvasBackendError extends Error {
  constructor(tenantId: string, backendId: string, actualType: string) {
    super(`Tenant ${tenantId} canvas backend ${backendId} has invalid type ${actualType}, expected intellect-rag`);
    this.name = 'InvalidCanvasBackendError';
  }
}
