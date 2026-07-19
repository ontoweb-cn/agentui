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
  CanvasBackendNotBoundError,
  InvalidCanvasBackendError,
} from './adapter-registry-errors';
import type { HarnessAdapterFactory, IAdapterRegistry } from './adapter-registry-types';
import { IntellectRagAdapter } from './adapters/intellect-rag/intellect-rag-adapter';

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

  /**
   * spec-008:按租户解析画布后端,返回 IntellectRagAdapter。
   *
   * Constitution Principle III (Canvas Hard-Bound): 画布永远走 Intellect RAG,
   * 返回类型 IntellectRagAdapter(非 IHarnessAdapter),类型签名落实 hard-bound。
   *
   * Resolution flow (research.md R3):
   * 1. tenant = tenantStore.getTenant(tenantId)
   * 2. if tenant.canvasBackendId: getAdapterForBackend + instanceof 断言
   * 3. if !canvasBackendId:
   *      if tenantId === 'default': 回退首个 intellect-rag backend
   *      else: throw CanvasBackendNotBoundError
   */
  getCanvasBackendForTenant(tenantId: string): IntellectRagAdapter {
    if (!this.isReady()) {
      throw new RegistryNotReadyError();
    }

    const tenant = this.tenantStore.getTenant(tenantId);

    // 有显式 canvasBackendId:直接按 backendId 获取,断言类型
    if (tenant?.canvasBackendId) {
      const adapter = this.getAdapterForBackend(tenant.canvasBackendId);
      if (!(adapter instanceof IntellectRagAdapter)) {
        const backend = this.harnessStore.get(tenant.canvasBackendId);
        throw new InvalidCanvasBackendError(
          tenantId,
          tenant.canvasBackendId,
          backend?.type ?? 'unknown',
        );
      }
      return adapter;
    }

    // 无 canvasBackendId:default 租户回退首个 intellect-rag backend
    if (tenantId === 'default') {
      const backends = this.harnessStore.list();
      const ragBackend = backends.find(
        (b: { type: string }) => b.type === 'intellect-rag',
      );
      if (!ragBackend) {
        throw new CanvasBackendNotBoundError(tenantId);
      }
      const adapter = this.getAdapterForBackend(ragBackend.id);
      if (!(adapter instanceof IntellectRagAdapter)) {
        throw new InvalidCanvasBackendError(
          tenantId,
          ragBackend.id,
          ragBackend.type,
        );
      }
      return adapter;
    }

    // 租户不存在(非 default 且 tenantStore 中找不到)
    if (!tenant) {
      throw new TenantNotFoundError(tenantId);
    }

    // 企业版租户未绑定画布
    throw new CanvasBackendNotBoundError(tenantId);
  }
}
