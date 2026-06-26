// @see specs/003-harness-admin-capabilities/contracts/harness-admin-api.ts (authority source)
// @see specs/003-harness-admin-capabilities/data-model.md (实体 6)
/**
 * BFF harness-admin 路由 — Multi-Harness P2 US1。
 *
 * Constitution references (v1.2.0):
 * - Principle I (BFF-Mediated Frontend): 前端经 BFF Admin 路由管理后端配置
 * - Principle V (Tenant Isolation): Admin 路由非租户隔离(运维全局操作)
 * - Token Security: 任何响应不含 adminToken 明文,只含 adminTokenEnvVar 引用
 *
 * 路径映射:
 * - GET    /admin/harness-backends            → list 所有配置 + ready 状态
 * - POST   /admin/harness-backends            → 新增(校验 + saveConfig + load + invalidate)
 * - PUT    /admin/harness-backends/:id        → 编辑(id 只读,校验 + saveConfig + load + invalidate)
 * - DELETE /admin/harness-backends/:id        → 删除(校验绑定 + saveConfig + invalidate)
 *
 * 挂载点:index.ts 注册到 `/api/bff/admin/harness-backends`(Vite rewrite 后 BFF 收到 /admin/harness-backends)。
 * 鉴权:authMiddleware(在 index.ts 全局挂载到 /admin/*,或路由内显式)
 */

import { Hono, type Context } from 'hono';
import type { HarnessStore } from '../types/stores';
import type { TenantStore } from '../types/stores';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import type { HarnessStoreListConfigs, HarnessBackendWithStatus, HarnessBackendForm } from '../types/harness-admin';
import type { HarnessBackendConfig } from '../types/harness';
import { validateForm, firstError } from '../services/harness-admin-validation';

interface HarnessAdminVariables {
  harnessStore: HarnessStore;
  tenantStore: TenantStore;
  adapterRegistry: IAdapterRegistry;
}

export const harnessAdminRoutes = new Hono<{ Variables: HarnessAdminVariables }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 从 Hono context 获取带 listConfigs 方法的 HarnessStore。
 * P2 扩展了 listConfigs(JSONFileHarnessStore 实现了 HarnessStoreListConfigs)。
 */
function getStore(c: Context): HarnessStore & HarnessStoreListConfigs {
  const store = c.get('harnessStore');
  // P2:JSONFileHarnessStore 已实现 listConfigs,断言为联合类型
  return store as HarnessStore & HarnessStoreListConfigs;
}

function getTenantStore(c: Context): TenantStore {
  return c.get('tenantStore');
}

function getRegistry(c: Context): IAdapterRegistry {
  return c.get('adapterRegistry');
}

/**
 * 将 HarnessBackendConfig + ready 状态合成 HarnessBackendWithStatus。
 * ready = HarnessStore.list() 中是否含该 backendId(env token 就绪)。
 */
function withStatus(
  config: HarnessBackendConfig,
  readyBackends: { id: string }[],
): HarnessBackendWithStatus {
  const ready = readyBackends.some((b) => b.id === config.id);
  return { ...config, ready };
}

/**
 * 标准响应封装,与 admin.ts 一致。
 */
function ok<T>(data: T, message = 'success') {
  return { code: 0, message, data };
}

function fail(code: number, message: string) {
  return { code, message, data: null };
}

/**
 * 检查 backendId 是否被任何 tenant 绑定(intellectBackendId 或 canvasBackendId)。
 */
function isBackendBound(
  tenantStore: TenantStore,
  backendId: string,
): { bound: boolean; tenantId?: string } {
  for (const tenant of tenantStore.listTenants()) {
    if (tenant.intellectBackendId === backendId) {
      return { bound: true, tenantId: tenant.id };
    }
    if (tenant.canvasBackendId === backendId) {
      return { bound: true, tenantId: tenant.id };
    }
  }
  return { bound: false };
}

// ---------------------------------------------------------------------------
// GET /admin/harness-backends — 列表(含 ready 状态,不含 token 明文)
// ---------------------------------------------------------------------------

harnessAdminRoutes.get('/admin/harness-backends', (c) => {
  const store = getStore(c);
  const configs = store.listConfigs();
  const readyBackends = store.list(); // 仅就绪(含 token,但下面只用 id)
  const data = configs.map((cfg) => withStatus(cfg, readyBackends));
  return c.json(ok(data));
});

// ---------------------------------------------------------------------------
// POST /admin/harness-backends — 新增
// ---------------------------------------------------------------------------

harnessAdminRoutes.post('/admin/harness-backends', async (c) => {
  const store = getStore(c);
  const tenantStore = getTenantStore(c);
  const registry = getRegistry(c);

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json(fail(400, 'Request body must be JSON'), 400);
  }

  // id 必填(新增时)
  if (!body.id) {
    return c.json(fail(400, 'id is required for create'), 400);
  }

  // id 唯一性校验
  const existing = store.listConfigs();
  if (existing.some((cfg) => cfg.id === body.id)) {
    return c.json(fail(409, `Backend id "${body.id}" 已存在`), 409);
  }

  // 表单校验
  const result = validateForm(body);
  if (!result.valid) {
    return c.json(fail(400, firstError(result)), 400);
  }

  const form = body as HarnessBackendForm;

  // 构造 HarnessBackendConfig(不含 token)
  const newConfig: HarnessBackendConfig = {
    id: form.id,
    name: form.name,
    type: form.type,
    endpoint: form.endpoint,
    adminTokenEnvVar: form.adminTokenEnvVar,
    capabilities: form.capabilities,
    ...(form.defaultForTenant !== undefined ? { defaultForTenant: form.defaultForTenant } : {}),
  };

  // 持久化 + 热加载 + 缓存失效
  const nextConfigs = [...existing, newConfig];
  try {
    await store.saveConfig(nextConfigs);
    await store.load();
  } catch (err) {
    return c.json(
      fail(500, `Failed to persist config: ${(err as Error).message}`),
      500,
    );
  }
  registry.invalidate(newConfig.id); // 新后端无缓存,no-op,统一调用

  const readyBackends = store.list();
  return c.json(ok(withStatus(newConfig, readyBackends)));
});

// ---------------------------------------------------------------------------
// PUT /admin/harness-backends/:id — 编辑(id 只读,用路径参数)
// ---------------------------------------------------------------------------

harnessAdminRoutes.put('/admin/harness-backends/:id', async (c) => {
  const store = getStore(c);
  const registry = getRegistry(c);
  const id = c.req.param('id');

  const existing = store.listConfigs();
  const idx = existing.findIndex((cfg) => cfg.id === id);
  if (idx < 0) {
    return c.json(fail(404, `Backend id "${id}" 不存在`), 404);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json(fail(400, 'Request body must be JSON'), 400);
  }

  // 编辑时 body.id 忽略(用路径参数),构造校验对象
  const formToValidate = { ...body, id };
  const result = validateForm(formToValidate);
  if (!result.valid) {
    return c.json(fail(400, firstError(result)), 400);
  }

  const form = formToValidate as HarnessBackendForm;

  // 构造更新后的 config(保留原 id)
  const updatedConfig: HarnessBackendConfig = {
    id, // 只读,用路径参数
    name: form.name,
    type: form.type,
    endpoint: form.endpoint,
    adminTokenEnvVar: form.adminTokenEnvVar,
    capabilities: form.capabilities,
    ...(form.defaultForTenant !== undefined ? { defaultForTenant: form.defaultForTenant } : {}),
  };

  // 持久化 + 热加载 + 缓存失效(旧实例用旧配置,需 invalidate)
  const nextConfigs = existing.map((cfg, i) => (i === idx ? updatedConfig : cfg));
  try {
    await store.saveConfig(nextConfigs);
    await store.load();
  } catch (err) {
    return c.json(
      fail(500, `Failed to persist config: ${(err as Error).message}`),
      500,
    );
  }
  registry.invalidate(id);

  const readyBackends = store.list();
  return c.json(ok(withStatus(updatedConfig, readyBackends)));
});

// ---------------------------------------------------------------------------
// DELETE /admin/harness-backends/:id — 删除(校验未绑定)
// ---------------------------------------------------------------------------

harnessAdminRoutes.delete('/admin/harness-backends/:id', async (c) => {
  const store = getStore(c);
  const tenantStore = getTenantStore(c);
  const registry = getRegistry(c);
  const id = c.req.param('id');

  const existing = store.listConfigs();
  const idx = existing.findIndex((cfg) => cfg.id === id);
  if (idx < 0) {
    return c.json(fail(404, `Backend id "${id}" 不存在`), 404);
  }

  // 绑定校验:被 tenant 绑定的后端禁止删除
  const binding = isBackendBound(tenantStore, id);
  if (binding.bound) {
    return c.json(
      fail(409, `Backend "${id}" 已被 tenant "${binding.tenantId}" 绑定,请先解绑`),
      409,
    );
  }

  // 持久化(过滤掉被删的)+ 缓存失效
  const nextConfigs = existing.filter((_, i) => i !== idx);
  try {
    await store.saveConfig(nextConfigs);
    // 删除后无需 load(只是少了一个,内存中 backends 仍含旧的就绪的)
    // 但为统一调用 + 保证 listConfigs 与 list 一致,仍调 load
    await store.load();
  } catch (err) {
    return c.json(
      fail(500, `Failed to persist config: ${(err as Error).message}`),
      500,
    );
  }
  registry.invalidate(id);

  return c.json(ok(null, `Backend "${id}" deleted`));
});
