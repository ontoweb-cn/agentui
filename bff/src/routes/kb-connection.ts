/**
 * 租户级 intellect-kb-app 连接设置。
 *
 * - GET  /settings/kb-connection      读取当前绑定(不回读 Token)
 * - PUT  /settings/kb-connection      保存并启用,revision 乐观锁
 * - POST /settings/kb-connection/test 使用候选 URL + 显式 Token 探测
 *
 * 服务 Token 只供 BFF 服务端连接/管理调用;普通 KB 数据请求仍由 proxy/rag-fetch
 * 按现有规则优先透传成员 imt_ Token。本路由不改变该优先级。
 */

import { Hono, type Context } from 'hono';
import { getAuthSession } from '../middleware/auth-session';
import type { IAdapterRegistry } from '../services/adapter-registry-types';
import { resolveMemberInfo } from '../services/member-id-resolver';
import {
  buildCompanionRagConfig,
  companionRagBackendId,
} from '../services/rag-plugin-backend';
import { getActiveRunCount, hasActiveRuns } from '../services/run-registry';
import { safeFetch } from '../services/ssrf-guard';
import type { ITokenVault } from '../services/token-vault';
import type { HarnessBackendConfig } from '../types/harness';
import type { BackendStore, HarnessStore } from '../types/stores';
import type { BffTenant } from '../types/tenant';
import { getRagBaseUrl } from '../utils/rag-base-url';

interface KbConnectionVariables {
  backendStore: BackendStore;
  harnessStore: HarnessStore;
  adapterRegistry: IAdapterRegistry;
  tokenVault?: ITokenVault;
}

type KbContext = Context<{ Variables: KbConnectionVariables }>;
type Store = HarnessStore & { listConfigs(): HarnessBackendConfig[] };

interface KbConnectionResponse {
  configured: boolean;
  endpoint: string;
  tokenConfigured: boolean;
  revision: number;
  version: string | null;
  versionError: string | null;
}

interface KbTestResult {
  success: boolean;
  stage: 'version' | 'authentication' | null;
  message: string;
  version: string | null;
  upstreamStatus: number | null;
}

export const kbConnectionRoutes = new Hono<{
  Variables: KbConnectionVariables;
}>();

function ok<T>(data: T, message = 'success') {
  return { code: 0, message, data };
}

function fail(code: number, message: string) {
  return { code, message, data: null };
}

function getStore(c: KbContext): Store {
  return c.get('harnessStore') as Store;
}

function getMainConfig(
  store: Store,
  tenant: BffTenant,
): HarnessBackendConfig | undefined {
  return store
    .listConfigs()
    .find((cfg) => cfg.id === tenant.intellectBackendId);
}

/** 只解析显式绑定,不使用默认 tenant 的首个 RAG 回退。 */
function getBoundRagConfig(
  store: Store,
  tenant: BffTenant,
): HarnessBackendConfig | undefined {
  const configs = store.listConfigs();
  if (tenant.canvasBackendId) {
    const bound = configs.find((cfg) => cfg.id === tenant.canvasBackendId);
    return bound?.type === 'intellect-rag' ? bound : undefined;
  }
  const main = getMainConfig(store, tenant);
  if (main?.type === 'intellect-rag') return main;
  if (main?.type === 'intellect-enterprise' && main.ragBackendId) {
    const bound = configs.find((cfg) => cfg.id === main.ragBackendId);
    return bound?.type === 'intellect-rag' ? bound : undefined;
  }
  return undefined;
}

function normalizeEndpoint(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return value.trim().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function kbApiUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, '')}/api/v1${path}`;
}

async function readEffectiveToken(
  config: HarnessBackendConfig,
  vault: ITokenVault | undefined,
): Promise<string | undefined> {
  const credential = vault ? await vault.getCredentials(config.id) : null;
  if (credential?.kind === 'bearer-token') return credential.token;
  if (credential?.kind === 'email-password') return credential.password;
  return process.env[config.adminTokenEnvVar];
}

async function authorize(
  c: KbContext,
): Promise<
  | { ok: true; tenant: BffTenant }
  | { ok: false; status: 400 | 401 | 403 | 404 | 502 | 503; message: string }
> {
  // AuthSession.backendId 是待验证的租户选择,不是授权凭证;绝不能缺省到 tenant 0。
  const tenantId = c.req.header('X-Backend-Id')?.trim();
  if (!tenantId) {
    return { ok: false, status: 400, message: 'X-Backend-Id is required' };
  }
  const session = getAuthSession(c);
  if (session && session.backendId !== tenantId) {
    return {
      ok: false,
      status: 400,
      message: 'Session tenant does not match X-Backend-Id',
    };
  }
  const backendStore = c.get('backendStore');
  const store = getStore(c);
  const tenant = backendStore.getBackend(tenantId);
  if (!tenant) {
    return { ok: false, status: 404, message: `Tenant not found: ${tenantId}` };
  }

  const authMode = tenant.authMode ?? 'intellect-community';
  if (authMode === 'intellect-enterprise') {
    if (!session) {
      return {
        ok: false,
        status: 401,
        message: 'Unauthorized: no valid session cookie',
      };
    }
    const main = getMainConfig(store, tenant);
    if (!main || main.type !== 'intellect-enterprise') {
      return {
        ok: false,
        status: 503,
        message: 'Enterprise backend not configured for tenant',
      };
    }
    const info = await resolveMemberInfo(
      tenantId,
      session.token,
      main.endpoint,
    );
    if (!info) {
      return {
        ok: false,
        status: 401,
        message: 'Unauthorized: member identity not resolved',
      };
    }
    if (info.role !== 'admin' && info.role !== 'owner') {
      return {
        ok: false,
        status: 403,
        message: '知识库服务配置仅允许 owner 或 admin 操作',
      };
    }
    return { ok: true, tenant };
  }

  // 社区模式沿用 RAG 超管语义。使用当前绑定或社区认证源实校,不使用候选 URL。
  const authorization = c.req.header('Authorization');
  if (!authorization) {
    return {
      ok: false,
      status: 401,
      message: 'Unauthorized: missing Authorization header',
    };
  }
  const bound = getBoundRagConfig(store, tenant);
  const identityEndpoint = bound?.endpoint ?? getRagBaseUrl();
  let response: Response;
  try {
    response = await safeFetch(kbApiUrl(identityEndpoint, '/users/me'), {
      method: 'GET',
      headers: { Authorization: authorization },
      timeoutMs: 5_000,
    });
  } catch (err) {
    console.error(
      '[kb-connection] community /users/me failed:',
      (err as Error).message,
    );
    return {
      ok: false,
      status: 502,
      message: '知识库认证源不可达,无法确认管理员身份',
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      status: 401,
      message: 'Unauthorized: invalid community token',
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: 502,
      message: '知识库认证源异常,无法确认管理员身份',
    };
  }
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    data?: { is_superuser?: boolean };
  } | null;
  if (!payload || payload.code !== 0 || !payload.data) {
    return { ok: false, status: 502, message: '知识库认证源返回无效身份响应' };
  }
  if (payload.data.is_superuser !== true) {
    return {
      ok: false,
      status: 403,
      message: '知识库服务配置仅允许超级管理员操作',
    };
  }
  return { ok: true, tenant };
}

async function fetchKbVersion(
  endpoint: string,
): Promise<
  | { ok: true; version: string }
  | { ok: false; message: string; upstreamStatus: number | null }
> {
  let response: Response;
  try {
    response = await safeFetch(kbApiUrl(endpoint, '/system/version'), {
      method: 'GET',
      timeoutMs: 5_000,
    });
  } catch (err) {
    return { ok: false, message: (err as Error).message, upstreamStatus: null };
  }
  if (!response.ok) {
    return {
      ok: false,
      message: `知识库版本接口返回 HTTP ${response.status}`,
      upstreamStatus: response.status,
    };
  }
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    data?: unknown;
    message?: string;
  } | null;
  const version =
    typeof payload?.data === 'string'
      ? payload.data
      : payload?.data &&
          typeof payload.data === 'object' &&
          typeof (payload.data as { version?: unknown }).version === 'string'
        ? (payload.data as { version: string }).version
        : null;
  if (!payload || payload.code !== 0 || !version) {
    return {
      ok: false,
      message: payload?.message || '知识库版本接口返回无效响应',
      upstreamStatus: response.status,
    };
  }
  return { ok: true, version };
}

async function connectionResponse(
  config: HarnessBackendConfig | undefined,
  vault: ITokenVault | undefined,
  includeVersion: boolean,
): Promise<KbConnectionResponse> {
  if (!config) {
    return {
      configured: false,
      endpoint: '',
      tokenConfigured: false,
      revision: 0,
      version: null,
      versionError: null,
    };
  }
  const token = await readEffectiveToken(config, vault);
  const versionResult = includeVersion
    ? await fetchKbVersion(config.endpoint)
    : null;
  return {
    configured: true,
    endpoint: config.endpoint,
    tokenConfigured: !!token,
    revision: config.revision ?? 0,
    version: versionResult?.ok ? versionResult.version : null,
    versionError:
      versionResult && !versionResult.ok ? versionResult.message : null,
  };
}

// 同一 tenant 的保存串行执行;第二个请求在锁内重新读取 revision,不会覆盖首个写入。
const saveChains = new Map<string, Promise<void>>();

async function serializeSave<T>(
  tenantId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = saveChains.get(tenantId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  saveChains.set(tenantId, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (saveChains.get(tenantId) === current) saveChains.delete(tenantId);
  }
}

kbConnectionRoutes.get('/settings/kb-connection', async (c) => {
  const auth = await authorize(c);
  if (!auth.ok) return c.json(fail(auth.status, auth.message), auth.status);
  const store = getStore(c);
  const config = getBoundRagConfig(store, auth.tenant);
  const data = await connectionResponse(config, c.get('tokenVault'), true);
  return c.json(ok(data));
});

kbConnectionRoutes.post('/settings/kb-connection/test', async (c) => {
  const auth = await authorize(c);
  if (!auth.ok) return c.json(fail(auth.status, auth.message), auth.status);
  const body = (await c.req.json().catch(() => null)) as {
    endpoint?: unknown;
    serviceToken?: unknown;
    service_token?: unknown;
  } | null;
  const endpoint = normalizeEndpoint(body?.endpoint);
  if (!endpoint) {
    return c.json(
      fail(400, 'endpoint 必须是无凭据、query 和 hash 的 http/https URL'),
      400,
    );
  }

  const store = getStore(c);
  const current = getBoundRagConfig(store, auth.tenant);
  const rawServiceToken = body?.serviceToken ?? body?.service_token;
  const suppliedToken =
    typeof rawServiceToken === 'string' ? rawServiceToken.trim() : '';
  // URL 改变时禁止隐式复用旧 Token;同 URL 留空才表示使用已保存凭据。
  if (!suppliedToken && (!current || current.endpoint !== endpoint)) {
    return c.json(fail(400, '服务 URL 已改变,必须显式输入服务访问 Token'), 400);
  }
  const candidateToken =
    suppliedToken ||
    (current ? await readEffectiveToken(current, c.get('tokenVault')) : '');
  if (!candidateToken) {
    return c.json(fail(400, '服务访问 Token 不能为空'), 400);
  }
  if (candidateToken.startsWith('imt_')) {
    return c.json(
      fail(
        400,
        '请勿配置 imt_ 成员 Token;应使用可独立识别身份的 KB API Token/JWT',
      ),
      400,
    );
  }

  const versionResult = await fetchKbVersion(endpoint);
  if (!versionResult.ok) {
    const result: KbTestResult = {
      success: false,
      stage: 'version',
      message: versionResult.message,
      version: null,
      upstreamStatus: versionResult.upstreamStatus,
    };
    return c.json(ok(result));
  }

  // 只使用候选 Token 显式鉴权;不带 session/dynamic headers,也不在 401 后重试。
  let datasets: Response;
  try {
    datasets = await safeFetch(
      kbApiUrl(endpoint, '/datasets?page=1&page_size=1'),
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${candidateToken}` },
        timeoutMs: 5_000,
      },
    );
  } catch (err) {
    const result: KbTestResult = {
      success: false,
      stage: 'authentication',
      message: (err as Error).message,
      version: versionResult.version,
      upstreamStatus: null,
    };
    return c.json(ok(result));
  }
  const payload = (await datasets.json().catch(() => null)) as {
    code?: number;
    message?: string;
  } | null;
  if (!datasets.ok || !payload || payload.code !== 0) {
    const result: KbTestResult = {
      success: false,
      stage: 'authentication',
      message:
        datasets.status === 401 ||
        datasets.status === 403 ||
        payload?.code === 401
          ? '服务访问 Token 无效或无权访问知识库'
          : payload?.message || `知识库鉴权请求失败 (HTTP ${datasets.status})`,
      version: versionResult.version,
      upstreamStatus: datasets.status,
    };
    return c.json(ok(result));
  }

  const result: KbTestResult = {
    success: true,
    stage: null,
    message: '连接成功,服务 URL 与访问 Token 均有效',
    version: versionResult.version,
    upstreamStatus: datasets.status,
  };
  return c.json(ok(result));
});

kbConnectionRoutes.put('/settings/kb-connection', async (c) => {
  const auth = await authorize(c);
  if (!auth.ok) return c.json(fail(auth.status, auth.message), auth.status);
  const body = (await c.req.json().catch(() => null)) as {
    endpoint?: unknown;
    serviceToken?: unknown;
    service_token?: unknown;
    revision?: unknown;
  } | null;
  const endpoint = normalizeEndpoint(body?.endpoint);
  if (!endpoint) {
    return c.json(
      fail(400, 'endpoint 必须是无凭据、query 和 hash 的 http/https URL'),
      400,
    );
  }
  const revision = body?.revision;
  if (
    typeof revision !== 'number' ||
    !Number.isInteger(revision) ||
    revision < 0
  ) {
    return c.json(fail(400, 'revision 必须是非负整数'), 400);
  }

  return serializeSave(auth.tenant.id, async () => {
    const store = getStore(c);
    const backendStore = c.get('backendStore');
    const vault = c.get('tokenVault');
    const registry = c.get('adapterRegistry');
    if (!vault) {
      return c.json(
        fail(503, 'Token Vault 未配置,无法保存服务访问 Token'),
        503,
      );
    }

    const existing = store.listConfigs();
    // 在串行锁内按 id 重新定位,避免使用锁外快照。
    const tenant = backendStore.getBackend(auth.tenant.id);
    if (!tenant)
      return c.json(fail(404, `Tenant not found: ${auth.tenant.id}`), 404);
    const main = getMainConfig(store, tenant);
    if (!main) {
      return c.json(fail(503, 'Tenant main backend not configured'), 503);
    }
    const current = getBoundRagConfig(store, tenant);
    const currentRevision = current?.revision ?? 0;
    // fail-closed:canvasBackendId 已设置但解析不到有效 intellect-rag 后端时,
    // 禁止把失效绑定当未绑定静默覆盖;管理员需先到 Harness Admin 修复绑定。
    if (tenant.canvasBackendId && !current) {
      return c.json(
        fail(
          400,
          '当前租户存在指向无效 RAG 后端的画布绑定,请先到 Harness Admin 修复绑定后再配置知识库服务',
        ),
        400,
      );
    }
    if (revision !== currentRevision) {
      return c.json(
        fail(409, '配置已被其他管理员修改,请重新加载后再保存'),
        409,
      );
    }

    const rawServiceToken = body?.serviceToken ?? body?.service_token;
    const suppliedToken =
      typeof rawServiceToken === 'string' ? rawServiceToken.trim() : '';
    if (!suppliedToken && (!current || current.endpoint !== endpoint)) {
      return c.json(
        fail(400, '服务 URL 已改变,必须显式输入服务访问 Token'),
        400,
      );
    }
    const retainedToken = current
      ? await readEffectiveToken(current, vault)
      : undefined;
    if (!suppliedToken && !retainedToken) {
      return c.json(fail(400, '服务访问 Token 不能为空'), 400);
    }
    if ((suppliedToken || retainedToken)?.startsWith('imt_')) {
      return c.json(
        fail(
          400,
          '请勿配置 imt_ 成员 Token;应使用可独立识别身份的 KB API Token/JWT',
        ),
        400,
      );
    }

    const bindingChange = !current;
    if (
      bindingChange &&
      (hasActiveRuns(tenant.id) || hasActiveRuns(tenant.intellectBackendId))
    ) {
      const count = Math.max(
        getActiveRunCount(tenant.id),
        getActiveRunCount(tenant.intellectBackendId),
      );
      return c.json(
        fail(
          409,
          `当前租户有 ${count} 个活跃 Run,请等待完成后再启用知识库服务`,
        ),
        409,
      );
    }

    const ragId = current?.id ?? companionRagBackendId(main.id);
    if (!current && existing.some((cfg) => cfg.id === ragId)) {
      return c.json(
        fail(409, `Backend id "${ragId}" 已存在,无法自动绑定`),
        409,
      );
    }
    const nextRag: HarnessBackendConfig = current
      ? { ...current, endpoint, revision: currentRevision + 1 }
      : {
          ...buildCompanionRagConfig({
            enterpriseId: main.id,
            enterpriseName: main.name,
            ragEndpoint: endpoint,
          }),
          revision: 1,
        };
    const nextMain =
      bindingChange && main.type === 'intellect-enterprise'
        ? { ...main, ragBackendId: ragId, revision: (main.revision ?? 0) + 1 }
        : main;
    const byId = new Map(existing.map((cfg) => [cfg.id, cfg]));
    byId.set(nextMain.id, nextMain);
    byId.set(ragId, nextRag);
    const nextConfigs = [...byId.values()];
    const previousCredential = current
      ? await vault.getCredentials(current.id)
      : null;

    try {
      if (suppliedToken) {
        await vault.setCredentials(ragId, {
          kind: 'bearer-token',
          token: suppliedToken,
        });
      }
      await store.saveConfig(nextConfigs);
      await store.load();
      if (bindingChange) {
        await backendStore.setCanvasBinding(tenant.id, ragId);
      }
    } catch (err) {
      // 跨 vault/config/binding 无单文件事务;失败时恢复配置与凭据快照。
      // setCanvasBinding 自身会在 persist 失败时恢复 tenant 内存状态。
      if (suppliedToken) {
        try {
          if (previousCredential)
            await vault.setCredentials(ragId, previousCredential);
          else await vault.deleteCredentials(ragId);
        } catch (rollbackErr) {
          console.error(
            '[kb-connection] credential rollback failed:',
            (rollbackErr as Error).message,
          );
        }
      }
      try {
        await store.saveConfig(existing);
        await store.load();
      } catch (rollbackErr) {
        console.error(
          '[kb-connection] config rollback failed:',
          (rollbackErr as Error).message,
        );
      }
      return c.json(
        fail(500, `Failed to persist KB connection: ${(err as Error).message}`),
        500,
      );
    }

    registry.invalidate();
    const persisted =
      store.listConfigs().find((cfg) => cfg.id === ragId) ?? nextRag;
    const data = await connectionResponse(persisted, vault, false);
    return c.json(
      ok(
        data,
        bindingChange ? '知识库服务已保存并启用' : '知识库服务配置已保存',
      ),
    );
  });
});
