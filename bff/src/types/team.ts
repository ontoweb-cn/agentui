// @see specs/007-team-project-management/spec.md (FR-001/FR-002)
// @see intellect-team/docs/agentui-integration/teams-projects-api.md (实际契约)
/**
 * Contract: Team & Project entities (intellect-team 侧业务实体透传)。
 *
 * Constitution references (v1.2.0):
 * - Principle V (Tenant Isolation via BFF): BffTenant 只存绑定 refs,
 *   Team/Project 业务数据通过 intellect-team HTTP API 透传管理。
 * - Principle VII (YAGNI): P5 仅透传 CRUD,不实现复杂业务逻辑(成员管理/权限)。
 *
 * 字段对齐 intellect-team 实际实现(plugins/platforms/api_server/adapter.py):
 * - Team: {id, slug, display_name, enabled, created_at}
 * - Project: {id, slug, display_name, team_id, repo_url, status, created_at}
 * - 创建需 created_by(member_id),BFF 从 AuthSession 注入
 * - DELETE 是软删除(archive),非硬删除
 */

/** intellect-team 侧的 Team 实体。 */
export interface Team {
  /** intellect-team DB 中 teams.slug(公开标识,BffTenant.intellectTenantId 绑定此值) */
  id: string;
  /** URL 友好标识(唯一) */
  slug: string;
  /** 人类可读名称 */
  display_name: string;
  /** 是否启用(1=启用,0=已归档/软删除) */
  enabled: number;
  /** ISO 时间戳或 epoch(float) */
  created_at: number | string;
  /** 可选:更新时间 */
  updated_at?: number | string;
}

/** 创建 Team 的请求体(POST /api/teams)。 */
export interface CreateTeamRequest {
  /** URL 友好标识(唯一) */
  slug: string;
  /** 人类可读名称 */
  display_name: string;
  /** 创建者 member_id(creator 自动成为 team admin) */
  created_by: string;
}

/** 更新 Team 的请求体。
 * 注意:intellect-team P5 未实现 PUT /api/teams/{id},此类型保留供未来扩展。
 */
export interface UpdateTeamRequest {
  display_name?: string;
}

/** intellect-team 侧的 Project 实体。 */
export interface Project {
  /** intellect-team DB 中 projects.slug(公开标识) */
  id: string;
  /** URL 友好标识(唯一) */
  slug: string;
  /** 人类可读名称 */
  display_name: string;
  /** 所属 Team ID(slug),可选(可独立存在) */
  team_id?: string;
  /** 可选仓库 URL */
  repo_url?: string;
  /** 状态:active 或 archived */
  status?: 'active' | 'archived';
  /** ISO 时间戳或 epoch(float) */
  created_at: number | string;
  /** 可选:更新时间 */
  updated_at?: number | string;
}

/** 创建 Project 的请求体(POST /api/projects)。 */
export interface CreateProjectRequest {
  /** URL 友好标识(唯一) */
  slug: string;
  /** 人类可读名称 */
  display_name: string;
  /** 创建者 member_id(creator 自动成为 project_admin) */
  created_by: string;
  /** 可选:关联团队(slug 或 id) */
  team_ref?: string;
  /** 可选:仓库 URL */
  repo_url?: string;
}

/** 更新 Project 的请求体。
 * 注意:intellect-team P5 未实现 PUT /api/projects/{id},此类型保留供未来扩展。
 */
export interface UpdateProjectRequest {
  display_name?: string;
}
