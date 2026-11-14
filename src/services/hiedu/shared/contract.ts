// hiedu 契约类型与错误(shared 层,双门户共享——方案 docs/hiedu-web与AgentUI复用-方案分析.md)。
// 本文件由 api.ts 机械拆分生成,禁止引入宿主特有依赖(import.meta.env/window)。
// 宿主: hiedu-web src/api.ts(独立门户) / agentui src/services/hiedu/api.ts(BFF 代理)。

// ---------- 契约类型 ----------

export interface MePerson {
  id: number;
  name: string;
  person_no?: string;
  person_type?: string;
  staff_no?: string;
  student_no?: string;
}

export interface MeScope {
  unit_id?: number;
  name: string;
  path?: string;
  all?: boolean;
  include_descendants?: boolean;
}

export interface MePII {
  read: boolean;
  write: boolean;
}

export interface Me {
  person: MePerson;
  org_code: string;
  permissions: string[];
  scopes: MeScope[];
  pii: MePII;
  bound: boolean;
  idp_console_url?: string;
}

export interface Unit {
  id: number;
  org_code?: string;
  parent_id?: number;
  unit_code: string;
  name: string;
  short_name?: string;
  category_code: string;
  subtype_code?: string;
  level: number;
  path: string;
  idp_projection: boolean;
  idp_group_name?: string;
  status: string;
  merged_into_unit_id?: number;
}

export interface UnitImpact {
  unit_id: number;
  unit_name: string;
  persons_direct: number;
  persons_total: number;
  projects: number;
  classes: number;
  groups: string[];
}

export interface AccountPreview {
  account: string;
  available: boolean;
  reason?: string;
}

export interface Person {
  id: number;
  org_code?: string;
  person_no: string;
  person_type: string;
  name: string;
  title_code?: string;
  email?: string;
  staff_no?: string;
  student_no?: string;
  account_name?: string;
  status: string;
  idp_user_uuid?: string;
  idp_external_id?: string;
  idp_unified_id?: string;
}

export interface PersonChange {
  id: number;
  person_id: number;
  field: string;
  old_value: string;
  new_value: string;
  actor: string;
  created_at: string;
}

export interface PersonPII {
  email?: string;
}

export interface PersonRelation {
  id: number;
  unit_id: number;
  unit_name?: string;
  position_code?: string;
  is_primary: boolean;
  status: string;
  start_date?: string;
  end_date?: string;
}

export type CountValue = number | string | null | undefined;

export interface ReconcileSummary {
  org_code?: string;
  status?: string;
  /** 实际后端字段为 last_run_at；同时兼容契约中的 last_run。 */
  last_run_at?: string;
  last_run?: string;
  total?: CountValue;
  converged?: CountValue;
  diffs?: CountValue;
  errors?: CountValue;
  manual_queue?: CountValue;
  consecutive_unconverged?: CountValue;
}

export interface DashboardSummary {
  units?: CountValue;
  persons?: CountValue;
  projects?: CountValue;
  classes?: CountValue;
  pending_jobs?: CountValue;
  manual_jobs?: CountValue;
  reconcile?: ReconcileSummary | null;
  scopes?: MeScope[];
}

export interface Project {
  id: number;
  org_code?: string;
  project_code: string;
  name: string;
  category_code: string;
  unit_id?: number;
  owner_person_id?: number;
  course_code?: string;
  start_date?: string;
  end_date?: string;
  max_members?: number;
  idp_projection: boolean;
  status: string;
}

export interface ClassUnit {
  id: number;
  org_code?: string;
  class_code: string;
  name: string;
  grade_year?: number;
  unit_id?: number;
  head_teacher_person_id?: number;
  status: string;
}

export interface DictItem {
  id: number;
  org_code?: string;
  dict_type: string;
  code: string;
  name: string;
  parent_code?: string;
  attrs?: string;
  sort: number;
  is_enabled: boolean;
}

export interface Invitation {
  id: number;
  org_code?: string;
  project_id: number;
  inviter_person_id: number;
  invitee_person_id: number;
  max_uses: number;
  used_count: number;
  expires_at?: string;
  status: string;
}

export interface JobItem {
  id: number;
  kind: string;
  subject: string;
  status: string;
  attempts: number;
  next_at?: string;
  last_error?: string;
}

export interface JobsView {
  items: JobItem[];
  counts: Record<string, number>;
  total: number;
}

export interface SyncLog {
  id: number;
  org_code: string;
  entity_type: string;
  entity_id: string;
  idp_object: string;
  action: string;
  status: string;
  conflict_type?: string;
  message?: string;
  created_at: string;
}

export interface ReconcileStatus {
  org_code: string;
  status: string;
  last_run_at?: string;
  total: number;
  converged: number;
  diffs: number;
  errors: number;
  manual_queue: number;
  consecutive_unconverged: number;
}

export interface ReconcileSnapshot {
  status: ReconcileStatus | null;
  diffs: SyncLog[];
}

export interface AuditLog {
  id: number;
  org_code: string;
  actor: string;
  action: string;
  object_type: string;
  object_id: string;
  summary: string;
  detail: string;
  request_id: string;
  ip: string;
  ua: string;
  created_at: string;
}

export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface ImportPreview {
  kind: string;
  total: number;
  valid: number;
  invalid: number;
  errors: ImportRowError[];
  rows?: Array<{ row: number; data: Record<string, string>; errors?: string[] }>;
}

export interface ImportJob {
  id: string;
  org_code: string;
  kind: string;
  status: string;
  total: number;
  valid: number;
  invalid: number;
  errors: ImportRowError[];
  created_at: string;
  actor?: string;
}

export interface ExportJob {
  id: string;
  org_code: string;
  kind: string;
  status: string;
  pii: boolean;
  requested_by: string;
  approved_by?: string;
  approved_at?: string;
  file_name?: string;
  created_at: string;
}

// 后端 PersonChange 已声明 JSON tag；兼容旧版首字母大写键以平滑升级。

export interface QueryParams {
  [key: string]: string | number | boolean | null | undefined;
}

export interface ApiResult<T> {
  data: T;
  total: number | null;
  status: number;
  etag: string | null;
}

// ---------- 错误 ----------

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '请求失败，请稍后重试';
}
