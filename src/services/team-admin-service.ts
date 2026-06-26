// Multi-Harness P5 (US1/US2/US3):Team/Project/Tenant-binding Admin 服务层封装。
// Constitution Principle I (BFF-Mediated Frontend) + V (Tenant Isolation) + VIII (API_SERVER_KEY)。
// 前端 Admin 页面通过此 service 调 BFF `/api/bff/admin/{teams,projects,tenants}` CRUD 接口。
// 字段对齐 intellect-team 实际契约:slug/display_name/created_by,软删除(archive)。

import api from '@/utils/api';
import request from '@/utils/next-request';

// ---------------------------------------------------------------------------
// Types — 与 BFF src/types/team.ts 同步
// ---------------------------------------------------------------------------

/** intellect-team Team 实体。 */
export interface Team {
  id: string;
  slug: string;
  display_name: string;
  enabled: number;
  created_at: number | string;
  updated_at?: number | string;
}

/** 创建 Team 表单(created_by 由 BFF 从 session 自动注入,前端可不传)。 */
export interface CreateTeamForm {
  slug: string;
  display_name: string;
  created_by?: string;
}

/** intellect-team Project 实体。 */
export interface Project {
  id: string;
  slug: string;
  display_name: string;
  team_id?: string;
  repo_url?: string;
  status?: 'active' | 'archived';
  created_at: number | string;
  updated_at?: number | string;
}

/** 创建 Project 表单。 */
export interface CreateProjectForm {
  slug: string;
  display_name: string;
  created_by?: string;
  team_ref?: string;
  repo_url?: string;
}

/** Tenant 绑定状态。 */
export interface TenantBinding {
  tenant_id: string;
  tenant_name: string;
  intellect_tenant_id: string;
  intellect_project_id: string | null;
  is_default: boolean;
}

/** 更新绑定的表单。 */
export interface UpdateBindingForm {
  intellect_tenant_id?: string;
  intellect_project_id?: string;
}

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

// ---------------------------------------------------------------------------
// Team CRUD
// ---------------------------------------------------------------------------

/** 列出所有 Team。 GET /api/bff/admin/teams */
export const listTeams = () =>
  request.get<ApiResponse<Team[]>>(api.adminTeams);

/** 创建 Team(created_by 自动从 session 注入)。 POST /api/bff/admin/teams */
export const createTeam = (form: CreateTeamForm) =>
  request.post<ApiResponse<Team>>(api.adminTeams, form);

/** 获取单个 Team(ref 为 slug 或 id)。 GET /api/bff/admin/teams/:ref */
export const getTeam = (ref: string) =>
  request.get<ApiResponse<Team>>(api.adminTeam(ref));

/** 归档 Team(软删除,enabled=0)。 DELETE /api/bff/admin/teams/:ref */
export const archiveTeam = (ref: string) =>
  request.delete<ApiResponse<{ archived: boolean }>>(api.adminTeam(ref));

// ---------------------------------------------------------------------------
// Project CRUD
// ---------------------------------------------------------------------------

/** 列出所有 Project。 GET /api/bff/admin/projects */
export const listProjects = () =>
  request.get<ApiResponse<Project[]>>(api.adminProjects);

/** 创建 Project。 POST /api/bff/admin/projects */
export const createProject = (form: CreateProjectForm) =>
  request.post<ApiResponse<Project>>(api.adminProjects, form);

/** 获取单个 Project。 GET /api/bff/admin/projects/:ref */
export const getProject = (ref: string) =>
  request.get<ApiResponse<Project>>(api.adminProject(ref));

/** 归档 Project(软删除,archived=1)。 DELETE /api/bff/admin/projects/:ref */
export const archiveProject = (ref: string) =>
  request.delete<ApiResponse<{ archived: boolean }>>(api.adminProject(ref));

// ---------------------------------------------------------------------------
// Tenant Binding
// ---------------------------------------------------------------------------

/** 获取 Tenant 绑定状态。 GET /api/bff/admin/tenants/:id/binding */
export const getTenantBinding = (tenantId: string) =>
  request.get<ApiResponse<TenantBinding>>(api.adminTenantBinding(tenantId));

/** 更新 Tenant 绑定(intellect_tenant_id="0" 或空 → 回退缺省)。 PUT /api/bff/admin/tenants/:id/binding */
export const updateTenantBinding = (
  tenantId: string,
  form: UpdateBindingForm,
) =>
  request.put<ApiResponse<TenantBinding>>(
    api.adminTenantBinding(tenantId),
    form,
  );
