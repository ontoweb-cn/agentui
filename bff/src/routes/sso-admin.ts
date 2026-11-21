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
import {
  clearSsoRuntimeConfig,
  readSsoRuntimeConfig,
  writeSsoRuntimeConfig,
  type SsoRuntimeConfig,
} from '../services/sso-store';
import { loadSsoConfig } from '../services/sso-config';

interface SsoAdminVariables {
  // 预留:未来注入审计/限流依赖
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

/** 响应视图:生效配置(合并后)+ 来源标记 + 密钥自检位。 */
function buildView() {
  const runtime = readSsoRuntimeConfig();
  const effective = loadSsoConfig();
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
    stateSecretConfigured: Boolean(process.env.BFF_SSO_STATE_SECRET),
  };
}

// ---------------------------------------------------------------------------
// GET /admin/sso/config — 查看生效配置与来源
// ---------------------------------------------------------------------------

ssoAdminRoutes.get('/admin/sso/config', (c) => {
  return c.json(ok(buildView()));
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

  // 启用但密钥缺失:返回非阻断告警(启动时 assertSsoConfigAtStartup 会 fail-fast)
  const warnings: string[] = [];
  if (saved.enabled && !process.env.BFF_SSO_STATE_SECRET) {
    warnings.push(
      'BFF_SSO_STATE_SECRET 未配置:重启后 BFF 将启动失败,请先在部署配置中设置(≥32 字符)。',
    );
  }

  return c.json(ok({ ...buildView(), warnings }));
});

// ---------------------------------------------------------------------------
// DELETE /admin/sso/config — 清除运行时配置,回滚到 env 兜底
// ---------------------------------------------------------------------------

ssoAdminRoutes.delete('/admin/sso/config', (c) => {
  clearSsoRuntimeConfig();
  return c.json(ok(buildView()));
});
