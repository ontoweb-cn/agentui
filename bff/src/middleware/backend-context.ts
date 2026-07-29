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
 * - tenantId 或 userId 缺失 → 降级使用默认值('0'/'bff-default')并 console.warn,避免阻断 P1 阶段未注入 header 的调用方
 * - P3 扩展:从 BackendStore 读取 BffTenant,注入 intellectTeamId/intellectProjectId
 *   (research.md R3:BffTenant.intellectTenantId 映射到 BackendContext.intellectTeamId → X-Intellect-Team 头)
 *   store 未就绪或 tenant 不存在时,头字段留空(单租户场景兼容)
 *
 * 默认 tenantId='0' 与 auth.ts:176 / bff-tenants.json 默认租户 ID 保持一致。
 * 原值 'default' 会导致 backendStore.getBackend('default') 返回 undefined → 503。
 */
export const backendContextMiddleware: MiddlewareHandler = async (c, next) => {
  const backendId = c.req.header('X-Backend-Id');
  const userId = c.req.header('X-User-Id');

  // 缺失 X-Backend-Id / X-User-Id 时使用默认值，对齐 resolveBackendContext() 的兜底策略。
  // P1 阶段前端尚未全局注入这些 header（仅部分 API 显式传递），
  // 返回 400 会阻断 agent 列表等核心功能。
  // 默认 '0' 对齐 bff-tenants.json 中 id="0" 的默认租户。
  const ctx: BackendContext = {
    backendId: backendId || '0',
    userId: userId || 'bff-default',
  };

  if (!backendId || !userId) {
    // 记录缺失的 header（有助于调试 P1→P3 迁移时未注入 header 的调用方）
    const missing: string[] = [];
    if (!backendId) missing.push('X-Backend-Id');
    if (!userId) missing.push('X-User-Id');
    console.warn(
      `[backend-context] Using defaults for missing header(s): ${missing.join(', ')} ` +
      `(req ${c.req.path})`,
    );
  }

  // BFF-P0-1: 从 AuthSession 解析 member_id (token → /api/members/me)。
  // 仅企业版 (authMode=intellect-enterprise) 下解析,RAG 版不调用。
  // 解析失败不阻塞(留空),由下游 adapter 按需处理。
  try {
    const { resolveMemberIdFromContext } = await import('../services/member-id-resolver');
    const memberId = await resolveMemberIdFromContext(c);
    if (memberId) {
      ctx.intellectUserId = memberId;
    }
  } catch (_err) {
    // member-id-resolver 不可用时静默跳过(intellect-rag 单租户场景)
  }

  // 方案 B: 从 AuthSession 提取会话 token (imt_*),用于 intellect-rag imt_ 路径。
  // 优先于 admin JWT 传递给 intellect-rag,实现真实身份透传。
  // 仅企业版有值,RAG 版为 undefined(走 admin JWT fallback)。
  try {
    const { getAuthSession } = await import('./auth-session');
    const session = getAuthSession(c);
    if (session?.token) {
      ctx.sessionToken = session.token;
    }
  } catch (_err) {
    // AuthSession 中间件未挂载时静默跳过
  }

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

  // 方案 B: 从 HarnessBackend 读取 intellectTenantId (实例级 tenant_id,非 team_id)。
  // 注入到 X-Intellect-Tenant 头,让 intellect-rag 的 SubjectContext.tenant_id 正确解析。
  // 与 BffTenant.intellectTenantId (实际是 team_id) 不同,这是 intellect-team 实例级标识。
  const harnessStore = c.get('harnessStore');
  if (backendStore && harnessStore) {
    const bffTenant = backendStore.getBackend(backendId);
    if (bffTenant) {
      const harnessBackend = harnessStore.get(bffTenant.intellectBackendId);
      if (harnessBackend?.intellectTenantId) {
        ctx.intellectTenantId = harnessBackend.intellectTenantId;
      }
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
 * 回退到 { backendId: '0', userId: 'bff-default' },避免阻塞。
 *
 * 默认 '0' 与 bff-tenants.json 中 id="0" 的默认租户对齐。
 */
export function resolveBackendContext(c: Context): BackendContext {
  const ctx = getBackendContext(c);
  if (ctx) {
    return ctx;
  }
  // fallback:中间件未注入(如 P1 阶段未传 X-Backend-Id header)时使用默认,避免阻塞
  return {
    backendId: '0',
    userId: 'bff-default',
  };
}
