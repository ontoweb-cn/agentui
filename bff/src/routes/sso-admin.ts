/**
 * sso-admin 路由 — 统一认证运行时配置管理(wizard-sso-followup A7)。
 *
 * 路径映射(Vite rewrite 去掉 /api/bff):
 *   前端 /api/bff/admin/sso/config → BFF /admin/sso/config
 *
 * 鉴权:authMiddleware + requireValidImtSession 双层(同 harness-backends 模式,
 * 评审补强)——前者凭据存在性(方案 A 只认 imt_token cookie;社区模式认
 * Authorization header / cookie),后者对 enterprise 后端实校(60s 缓存,
 * 401/502/503 fail-closed;社区模式直通)。挂载点见 index.ts `/admin/sso/*`。
 *
 * 安全边界:stateSecret 属部署级敏感配置,**只读不可写** —— 本接口仅返回
 * `stateSecretConfigured` 布尔(用于"启用但密钥缺失"的自检提示),永不回显明文;
 * 修改密钥仍走部署配置文件(.env)+ 重启/启动 fail-fast(sso-config.ts 单一裁决点)。
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  clearSsoRuntimeConfig,
  readSsoRuntimeConfig,
  writeSsoRuntimeConfig,
  type SsoRuntimeConfig,
} from '../services/sso-store';
import { loadSsoConfig } from '../services/sso-config';
import { getLoginProviders } from '../services/sso-providers';
// wizard-ent-sso-mode v1.4(§12 R-2/R-3):复用共享检测服务与 store 消费
import { verifyEnterpriseSso } from '../services/enterprise-sso-check';
import { fetchTenantInfo } from '../services/tenant-validator';
import type { HarnessStore } from '../types/stores';
import type { BackendStore } from '../types/stores';
import type { HarnessBackend } from '../types/harness';

interface SsoAdminVariables {
  // 全局注入的 stores(index.ts app 级 c.set);v1.4 起本路由开始消费(§12 R-3)
  harnessStore?: HarnessStore;
  backendStore?: BackendStore;
  [key: string]: unknown;
}

// 变量注入留空:本路由无需 context 变量(鉴权由全局中间件承担)
export const ssoAdminRoutes = new Hono();

function ok<T>(data: T, message = 'success') {
  return { code: 0, message, data };
}

function fail(code: number, message: string) {
  return { code, message, data: null };
}

/** stateSecret 三态(§12 R-5):unset=未设置 / set=已设置且合规 / invalid=已设置但长度不足 */
type StateSecretStatus = 'unset' | 'set' | 'invalid';

function readStateSecretStatus(env: NodeJS.ProcessEnv = process.env): StateSecretStatus {
  const raw = env.BFF_SSO_STATE_SECRET ?? '';
  if (!raw) return 'unset';
  return raw.length >= 32 ? 'set' : 'invalid';
}

/**
 * 解析默认租户 '0' 绑定的企业后端(v1.4 §12 R-4:管理页面向默认租户口径,
 * 与登录页 resolveSsoTenantBackend('0') 一致)。
 * stores 未注入(部分单测 harness)时返回 undefined = 无法校验,调用方跳过守卫;
 * 显式 null = 已注入但确实未绑定。
 */
function resolveBoundEnterpriseBackend(
  c: Context,
): { backend: HarnessBackend } | null | undefined {
  const backendStore = c.get('backendStore') as BackendStore | undefined;
  const harnessStore = c.get('harnessStore') as HarnessStore | undefined;
  if (!backendStore || !harnessStore) return undefined;
  const tenant = backendStore.getBackend('0');
  if (!tenant?.intellectBackendId) return null;
  const backend = harnessStore.get(tenant.intellectBackendId);
  if (!backend || backend.type !== 'intellect-enterprise') return null;
  return { backend };
}

/** 响应视图:生效配置(合并后)+ 来源标记 + 密钥自检位 + 绑定后端(v1.4)。 */
function buildView(c: Context) {
  const runtime = readSsoRuntimeConfig();
  const effective = loadSsoConfig();
  const bound = resolveBoundEnterpriseBackend(c);
  return {
    config: {
      enabled: effective.enabled,
      publicOrigin: effective.publicOrigin,
      providers: effective.providers,
      silentRelogin: effective.silentRelogin,
    },
    runtime: runtime,
    sources: {
      enabled: runtime ? 'runtime' : 'env',
      publicOrigin: runtime ? 'runtime' : 'env',
      providers: runtime ? 'runtime' : 'env',
      silentRelogin: runtime ? 'runtime' : 'env',
      // 密钥永远来自部署配置(.env)
      stateSecret: 'env',
    } as Record<string, 'runtime' | 'env'>,
    /** 兼容位(v1.3 语义:=stateSecretStatus === 'set') */
    stateSecretConfigured: readStateSecretStatus() === 'set',
    /** v1.4 三态(§12 R-5):unset / set / invalid(已设但 <32 字符) */
    stateSecretStatus: readStateSecretStatus(),
    /** v1.4:默认租户绑定的企业后端(仅 id/endpoint;null=未绑定;stores 缺失=undefined 跳过) */
    boundBackend:
      bound === undefined
        ? undefined
        : bound === null
          ? null
          : { id: bound.backend.id, endpoint: bound.backend.endpoint },
  };
}

/**
 * v1.4:?check=1 对绑定后端做一次实时四项检测(§12 R-2,服务端复用
 * verifyEnterpriseSso;最坏 ~15s,前端需 loading 态)。
 */
async function runLiveCheck(c: Context) {
  const bound = resolveBoundEnterpriseBackend(c);
  if (bound === undefined) {
    return { boundBackendMissing: true, status: null };
  }
  if (bound === null) {
    return { boundBackendMissing: true, status: null };
  }
  const { backend } = bound;
  const tenantInfo = await fetchTenantInfo(backend.endpoint);
  const result = await verifyEnterpriseSso(backend.endpoint, tenantInfo, backend.adminToken || undefined);
  return { boundBackendMissing: false, status: result.sso ?? null };
}

// ---------------------------------------------------------------------------
// GET /admin/sso/config — 查看生效配置与来源
// v1.4:?check=1 附带绑定后端的实时四项检测(网关/租户/密钥/认证服务)
// ---------------------------------------------------------------------------

ssoAdminRoutes.get('/admin/sso/config', async (c) => {
  if (c.req.query('check') === '1') {
    const check = await runLiveCheck(c);
    return c.json(ok({ ...buildView(c), check }));
  }
  return c.json(ok(buildView(c)));
});

// ---------------------------------------------------------------------------
// GET /admin/sso/providers — 绑定后端的登录渠道裁剪视图(v1.4 §11.2)
// admin 门控(挂载点已有 authMiddleware+requireValidImtSession);
// 字段裁剪同 wizard providers 端点(仅 id/displayName/icon,不透出 clientId 等)。
// ---------------------------------------------------------------------------

ssoAdminRoutes.get('/admin/sso/providers', async (c) => {
  const bound = resolveBoundEnterpriseBackend(c);
  if (bound === undefined || bound === null) {
    return c.json(
      fail(400, '默认租户未绑定企业后端;请先完成企业版首装或到「Harness 后端」绑定。'),
      400,
    );
  }
  try {
    // 编辑预览需展示全部可用渠道(含被当前 env 白名单过滤掉的),
    // 否则管理员无法重新勾选——与 wizard 侧检测口径一致(providers:null)
    const selection = await getLoginProviders(bound.backend.endpoint, '0', {
      ...loadSsoConfig(),
      providers: null,
    });
    return c.json(
      ok({
        providers: selection.providers.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          icon: p.icon,
        })),
        misconfigured: selection.misconfigured,
      }),
    );
  } catch (err) {
    console.error('[sso-admin] providers fetch failed:', (err as Error).message);
    return c.json(fail(502, '统一认证服务不可达,请稍后再试'), 502);
  }
});

// ---------------------------------------------------------------------------
// PUT /admin/sso/config — 写入运行时配置(即时生效)
// 兼容前端 axios 拦截器的 snake_case(public_origin / silent_relogin)。
// ---------------------------------------------------------------------------

interface SsoConfigPutBody {
  enabled?: unknown;
  publicOrigin?: unknown;
  public_origin?: unknown;
  providers?: unknown;
  silentRelogin?: unknown;
  silent_relogin?: unknown;
}

ssoAdminRoutes.put('/admin/sso/config', async (c) => {
  const body = (await c.req.json().catch(() => null)) as SsoConfigPutBody | null;
  if (!body || typeof body !== 'object') {
    return c.json(fail(400, 'Request body must be JSON'), 400);
  }

  const enabled = body.enabled;
  const publicOriginRaw = (body.publicOrigin ?? body.public_origin) as unknown;
  const silentReloginRaw = body.silentRelogin ?? body.silent_relogin;

  if (typeof enabled !== 'boolean') {
    return c.json(fail(400, 'enabled must be a boolean'), 400);
  }
  const publicOrigin = typeof publicOriginRaw === 'string' ? publicOriginRaw.trim() : '';
  const silentRelogin = silentReloginRaw === undefined ? true : silentReloginRaw;
  if (typeof silentRelogin !== 'boolean') {
    return c.json(fail(400, 'silentRelogin must be a boolean'), 400);
  }

  if (enabled) {
    if (!publicOrigin) {
      return c.json(fail(400, '启用 sso 时 publicOrigin 必填'), 400);
    }
    try {
      const origin = new URL(publicOrigin);
      if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
        return c.json(fail(400, 'publicOrigin 必须为 http(s) URL'), 400);
      }
    } catch {
      return c.json(fail(400, `publicOrigin 不是合法 URL: ${publicOrigin}`), 400);
    }
  }

  let providers: string[] | null = null;
  if (body.providers !== undefined && body.providers !== null) {
    if (!Array.isArray(body.providers)) {
      return c.json(fail(400, 'providers 必须为数组或 null'), 400);
    }
    providers = body.providers;
  }

  let saved: SsoRuntimeConfig;
  try {
    saved = writeSsoRuntimeConfig({
      enabled,
      publicOrigin,
      providers,
      silentRelogin,
    });
  } catch (err) {
    console.error('[sso-admin] failed to persist sso-config.json:', (err as Error).message);
    return c.json(fail(500, `Failed to persist sso config: ${(err as Error).message}`), 500);
  }

  // 启用守卫(§12 R-3 双保险的服务端侧):密钥缺失/不合规 + 绑定后端缺失,
  // 均为非阻断 warnings(写入成功,但提示管理员先补齐);stores 缺失时跳过后端校验
  const warnings: string[] = [];
  const secretStatus = readStateSecretStatus();
  if (saved.enabled && secretStatus === 'unset') {
    warnings.push(
      'BFF_SSO_STATE_SECRET 未配置:重启后 BFF 将启动失败,请先在部署配置中设置(≥32 字符)。',
    );
  }
  if (saved.enabled && secretStatus === 'invalid') {
    warnings.push(
      'BFF_SSO_STATE_SECRET 长度不足 32 字符:重启后 BFF 将启动失败,请先在部署配置中更正。',
    );
  }
  if (saved.enabled) {
    const bound = resolveBoundEnterpriseBackend(c);
    if (bound === null) {
      warnings.push(
        '默认租户未绑定企业后端:SSO 兑换无法路由,请先完成企业版首装或到「Harness 后端」绑定。',
      );
    } else if (bound !== undefined && !bound.backend.adminToken) {
      warnings.push(
        `企业后端 "${bound.backend.id}" 未就绪(服务密钥未加载):SSO 登录将在兑换时失败,请补齐凭据。`,
      );
    }
  }

  return c.json(ok({ ...buildView(c), warnings }));
});

// ---------------------------------------------------------------------------
// DELETE /admin/sso/config — 清除运行时配置,回滚到 env 兜底
// ---------------------------------------------------------------------------

ssoAdminRoutes.delete('/admin/sso/config', (c) => {
  clearSsoRuntimeConfig();
  return c.json(ok(buildView(c)));
});
