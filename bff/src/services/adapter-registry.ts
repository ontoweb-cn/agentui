// @see specs/002-multi-harness-p1/contracts/adapter-registry.ts (authority source)
// @see specs/002-multi-harness-p1/data-model.md (实体 2)
/**
 * AdapterRegistry — Adapter 注册中心。
 *
 * Authority source: specs/002-multi-harness-p1/contracts/adapter-registry.ts
 * Runtime: bff/src/services/adapter-registry.ts
 *
 * Constitution references (v1.2.0):
 * - Principle II (Adapter Abstraction): Registry 按 tenantId 选择 Adapter,路由层不感知后端
 * - Principle III (Canvas Hard-Bound): getAdapterForBackend 用于 canvas 硬绑定场景
 * - Principle V (Tenant Isolation): 通过 TenantStore 查询绑定关系
 *
 * P1: 单后端(intellect-rag)
 * P3: 多后端切换(intellect-rag + intellect-enterprise)
 */

import type { IHarnessAdapter } from '../types/adapter';
import type { HarnessBackend, BackendType } from '../types/harness';
import type { HarnessStore, TenantStore } from '../types/stores';
import {
  TenantNotFoundError,
  BackendNotConfiguredError,
  AdapterFactoryNotRegisteredError,
  RegistryNotReadyError,
} from './adapter-registry-errors';
import type { HarnessAdapterFactory, IAdapterRegistry } from './adapter-registry-types';

export class AdapterRegistry implements IAdapterRegistry {
  private readonly harnessStore: HarnessStore;
  private readonly tenantStore: TenantStore;
  private readonly adapterCache = new Map<string, IHarnessAdapter>();
  private readonly factories = new Map<BackendType, HarnessAdapterFactory>();

  constructor(harnessStore: HarnessStore, tenantStore: TenantStore) {
    this.harnessStore = harnessStore;
    this.tenantStore = tenantStore;
  }

  registerFactory(backendType: BackendType, factory: HarnessAdapterFactory): void {
    this.factories.set(backendType, factory);
  }

  isReady(): boolean {
    // Store 已加载完成:HarnessStore.list() 返回非空(或至少 load 已执行)。
    // P1 简化:若 list() 为空视为未就绪(env token 缺失或未 load)。
    return this.harnessStore.list().length > 0;
  }

  getAdapterForTenant(tenantId: string): IHarnessAdapter {
    if (!this.isReady()) {
      throw new RegistryNotReadyError();
    }

    const tenant = this.tenantStore.getTenant(tenantId);
    if (!tenant) {
      throw new TenantNotFoundError(tenantId);
    }

    const backendId = tenant.intellectBackendId;
    return this.getAdapterForBackend(backendId);
  }

  getAdapterForBackend(backendId: string): IHarnessAdapter {
    // 复用缓存(同 backendId 同实例)
    const cached = this.adapterCache.get(backendId);
    if (cached) {
      return cached;
    }

    const backend = this.harnessStore.get(backendId);
    if (!backend) {
      throw new BackendNotConfiguredError(backendId);
    }

    const factory = this.factories.get(backend.type);
    if (!factory) {
      throw new AdapterFactoryNotRegisteredError(backend.type);
    }

    const adapter = factory(backend);
    this.adapterCache.set(backendId, adapter);
    return adapter;
  }

  /**
   * P2 新增:失效缓存的 Adapter 实例。
   *
   * 后端配置变更(CRUD)后调用,下次 getAdapterForTenant/getAdapterForBackend
   * 创建新实例(用最新 HarnessBackend 配置)。
   *
   * @param backendId 可选,不传清空整个缓存,传则只移除该条目
   */
  invalidate(backendId?: string): void {
    if (backendId === undefined) {
      this.adapterCache.clear();
    } else {
      this.adapterCache.delete(backendId);
    }
  }
}
