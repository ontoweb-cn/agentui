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
 * - DELETE /admin/harness-backends/:id        → 删除(校验绑定 + RunRegistry + saveConfig + invalidate)
 * - POST   /admin/harness-backends/:id/switch → 切换为主/画布后端(spec-010 v8 修改 6 D2:校验活跃 run)
 *
 * 挂载点:index.ts 注册到 `/api/bff/admin/harness-backends`(Vite rewrite 后 BFF 收到 /admin/harness-backends)。
 * 鉴权:authMiddleware(在 index.ts 全局挂载到 /admin/*,或路由内显式)
 */

import { Hono, type Context } from 'hono';
import type { HarnessStore } from '../types/stores';
import type { BackendStore } from '../types/stores';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import type { ITokenVault } from '../services/token-vault';
import type { HarnessStoreListConfigs, HarnessBackendWithStatus, HarnessBackendForm } from '../types/harness-admin';
import type { HarnessBackendConfig } from '../types/harness';
import { VALIDATION_RULES } from '../types/harness-admin';
import { validateForm, firstError } from '../services/harness-admin-validation';
import { buildCompanionRagConfig } from '../services/rag-plugin-backend';
// spec-010 v8 修改 6 (D2):backend 切换/删除时校验 RunRegistry 活跃 run
import {
  hasActiveRuns,
  getActiveRunCount,
  hasRunsForBackend,
} from '../services/run-registry';

interface HarnessAdminVariables {
  harnessStore: HarnessStore;
  backendStore: BackendStore;
  adapterRegistry: IAdapterRegistry;
  tokenVault?: ITokenVault;
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

function getBackendStore(c: Context): BackendStore {
  return c.get('backendStore');
}

function getRegistry(c: Context): IAdapterRegistry {
  return c.get('adapterRegistry');
}

function getVault(c: Context): ITokenVault | undefined {
  return c.get('tokenVault');
}

/**
 * 将 HarnessBackendConfig + ready 状态合成 HarnessBackendWithStatus。
 * ready = HarnessStore.list() 中是否含该 backendId(env token 就绪)。
 * 方案 A: enterprise 的 ragEndpoint 从伴生 rag backend 解析,不含 API Key。
 */
function withStatus(
  config: HarnessBackendConfig,
  readyBackends: { id: string }[],
  allConfigs: HarnessBackendConfig[] = [],
): HarnessBackendWithStatus {
  const ready = readyBackends.some((b) => b.id === config.id);
  const ragEndpoint = config.ragBackendId
    ? allConfigs.find((cfg) => cfg.id === config.ragBackendId)?.endpoint
    : undefined;
  return { ...config, ready, ...(ragEndpoint ? { ragEndpoint } : {}) };
}

function ragEndpointError(ragEndpoint: string | undefined): string | null {
  if (!ragEndpoint?.trim() || !VALIDATION_RULES.endpoint.pattern.test(ragEndpoint.trim())) {
    return 'intellect-enterprise 类型必须提供合法 ragEndpoint(http/https URL)';
  }
  return null;
}

function upsertCompanion(
  configs: HarnessBackendConfig[],
  enterprise: HarnessBackendConfig,
  ragEndpoint: string,
): { next: HarnessBackendConfig[]; companion: HarnessBackendConfig } {
  const companion = buildCompanionRagConfig({
    enterpriseId: enterprise.id,
    enterpriseName: enterprise.name,
    ragEndpoint: ragEndpoint.trim(),
  });
  enterprise.ragBackendId = companion.id;
  const byId = new Map(configs.map((cfg) => [cfg.id, cfg]));
  byId.set(enterprise.id, enterprise);
  byId.set(companion.id, companion);
  return { next: [...byId.values()], companion };
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
  backendStore: BackendStore,
  backendId: string,
): { bound: boolean; tenantId?: string } {
  for (const tenant of backendStore.listBackends()) {
    if (tenant.intellectBackendId === backendId) {
      return { bound: true, tenantId: tenant.id };
    }
    if (tenant.canvasBackendId === backendId) {
      return { bound: true, tenantId: tenant.id };
    }
  }
  return { bound: false };
}

/**
 * 始终由 BFF 自动生成 adminTokenEnvVar,命名规则:HARNESS_<ID>_TOKEN。
 * 前端传入的 adminTokenEnvVar 会被忽略并记录 warn(防止前端污染命名空间)。
 * 向后兼容:已持久化的 config 不变,只有新建/编辑 backend 用新规则。
 */
function generateAdminTokenEnvVar(backendId: string): string {
  return `HARNESS_${backendId.toUpperCase().replace(/-/g, '_')}_TOKEN`;
}

/**
 * 检查前端 body 是否传入了 adminTokenEnvVar,若有则记录 warn(值会被覆盖)。
 */
function warnIfAdminTokenEnvVarProvided(
  source: 'POST' | 'PUT',
  backendId: string,
  body: Record<string, unknown>,
): void {
  if (body.adminTokenEnvVar !== undefined) {
    console.warn(
      `[harness-admin:${source}] Ignoring frontend-provided adminTokenEnvVar="${body.adminTokenEnvVar}" ` +
        `for backend "${backendId}"; BFF auto-generates HARNESS_<ID>_TOKEN.`,
    );
  }
}

// ---------------------------------------------------------------------------
// GET /admin/harness-backends — 列表(含 ready 状态,不含 token 明文)
// ---------------------------------------------------------------------------

harnessAdminRoutes.get('/admin/harness-backends', (c) => {
  const store = getStore(c);
  const configs = store.listConfigs();
  const readyBackends = store.list(); // 仅就绪(含 token,但下面只用 id)
  const data = configs.map((cfg) => withStatus(cfg, readyBackends, configs));
  return c.json(ok(data));
});

// ---------------------------------------------------------------------------
// POST /admin/harness-backends — 新增
// ---------------------------------------------------------------------------

harnessAdminRoutes.post('/admin/harness-backends', async (c) => {
  const store = getStore(c);
  const backendStore = getBackendStore(c);
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

  // RAG 是 enterprise 插件,不接受独立新增。
  if (form.type === 'intellect-rag') {
    return c.json(
      fail(
        400,
        'intellect-rag is not a standalone admin type; configure it as the RAG plugin of intellect-enterprise',
      ),
      400,
    );
  }

  if (form.type === 'intellect-enterprise') {
    const endpointErr = ragEndpointError(form.ragEndpoint);
    if (endpointErr) {
      return c.json(fail(400, endpointErr), 400);
    }
    if (!form.ragApiKey?.trim()) {
      return c.json(
        fail(400, 'intellect-enterprise 类型必须提供 ragApiKey'),
        400,
      );
    }
  }

  // adminTokenEnvVar 始终由 BFF 自动生成(忽略前端传入,记录 warn)
  warnIfAdminTokenEnvVarProvided('POST', form.id, body as Record<string, unknown>);
  const adminTokenEnvVar = generateAdminTokenEnvVar(form.id);

  // 构造 HarnessBackendConfig(不含 token)
  const newConfig: HarnessBackendConfig = {
    id: form.id,
    name: form.name,
    type: form.type,
    endpoint: form.endpoint,
    adminTokenEnvVar,
    capabilities: form.capabilities,
    ...(form.defaultForTenant !== undefined ? { defaultForTenant: form.defaultForTenant } : {}),
  };

  let companion: HarnessBackendConfig | undefined;
  let nextConfigs = [...existing, newConfig];
  if (form.type === 'intellect-enterprise' && form.ragEndpoint && form.ragApiKey) {
    const vault = getVault(c);
    if (!vault) {
      return c.json(
        fail(500, 'RAG plugin API key 需要 Token Vault 支持,当前环境未配置 vault'),
        500,
      );
    }
    const upserted = upsertCompanion(existing, newConfig, form.ragEndpoint);
    companion = upserted.companion;
    nextConfigs = upserted.next;
    await vault.setCredentials(companion.id, {
      kind: 'bearer-token',
      token: form.ragApiKey.trim(),
    });
  }

  // 持久化 + 热加载 + 缓存失效
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
  if (companion) {
    registry.invalidate(companion.id);
    const defaultTenant = backendStore.getBackend('0');
    if (defaultTenant) {
      await backendStore.setCanvasBinding('0', companion.id);
    }
  }

  const readyBackends = store.list();
  return c.json(ok(withStatus(newConfig, readyBackends, nextConfigs)));
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
  const prev = existing[idx];

  // 不允许把其他类型改成独立 intellect-rag;已有伴生 rag 可继续编辑。
  if (form.type === 'intellect-rag' && prev.type !== 'intellect-rag') {
    return c.json(
      fail(
        400,
        'intellect-rag is not a standalone admin type; configure it as the RAG plugin of intellect-enterprise',
      ),
      400,
    );
  }

  if (form.type === 'intellect-enterprise') {
    const needsCreate = !prev.ragBackendId;
    if (needsCreate) {
      const endpointErr = ragEndpointError(form.ragEndpoint);
      if (endpointErr) {
        return c.json(fail(400, endpointErr), 400);
      }
      if (!form.ragApiKey?.trim()) {
        return c.json(
          fail(400, 'intellect-enterprise 类型必须提供 ragApiKey'),
          400,
        );
      }
    } else if (form.ragEndpoint) {
      const endpointErr = ragEndpointError(form.ragEndpoint);
      if (endpointErr) {
        return c.json(fail(400, endpointErr), 400);
      }
    }
  }

  // adminTokenEnvVar 始终由 BFF 自动生成(忽略前端传入,记录 warn)
  // 注:PUT 也会重新生成,确保命名规则升级后编辑旧 config 时同步迁移到 HARNESS_<ID>_TOKEN
  warnIfAdminTokenEnvVarProvided('PUT', id, body as Record<string, unknown>);
  const adminTokenEnvVar = generateAdminTokenEnvVar(id);

  // 构造更新后的 config(保留原 id 及方案 A / tenant 字段)
  const updatedConfig: HarnessBackendConfig = {
    id, // 只读,用路径参数
    name: form.name,
    type: form.type,
    endpoint: form.endpoint,
    adminTokenEnvVar,
    capabilities: form.capabilities,
    ...(form.defaultForTenant !== undefined ? { defaultForTenant: form.defaultForTenant } : {}),
    ...(prev.intellectTenantId ? { intellectTenantId: prev.intellectTenantId } : {}),
    ...(prev.comment ? { comment: prev.comment } : {}),
    ...(prev.credentialKind ? { credentialKind: prev.credentialKind } : {}),
    ...(prev.allowEmptyToken !== undefined ? { allowEmptyToken: prev.allowEmptyToken } : {}),
    ...(prev.projectTokenEnvVar ? { projectTokenEnvVar: prev.projectTokenEnvVar } : {}),
    ...(prev.ragBackendId ? { ragBackendId: prev.ragBackendId } : {}),
  };

  let nextConfigs = existing.map((cfg, i) => (i === idx ? updatedConfig : cfg));
  let companion: HarnessBackendConfig | undefined;
  if (form.type === 'intellect-enterprise' && (form.ragEndpoint || form.ragApiKey)) {
    const ragEndpoint =
      form.ragEndpoint?.trim() ||
      existing.find((cfg) => cfg.id === prev.ragBackendId)?.endpoint;
    if (ragEndpoint) {
      const upserted = upsertCompanion(nextConfigs, updatedConfig, ragEndpoint);
      companion = upserted.companion;
      nextConfigs = upserted.next;
    }
    if (form.ragApiKey?.trim()) {
      const vault = getVault(c);
      if (!vault) {
        return c.json(
          fail(500, 'RAG plugin API key 需要 Token Vault 支持,当前环境未配置 vault'),
          500,
        );
      }
      const companionId = companion?.id || updatedConfig.ragBackendId;
      if (companionId) {
        await vault.setCredentials(companionId, {
          kind: 'bearer-token',
          token: form.ragApiKey.trim(),
        });
      }
    }
  }

  // 持久化 + 热加载 + 缓存失效(旧实例用旧配置,需 invalidate)
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
  if (companion) {
    registry.invalidate(companion.id);
  }

  const readyBackends = store.list();
  return c.json(ok(withStatus(updatedConfig, readyBackends, nextConfigs)));
});

// ---------------------------------------------------------------------------
// DELETE /admin/harness-backends/:id — 删除(校验未绑定)
// ---------------------------------------------------------------------------

harnessAdminRoutes.delete('/admin/harness-backends/:id', async (c) => {
  const store = getStore(c);
  const backendStore = getBackendStore(c);
  const registry = getRegistry(c);
  const id = c.req.param('id');

  const existing = store.listConfigs();
  const idx = existing.findIndex((cfg) => cfg.id === id);
  if (idx < 0) {
    return c.json(fail(404, `Backend id "${id}" 不存在`), 404);
  }

  // 绑定校验:被 tenant 绑定的后端禁止删除
  const binding = isBackendBound(backendStore, id);
  if (binding.bound) {
    return c.json(
      fail(409, `Backend "${id}" 已被 tenant "${binding.tenantId}" 绑定,请先解绑`),
      409,
    );
  }

  const companionId = existing[idx].ragBackendId;
  if (companionId) {
    const companionBinding = isBackendBound(backendStore, companionId);
    if (companionBinding.bound) {
      return c.json(
        fail(
          409,
          `RAG plugin "${companionId}" 已被 tenant "${companionBinding.tenantId}" 绑定,请先解绑`,
        ),
        409,
      );
    }
  }

  // spec-010 v8 修改 6 (D2):校验该 backend 是否有 run 记录(含已完成的),
  // 有任何 run 记录时软阻断删除,提示先清理或迁移。
  if (hasRunsForBackend(id) || (companionId && hasRunsForBackend(companionId))) {
    return c.json(
      fail(409, '该 backend 仍有 run 记录,请先清理或迁移后再删除'),
      409,
    );
  }

  // 持久化(过滤掉被删的 enterprise + 伴生 RAG)+ 缓存失效
  const dropIds = new Set([id, ...(companionId ? [companionId] : [])]);
  const nextConfigs = existing.filter((cfg) => !dropIds.has(cfg.id));
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
  if (companionId) {
    registry.invalidate(companionId);
    await getVault(c)?.deleteCredentials(companionId);
  }

  return c.json(ok(null, `Backend "${id}" deleted`));
});

// ---------------------------------------------------------------------------
// POST /admin/harness-backends/:id/switch — 切换为主/画布后端
// spec-010 v8 修改 6 (D2):切换前校验活跃 run,软阻断返回 409
// ---------------------------------------------------------------------------

harnessAdminRoutes.post('/admin/harness-backends/:id/switch', async (c) => {
  const id = c.req.param('id');
  const backendStore = getBackendStore(c);
  const registry = getRegistry(c);

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json(fail(400, 'Request body must be JSON'), 400);
  }

  const { tenantId, role } = body as { tenantId?: string; role?: 'primary' | 'canvas' };

  if (!tenantId) {
    return c.json(fail(400, 'tenantId is required'), 400);
  }
  if (role !== 'primary' && role !== 'canvas') {
    return c.json(fail(400, "role must be 'primary' or 'canvas'"), 400);
  }

  // spec-010 v8 修改 6 (D2):切换 backend 时软阻断活跃 run,
  // 避免中断进行中的对话/审批。
  // P2-M1 修复:语义为 backend 维度(单实例单租户模型下 backend ≡ tenant)
  if (hasActiveRuns(id)) {
    const count = getActiveRunCount(id);
    return c.json(
      fail(409, `Backend "${id}" 有 ${count} 个活跃 run,请等待完成或强制取消后再切换`),
      409,
    );
  }

  // 切换逻辑(更新 BffTenant.intellectBackendId 或 canvasBackendId)
  try {
    if (role === 'primary') {
      await backendStore.setHarnessBinding(tenantId, id);
    } else {
      await backendStore.setCanvasBinding(tenantId, id);
    }
  } catch (err) {
    return c.json(
      fail(500, `Failed to switch backend: ${(err as Error).message}`),
      500,
    );
  }

  // 失效 Adapter 缓存(切换后下次 getAdapter 创建新实例)
  registry.invalidate();

  return c.json(ok(null, '切换成功'));
});
