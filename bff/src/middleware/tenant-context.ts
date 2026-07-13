// @see specs/002-multi-harness-p1/contracts/adapter-registry.ts (TenantContextMiddleware)
// @see specs/002-multi-harness-p1/data-model.md (实体 3)
/**
 * TenantContext 中间件 — 从请求提取 tenantId/userId 构造 TenantContext。
 *
 * Constitution references (v1.2.0):
 * - Principle V (Tenant Isolation): BFF 维护 TenantContext,Adapter 据此注入 Team/Project 组织隔离头
 *   (真正的租户隔离通过多实例:intellectBackendId 绑定不同 intellect-team 实例)
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
 * - P3 扩展:从 TenantStore 读取 BffTenant,注入 intellectTeamId/intellectProjectId
 *   (research.md R3:BffTenant.intellectTenantId 映射到 TenantContext.intellectTeamId → X-Intellect-Team 头)
 *   store 未就绪或 tenant 不存在时,头字段留空(单租户场景兼容)
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
  };

  // P3:从 TenantStore 读取 BffTenant 绑定,注入企业版实例内 Team/Project 组织隔离字段(Principle V)。
  // store 注入由 index.ts 的 context middleware 完成;此处防御性获取。
  const tenantStore = c.get('tenantStore');
  if (tenantStore) {
    const bffTenant = tenantStore.getTenant(tenantId);
    if (bffTenant?.intellectTenantId) {
      // P4b (FR-006):缺省 TenantID="0" 时不注入 X-Intellect-Team 头。
      // intellect-team 侧 _resolve_member_context 检测到无此头时使用全局默认上下文,
      // 实现企业版零 Team/Project 改动兼容(见 intellect-team/docs/agentui-integration/default-tenant-compat.md)。
      if (bffTenant.intellectTenantId === '0') {
        // 缺省租户:不注入 intellectTeamId,留空让 intellect-team 走全局默认
      } else {
        // research.md R3:intellectTenantId 视为 team_id 同义词
        ctx.intellectTeamId = bffTenant.intellectTenantId;
      }
    }
    // P5 (FR-005):intellectProjectId 存在时注入 X-Intellect-Project 头。
    // 注意:project 隶属于 team,仅当 team_id 已绑定(非 "0")时 project 才有意义。
    // 但此处不强制校验 team/project 依赖(intellect-team 侧校验),保持透传灵活性。
    if (bffTenant?.intellectProjectId) {
      ctx.intellectProjectId = bffTenant.intellectProjectId;
    }
  }

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
