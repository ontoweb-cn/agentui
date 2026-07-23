// v6-followup-3: token → 团队/项目成员关系解析服务。
//
// 调用 intellect-team GET /api/teams + GET /api/projects(member token 鉴权),
// 解析当前用户所属的 team/project 列表。结果缓存到 membershipCache(TTL 5min)。
//
// 用途:BFF 侧防御性校验,防止用户访问未授权的 team/project 资源。
// 当 BffBackend 配置了 intellectTeamId/intellectProjectId 时,
// requestContextMiddleware 会调用本服务校验用户是否属于该 team/project。
//
// 安全要求:
// - 绝不信任客户端 header,只使用 token 调上游 API
// - 解析失败时返回 undefined,不降级到空列表(空列表会导致误判为"无权限")
// - 仅在企业版 (authMode=intellect-enterprise) 下解析
// - intellect-team 的 GET /api/teams 用 member token 调用时仅返回该 member 参与的团队
//
// 失败策略:
// - 网络错误/401/500 → 返回 undefined(调用方应 fail-open,不阻塞请求)
// - 成功但用户无团队/项目 → 返回 { teamIds: [], projectIds: [] }(明确无成员关系)

import { membershipCache, type Memberships } from './membership-cache';
import type { TenantStore, HarnessStore } from '../types';
import { getAuthSession } from '../middleware/auth-session';

interface TeamListItem {
  /** intellect-team API 返回的 id 字段(实际是 slug,由 team_row_for_api 覆盖) */
  id: string;
  slug?: string;
}

interface ProjectListItem {
  id: string;
  slug?: string;
}

interface ListResponse<T> {
  data?: T[];
}

/**
 * 解析 token → 团队/项目成员关系。
 *
 * @param backendId BFF 内部 backend 标识(如 "0"),用于 composite cache key
 * @param token imt_* member token(从 cookie 提取)
 * @param backendEndpoint intellect-team 实例 endpoint(如 http://localhost:9381)
 * @returns 成员关系,或 undefined(解析失败/token 无效)
 */
export async function resolveMemberships(
  backendId: string,
  token: string,
  backendEndpoint: string,
): Promise<Memberships | undefined> {
  // 1. 查缓存
  const cached = membershipCache.get(backendId, token);
  if (cached) {
    return cached;
  }

  // 2. 并行调 /api/teams + /api/projects
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const [teamsResult, projectsResult] = await Promise.allSettled([
    fetch(`${backendEndpoint}/api/teams`, {
      method: 'GET',
      headers: authHeaders,
    }),
    fetch(`${backendEndpoint}/api/projects`, {
      method: 'GET',
      headers: authHeaders,
    }),
  ]);

  // 3. 解析 teams 响应(401 表示 token 无效,直接返回 undefined)
  if (teamsResult.status === 'rejected') {
    console.error(
      '[membership-resolver] /api/teams fetch rejected:',
      teamsResult.reason?.message ?? teamsResult.reason,
    );
    return undefined;
  }

  const teamsResp = teamsResult.value;
  if (teamsResp.status === 401) {
    // token 无效,不缓存
    return undefined;
  }
  if (!teamsResp.ok) {
    const text = await teamsResp.text().catch(() => '');
    console.error(
      `[membership-resolver] /api/teams failed: ${teamsResp.status}`,
      text,
    );
    return undefined;
  }

  let teamsData: ListResponse<TeamListItem>;
  try {
    teamsData = (await teamsResp.json()) as ListResponse<TeamListItem>;
  } catch (err) {
    console.error(
      '[membership-resolver] /api/teams JSON parse error:',
      (err as Error).message,
    );
    return undefined;
  }

  // 4. 解析 projects 响应(允许失败,project 校验是可选的)
  let projectIds: string[] = [];
  if (projectsResult.status === 'fulfilled') {
    const projectsResp = projectsResult.value;
    if (projectsResp.status === 401) {
      // token 无效(与 teams 不一致?保守起见返回 undefined)
      return undefined;
    }
    if (projectsResp.ok) {
      try {
        const projectsData = (await projectsResp.json()) as ListResponse<ProjectListItem>;
        projectIds = extractIds(projectsData.data);
      } catch (err) {
        console.error(
          '[membership-resolver] /api/projects JSON parse error:',
          (err as Error).message,
        );
        // projects 解析失败不影响 teams,继续用空 projectIds
      }
    } else {
      // projects 端点返回非 401 错误(如 503 功能未启用),记录但不阻塞
      console.warn(
        `[membership-resolver] /api/projects returned ${projectsResp.status}, project validation will be skipped`,
      );
    }
  } else {
    console.warn(
      '[membership-resolver] /api/projects fetch rejected:',
      projectsResult.reason?.message ?? projectsResult.reason,
    );
  }

  // 5. 提取 team ids
  const teamIds = extractIds(teamsData.data);

  // 6. 缓存并返回
  const memberships: Memberships = { teamIds, projectIds };
  membershipCache.set(backendId, token, memberships);

  return memberships;
}

/**
 * 从 list 响应的 data 字段提取 id(slug)列表。
 * 同时检查 id 和 slug 字段,去重。
 */
function extractIds(items: TeamListItem[] | ProjectListItem[] | undefined): string[] {
  if (!Array.isArray(items)) {
    return [];
  }
  const ids = new Set<string>();
  for (const item of items) {
    if (item && typeof item.id === 'string' && item.id) {
      ids.add(item.id);
    }
    if (item && typeof item.slug === 'string' && item.slug) {
      ids.add(item.slug);
    }
  }
  return Array.from(ids);
}

/**
 * 从 Hono Context 解析当前用户的成员关系(企业版专用)。
 *
 * 流程:
 * 1. 从 authSession 取 token
 * 2. 用 tenantStore + harnessStore 解析 intellect-team endpoint
 * 3. 调 resolveMemberships(token, endpoint) 获取成员关系
 *
 * @returns 成员关系,或 undefined(无 session/后端配置缺失/解析失败)
 *          RAG 版直接返回 undefined(不需要成员关系校验)
 */
export async function resolveMembershipsFromContext(c: {
  get: (key: string) => unknown;
}): Promise<Memberships | undefined> {
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

  return resolveMemberships(session.tenantId, session.token, backend.endpoint);
}
