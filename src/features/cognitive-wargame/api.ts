/**
 * Cognitive Wargame 插件 API 客户端。
 *
 * 管理服务监听 9381 端口，前端通过 Nginx 反向代理以 `/api/v1/*` 访问。
 * 这里使用独立的 axios 实例，避免与 BFF 的 restAPIv1 (`/api/bff/proxy/v1`) 拦截器耦合。
 */
import axios, { type AxiosInstance } from 'axios';
import { Authorization } from '@/constants/authorization';

/** 管理服务基础路径，由 Nginx 代理到 9381。 */
const WARGAME_BASE_URL = '/api/v1';

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
      (Array.isArray(sourceEvents)
        ? sourceEvents.join(', ')
        : undefined),
    status: (raw.status as ScenarioStatus | undefined) ?? 'ready',
    rounds_limit: (raw.total_rounds ?? raw.rounds_limit) as
      | number
      | undefined,
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
    return unwrap<TaskStatus>(
      client.get(`/scenarios/${id}/status`),
    );
  },

  /** 获取指定回合态势指标。 */
  getMetrics(scenarioId: string, round: number) {
    return unwrap<Metrics>(
      client.get(`/metrics/${scenarioId}/rounds/${round}`),
    );
  },

  /** 获取态势指标历史序列。 */
  getMetricsHistory(scenarioId: string) {
    return unwrap<Metrics[]>(
      client.get(`/metrics/${scenarioId}/history`),
    );
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
    const base = `${WARGAME_BASE_URL}/events/${scenarioId}/stream`;
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
  getNarrativeChain(
    scenarioId: string,
    entityId: string,
    maxHops?: number,
  ) {
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
};

export default api;
