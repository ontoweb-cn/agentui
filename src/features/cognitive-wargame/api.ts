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

/** 想定相关 API。 */
export const api = {
  /** 分页获取想定列表。 */
  getScenarios(limit = 20, offset = 0) {
    return unwrap<Paginated<Scenario>>(
      client.get('/scenarios', { params: { limit, offset } }),
    );
  },

  /** 获取单个想定详情。 */
  getScenario(id: string) {
    return unwrap<Scenario>(client.get(`/scenarios/${id}`));
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
};

export default api;
