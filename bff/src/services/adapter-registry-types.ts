// @see specs/002-multi-harness-p1/contracts/adapter-registry.ts (authority source)
/**
 * AdapterRegistry shared types: factory + registry interface.
 *
 * Authority source: specs/002-multi-harness-p1/contracts/adapter-registry.ts
 * Runtime copy: bff/src/services/adapter-registry-types.ts
 *
 * Constitution references (v1.2.0):
 * - Principle II (Adapter Abstraction): Registry 按 tenantId 选择 Adapter,路由层不感知后端
 */

import type { IHarnessAdapter } from '../types/adapter';
import type { HarnessBackend, BackendType } from '../types/harness';
import type { IntellectRagAdapter } from './adapters/intellect-rag/intellect-rag-adapter';

/**
 * Adapter 工厂函数签名。
 * Registry 调用此工厂创建 Adapter 实例。
 * P1 注册 'intellect-rag' → IntellectRagAdapterFactory
 * P3 注册 'intellect-enterprise' → IntellectEnterpriseAdapterFactory
 */
export type HarnessAdapterFactory = (backend: HarnessBackend) => IHarnessAdapter;

/**
 * Adapter 注册中心契约。
 * 根据 tenantId 查询 BackendStore 绑定关系,从 HarnessStore 获取后端配置,创建/复用 Adapter 实例。
 *
 * P1: 单后端(intellect-rag)场景
 * P2: 新增 invalidate 方法,后端配置变更后失效缓存
 * P3: 多后端切换(intellect-rag + intellect-enterprise)
 */
export interface IAdapterRegistry {
  /**
   * 按 tenantId 获取 Adapter。
   * 查 BackendStore → intellectBackendId → HarnessStore → backend → Adapter
   *
   * @throws TenantNotFoundError tenantId 不存在
   * @throws BackendNotConfiguredError tenant 绑定的 backendId 不存在
   * @throws AdapterFactoryNotRegisteredError backendType 无对应 factory
   * @throws RegistryNotReadyError Store 未加载完成
   */
  getAdapterForBackend(tenantId: string): IHarnessAdapter;

  /**
   * 按 backendId 直接获取 Adapter(用于 canvas 硬绑定场景,Constitution Principle III)。
   */
  getAdapterForBackend(backendId: string): IHarnessAdapter;

  /**
   * 注册后端类型对应的 Adapter 工厂。
   */
  registerFactory(backendType: BackendType, factory: HarnessAdapterFactory): void;

  /**
   * Store 是否已加载完成。未就绪时路由层应返回 503。
   */
  isReady(): boolean;

  /**
   * P2 新增:失效缓存的 Adapter 实例。
   *
   * 后端配置变更(CRUD)后调用,下次 getAdapterForBackend/getAdapterForBackend
   * 创建新实例(用最新 HarnessBackend 配置)。
   *
   * @param backendId 可选,不传清空整个缓存,传则只移除该条目
   */
  invalidate(backendId?: string): void;

  /**
   * spec-008 新增:按租户解析画布后端,返回 IntellectRagAdapter。
   *
   * Constitution Principle III (Canvas Hard-Bound): 画布永远走 Intellect RAG,
   * 返回类型 IntellectRagAdapter(非 IHarnessAdapter),类型签名落实 hard-bound。
   *
   * Resolution flow (research.md R3):
   * 1. tenant = backendStore.getBackend(tenantId)
   * 2. if tenant.canvasBackendId: getAdapterForBackend + instanceof 断言
   * 3. if !canvasBackendId:
   *      if tenantId === 'default': 回退首个 intellect-rag backend
   *      else: throw CanvasBackendNotBoundError
   *
   * @throws CanvasBackendNotBoundError 企业版租户未绑定画布后端
   * @throws InvalidCanvasBackendError canvasBackendId 指向非 intellect-rag 后端
   * @throws BackendNotConfiguredError canvasBackendId 在 HarnessStore 不存在
   * @throws RegistryNotReadyError Store 未加载完成
   *
   * spec-010 v8 A1-4 命名遗留说明(D1 决策:不重命名):
   * 参数名 `tenantId` 实际接收 `ctx.backendId`(即 BffTenant.id),与参数名语义不符。
   * spec-010 v8 沿用此签名不重命名,避免破坏 spec-008 已发布契约(零契约变更)。
   * 若未来 spec-008 发布破坏性版本,可考虑重命名为 getCanvasBackendForTenant(tenantId)。
   */
  getCanvasBackendForBackend(tenantId: string): IntellectRagAdapter;
}
