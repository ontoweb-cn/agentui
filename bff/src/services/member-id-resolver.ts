// v6-followup: token → member_id 解析服务。
//
// 调用 intellect-team GET /api/members/me 校验 token + 解析 member_id + role。
// 解析结果缓存到 memberIdCache(TTL 60s),避免每次请求都调上游。
//
// v9 (BFF-P2-2):新增 resolveMemberInfo 返回 { memberId, role },
// 让 llm-auth 中间件共享缓存(消除 /chats/* 无缓存的双路径问题)。
// resolveMemberId 保持兼容(内部调 resolveMemberInfo 取 .memberId)。
//
// v9 (BFF-P2-4):所有 cache 调用传入 backendId,复合 key `${backendId}:${token}`,
// 防御多实例部署时不同 backend 下 token 碰撞。
//
// 安全要求:
// - 绝不信任客户端 X-User-Id header
// - /api/members/me 失败时返回 undefined,不降级
// - 仅在企业版 (authMode=intellect-enterprise) 下解析
//   RAG 版不需要 member_id(单租户场景)

import { memberIdCache } from './member-id-cache';
import type { TenantStore, HarnessStore } from '../types';
import { getAuthSession } from '../middleware/auth-session';

interface MemberInfoResponse {
  member_id: string;
  role?: string;
  team_id?: string;
}

export interface MemberInfo {
  memberId: string;
  role: string;
}

/**
 * 解析 token → { memberId, role }(v9 新增,带 60s 缓存)。
 *
 * @param backendId BFF Backend ID(用于 cache 复合 key,多实例隔离)
 * @param token imt_* member token(从 cookie 提取)
 * @param backendEndpoint intellect-team 实例 endpoint(如 http://localhost:9381)
 * @returns { memberId, role },或 undefined(解析失败/token 无效)
 */
export async function resolveMemberInfo(
  backendId: string,
  token: string,
  backendEndpoint: string,
): Promise<MemberInfo | undefined> {
  // 1. 查缓存(v9 BFF-P2-4:复合 key `${backendId}:${token}`)
  const cached = memberIdCache.get(backendId, token);
  if (cached) {
    return { memberId: cached.memberId, role: cached.role };
  }

  // 2. 调 intellect-team /api/members/me
  let resp: Response;
  try {
    resp = await fetch(`${backendEndpoint}/api/members/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    console.error(
      '[member-id-resolver] intellect-team /me fetch error:',
      (err as Error).message,
    );
    return undefined; // 不降级
  }

  if (resp.status === 401) {
    // token 无效,不缓存(下次请求仍会重试)
    return undefined;
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(
      `[member-id-resolver] intellect-team /me failed: ${resp.status}`,
      text,
    );
    return undefined;
  }

  let data: MemberInfoResponse;
  try {
    data = (await resp.json()) as MemberInfoResponse;
  } catch (err) {
    console.error(
      '[member-id-resolver] intellect-team /me JSON parse error:',
      (err as Error).message,
    );
    return undefined;
  }

  // 3. 校验 member_id 非空
  if (!data.member_id || typeof data.member_id !== 'string') {
    console.error(
      '[member-id-resolver] intellect-team /me returned invalid response: missing or invalid member_id',
      data,
    );
    return undefined;
  }

  // 4. 写入缓存(role 缺失时兜底为 'member')
  const role = data.role || 'member';
  memberIdCache.set(backendId, token, data.member_id, role);

  return { memberId: data.member_id, role };
}

/**
 * 解析 token → member_id(兼容旧接口,内部调 resolveMemberInfo)。
 *
 * @param backendId BFF Backend ID(用于 cache 复合 key,多实例隔离)
 * @param token imt_* member token(从 cookie 提取)
 * @param backendEndpoint intellect-team 实例 endpoint(如 http://localhost:9381)
 * @returns member_id,或 undefined(解析失败/token 无效)
 */
export async function resolveMemberId(
  backendId: string,
  token: string,
  backendEndpoint: string,
): Promise<string | undefined> {
  const info = await resolveMemberInfo(backendId, token, backendEndpoint);
  return info?.memberId;
}

/**
 * 从 Hono Context 解析当前用户的 member_id(企业版专用)。
 *
 * 流程:
 * 1. 从 authSession 取 token + backendId
 * 2. 用 tenantStore + harnessStore 解析 intellect-team endpoint
 * 3. 调 resolveMemberId(backendId, token, endpoint) 获取 member_id
 *
 * @returns member_id,或 undefined(无 session/后端配置缺失/解析失败)
 *          RAG 版直接返回 undefined(不需要 member_id)
 */
export async function resolveMemberIdFromContext(c: {
  get: (key: string) => unknown;
}): Promise<string | undefined> {
  const session = getAuthSession(c);
  if (!session) {
    return undefined;
  }

  // v7:authMode 已固定为企业版,无需检查 session.authMode

  const tenantStore = c.get('tenantStore') as TenantStore | undefined;
  const harnessStore = c.get('harnessStore') as HarnessStore | undefined;
  if (!tenantStore || !harnessStore) {
    return undefined;
  }

  const backendConfig = tenantStore.getTenant(session.tenantId);
  if (!backendConfig) {
    return undefined;
  }

  const backend = harnessStore.get(backendConfig.intellectBackendId);
  if (!backend) {
    return undefined;
  }

  // v9 BFF-P2-4:传 backendId 用作 cache 复合 key
  return resolveMemberId(session.tenantId, session.token, backend.endpoint);
}
