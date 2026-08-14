// Multi-Harness P3: LLM Admin 路由专用认证 + 授权中间件。
// Constitution Principle I (BFF-Mediated Frontend) + V (Tenant Isolation) + VIII (API_SERVER_KEY)。
//
// 修复 P0-1(认证绕过)+ P1-5(无 RBAC):
// authMiddleware 仅校验 Authorization header / imt_token cookie 的"存在性",
// 对 /proxy/* 透传路由仅存在性校验(上游 401 被 proxy.ts 吞成空数据返回,并未真正拒绝),
// 但 /llm/* 路由使用 BFF 自己的 adminToken 调上游,用户 token 从未转发也从未校验,
// 导致任何发送 `Authorization: Bearer x` 的请求都能执行 admin 操作。
//
// 本中间件:
// 1. 从 cookie 提取 imt_token(经 authSessionMiddleware 注入到 c.get('authSession'))
// 2. 调 intellect-team GET /api/members/me 校验 token 真实性 + 解析 role
//    (v9:改为调 resolveMemberInfo,共享 memberIdCache 5min 缓存,
//     消除 /chats/* 每次请求都调 /api/members/me 的性能问题)
// 3. 按 requireAdmin 配置决定是否仅允许 admin 角色
// 4. 校验失败返回 401/403(envelope code),不进入路由 handler
//
// 错误响应模式(P1-4 方案 B):
// 所有响应(含错误)均返回 HTTP 200,错误信息通过 envelope 中的 code(非零)+ message 传递。
// 这对齐 next-request.ts L147-153 已有的 `code !== 0` 通知路径。
// 注意:code:401 在企业版模式下会被 next-request.ts L130-146 跳过自动登出(与 HTTP 401
// error 拦截器 L159-176 行为一致),不改变既有企业版兼容逻辑。
//
// v9 (BFF-P2-2):不再直接 fetch /api/members/me,改为调 resolveMemberInfo 共享缓存。
// 失败语义保持 fail-closed(401/502),与 requestContextMiddleware 的 fail-open 有意区分:
// - /chats/* /llm/* 路径需要强制认证(fail-closed)
// - /proxy/* /canvas/* 路径允许匿名(fail-open)

import type { Context, Next } from 'hono';
import type { HarnessStore, BackendStore } from '../types';
import { getAuthSession } from './auth-session';
import { resolveMemberInfo } from '../services/member-id-resolver';

/**
 * LLM Admin 认证 + 授权中间件工厂。
 *
 * @param requireAdmin true 时仅允许 admin 角色(用于 POST/PUT/DELETE 破坏性路由);
 *                     false 时允许任意有效 member(用于 GET 只读路由)。
 */
export function createLlmAuthMiddleware(options: { requireAdmin: boolean }) {
  const { requireAdmin } = options;
  return async function llmAuthMiddleware(c: Context, next: Next) {
    // Step 1: 从 authSessionMiddleware 注入的 context 取 session
    const session = getAuthSession(c);
    if (!session) {
      return c.json(
        { code: 401, message: 'Unauthorized: no valid session cookie', data: null },
      );
    }

    // Step 2: 解析企业版后端 endpoint
    const backendStore = c.get('backendStore') as BackendStore | undefined;
    const harnessStore = c.get('harnessStore') as HarnessStore | undefined;
    if (!backendStore || !harnessStore) {
      return c.json(
        { code: 503, message: 'Service unavailable: stores not ready', data: null },
      );
    }

    const backendConfig = backendStore.getBackend(session.backendId);
    if (!backendConfig) {
      return c.json(
        { code: 401, message: 'Unauthorized: backend not found', data: null },
      );
    }
    const backend = harnessStore.get(backendConfig.intellectBackendId);
    if (!backend) {
      return c.json(
        { code: 503, message: 'Enterprise backend not configured', data: null },
      );
    }

    // Step 3: 调 resolveMemberInfo 校验 token + 解析 role
    // v9:共享 memberIdCache 60s 缓存(与 requestContextMiddleware 路径统一)
    // v9 BFF-P2-4:传 session.backendId 用作 cache 复合 key
    let info;
    try {
      info = await resolveMemberInfo(session.backendId, session.token, backend.endpoint);
    } catch (err) {
      console.error('[llm-auth] resolveMemberInfo error:', (err as Error).message);
      return c.json(
        { code: 502, message: 'intellect-team unreachable', data: null },
      );
    }

    if (!info) {
      // resolveMemberInfo 返回 undefined 可能是 401(token 无效)或 502(上游错误)
      // fail-closed:统一返回 401(与原实现一致,token 无效是最常见原因)
      return c.json(
        { code: 401, message: 'Unauthorized: invalid token or member identity not resolved', data: null },
      );
    }

    // P1-1 修复:member_id 非空校验(resolveMemberInfo 内部已校验,这里二次防御)
    if (!info.memberId || typeof info.memberId !== 'string') {
      return c.json(
        { code: 502, message: 'intellect-team /me returned invalid member identity', data: null },
      );
    }

    // Step 4: RBAC 检查
    // owner 与 admin 均视为管理员(与 RAG _is_tenant_admin / 认知兵棋一致;owner 为最高角色)。
    if (requireAdmin && info.role !== 'admin' && info.role !== 'owner') {
      return c.json(
        { code: 403, message: 'Forbidden: admin or owner role required', data: null },
      );
    }

    // 注入 memberId 供下游 handler 使用
    c.set('llmAuthMemberId', info.memberId);
    await next();
  };
}

/** 只读路由(GET)使用的认证中间件:允许任意有效 member */
export const llmReadAuth = createLlmAuthMiddleware({ requireAdmin: false });

/** 破坏性路由(POST/PUT/DELETE)使用的认证中间件:仅允许 admin */
export const llmAdminAuth = createLlmAuthMiddleware({ requireAdmin: true });
