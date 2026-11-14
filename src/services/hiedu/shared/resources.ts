// hiedu 资源方法(shared 层):契约到 HTTP 的纯映射,不含宿主逻辑。
// 由 api.ts 机械拆分生成;类型为模块级导出,方法经 createResources(client) 组装。

import type { HieduClient } from './client';

import type {
  AccountPreview,
  ApiResult,
  AuditLog,
  ClassUnit,
  DashboardSummary,
  DictItem,
  ExportJob,
  ImportJob,
  ImportPreview,
  Invitation,
  JobItem,
  JobsView,
  Me,
  Person,
  PersonChange,
  PersonPII,
  PersonRelation,
  Project,
  QueryParams,
  ReconcileSnapshot,
  ReconcileStatus,
  SyncLog,
  Unit,
  UnitImpact,
} from './contract';

interface RawPersonChange {
  id?: number;
  ID?: number;
  person_id?: number;
  PersonID?: number;
  field?: string;
  Field?: string;
  old_value?: string | null;
  OldValue?: string | null;
  new_value?: string | null;
  NewValue?: string | null;
  actor?: string;
  Actor?: string;
  created_at?: string;
  CreatedAt?: string;
}

function normalizePersonChange(raw: RawPersonChange): PersonChange {
  return {
    id: raw.id ?? raw.ID ?? 0,
    person_id: raw.person_id ?? raw.PersonID ?? 0,
    field: raw.field ?? raw.Field ?? '',
    old_value: raw.old_value ?? raw.OldValue ?? '',
    new_value: raw.new_value ?? raw.NewValue ?? '',
    actor: raw.actor ?? raw.Actor ?? '',
    created_at: raw.created_at ?? raw.CreatedAt ?? '',
  };
}

// ---------- 资源方法 ----------

export interface CreateUnitBody {
  parent_id?: number;
  unit_code: string;
  name: string;
  short_name?: string;
  category_code: string;
  subtype_code?: string;
  idp_projection?: boolean;
}

export interface UpdateUnitBody {
  name?: string;
  short_name?: string;
  idp_projection?: boolean;
  parent_id?: number;
}

export interface CreatePersonBody {
  person_no: string;
  person_type: string;
  name: string;
  title_code?: string;
  staff_no?: string;
  student_no?: string;
  email?: string;
  department_id?: number;
  position_code?: string;
  no_account?: boolean;
}

export interface UpdatePersonBody {
  name?: string;
  email?: string;
  title_code?: string;
}

export interface TransferBody {
  old_relation?: number;
  new_unit_id?: number;
  position_code?: string;
  end_date?: string;
}

export interface CreateProjectBody {
  project_code: string;
  name: string;
  category_code: string;
  owner_person_id?: number;
  unit_id?: number;
  course_code?: string;
  start_date?: string;
  end_date?: string;
  max_members?: number;
}

export interface CreateClassBody {
  class_code: string;
  name: string;
  grade_year?: number;
  unit_id?: number;
  head_teacher_person_id?: number;
  status?: string;
}

export interface UpdateClassBody {
  name?: string;
  grade_year?: number;
  unit_id?: number;
  head_teacher_person_id?: number;
  status?: string;
}

export interface UpsertDictBody {
  dict_type: string;
  code: string;
  name: string;
  parent_code?: string;
  attrs?: string;
  sort?: number;
  is_enabled?: boolean;
}

export interface CreateInvitationBody {
  project_id: number;
  inviter_person_id?: number;
  invitee_person_id?: number;
  max_uses?: number;
}

export interface CreateInvitationResult {
  status: string;
  /** 明文 token 仅创建时返回一次，请立即分发保管。 */
  token: string;
}

// ---------- 角色与授权 ----------

export interface Role {
  id?: number;
  org_code: string;
  code: string;
  name: string;
  permissions: string[];
  scope_all: boolean;
  is_system: boolean;
  status: string;
}

export interface RoleSummary extends Role {
  assignment_count: number;
  assigned_person_count: number;
  updated_at?: string;
}

export interface RoleInput {
  code: string;
  name: string;
  permissions: string[];
  scope_all?: boolean;
  is_system?: boolean;
  /** 仅创建：编码已存在时后端返回 409，避免覆盖既有角色。 */
  create_only?: boolean;
}

export interface RoleAssignment {
  id?: number;
  org_code?: string;
  person_id: number;
  role_code: string;
  unit_id?: number;
  include_descendants: boolean;
}

export interface RoleAssignmentDetail {
  id: number;
  person_id: number;
  person_no: string;
  person_name: string;
  person_type: string;
  person_status: string;
  role_code: string;
  role_name: string;
  role_status: string;
  scope_all: boolean;
  unit_id?: number;
  unit_name?: string;
  unit_path?: string;
  unit_status?: string;
  include_descendants: boolean;
  created_at: string;
}

export interface AppRegistry {
  id: number;
  org_code: string;
  app_code: string;
  display_name: string;
  status: string;
  sync_mode: string;
  api_base_url?: string;
  m2m_client_id?: string;
  idp_ref?: string;
  synced_at?: string;
}

/** 应用列表视图：注册行 + 引用计数（应用管理页列表列）。 */
export interface AppSummary extends AppRegistry {
  catalog_count: number;
  link_count: number;
  grant_count: number;
}

export interface AppPermission {
  id: number;
  app_code: string;
  perm_code: string;
  display_name: string;
  kind: string;
  assignable: boolean;
  owner_only: boolean;
  status: string;
  sort?: number;
  description?: string;
}

/** IdP 组织应用目录项（字段白名单，无凭据；managed=已被 hiedu 纳管）。 */
export interface IdpApplication {
  id: string;
  owner: string;
  name: string;
  display_name: string;
  homepage_url?: string;
  logo?: string;
  tags?: string[];
  managed: boolean;
}

export interface AppPermInput {
  perm_code: string;
  display_name: string;
  kind: string; // platform|project|team
  assignable?: boolean;
  owner_only?: boolean;
  sort?: number;
  description?: string;
  status?: string; // 空=active；revoked 级联吊销该档直授
}

export interface AppRegisterInput {
  app_code: string;
  display_name: string;
  api_base_url?: string;
  m2m_client_id?: string;
  sync_mode?: string; // api_push|idp_role|manual，空默认 api_push
  idp_ref?: string;
  permissions?: AppPermInput[];
}

export interface ProjectAppLink {
  id: number;
  org_code: string;
  app_code: string;
  project_id: number;
  app_project_name: string;
  status: string;
  last_synced_at?: string;
  last_error?: string;
}

export interface UnitAppLink {
  id: number;
  org_code: string;
  app_code: string;
  unit_id: number;
  app_unit_name: string;
  status: string;
  last_synced_at?: string;
  last_error?: string;
}

export interface ProjectLinkInput {
  project_id: number;
  app_project_name: string;
  status?: string;
}

export interface UnitLinkInput {
  unit_id: number;
  app_unit_name: string;
  status?: string;
}

export interface AppGrant {
  id: number;
  org_code: string;
  app_code: string;
  person_id: number;
  scope_kind: string; // project|team
  project_id?: number;
  unit_id?: number;
  app_role: string;
  status: string;
  created_by: string;
}

export interface GrantInput {
  person_id: number;
  scope_kind: string;
  project_id?: number;
  unit_id?: number;
  app_role: string;
}

export interface AppRoleRef {
  code: string;
  name: string;
  status: string;
}

export interface AppPermRef {
  perm_code: string;
  display_name?: string;
  kind?: string;
  status: string;
  roles: AppRoleRef[];
}

export interface AppGrantView extends AppGrant {
  person_no?: string;
  person_name?: string;
}

export interface AppBindings {
  app_code: string;
  role_refs: AppPermRef[];
  grants: AppGrantView[];
}

export interface AppGrantDrift {
  grant_id: number;
  app_code: string;
  app_role: string;
  person_id: number;
  scope_kind: string;
  project_id?: number;
  unit_id?: number;
  type: string;
  message?: string;
}

export interface AppLinkDrift {
  app_code: string;
  scope_kind: string;
  project_id?: number;
  unit_id?: number;
  app_object_name: string;
  username: string;
  person_id?: number;
  expected_role?: string;
  actual_role?: string;
  actual_origin?: string;
  type: string;
  message?: string;
}

export interface AppRoleDrift {
  app_code: string;
  perm_code: string;
  role_name: string;
  type: string;
  users?: string;
  message?: string;
}

export interface AppReconcileReport {
  app_code: string;
  grant_drifts: AppGrantDrift[];
  link_drifts: AppLinkDrift[];
  role_drifts: AppRoleDrift[];
}

/** 项目成员行（后端 ProjectMember 无 json 标签，键为 Go 字段名）。 */
export interface ProjectMember {
  ID: number;
  OrgCode: string;
  ProjectID: number;
  PersonID: number;
  RoleCode: string;
  Status: string;
}

export function createResources(c: HieduClient) {
const api = {
  me(): Promise<ApiResult<Me>> {
    return c.requestJSON<Me>('/api/me');
  },

  dashboardSummary(): Promise<ApiResult<DashboardSummary>> {
    return c.requestJSON<DashboardSummary>('/api/dashboard/summary');
  },

  units(params?: QueryParams): Promise<ApiResult<Unit[]>> {
    return c.requestJSON<Unit[]>('/api/units', { params });
  },

  unit(id: number): Promise<ApiResult<Unit>> {
    return c.requestJSON<Unit>(`/api/units/${encodeURIComponent(String(id))}`);
  },

  createUnit(body: CreateUnitBody): Promise<ApiResult<Unit>> {
    return c.requestJSON<Unit>('/api/units', { method: 'POST', body });
  },

  updateUnit(id: number, body: UpdateUnitBody, ifMatch?: string): Promise<ApiResult<Unit>> {
    return c.requestJSON<Unit>(`/api/units/${encodeURIComponent(String(id))}`, {
      method: 'PUT',
      body,
      ifMatch,
    });
  },

  unitImpact(id: number): Promise<ApiResult<UnitImpact>> {
    return c.requestJSON<UnitImpact>(`/api/units/${encodeURIComponent(String(id))}/impact`);
  },

  disableUnit(id: number): Promise<ApiResult<null>> {
    return c.requestJSON<null>(`/api/units/${encodeURIComponent(String(id))}/disable`, {
      method: 'POST',
    });
  },

  mergeUnit(id: number, toUnitID: number): Promise<ApiResult<null>> {
    return c.requestJSON<null>(`/api/units/${encodeURIComponent(String(id))}/merge`, {
      method: 'POST',
      body: { to_unit_id: toUnitID },
    });
  },

  dissolveUnit(id: number): Promise<ApiResult<null>> {
    return c.requestJSON<null>(`/api/units/${encodeURIComponent(String(id))}/dissolve`, {
      method: 'POST',
    });
  },

  accountPreview(type: string, no: string): Promise<ApiResult<AccountPreview>> {
    return c.requestJSON<AccountPreview>('/api/persons/account-preview', {
      params: { type, no },
    });
  },

  persons(params?: QueryParams): Promise<ApiResult<Person[]>> {
    return c.requestJSON<Person[]>('/api/persons', { params });
  },

  person(id: number): Promise<ApiResult<Person>> {
    return c.requestJSON<Person>(`/api/persons/${encodeURIComponent(String(id))}`);
  },

  createPerson(body: CreatePersonBody): Promise<ApiResult<Person>> {
    return c.requestJSON<Person>('/api/persons', { method: 'POST', body });
  },

  updatePerson(id: number, body: UpdatePersonBody, ifMatch?: string): Promise<ApiResult<Person>> {
    return c.requestJSON<Person>(`/api/persons/${encodeURIComponent(String(id))}`, {
      method: 'PUT',
      body,
      ifMatch,
    });
  },

  transferPerson(id: number, body: TransferBody): Promise<ApiResult<null>> {
    return c.requestJSON<null>(`/api/persons/${encodeURIComponent(String(id))}/transfer`, {
      method: 'POST',
      body,
    });
  },

  updatePersonRelation(
    personID: number,
    relationID: number,
    body: { status?: string; end_date?: string; position_code?: string },
  ): Promise<ApiResult<null>> {
    return c.requestJSON<null>(
      `/api/persons/${encodeURIComponent(String(personID))}/units/${encodeURIComponent(String(relationID))}`,
      { method: 'PUT', body },
    );
  },

  async personHistory(id: number): Promise<ApiResult<PersonChange[]>> {
    const result = await c.requestJSON<RawPersonChange[]>(
      `/api/persons/${encodeURIComponent(String(id))}/history`,
    );
    const data = Array.isArray(result.data) ? result.data.map(normalizePersonChange) : [];
    return { ...result, data };
  },

  personPII(id: number): Promise<ApiResult<PersonPII>> {
    return c.requestJSON<PersonPII>(`/api/persons/${encodeURIComponent(String(id))}/pii`);
  },

  personRelations(id: number): Promise<ApiResult<PersonRelation[]>> {
    return c.requestJSON<PersonRelation[]>(
      `/api/persons/${encodeURIComponent(String(id))}/relations`,
    );
  },

  projects(params?: QueryParams): Promise<ApiResult<Project[]>> {
    return c.requestJSON<Project[]>('/api/projects', { params });
  },

  project(id: number): Promise<ApiResult<Project>> {
    return c.requestJSON<Project>(`/api/projects/${encodeURIComponent(String(id))}`);
  },

  createProject(body: CreateProjectBody): Promise<ApiResult<Project>> {
    return c.requestJSON<Project>('/api/projects', { method: 'POST', body });
  },

  publishProject(id: number): Promise<ApiResult<null>> {
    return c.requestJSON<null>(`/api/projects/${encodeURIComponent(String(id))}/publish`, {
      method: 'POST',
    });
  },

  classes(params?: QueryParams): Promise<ApiResult<ClassUnit[]>> {
    return c.requestJSON<ClassUnit[]>('/api/classes', { params });
  },

  class(id: number): Promise<ApiResult<ClassUnit>> {
    return c.requestJSON<ClassUnit>(`/api/classes/${encodeURIComponent(String(id))}`);
  },

  createClass(body: CreateClassBody): Promise<ApiResult<ClassUnit>> {
    return c.requestJSON<ClassUnit>('/api/classes', { method: 'POST', body });
  },

  updateClass(id: number, body: UpdateClassBody, ifMatch?: string): Promise<ApiResult<ClassUnit>> {
    return c.requestJSON<ClassUnit>(`/api/classes/${encodeURIComponent(String(id))}`, {
      method: 'PUT',
      body,
      ifMatch,
    });
  },

  dicts(params?: QueryParams): Promise<ApiResult<DictItem[]>> {
    return c.requestJSON<DictItem[]>('/api/dicts', { params });
  },

  upsertDict(body: UpsertDictBody): Promise<ApiResult<DictItem>> {
    return c.requestJSON<DictItem>('/api/dicts', { method: 'POST', body });
  },

  setDictEnabled(id: number, enabled: boolean): Promise<ApiResult<null>> {
    return c.requestJSON<null>(`/api/dicts/${encodeURIComponent(String(id))}/enable`, {
      method: 'POST',
      body: { is_enabled: enabled },
    });
  },

  invitations(params?: QueryParams): Promise<ApiResult<Invitation[]>> {
    return c.requestJSON<Invitation[]>('/api/invitations', { params });
  },

  createInvitation(body: CreateInvitationBody): Promise<ApiResult<CreateInvitationResult>> {
    return c.requestJSON<CreateInvitationResult>('/api/invitations', { method: 'POST', body });
  },

  revokeInvitation(id: number): Promise<ApiResult<Invitation>> {
    return c.requestJSON<Invitation>('/api/invitations', {
      method: 'DELETE',
      params: { id },
    });
  },

  jobs(params?: QueryParams): Promise<ApiResult<JobsView>> {
    return c.requestJSON<JobsView>('/api/jobs', { params });
  },

  /** 失败明细为文本/CSV；走 fetch 下载，以便携带租户头（链接无法自定义请求头）。 */
  downloadJobFailures(id: number, format: 'csv' | 'text' = 'csv'): Promise<void> {
    const path = c.buildURL(`/api/jobs/${encodeURIComponent(String(id))}/failures`, {
      format,
    });
    return c.downloadFile(path, `job-${id}-failures.${format === 'csv' ? 'csv' : 'txt'}`);
  },

  outbox(params?: QueryParams): Promise<ApiResult<JobItem[]>> {
    return c.requestJSON<JobItem[]>('/api/outbox', { params });
  },

  retryOutbox(id: number): Promise<ApiResult<null>> {
    return c.requestJSON<null>(`/api/outbox/${encodeURIComponent(String(id))}/retry`, {
      method: 'POST',
    });
  },

  reconcileSnapshot(): Promise<ApiResult<ReconcileSnapshot>> {
    return c.requestJSON<ReconcileSnapshot>('/api/reconcile');
  },

  reconcileRun(): Promise<ApiResult<SyncLog[]>> {
    return c.requestJSON<SyncLog[]>('/api/reconcile/run', { method: 'POST' });
  },

  reconcileStatus(): Promise<ApiResult<ReconcileStatus>> {
    return c.requestJSON<ReconcileStatus>('/api/reconcile/status');
  },

  repairDiff(id: number): Promise<ApiResult<unknown>> {
    return c.requestJSON<unknown>(`/api/reconcile/diffs/${encodeURIComponent(String(id))}/repair`, {
      method: 'POST',
    });
  },

  ignoreDiff(id: number, reason: string): Promise<ApiResult<null>> {
    return c.requestJSON<null>(`/api/reconcile/diffs/${encodeURIComponent(String(id))}/ignore`, {
      method: 'POST',
      body: { reason },
    });
  },

  auditLogs(params?: QueryParams): Promise<ApiResult<AuditLog[]>> {
    return c.requestJSON<AuditLog[]>('/api/audit-logs', { params });
  },

  importPreview(kind: string, csv: string): Promise<ApiResult<ImportPreview>> {
    return c.requestJSON<ImportPreview>('/api/imports/preview', {
      method: 'POST',
      body: { kind, csv },
    });
  },

  importCommit(kind: string, csv: string): Promise<ApiResult<ImportJob>> {
    return c.requestJSON<ImportJob>('/api/imports/commit', {
      method: 'POST',
      body: { kind, csv },
    });
  },

  getImport(id: string): Promise<ApiResult<ImportJob>> {
    return c.requestJSON<ImportJob>(`/api/imports/${encodeURIComponent(id)}`);
  },

  createExport(kind: string, pii: boolean): Promise<ApiResult<ExportJob>> {
    return c.requestJSON<ExportJob>('/api/exports', { method: 'POST', body: { kind, pii } });
  },

  getExport(id: string): Promise<ApiResult<ExportJob>> {
    return c.requestJSON<ExportJob>(`/api/exports/${encodeURIComponent(id)}`);
  },

  approveExport(id: string): Promise<ApiResult<ExportJob>> {
    return c.requestJSON<ExportJob>(`/api/exports/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
  },

  rejectExport(id: string): Promise<ApiResult<ExportJob>> {
    return c.requestJSON<ExportJob>(`/api/exports/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
    });
  },

  downloadExport(id: string): Promise<void> {
    return c.downloadFile(
      `/api/exports/${encodeURIComponent(id)}/download`,
      `export-${id}.csv`,
    );
  },

  roles(): Promise<ApiResult<RoleSummary[]>> {
    return c.requestJSON<RoleSummary[]>('/api/roles');
  },

  role(code: string): Promise<ApiResult<RoleSummary>> {
    return c.requestJSON<RoleSummary>(`/api/roles/${encodeURIComponent(code)}`);
  },

  upsertRole(body: RoleInput, ifMatch?: string): Promise<ApiResult<RoleSummary>> {
    return c.requestJSON<RoleSummary>('/api/roles', { method: 'POST', body, ifMatch });
  },

  setRoleEnabled(code: string, enabled: boolean): Promise<ApiResult<null>> {
    return c.requestJSON<null>(
      `/api/roles/${encodeURIComponent(code)}/${enabled ? 'enable' : 'disable'}`,
      { method: 'POST' },
    );
  },

  roleAssignmentsByRole(
    code: string,
    params?: QueryParams,
  ): Promise<ApiResult<RoleAssignmentDetail[]>> {
    return c.requestJSON<RoleAssignmentDetail[]>(
      `/api/roles/${encodeURIComponent(code)}/assignments`,
      { params },
    );
  },

  rolePermissions(): Promise<ApiResult<{ local: string[] }>> {
    return c.requestJSON<{ local: string[] }>('/api/role-permissions');
  },

  roleAssignments(personID: number): Promise<ApiResult<RoleAssignment[]>> {
    return c.requestJSON<RoleAssignment[]>('/api/role-assignments', {
      params: { person_id: personID },
    });
  },

  assignRole(body: RoleAssignment): Promise<ApiResult<null>> {
    return c.requestJSON<null>('/api/role-assignments', { method: 'POST', body });
  },

  revokeRoleAssignment(personID: number, roleCode: string, unitID?: number): Promise<ApiResult<null>> {
    return c.requestJSON<null>('/api/role-assignments', {
      method: 'DELETE',
      params: {
        person_id: personID,
        role_code: roleCode,
        ...(unitID ? { unit_id: unitID } : {}),
      },
    });
  },

  apps(): Promise<ApiResult<AppSummary[]>> {
    return c.requestJSON<AppSummary[]>('/api/apps');
  },

  app(appCode: string): Promise<ApiResult<AppRegistry>> {
    return c.requestJSON<AppRegistry>(`/api/apps/${encodeURIComponent(appCode)}`);
  },

  appPermissions(appCode: string): Promise<ApiResult<AppPermission[]>> {
    return c.requestJSON<AppPermission[]>(
      `/api/apps/${encodeURIComponent(appCode)}/permissions`,
    );
  },

  // ---------- 应用管理页（方案 §4.2.2） ----------

  idpApplications(): Promise<ApiResult<IdpApplication[]>> {
    return c.requestJSON<IdpApplication[]>('/api/idp-applications');
  },

  registerApp(body: AppRegisterInput): Promise<ApiResult<AppRegistry>> {
    return c.requestJSON<AppRegistry>('/api/apps', { method: 'POST', body });
  },

  deregisterApp(appCode: string): Promise<ApiResult<null>> {
    return c.requestJSON<null>(`/api/apps/${encodeURIComponent(appCode)}/deregister`, {
      method: 'POST',
    });
  },

  purgeApp(appCode: string): Promise<ApiResult<null>> {
    return c.requestJSON<null>(`/api/apps/${encodeURIComponent(appCode)}/purge`, {
      method: 'POST',
    });
  },

  appBindings(appCode: string): Promise<ApiResult<AppBindings>> {
    return c.requestJSON<AppBindings>(`/api/apps/${encodeURIComponent(appCode)}/bindings`);
  },

  upsertAppPermission(appCode: string, body: AppPermInput): Promise<ApiResult<AppPermission>> {
    return c.requestJSON<AppPermission>(`/api/apps/${encodeURIComponent(appCode)}/permissions`, {
      method: 'POST',
      body,
    });
  },

  appProjectLinks(appCode: string): Promise<ApiResult<ProjectAppLink[]>> {
    return c.requestJSON<ProjectAppLink[]>(
      `/api/apps/${encodeURIComponent(appCode)}/project-links`,
    );
  },

  upsertAppProjectLink(appCode: string, body: ProjectLinkInput): Promise<ApiResult<ProjectAppLink>> {
    return c.requestJSON<ProjectAppLink>(`/api/apps/${encodeURIComponent(appCode)}/project-links`, {
      method: 'POST',
      body,
    });
  },

  appUnitLinks(appCode: string): Promise<ApiResult<UnitAppLink[]>> {
    return c.requestJSON<UnitAppLink[]>(`/api/apps/${encodeURIComponent(appCode)}/unit-links`);
  },

  upsertAppUnitLink(appCode: string, body: UnitLinkInput): Promise<ApiResult<UnitAppLink>> {
    return c.requestJSON<UnitAppLink>(`/api/apps/${encodeURIComponent(appCode)}/unit-links`, {
      method: 'POST',
      body,
    });
  },

  appGrants(appCode: string, params?: QueryParams): Promise<ApiResult<AppGrant[]>> {
    return c.requestJSON<AppGrant[]>(`/api/apps/${encodeURIComponent(appCode)}/grants`, { params });
  },

  grantAppRole(appCode: string, body: GrantInput): Promise<ApiResult<AppGrant>> {
    return c.requestJSON<AppGrant>(`/api/apps/${encodeURIComponent(appCode)}/grants`, {
      method: 'POST',
      body,
    });
  },

  revokeAppGrant(appCode: string, id: number): Promise<ApiResult<null>> {
    return c.requestJSON<null>(`/api/apps/${encodeURIComponent(appCode)}/grants/${id}`, {
      method: 'DELETE',
    });
  },

  reconcileApp(appCode: string): Promise<ApiResult<AppReconcileReport>> {
    return c.requestJSON<AppReconcileReport>(`/api/apps/${encodeURIComponent(appCode)}/reconcile`, {
      method: 'POST',
    });
  },

  projectMembers(projectId: number): Promise<ApiResult<ProjectMember[]>> {
    return c.requestJSON<ProjectMember[]>(`/api/projects/${encodeURIComponent(String(projectId))}/members`);
  },

  addProjectMember(projectId: number, body: { person_id: number; role_code: string }): Promise<ApiResult<null>> {
    return c.requestJSON<null>(`/api/projects/${encodeURIComponent(String(projectId))}/members`, {
      method: 'POST',
      body,
    });
  },

  removeProjectMember(projectId: number, personId: number): Promise<ApiResult<null>> {
    return c.requestJSON<null>(
      `/api/projects/${encodeURIComponent(String(projectId))}/members/${encodeURIComponent(String(personId))}`,
      { method: 'DELETE' },
    );
  },
  };

  return api;
}
