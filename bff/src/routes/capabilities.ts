// @see specs/003-harness-admin-capabilities/contracts/harness-admin-api.ts (authority source)
// @see specs/003-harness-admin-capabilities/data-model.md (实体 7)
/**
 * BFF capabilities 路由 — Multi-Harness P2 US2。
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend): 前端经 BFF 路由查询能力,不直连 Intellect RAG
 * - Principle II (Adapter Abstraction): 路由层通过 AdapterRegistry 获取 Adapter,不感知后端类型
 * - Principle V (Tenant Isolation): 必须带 X-Backend-Id + X-User-Id,按 tenant 隔离
 * - Principle VIII (Progressive Enhancement): 前端按 capabilities 条件渲染,无能力降级
 *
 * 路径映射:
 * - GET /capabilities → 返回当前 tenant 绑定后端的 CapabilitiesResponse
 *
 * 挂载点:index.ts 注册到 `/api/bff/capabilities`(Vite rewrite 后 BFF 收到 /capabilities)。
 * 中间件链:authMiddleware(全局)→ backendContextMiddleware(注入 tenantId/userId)→ route
 */

import { Hono } from 'hono';
import type { HarnessStore } from '../types/stores';
import type { BackendStore } from '../types/stores';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import type { CapabilitiesResponse } from '../types/harness-admin';
import { getBackendContext, BACKEND_CONTEXT_KEY } from '../middleware/backend-context';
import type { Context } from 'hono';
import {
  TenantNotFoundError,
  BackendNotConfiguredError,
  AdapterFactoryNotRegisteredError,
  RegistryNotReadyError,
} from '../services/adapter-registry-errors';

interface CapabilitiesVariables {
  harnessStore: HarnessStore;
  backendStore: BackendStore;
  adapterRegistry: IAdapterRegistry;
  [BACKEND_CONTEXT_KEY]?: { backendId: string; userId: string };
}

export const capabilitiesRoutes = new Hono<{ Variables: CapabilitiesVariables }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok<T>(data: T, message = 'success') {
  return { code: 0, message, data };
}

function fail(code: number, message: string) {
  return { code, message, data: null };
}

function getRegistry(c: Context): IAdapterRegistry {
  return c.get('adapterRegistry');
}

// ---------------------------------------------------------------------------
// GET /capabilities — 查询当前 tenant 后端能力
// ---------------------------------------------------------------------------

capabilitiesRoutes.get('/capabilities', async (c) => {
  const ctx = getBackendContext(c);
  if (!ctx) {
    // 中间件未注入(理论上 backendContextMiddleware 已拦截,此处防御性兜底)
    return c.json(fail(400, 'Missing X-Backend-Id / X-User-Id header'), 400);
  }
  const tenantId = ctx.backendId;

  const registry = getRegistry(c);

  // Registry 未就绪(Store 未加载完成)
  if (!registry.isReady()) {
    return c.json(fail(503, 'Registry not ready, please retry later'), 503);
  }

  let adapter;
  try {
    adapter = registry.getAdapterForBackend(tenantId);
  } catch (err) {
    if (err instanceof TenantNotFoundError) {
      return c.json(fail(404, `Tenant not found: ${tenantId}`), 404);
    }
    if (err instanceof BackendNotConfiguredError) {
      // tenant 存在但绑定的 backendId 不在 HarnessStore(配置不一致)
      // 503:配置/基础设施问题(与 canvas.ts 保持一致)
      return c.json(
        fail(503, `Backend not configured for tenant: ${(err as Error).message}`),
        503,
      );
    }
    if (err instanceof AdapterFactoryNotRegisteredError) {
      return c.json(
        fail(500, `Adapter factory not registered: ${(err as Error).message}`),
        500,
      );
    }
    if (err instanceof RegistryNotReadyError) {
      return c.json(fail(503, 'Registry not ready'), 503);
    }
    throw err; // 未知错误由 errorHandler 处理
  }

  // 调用 Adapter 查询能力(P0 静态返回,P3 动态探测)
  const capabilities = await adapter.discoverCapabilities();

  // 构造响应:补全 backend 元信息(从 Adapter.backendId 反查)
  const harnessStore = c.get('harnessStore');
  const backend = harnessStore.get(adapter.backendId);
  if (!backend) {
    return c.json(
      fail(500, `Backend config not found for id: ${adapter.backendId}`),
      500,
    );
  }

  const response: CapabilitiesResponse = {
    backendId: backend.id,
    backendName: backend.name,
    backendType: backend.type,
    capabilities,
  };

  return c.json(ok(response));
});
