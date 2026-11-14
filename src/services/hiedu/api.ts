// 统一认证（intellect-auth）内置页 API 客户端。
// 端口化自 intellect-auth/hiedu/web/src/api.ts，保留后端契约：
// 同源请求、cookie、X-Request-Id、If-Match/ETag、X-Total-Count、Blob 下载。
// 与独立门户唯一差异：基址固定为 BFF 断言代理前缀 /api/bff/hiedu。

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

export interface QueryParams {
  [key: string]: string | number | boolean | null | undefined;
}

export interface ApiResult<T> {
  data: T;
  total: number | null;
  status: number;
  etag: string | null;
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
}

export interface AppPermission {
  id: number;
  org_code: string;
  app_code: string;
  perm_code: string;
  display_name?: string;
  kind: string;
  status: string;
}

// ---------- 错误 ----------

// 会话中途失效时由 App 监听并切换到未登录页，避免每个页面各自处理。
export const UNAUTHORIZED_EVENT = 'hiedu:unauthorized';

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

// ---------- 请求实现 ----------

interface ErrorBody {
  error?: string;
  code?: string;
}

/** BFF 断言代理前缀（固定；由 BFF 注入 X-Hiedu-Assertion）。 */
const API_BASE = '/api/bff/hiedu';

function withBase(path: string): string {
  return `${API_BASE}${path}`;
}

function baseHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Request-Id': createRequestId(),
  };
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  params?: QueryParams;
  /** 强校验 If-Match（来自上一次 GET 的 ETag）。 */
  ifMatch?: string;
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 兼容不支持 randomUUID 的环境。
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const random = Math.floor(Math.random() * 16);
    const value = ch === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function buildURL(path: string, params?: QueryParams): string {
  if (!params) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 60_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, '请求超时，请稍后重试', 'timeout');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function requestJSON<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const method = options.method ?? 'GET';
  const headers = baseHeaders();
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.ifMatch) {
    headers['If-Match'] = options.ifMatch;
  }

  const response = await fetchWithTimeout(buildURL(withBase(path), options.params), {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    const body = payload as ErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error || `请求失败（HTTP ${response.status}）`,
      body?.code,
    );
  }

  const rawTotal = response.headers.get('X-Total-Count');
  const total = rawTotal && /^\d+$/.test(rawTotal) ? Number(rawTotal) : null;

  return {
    data: payload as T,
    total,
    status: response.status,
    etag: response.headers.get('ETag'),
  };
}

function fileNameFrom(response: Response, fallback: string): string {
  const disposition = response.headers.get('Content-Disposition') || '';
  const match =
    /filename\*=UTF-8''([^;]+)/i.exec(disposition) || /filename="?([^";]+)"?/i.exec(disposition);
  if (!match) return fallback;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return fallback;
  }
}

/** 以 fetch + Blob 触发下载：需要携带租户头，因此不能直接用 <a href>。 */
async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const headers = { ...baseHeaders(), Accept: '*/*' };
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', headers });
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(response.status, `下载失败（HTTP ${response.status}）`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileNameFrom(response, fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

export const api = {
  me(): Promise<ApiResult<Me>> {
    return requestJSON<Me>('/api/me');
  },

  dashboardSummary(): Promise<ApiResult<DashboardSummary>> {
    return requestJSON<DashboardSummary>('/api/dashboard/summary');
  },

  units(params?: QueryParams): Promise<ApiResult<Unit[]>> {
    return requestJSON<Unit[]>('/api/units', { params });
  },

  unit(id: number): Promise<ApiResult<Unit>> {
    return requestJSON<Unit>(`/api/units/${encodeURIComponent(String(id))}`);
  },

  createUnit(body: CreateUnitBody): Promise<ApiResult<Unit>> {
    return requestJSON<Unit>('/api/units', { method: 'POST', body });
  },

  updateUnit(id: number, body: UpdateUnitBody, ifMatch?: string): Promise<ApiResult<Unit>> {
    return requestJSON<Unit>(`/api/units/${encodeURIComponent(String(id))}`, {
      method: 'PUT',
      body,
      ifMatch,
    });
  },

  unitImpact(id: number): Promise<ApiResult<UnitImpact>> {
    return requestJSON<UnitImpact>(`/api/units/${encodeURIComponent(String(id))}/impact`);
  },

  disableUnit(id: number): Promise<ApiResult<null>> {
    return requestJSON<null>(`/api/units/${encodeURIComponent(String(id))}/disable`, {
      method: 'POST',
    });
  },

  mergeUnit(id: number, toUnitID: number): Promise<ApiResult<null>> {
    return requestJSON<null>(`/api/units/${encodeURIComponent(String(id))}/merge`, {
      method: 'POST',
      body: { to_unit_id: toUnitID },
    });
  },

  dissolveUnit(id: number): Promise<ApiResult<null>> {
    return requestJSON<null>(`/api/units/${encodeURIComponent(String(id))}/dissolve`, {
      method: 'POST',
    });
  },

  accountPreview(type: string, no: string): Promise<ApiResult<AccountPreview>> {
    return requestJSON<AccountPreview>('/api/persons/account-preview', {
      params: { type, no },
    });
  },

  persons(params?: QueryParams): Promise<ApiResult<Person[]>> {
    return requestJSON<Person[]>('/api/persons', { params });
  },

  person(id: number): Promise<ApiResult<Person>> {
    return requestJSON<Person>(`/api/persons/${encodeURIComponent(String(id))}`);
  },

  createPerson(body: CreatePersonBody): Promise<ApiResult<Person>> {
    return requestJSON<Person>('/api/persons', { method: 'POST', body });
  },

  updatePerson(id: number, body: UpdatePersonBody, ifMatch?: string): Promise<ApiResult<Person>> {
    return requestJSON<Person>(`/api/persons/${encodeURIComponent(String(id))}`, {
      method: 'PUT',
      body,
      ifMatch,
    });
  },

  transferPerson(id: number, body: TransferBody): Promise<ApiResult<null>> {
    return requestJSON<null>(`/api/persons/${encodeURIComponent(String(id))}/transfer`, {
      method: 'POST',
      body,
    });
  },

  updatePersonRelation(
    personID: number,
    relationID: number,
    body: { status?: string; end_date?: string; position_code?: string },
  ): Promise<ApiResult<null>> {
    return requestJSON<null>(
      `/api/persons/${encodeURIComponent(String(personID))}/units/${encodeURIComponent(String(relationID))}`,
      { method: 'PUT', body },
    );
  },

  async personHistory(id: number): Promise<ApiResult<PersonChange[]>> {
    const result = await requestJSON<RawPersonChange[]>(
      `/api/persons/${encodeURIComponent(String(id))}/history`,
    );
    const data = Array.isArray(result.data) ? result.data.map(normalizePersonChange) : [];
    return { ...result, data };
  },

  personPII(id: number): Promise<ApiResult<PersonPII>> {
    return requestJSON<PersonPII>(`/api/persons/${encodeURIComponent(String(id))}/pii`);
  },

  personRelations(id: number): Promise<ApiResult<PersonRelation[]>> {
    return requestJSON<PersonRelation[]>(
      `/api/persons/${encodeURIComponent(String(id))}/relations`,
    );
  },

  projects(params?: QueryParams): Promise<ApiResult<Project[]>> {
    return requestJSON<Project[]>('/api/projects', { params });
  },

  createProject(body: CreateProjectBody): Promise<ApiResult<Project>> {
    return requestJSON<Project>('/api/projects', { method: 'POST', body });
  },

  publishProject(id: number): Promise<ApiResult<null>> {
    return requestJSON<null>(`/api/projects/${encodeURIComponent(String(id))}/publish`, {
      method: 'POST',
    });
  },

  classes(params?: QueryParams): Promise<ApiResult<ClassUnit[]>> {
    return requestJSON<ClassUnit[]>('/api/classes', { params });
  },

  class(id: number): Promise<ApiResult<ClassUnit>> {
    return requestJSON<ClassUnit>(`/api/classes/${encodeURIComponent(String(id))}`);
  },

  createClass(body: CreateClassBody): Promise<ApiResult<ClassUnit>> {
    return requestJSON<ClassUnit>('/api/classes', { method: 'POST', body });
  },

  updateClass(id: number, body: UpdateClassBody, ifMatch?: string): Promise<ApiResult<ClassUnit>> {
    return requestJSON<ClassUnit>(`/api/classes/${encodeURIComponent(String(id))}`, {
      method: 'PUT',
      body,
      ifMatch,
    });
  },

  dicts(params?: QueryParams): Promise<ApiResult<DictItem[]>> {
    return requestJSON<DictItem[]>('/api/dicts', { params });
  },

  upsertDict(body: UpsertDictBody): Promise<ApiResult<DictItem>> {
    return requestJSON<DictItem>('/api/dicts', { method: 'POST', body });
  },

  setDictEnabled(id: number, enabled: boolean): Promise<ApiResult<null>> {
    return requestJSON<null>(`/api/dicts/${encodeURIComponent(String(id))}/enable`, {
      method: 'POST',
      body: { is_enabled: enabled },
    });
  },

  invitations(params?: QueryParams): Promise<ApiResult<Invitation[]>> {
    return requestJSON<Invitation[]>('/api/invitations', { params });
  },

  createInvitation(body: CreateInvitationBody): Promise<ApiResult<CreateInvitationResult>> {
    return requestJSON<CreateInvitationResult>('/api/invitations', { method: 'POST', body });
  },

  revokeInvitation(id: number): Promise<ApiResult<Invitation>> {
    return requestJSON<Invitation>('/api/invitations', {
      method: 'DELETE',
      params: { id },
    });
  },

  jobs(params?: QueryParams): Promise<ApiResult<JobsView>> {
    return requestJSON<JobsView>('/api/jobs', { params });
  },

  /** 失败明细为文本/CSV；走 fetch 下载，以便携带租户头（链接无法自定义请求头）。 */
  downloadJobFailures(id: number, format: 'csv' | 'text' = 'csv'): Promise<void> {
    const path = buildURL(withBase(`/api/jobs/${encodeURIComponent(String(id))}/failures`), {
      format,
    });
    return downloadFile(path, `job-${id}-failures.${format === 'csv' ? 'csv' : 'txt'}`);
  },

  outbox(params?: QueryParams): Promise<ApiResult<JobItem[]>> {
    return requestJSON<JobItem[]>('/api/outbox', { params });
  },

  retryOutbox(id: number): Promise<ApiResult<null>> {
    return requestJSON<null>(`/api/outbox/${encodeURIComponent(String(id))}/retry`, {
      method: 'POST',
    });
  },

  reconcileSnapshot(): Promise<ApiResult<ReconcileSnapshot>> {
    return requestJSON<ReconcileSnapshot>('/api/reconcile');
  },

  reconcileRun(): Promise<ApiResult<SyncLog[]>> {
    return requestJSON<SyncLog[]>('/api/reconcile/run', { method: 'POST' });
  },

  reconcileStatus(): Promise<ApiResult<ReconcileStatus>> {
    return requestJSON<ReconcileStatus>('/api/reconcile/status');
  },

  repairDiff(id: number): Promise<ApiResult<unknown>> {
    return requestJSON<unknown>(`/api/reconcile/diffs/${encodeURIComponent(String(id))}/repair`, {
      method: 'POST',
    });
  },

  ignoreDiff(id: number, reason: string): Promise<ApiResult<null>> {
    return requestJSON<null>(`/api/reconcile/diffs/${encodeURIComponent(String(id))}/ignore`, {
      method: 'POST',
      body: { reason },
    });
  },

  auditLogs(params?: QueryParams): Promise<ApiResult<AuditLog[]>> {
    return requestJSON<AuditLog[]>('/api/audit-logs', { params });
  },

  importPreview(kind: string, csv: string): Promise<ApiResult<ImportPreview>> {
    return requestJSON<ImportPreview>('/api/imports/preview', {
      method: 'POST',
      body: { kind, csv },
    });
  },

  importCommit(kind: string, csv: string): Promise<ApiResult<ImportJob>> {
    return requestJSON<ImportJob>('/api/imports/commit', {
      method: 'POST',
      body: { kind, csv },
    });
  },

  getImport(id: string): Promise<ApiResult<ImportJob>> {
    return requestJSON<ImportJob>(`/api/imports/${encodeURIComponent(id)}`);
  },

  createExport(kind: string, pii: boolean): Promise<ApiResult<ExportJob>> {
    return requestJSON<ExportJob>('/api/exports', { method: 'POST', body: { kind, pii } });
  },

  getExport(id: string): Promise<ApiResult<ExportJob>> {
    return requestJSON<ExportJob>(`/api/exports/${encodeURIComponent(id)}`);
  },

  approveExport(id: string): Promise<ApiResult<ExportJob>> {
    return requestJSON<ExportJob>(`/api/exports/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
  },

  rejectExport(id: string): Promise<ApiResult<ExportJob>> {
    return requestJSON<ExportJob>(`/api/exports/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
    });
  },

  downloadExport(id: string): Promise<void> {
    return downloadFile(
      withBase(`/api/exports/${encodeURIComponent(id)}/download`),
      `export-${id}.csv`,
    );
  },

  roles(): Promise<ApiResult<RoleSummary[]>> {
    return requestJSON<RoleSummary[]>('/api/roles');
  },

  role(code: string): Promise<ApiResult<RoleSummary>> {
    return requestJSON<RoleSummary>(`/api/roles/${encodeURIComponent(code)}`);
  },

  upsertRole(body: RoleInput, ifMatch?: string): Promise<ApiResult<RoleSummary>> {
    return requestJSON<RoleSummary>('/api/roles', { method: 'POST', body, ifMatch });
  },

  setRoleEnabled(code: string, enabled: boolean): Promise<ApiResult<null>> {
    return requestJSON<null>(
      `/api/roles/${encodeURIComponent(code)}/${enabled ? 'enable' : 'disable'}`,
      { method: 'POST' },
    );
  },

  roleAssignmentsByRole(
    code: string,
    params?: QueryParams,
  ): Promise<ApiResult<RoleAssignmentDetail[]>> {
    return requestJSON<RoleAssignmentDetail[]>(
      `/api/roles/${encodeURIComponent(code)}/assignments`,
      { params },
    );
  },

  rolePermissions(): Promise<ApiResult<{ local: string[] }>> {
    return requestJSON<{ local: string[] }>('/api/role-permissions');
  },

  roleAssignments(personID: number): Promise<ApiResult<RoleAssignment[]>> {
    return requestJSON<RoleAssignment[]>('/api/role-assignments', {
      params: { person_id: personID },
    });
  },

  assignRole(body: RoleAssignment): Promise<ApiResult<null>> {
    return requestJSON<null>('/api/role-assignments', { method: 'POST', body });
  },

  revokeRoleAssignment(
    personID: number,
    roleCode: string,
    unitID?: number,
  ): Promise<ApiResult<null>> {
    return requestJSON<null>('/api/role-assignments', {
      method: 'DELETE',
      params: {
        person_id: personID,
        role_code: roleCode,
        ...(unitID ? { unit_id: unitID } : {}),
      },
    });
  },

  apps(): Promise<ApiResult<AppRegistry[]>> {
    return requestJSON<AppRegistry[]>('/api/apps');
  },

  appPermissions(appCode: string): Promise<ApiResult<AppPermission[]>> {
    return requestJSON<AppPermission[]>(
      `/api/apps/${encodeURIComponent(appCode)}/permissions`,
    );
  },
};
