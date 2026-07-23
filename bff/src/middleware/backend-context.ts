// @see specs/002-multi-harness-p1/contracts/adapter-registry.ts (BackendContextMiddleware)
// @see specs/002-multi-harness-p1/data-model.md (实体 3)
/**
 * BackendContext 中间件 — 从请求提取 tenantId/userId 构造 BackendContext。
 *
 * Constitution references (v1.2.0):
 * - Principle V (Tenant Isolation): BFF 维护 BackendContext,Adapter 据此注入 Team/Project 组织隔离头
 *   (真正的租户隔离通过多实例:intellectBackendId 绑定不同 intellect-team 实例)
 *
 * P1: 从 X-Backend-Id / X-User-Id header 提取(简化方案)
 * P3: 扩展为优先从 JWT 提取,header 作为 fallback
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { BackendContext } from '../types/tenant';

/** Hono context key for injected BackendContext */
export const BACKEND_CONTEXT_KEY = 'backendContext';

/**
 * BackendContext 中间件。
 *
 * 行为:
 * - 提取 X-Backend-Id / X-User-Id header → 构造 BackendContext → c.set('backendContext', ctx) → next()
 * - tenantId 或 userId 缺失 → 返回 400 明确错误(不静默使用默认 tenant)
 * - P3 扩展:从 BackendStore 读取 BffTenant,注入 intellectTeamId/intellectProjectId
 *   (research.md R3:BffTenant.intellectTenantId 映射到 BackendContext.intellectTeamId → X-Intellect-Team 头)
 *   store 未就绪或 tenant 不存在时,头字段留空(单租户场景兼容)
 */
export const backendContextMiddleware: MiddlewareHandler = async (c, next) => {
  const backendId = c.req.header('X-Backend-Id');
  const userId = c.req.header('X-User-Id');

  if (!backendId || !userId) {
    const missing: string[] = [];
    if (!backendId) missing.push('X-Backend-Id');
    if (!userId) missing.push('X-User-Id');
    return c.json(
      {
        code: 400,
        message: `Missing required header(s): ${missing.join(', ')}`,
      },
      400,
    );
  }

  const ctx: BackendContext = {
    backendId,
    userId,
  };

  // P3:从 BackendStore 读取 BffTenant 绑定,注入企业版实例内 Team/Project 组织隔离字段(Principle V)。
  // store 注入由 index.ts 的 context middleware 完成;此处防御性获取。
  const backendStore = c.get('backendStore');
  if (backendStore) {
    const bffTenant = backendStore.getBackend(backendId);
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

  c.set(BACKEND_CONTEXT_KEY, ctx);
  await next();
};

/**
 * 从 Hono context 获取 BackendContext。
 * 路由层用此 helper 取出中间件注入的 ctx。
 */
export function getBackendContext(c: Context): BackendContext | undefined {
  return c.get(BACKEND_CONTEXT_KEY);
}

/**
 * 从 Hono context 解析 BackendContext,缺失时返回社区版默认租户上下文。
 *
 * 用于路由 handler:优雅降级,中间件未注入时(如测试环境或未挂载中间件的路由)
 * 回退到 { backendId: 'default', userId: 'bff-default' },避免阻塞。
 */
export function resolveBackendContext(c: Context): BackendContext {
  const ctx = getBackendContext(c);
  if (ctx) {
    return ctx;
  }
  // fallback:中间件未注入(如 P1 阶段未传 X-Backend-Id header)时使用默认,避免阻塞
  return {
    backendId: 'default',
    userId: 'bff-default',
  };
}
