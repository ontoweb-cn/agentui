// @see specs/002-multi-harness-p1/contracts/adapter-registry.ts (TenantContextMiddleware)
// @see specs/002-multi-harness-p1/data-model.md (实体 3)
/**
 * TenantContext 中间件 — 从请求提取 tenantId/userId 构造 TenantContext。
 *
 * Constitution references (v1.2.0):
 * - Principle V (Tenant Isolation): BFF 维护 TenantContext,Adapter 据此注入多租户头
 *
 * P1: 从 X-Tenant-Id / X-User-Id header 提取(简化方案)
 * P3: 扩展为优先从 JWT 提取,header 作为 fallback
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { TenantContext } from '../types/tenant';

/** Hono context key for injected TenantContext */
export const TENANT_CONTEXT_KEY = 'tenantContext';

/**
 * TenantContext 中间件。
 *
 * 行为:
 * - 提取 X-Tenant-Id / X-User-Id header → 构造 TenantContext → c.set('tenantContext', ctx) → next()
 * - tenantId 或 userId 缺失 → 返回 400 明确错误(不静默使用默认 tenant)
 * - P1 不提取 X-Intellect-Team / X-Intellect-Project(单租户场景,Principle V)
 */
export const tenantContextMiddleware: MiddlewareHandler = async (c, next) => {
  const tenantId = c.req.header('X-Tenant-Id');
  const userId = c.req.header('X-User-Id');

  if (!tenantId || !userId) {
    const missing: string[] = [];
    if (!tenantId) missing.push('X-Tenant-Id');
    if (!userId) missing.push('X-User-Id');
    return c.json(
      {
        code: 400,
        message: `Missing required header(s): ${missing.join(', ')}`,
      },
      400,
    );
  }

  const ctx: TenantContext = {
    tenantId,
    userId,
    // P1 不提取企业版头(intellectTeamId/intellectProjectId 留空)
    // P3 扩展:从 JWT 或 header 提取企业版多租户字段
  };

  c.set(TENANT_CONTEXT_KEY, ctx);
  await next();
};

/**
 * 从 Hono context 获取 TenantContext。
 * 路由层用此 helper 取出中间件注入的 ctx。
 */
export function getTenantContext(c: Context): TenantContext | undefined {
  return c.get(TENANT_CONTEXT_KEY);
}
