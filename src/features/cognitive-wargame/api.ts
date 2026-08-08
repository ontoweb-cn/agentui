/**
 * Cognitive Wargame 插件 API 客户端。
 *
 * 管理服务监听 9385 端口（独立服务，非 intellect-rag-app），前端通过 Vite proxy
 * 以 `/api/v1/wargame/*` 访问，rewrite 去掉 /wargame 前缀后转发到后端 /api/v1/*。
 * 这里使用独立的 axios 实例，避免与 BFF 的 restAPIv1 (`/api/bff/proxy/v1`) 拦截器耦合。
 */
import { Authorization } from '@/constants/authorization';
import axios, { type AxiosInstance } from 'axios';

/** 管理服务基础路径，统一前缀 /api/v1/wargame，由 Vite proxy 代理到 9385。 */
const WARGAME_BASE_URL = '/api/v1/wargame';

/**
 * SSE 事件流直连地址。
 * Vite 7.3.0 的 http-proxy-3 不支持 SSE 流式转发，开发环境直连 cognitive-wargame 管理服务。
 * 主机/端口由 vite.config.ts 的 define 注入(取自 .env 的 API_HOST / WARGAME_PORT)。
 * 生产环境通过 Nginx/Gateway 代理，可改回相对路径。
 */
const SSE_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? `http://${import.meta.env.WARGAME_SSE_HOST ?? 'localhost'}:${import.meta.env.WARGAME_SSE_PORT ?? '9385'}/api/v1`
    : WARGAME_BASE_URL;

/** 创建带鉴权拦截器的 axios 实例。 */
function createWargameClient(): AxiosInstance {
  const instance = axios.create({
    baseURL: WARGAME_BASE_URL,
    timeout: 300000,
    headers: { 'Content-Type': 'application/json' },
  });

  instance.interceptors.request.use((config) => {
    // S1 TODO: localStorage 存 token 有 XSS 风险，生产环境应改用 httpOnly cookie
    // 或 GATEWAY 签发 SSE 专用短期 token（见 intellect-team-gateway-integration-requirements.md §二）
    const token =
      (typeof localStorage !== 'undefined' &&
        localStorage.getItem(Authorization)) ||
      '';
    if (token) {
      config.headers.Authorization = token;
    }
    return config;
  });

  return instance;
}

const client = createWargameClient();

const encodePathSegments = (value: string) =>
  value.split('/').map(encodeURIComponent).join('/');

/**
 * 通用响应包装（兼容 intellect-rag-app 的 { code, data, message } 形态）。
 * 注意：cognitive-wargame 管理服务直接返回 Tool 的 dict 结果，不使用此包装。
 * unwrap() 函数会自动检测并兼容两种形态。
 */
export interface ApiResult<T> {
  code: number;
  data: T;
  message?: string;
}

/** 想定（Scenario）。 */
export interface Scenario {
  id: string;
  name: string;
  description?: string;
  status?: ScenarioStatus;
  red_force?: string;
  blue_force?: string;
  rounds_limit?: number;
  rounds_completed?: number;
  created_at?: string;
  updated_at?: string;
}

export type ScenarioStatus =
  | 'draft'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed';

/** 分页响应。 */
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** 回合事件。 */
export interface RoundEvent {
  round: number;
  phase: string;
  actor?: string;
  action?: string;
  content?: string;
  timestamp?: string;
}

/** 单回合态势指标。 */
export interface Metrics {
  scenario_id: string;
  round: number;
  red_score?: number;
  blue_score?: number;
  red_cognitive?: number;
  blue_cognitive?: number;
  red_morale?: number;
  blue_morale?: number;
  summary?: string;
}

/** 知识图谱实体。 */
export interface KGEntity {
  id: string;
  subject: string;
  type?: string;
  properties?: Record<string, unknown>;
}

/** 知识图谱关系。 */
export interface KGRelation {
  subject: string;
  predicate: string;
  object: string;
  weight?: number;
}

/** 评估报告。 */
export interface Report {
  scenario_id: string;
  type: string;
  title?: string;
  content: string;
  generated_at?: string;
}

/** 回放数据。 */
export interface Playback {
  scenario_id: string;
  round: number;
  events: RoundEvent[];
}

/** 事件日志条目（P4 修复：替代 unknown[]）。 */
export interface EventLogEntry {
  event_id: string;
  event_type: string;
  scenario_id: string;
  timestamp: number | string;
  payload: Record<string, unknown>;
}

/** 回放时间轴条目（P4 修复：替代 unknown[]）。 */
export interface PlaybackTimelineEntry {
  round_id: number;
  timestamp: string;
  event_type: string;
  snapshot: Record<string, unknown>;
}

/** 异步任务状态（对应后端 TaskInfo.to_dict()）。 */
export interface TaskStatus {
  task_id: string;
  task_type: string;
  scenario_id?: string;
  status: string;
  error?: string | null;
  created_at: number;
  started_at?: number | null;
  finished_at?: number | null;
  elapsed: number;
}

/** 审批记录（对应 intellect-gateway Approval schema，P3.3-3）。 */
export interface Approval {
  approval_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'request_changes' | 'completed';
  tenant_id?: string;
  resource_type: string;
  resource_id: string;
  title: string;
  description?: string | null;
  summary?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  submitted_by?: string | null;
  approvers?: string[];
  callback_channel?: string | null;
  created_at?: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_comment?: string | null;
  completed_at?: string | null;
}

/** 审批详情（含审计历史）。 */
export interface ApprovalDetail extends Approval {
  history?: Array<{
    action: string;
    actor: string | null;
    timestamp: string;
    comment: string | null;
  }>;
}

/** 审批列表响应。 */
export interface ApprovalList {
  approvals: Approval[];
  total: number;
  limit: number;
  offset: number;
}

/** Agent（对应 intellect_agents 表，G-16）。 */
export interface Agent {
  agent_id: string;
  name: string;
  agent_type:
    | 'individual'
    | 'admin_organ'
    | 'political_party'
    | 'news_media'
    | 'mass';
  parent_agent_id?: string | null;
  bio?: string | null;
  avatar?: string | null;
  attributes?: Record<string, unknown>;
  status?: 'active' | 'archived';
  tenant_id?: string;
  created_at?: string;
  updated_at?: string;
}

/** Agent 关系（对应 intellect_agent_relations 表）。 */
export interface AgentRelation {
  relation_id: string;
  source_agent_id: string;
  target_agent_id: string;
  relation_type:
    | 'employed_by'
    | 'spokesperson_of'
    | 'member_of'
    | 'subsidiary_of'
    | 'belongs_to';
  valid_from?: string | null;
  valid_to?: string | null;
  attributes?: Record<string, unknown>;
  created_at?: string;
}

/** Agent 类型字典（对应 intellect_agent_types 表）。 */
export interface AgentType {
  type_code: string;
  type_name: string;
  parent_type_code?: string | null;
  description?: string | null;
  sort_order: number;
  is_active: boolean;
}

/** Agent 列表响应（gateway 返回）。 */
export interface AgentList {
  agents: Agent[];
  total: number;
  limit: number;
  offset: number;
}

/** Agent 关系列表响应（gateway 返回）。 */
export interface AgentRelationList {
  relations: AgentRelation[];
  total: number;
}

/** 干预请求（P3.3-1 对接 intervention_api）。 */
export interface InterventionRequest {
  type: 'narrative_inject' | 'agent_override' | 'strategy_veto';
  round_num: number;
  payload: Record<string, unknown>;
  reason?: string;
}

/** 干预审计记录。 */
export interface Intervention {
  log_id: string;
  scenario_id: string;
  intervention_type: string;
  task_id?: string;
  round_num?: number;
  payload?: Record<string, unknown>;
  reason?: string;
  operator?: string;
  created_at?: string;
}

/** 异常告警（P3.3-2 对接 anomaly.detected 事件）。 */
export interface Anomaly {
  type: string;
  severity: 'warning' | 'critical';
  scenario_id: string;
  round_num: number;
  detail: Record<string, unknown>;
  timestamp: number;
}

export type ResourceCategory =
  | 'blue-team'
  | 'gray-team'
  | 'group-agents'
  | 'person-agents'
  | 'red-team'
  | 'rule-team';

export interface SkillResource {
  id: string;
  name: string;
  category: ResourceCategory;
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
  directory?: string;
  file_count?: number;
  created_at?: number;
  updated_at?: number;
}

export interface SkillFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  content?: string;
}

export interface SkillDetailResource extends SkillResource {
  files: SkillFileEntry[];
  metadata?: Record<string, unknown>;
}

export interface ToolResource {
  name: string;
  toolset?: string;
  category: string;
  category_label?: string;
  description?: string;
  actions?: string[];
  requires_env?: string[];
  source_file?: string;
}

export interface ToolDetailResource extends ToolResource {
  schema?: Record<string, unknown>;
  source_code_preview?: string;
}

export interface SkillCategoriesResponse {
  categories: Array<{ name: ResourceCategory; label?: string; count: number }>;
  total: number;
}

export interface SkillListResponse {
  skills: SkillResource[];
  total: number;
  page: number;
  page_size: number;
}

export interface ToolListResponse {
  tools: ToolResource[];
  total: number;
  categories: Array<{ name: string; label?: string; count: number }>;
}

async function unwrap<T>(p: Promise<{ data: ApiResult<T> | T }>): Promise<T> {
  const res = await p;
  const payload = res.data as ApiResult<T> | T;
  // 兼容 { code, data } 包装与裸数据两种形态。
  if (
    payload &&
    typeof payload === 'object' &&
    'data' in payload &&
    'code' in payload
  ) {
    return (payload as ApiResult<T>).data;
  }
  return payload as T;
}

/** 后端想定 dict → 前端 Scenario 类型映射。 */
function mapScenario(raw: Record<string, unknown>): Scenario {
  const overview = (raw.overview ?? {}) as Record<string, unknown>;
  const sourceEvents = raw.source_events;
  return {
    id: String(raw.scenario_id ?? raw.id ?? ''),
    name: String(raw.scenario_id ?? raw.name ?? ''),
    description:
      (overview.objective as string | undefined) ??
      (Array.isArray(sourceEvents) ? sourceEvents.join(', ') : undefined),
    status: (raw.status as ScenarioStatus | undefined) ?? 'ready',
    rounds_limit: (raw.total_rounds ?? raw.rounds_limit) as number | undefined,
    rounds_completed: raw.rounds_completed as number | undefined,
    created_at: raw.created_at as string | undefined,
    updated_at: raw.updated_at as string | undefined,
  };
}

/** 想定相关 API。 */
export const api = {
  /** 分页获取想定列表。 */
  async getScenarios(limit = 20, offset = 0): Promise<Paginated<Scenario>> {
    const raw = await unwrap<{
      status: string;
      count: number;
      scenarios: Array<Record<string, unknown>>;
    }>(client.get('/scenarios', { params: { limit, offset } }));
    return {
      items: (raw.scenarios ?? []).map((s) => mapScenario(s)),
      total: raw.count ?? 0,
      limit,
      offset,
    };
  },

  /** 获取单个想定详情。 */
  async getScenario(id: string): Promise<Scenario> {
    const raw = await unwrap<Record<string, unknown>>(
      client.get(`/scenarios/${id}`),
    );
    return mapScenario(raw);
  },

  /** 生成/创建想定。 */
  generateScenario(data: Partial<Scenario> & Record<string, unknown>) {
    return unwrap<Scenario>(client.post('/scenarios', data));
  },

  /** 执行想定推演（异步，返回 task_id）。 */
  executeScenario(id: string, roundsLimit?: number) {
    return unwrap<TaskStatus>(
      client.post(`/scenarios/${id}/execute`, { rounds_limit: roundsLimit }),
    );
  },

  /** 查询想定执行状态。 */
  getScenarioStatus(id: string) {
    return unwrap<TaskStatus>(client.get(`/scenarios/${id}/status`));
  },

  /** 获取指定回合态势指标。 */
  getMetrics(scenarioId: string, round: number) {
    return unwrap<Metrics>(
      client.get(`/metrics/${scenarioId}/rounds/${round}`),
    );
  },

  /** 获取态势指标历史序列。 */
  async getMetricsHistory(scenarioId: string) {
    const data = await unwrap<Metrics[]>(
      client.get(`/metrics/${scenarioId}/history`),
    );
    return Array.isArray(data) ? data : [];
  },

  /** 生成评估报告（POST，对应后端 /reports/round）。 */
  getReport(scenarioId: string, _type: string, roundNum = 0) {
    return unwrap<Report>(
      client.post('/reports/round', {
        scenario_id: scenarioId,
        round_num: roundNum,
      }),
    );
  },

  /** 获取知识图谱实体。 */
  getKGEntities(scenarioId: string, subject?: string) {
    return unwrap<KGEntity[]>(
      client.get('/kg/entities', {
        params: { subject: subject ?? scenarioId },
      }),
    );
  },

  /** 获取知识图谱关系（scenarioId 用作 namespace 过滤）。 */
  getKGRelations(scenarioId: string, predicate?: string) {
    return unwrap<KGRelation[]>(
      client.get('/kg/relations', {
        params: {
          namespace: scenarioId,
          ...(predicate ? { predicate } : {}),
        },
      }),
    );
  },

  /** 获取回合回放数据。 */
  getPlayback(scenarioId: string, round: number) {
    return unwrap<Playback>(
      client.get(`/playback/${scenarioId}/rounds/${round}`),
    );
  },

  /** 删除想定（对接 scenario_cleanup Tool）。 */
  deleteScenario(id: string) {
    return unwrap<void>(client.delete(`/scenarios/${id}`));
  },

  /** 暂停推演（P3.3-1 导演台干预）。 */
  pauseScenario(id: string) {
    return unwrap<Record<string, unknown>>(
      client.post(`/scenarios/${id}/pause`),
    );
  },

  /** 恢复推演（P3.3-1 导演台干预）。 */
  resumeScenario(id: string) {
    return unwrap<Record<string, unknown>>(
      client.post(`/scenarios/${id}/resume`),
    );
  },

  /** 注入干预（P3.3-1 导演台干预）。 */
  injectIntervention(id: string, req: InterventionRequest) {
    return unwrap<Record<string, unknown>>(
      client.post(`/scenarios/${id}/interventions`, req),
    );
  },

  /** 查询干预审计日志（P3.3-1）。 */
  getInterventions(id: string, limit = 100) {
    return unwrap<{ count: number; interventions: Intervention[] }>(
      client.get(`/scenarios/${id}/interventions`, { params: { limit } }),
    );
  },

  /** 查询事件日志（P4 修复：强类型返回）。 */
  listEvents(
    scenarioId: string,
    params?: { limit?: number; offset?: number; type?: string },
  ) {
    return unwrap<EventLogEntry[]>(
      client.get(`/scenarios/${scenarioId}/events`, { params }),
    );
  },

  /**
   * SSE 事件流 URL（供 EventSource 订阅）。
   * P3.3-2: 指向 /events/{id}/stream SSE 端点（Redis pub-sub → text/event-stream）。
   * P2 修复：EventSource 不支持自定义 Header，通过 ?token= 传递认证。
   * P5 修复：URL 编码 channel 名，防止特殊字符破坏 URL。
   */
  eventStreamUrl: (scenarioId: string, channels?: string[]) => {
    const base = `${SSE_BASE_URL}/events/${scenarioId}/stream`;
    const params = new URLSearchParams();
    const token =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(Authorization)
        : null;
    if (token) {
      params.set('token', token);
    }
    if (channels?.length) {
      params.set('channels', channels.map(encodeURIComponent).join(','));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  },

  /** 运行反事实分析（异步，返回 task_id）。 */
  runCounterfactual(scenarioId: string, data: Record<string, unknown>) {
    return unwrap<TaskStatus>(
      client.post('/reports/counterfactual', {
        scenario_id: scenarioId,
        ...data,
      }),
    );
  },

  /** 获取叙事链（知识图谱溯源）。 */
  getNarrativeChain(scenarioId: string, entityId: string, maxHops?: number) {
    return unwrap<Record<string, unknown>>(
      client.get('/kg/narrative-chain', {
        params: {
          narrative_id: entityId,
          namespace: scenarioId,
          max_depth: maxHops,
        },
      }),
    );
  },

  /** 获取关键节点（度中心性 + 介数中心性）。 */
  getKeyNodes(
    scenarioId: string,
    params?: { limit?: number; algorithm?: string },
  ) {
    return unwrap<unknown[]>(
      client.get('/kg/key-nodes', {
        params: {
          scenario_id: scenarioId,
          top_n: params?.limit,
        },
      }),
    );
  },

  // ── P3.4-2 评估中心：蒙特卡洛 / 回测 / 任务轮询 ──────────────

  /** 提交蒙特卡洛报告生成（异步，返回 task_id）。 */
  runMonteCarlo(
    scenarioId: string,
    params: { n: number; rounds: number; seed_base: number },
  ) {
    return unwrap<TaskStatus>(
      client.post('/reports/monte-carlo', {
        scenario_id: scenarioId,
        n: params.n,
        rounds: params.rounds,
        seed_base: params.seed_base,
      }),
    );
  },

  /** 提交回测报告生成（异步，返回 task_id）。 */
  runBacktest(scenarioId: string, params: { event_ids?: string[] }) {
    return unwrap<TaskStatus>(
      client.post('/reports/backtest', {
        scenario_id: scenarioId,
        event_ids: params.event_ids,
      }),
    );
  },

  /** 查询任务状态（轮询用，对接 /scenarios/{id}/status?task_id=）。 */
  getTaskStatus(scenarioId: string, taskId: string) {
    return unwrap<TaskStatus>(
      client.get(`/scenarios/${scenarioId}/status`, {
        params: { task_id: taskId },
      }),
    );
  },

  /** 获取异步报告任务结果（任务完成后调）。 */
  getReportResult(taskId: string) {
    return unwrap<Record<string, unknown>>(
      client.get(`/reports/result/${taskId}`),
    );
  },

  // ── P3.3-3 想定审批（代理 intellect-gateway /v1/approvals）────

  /** 提交审批（resource_type='scenario'，resource_id=想定ID）。 */
  submitApproval(data: {
    resource_type: string;
    resource_id: string;
    title: string;
    description?: string;
    summary?: Record<string, unknown>;
    callback_channel?: string;
    approvers?: string[];
    metadata?: Record<string, unknown>;
  }) {
    return unwrap<Approval>(client.post('/approvals', data));
  },

  /** 查询审批列表。 */
  getApprovals(params?: {
    status?: string;
    resource_type?: string;
    submitted_by?: string;
    limit?: number;
    offset?: number;
  }) {
    return unwrap<ApprovalList>(client.get('/approvals', { params }));
  },

  /** 查询审批详情（含审计历史）。 */
  getApprovalDetail(approvalId: string) {
    return unwrap<ApprovalDetail>(client.get(`/approvals/${approvalId}`));
  },

  /** 决议审批（approved/rejected/request_changes）。 */
  resolveApproval(approvalId: string, decision: string, comment?: string) {
    return unwrap<Approval>(
      client.post(`/approvals/${approvalId}/resolve`, { decision, comment }),
    );
  },

  // ── Skills 资源（代理 intellect-gateway /v1/intellect/skills）──

  getSkillCategories() {
    return unwrap<SkillCategoriesResponse>(client.get('/skills/categories'));
  },

  getSkills(params?: { category?: ResourceCategory; page_size?: number }) {
    return unwrap<SkillListResponse>(client.get('/skills', { params }));
  },

  getSkillDetail(category: ResourceCategory, skillId: string) {
    return unwrap<SkillDetailResource>(
      client.get(
        `/skills/${encodeURIComponent(category)}/${encodeURIComponent(skillId)}`,
      ),
    );
  },

  getSkillFileContent(
    category: ResourceCategory,
    skillId: string,
    filePath: string,
  ) {
    return client
      .get(
        `/skills/${encodeURIComponent(category)}/${encodeURIComponent(skillId)}/files/${encodePathSegments(filePath)}`,
        {
          responseType: 'text',
          transformResponse: [(data) => data],
        },
      )
      .then((res) => res.data as string);
  },

  testSkill(
    category: ResourceCategory,
    skillId: string,
    input: Record<string, unknown>,
  ) {
    return unwrap<Record<string, unknown>>(
      client.post(
        `/skills/${encodeURIComponent(category)}/${encodeURIComponent(skillId)}/test`,
        { input },
      ),
    );
  },

  getTools(category?: string) {
    return unwrap<ToolListResponse>(
      client.get('/tools', { params: category ? { category } : undefined }),
    );
  },

  getToolDetail(toolName: string) {
    return unwrap<ToolDetailResource>(
      client.get(`/tools/${encodeURIComponent(toolName)}`),
    );
  },

  getToolStatus(toolName: string) {
    return unwrap<Record<string, unknown>>(
      client.get(`/tools/${encodeURIComponent(toolName)}/status`),
    );
  },

  invokeTool(
    toolName: string,
    action: string,
    params: Record<string, unknown>,
  ) {
    return unwrap<Record<string, unknown>>(
      client.post(`/tools/${encodeURIComponent(toolName)}/invoke`, {
        action,
        params,
      }),
    );
  },

  // ── G-16 Agent 注册表（代理 intellect-gateway /v1/intellect/agents）──

  /** 查询 Agent 列表。 */
  getAgents(params?: {
    agent_type?: string;
    status?: string;
    parent_agent_id?: string;
    limit?: number;
    offset?: number;
  }) {
    return unwrap<AgentList>(client.get('/agents', { params }));
  },

  /** 查询 Agent 详情。 */
  getAgent(agentId: string) {
    return unwrap<Agent>(client.get(`/agents/${agentId}`));
  },

  /** 创建 Agent。 */
  createAgent(data: {
    agent_id: string;
    name: string;
    agent_type: string;
    parent_agent_id?: string;
    bio?: string;
    avatar?: string;
    attributes?: Record<string, unknown>;
  }) {
    return unwrap<Agent>(client.post('/agents', data));
  },

  /** 更新 Agent。 */
  updateAgent(agentId: string, data: Partial<Agent>) {
    return unwrap<Agent>(client.put(`/agents/${agentId}`, data));
  },

  /** 删除 Agent。 */
  deleteAgent(agentId: string, hard?: boolean) {
    return unwrap<{ deleted: boolean }>(
      client.delete(`/agents/${agentId}`, { params: { hard } }),
    );
  },

  /** 查询 Agent 类型字典。 */
  getAgentTypes(active?: boolean) {
    return unwrap<AgentType[] | { types: AgentType[] }>(
      client.get('/agents/types', { params: { active } }),
    );
  },

  /** 查询 Agent 关系列表。 */
  getAgentRelations(agentId: string, direction?: string) {
    return unwrap<AgentRelationList>(
      client.get(`/agents/${agentId}/relations`, { params: { direction } }),
    );
  },

  /** 建立 Agent 关系。 */
  createAgentRelation(
    agentId: string,
    data: {
      source_agent_id: string;
      target_agent_id: string;
      relation_type: string;
      valid_from?: string;
      valid_to?: string;
    },
  ) {
    return unwrap<AgentRelation>(
      client.post(`/agents/${agentId}/relations`, data),
    );
  },

  /** 删除 Agent 关系。 */
  deleteAgentRelation(agentId: string, relationId: string) {
    return unwrap<{ deleted: boolean }>(
      client.delete(`/agents/${agentId}/relations/${relationId}`),
    );
  },
};

export default api;
