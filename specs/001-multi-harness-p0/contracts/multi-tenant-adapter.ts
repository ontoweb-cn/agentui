/**
 * Contract: IMultiTenantAdapter — Extension Layer (Layer 2)
 *
 * Authority source: specs/001-multi-harness-p0/contracts/multi-tenant-adapter.ts
 * Runtime copy: bff/src/types/adapter.ts (merged with harness-adapter.ts)
 *
 * Constitution references:
 * - Principle II (Adapter Abstraction):
 *   Layer 2 extension interface — only backends with capabilities.multiTenant = true
 *   implement this (i.e., Intellect Enterprise).
 *   Layer 1 IHarnessAdapter is always required; IMultiTenantAdapter is optional.
 * - Principle V (Tenant Isolation via BFF):
 *   BFF does NOT own Team/Project/Member data. This interface forwards to
 *   Intellect Enterprise HTTP API. BFF Tenant only stores binding refs.
 *   BFF does NOT maintain permission model — Intellect Member role enforces.
 */

import type {
  Team,
  Project,
  TeamMember,
  ProjectMember,
} from './domain-models';
import type { TenantContext } from './tenant-context';
import type { IHarnessAdapter } from './harness-adapter';

// ---------------------------------------------------------------------------
// IMultiTenantAdapter — Extension Layer (Layer 2, Intellect Enterprise only)
// ---------------------------------------------------------------------------

/**
 * Team/Project 组织扩展契约。
 * 仅 Intellect 企业版(capabilities.multiTenant = true)实现。
 * 必须同时实现 IHarnessAdapter(Layer 1)。
 * 注:真正的租户隔离通过多实例部署实现,此契约仅定义实例内 Team/Project 组织隔离能力。
 *
 * Constitution Principle V (v1.1.0): Team/Project/Member 通过此接口透传到
 * intellect-team HTTP API,BFF 不存副本,不维护权限模型。
 * 实际 intellect-team 端点(从 plugins/platforms/api_server/adapter.py 确认):
 * - Team/Project/Member CRUD: 由 intellect-team /api/sessions 等会话级端点隐式管理,
 *   目前没有独立的 /api/teams 或 /api/projects HTTP 端点(P4+ 由 intellect-team 侧新增)
 * - 实例内 Team/Project 数据隔离通过 X-Intellect-Team / X-Intellect-Project 头注入(真正租户隔离通过多实例部署)
 *
 * Implementation lifecycle:
 * - P0: contract only (this file), no implementation
 * - P3: IntellectEnterpriseAdapter implements IHarnessAdapter + IMultiTenantAdapter
 * - P4+: intellect-team 侧补齐 Team/Project/Member HTTP 端点后,本接口才能完整实现
 *
 * P3 阶段 IntellectEnterpriseAdapter 可先实现 createSession/listSessions 等会话级方法
 * (依赖 intellect-team /api/sessions 端点),Team/Project/Member 管理暂留 stub 抛 NotImplemented。
 */
export interface IMultiTenantAdapter extends IHarnessAdapter {
  // -----------------------------------------------------------------------
  // Team CRUD
  // -----------------------------------------------------------------------

  /**
   * 列出当前租户下的所有 Team。
   * @param ctx 租户上下文(ctx.intellectTenantId 必填)
   */
  listTeams(ctx: TenantContext): Promise<Team[]>;

  /**
   * 创建 Team。
   * @param ctx 租户上下文
   * @param name Team 名称
   * @param slug Team slug
   * @param description 描述(可选)
   */
  createTeam(
    ctx: TenantContext,
    name: string,
    slug: string,
    description?: string,
  ): Promise<Team>;

  /**
   * 获取单个 Team 详情。
   */
  getTeam(ctx: TenantContext, teamId: string): Promise<Team>;

  /**
   * 更新 Team。
   * @param ctx 租户上下文
   * @param teamId Team ID
   * @param patch 部分更新字段
   */
  updateTeam(
    ctx: TenantContext,
    teamId: string,
    patch: Partial<Pick<Team, 'name' | 'slug' | 'description'>>,
  ): Promise<Team>;

  /**
   * 删除 Team。
   */
  deleteTeam(ctx: TenantContext, teamId: string): Promise<void>;

  // -----------------------------------------------------------------------
  // Team Member management
  // -----------------------------------------------------------------------

  /**
   * 列出 Team 成员。
   */
  listTeamMembers(ctx: TenantContext, teamId: string): Promise<TeamMember[]>;

  /**
   * 添加 Team 成员。
   * @param ctx 租户上下文
   * @param teamId Team ID
   * @param userId 用户 ID
   * @param role 角色
   */
  addTeamMember(
    ctx: TenantContext,
    teamId: string,
    userId: string,
    role: TeamMember['role'],
  ): Promise<TeamMember>;

  /**
   * 更新 Team 成员角色。
   */
  updateTeamMemberRole(
    ctx: TenantContext,
    teamId: string,
    userId: string,
    role: TeamMember['role'],
  ): Promise<TeamMember>;

  /**
   * 移除 Team 成员。
   */
  removeTeamMember(ctx: TenantContext, teamId: string, userId: string): Promise<void>;

  // -----------------------------------------------------------------------
  // Project CRUD
  // -----------------------------------------------------------------------

  /**
   * 列出 Team 下的所有 Project。
   */
  listProjects(ctx: TenantContext, teamId: string): Promise<Project[]>;

  /**
   * 创建 Project。
   */
  createProject(
    ctx: TenantContext,
    teamId: string,
    name: string,
    slug: string,
    description?: string,
  ): Promise<Project>;

  /**
   * 获取单个 Project 详情。
   */
  getProject(ctx: TenantContext, teamId: string, projectId: string): Promise<Project>;

  /**
   * 更新 Project。
   */
  updateProject(
    ctx: TenantContext,
    teamId: string,
    projectId: string,
    patch: Partial<Pick<Project, 'name' | 'slug' | 'description'>>,
  ): Promise<Project>;

  /**
   * 删除 Project。
   */
  deleteProject(ctx: TenantContext, teamId: string, projectId: string): Promise<void>;

  // -----------------------------------------------------------------------
  // Project Member management
  // -----------------------------------------------------------------------

  /**
   * 列出 Project 成员。
   */
  listProjectMembers(
    ctx: TenantContext,
    teamId: string,
    projectId: string,
  ): Promise<ProjectMember[]>;

  /**
   * 添加 Project 成员。
   */
  addProjectMember(
    ctx: TenantContext,
    teamId: string,
    projectId: string,
    userId: string,
    role: ProjectMember['role'],
  ): Promise<ProjectMember>;

  /**
   * 更新 Project 成员角色。
   */
  updateProjectMemberRole(
    ctx: TenantContext,
    teamId: string,
    projectId: string,
    userId: string,
    role: ProjectMember['role'],
  ): Promise<ProjectMember>;

  /**
   * 移除 Project 成员。
   */
  removeProjectMember(
    ctx: TenantContext,
    teamId: string,
    projectId: string,
    userId: string,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Type Guard
// ---------------------------------------------------------------------------

/**
 * 类型守卫:Adapter 是否支持实例内 Team/Project 组织模型(实现了 IMultiTenantAdapter)。
 * BFF 路由层据此决定是否暴露 Team/Project 相关端点。
 * 注意:真正的租户隔离通过多实例部署实现,此 guard 仅判断实例内组织模型扩展能力。
 *
 * Constitution Principle II: 路由层用 capabilities.multiTenant 静态判断,
 * 此 guard 作为运行时双保险。
 */
export function isMultiTenantAdapter(
  adapter: IHarnessAdapter,
): adapter is IMultiTenantAdapter {
  return 'listTeams' in adapter && typeof (adapter as IMultiTenantAdapter).listTeams === 'function';
}
