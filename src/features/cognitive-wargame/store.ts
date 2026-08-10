/**
 * Cognitive Wargame 插件 Zustand store。
 *
 * 管理想定列表、当前选中想定以及加载状态。页面组件通过 useWargameStore 读取/操作状态。
 */
import { create } from 'zustand';
import { api, type Scenario, type Intervention, type Anomaly, type Agent, type AgentRelation, type AgentType } from './api';

export interface WargameState {
  /** 想定列表。 */
  scenarios: Scenario[];
  /** 当前选中的想定（详情页/推演监控用）。 */
  currentScenario: Scenario | null;
  /** 列表加载态。 */
  loading: boolean;
  /** 最近一次错误信息。 */
  error: string | null;
  /** 列表分页总数。 */
  total: number;
  /** 当前选中的回合序号（回合视图用）。 */
  currentRound: number;
  /** SSE 实时连接状态（useSseEvents hook 维护）。 */
  sseConnected: boolean;
  /** 当前推演任务 ID（P3.0-5 导演台）。 */
  currentTaskId: string | null;
  /** 干预审计记录列表（P3.0-5 导演台）。 */
  interventions: Intervention[];
  /** 异常告警列表（P3.3-2 anomaly.detected）。 */
  anomalies: Anomaly[];
  /** Agent 列表（G-16）。 */
  agents: Agent[];
  agentTotal: number;
  agentLimit: number;
  agentOffset: number;
  /** 当前 Agent 详情。 */
  currentAgent: Agent | null;
  /** Agent 关系列表。 */
  agentRelations: AgentRelation[];
  /** Agent 类型字典。 */
  agentTypes: AgentType[];
  /** Agent 列表加载态。 */
  agentsLoading: boolean;
  /** Agent 类型字典加载态。 */
  typesLoading: boolean;

  /** 拉取想定列表。 */
  fetchScenarios: (limit?: number, offset?: number) => Promise<void>;
  /** 设置当前想定。 */
  setCurrentScenario: (scenario: Scenario | null) => void;
  /** 按需加载单个想定并设为当前。 */
  loadScenario: (id: string) => Promise<void>;
  /** 设置当前回合。 */
  setCurrentRound: (round: number) => void;
  /** 设置 SSE 连接状态。 */
  setSseConnected: (connected: boolean) => void;
  /** 设置当前任务 ID。 */
  setCurrentTaskId: (taskId: string | null) => void;
  /** 添加干预记录（SSE intervention.applied 事件触发）。 */
  addIntervention: (intervention: Intervention) => void;
  /** 添加异常告警（SSE anomaly.detected 事件触发）。 */
  addAnomaly: (anomaly: Anomaly) => void;
  /** 加载干预审计日志。 */
  fetchInterventions: (scenarioId: string) => Promise<void>;
  /** 清空事件（切换场景时调用）。 */
  clearEvents: () => void;
  /** 清空错误。 */
  clearError: () => void;
  /** 拉取 Agent 列表。 */
  fetchAgents: (params?: { agent_type?: string; status?: string; limit?: number; offset?: number }) => Promise<void>;
  /** 加载单个 Agent 详情。 */
  loadAgent: (agentId: string) => Promise<void>;
  /** 创建 Agent。 */
  createAgent: (data: { agent_id: string; name: string; agent_type: string; bio?: string; parent_agent_id?: string }) => Promise<void>;
  /** 更新 Agent。 */
  updateAgent: (agentId: string, data: Partial<Agent>) => Promise<void>;
  /** 删除 Agent。 */
  deleteAgent: (agentId: string, hard?: boolean) => Promise<void>;
  /** 加载 Agent 关系。 */
  loadAgentRelations: (agentId: string) => Promise<void>;
  /** 建立 Agent 关系（成功后刷新关系列表）。 */
  createAgentRelation: (
    agentId: string,
    data: {
      source_agent_id: string;
      target_agent_id: string;
      relation_type: string;
      valid_from?: string;
      valid_to?: string;
    },
  ) => Promise<void>;
  /** 删除 Agent 关系（成功后刷新关系列表）。 */
  deleteAgentRelation: (agentId: string, relationId: string) => Promise<void>;
  /** 拉取 Agent 类型字典。 */
  fetchAgentTypes: () => Promise<void>;
}

export const useWargameStore = create<WargameState>((set) => ({
  scenarios: [],
  currentScenario: null,
  loading: false,
  error: null,
  total: 0,
  currentRound: 0,
  sseConnected: false,
  currentTaskId: null,
  interventions: [],
  anomalies: [],
  agents: [],
  agentTotal: 0,
  agentLimit: 10,
  agentOffset: 0,
  currentAgent: null,
  agentRelations: [],
  agentTypes: [],
  agentsLoading: false,
  typesLoading: false,

  fetchScenarios: async (limit = 20, offset = 0) => {
    set({ loading: true, error: null });
    try {
      const page = await api.getScenarios(limit, offset);
      set({
        scenarios: page.items ?? [],
        total: page.total ?? page.items.length,
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setCurrentScenario: (scenario) => set({ currentScenario: scenario }),

  loadScenario: async (id) => {
    set({ loading: true, error: null });
    try {
      const scenario = await api.getScenario(id);
      set({ currentScenario: scenario, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setCurrentRound: (round) => set({ currentRound: round }),

  setSseConnected: (connected) => set({ sseConnected: connected }),

  setCurrentTaskId: (taskId) => set({ currentTaskId: taskId }),

  addIntervention: (intervention) =>
    set((state) => {
      // 去重：SSE 重连可能重复投递同一事件，按 log_id 跳过
      if (
        intervention.log_id &&
        state.interventions.some((iv) => iv.log_id === intervention.log_id)
      ) {
        return state;
      }
      return { interventions: [...state.interventions, intervention] };
    }),

  addAnomaly: (anomaly) =>
    set((state) => {
      // 去重：anomaly 无后端全量拉取对账，按 timestamp+type 跳过重复
      const key = `${anomaly.timestamp}-${anomaly.type}`;
      if (
        state.anomalies.some((a) => `${a.timestamp}-${a.type}` === key)
      ) {
        return state;
      }
      return { anomalies: [...state.anomalies, anomaly] };
    }),

  fetchInterventions: async (scenarioId) => {
    try {
      const result = await api.getInterventions(scenarioId);
      set({ interventions: result.interventions ?? [] });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  clearEvents: () =>
    set({ interventions: [], anomalies: [], currentTaskId: null }),

  clearError: () => set({ error: null }),

  fetchAgents: async (params) => {
    set({ agentsLoading: true, error: null });
    try {
      const limit = params?.limit ?? 10;
      const offset = params?.offset ?? 0;
      const data = await api.getAgents({ ...params, limit, offset });
      set({
        agents: data.agents ?? [],
        agentTotal: data.total ?? data.agents?.length ?? 0,
        agentLimit: data.limit ?? limit,
        agentOffset: data.offset ?? offset,
        agentsLoading: false,
      });
    } catch (err) {
      set({
        agentsLoading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  loadAgent: async (agentId) => {
    set({ loading: true, error: null });
    try {
      const agent = await api.getAgent(agentId);
      set({ currentAgent: agent, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  createAgent: async (data) => {
    await api.createAgent(data);
    await useWargameStore.getState().fetchAgents();
  },

  updateAgent: async (agentId, data) => {
    await api.updateAgent(agentId, data);
    await useWargameStore.getState().loadAgent(agentId);
  },

  deleteAgent: async (agentId, hard) => {
    await api.deleteAgent(agentId, hard);
    await useWargameStore.getState().fetchAgents();
  },

  loadAgentRelations: async (agentId) => {
    try {
      const data = await api.getAgentRelations(agentId, 'both');
      set({ agentRelations: data.relations ?? [] });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  createAgentRelation: async (agentId, data) => {
    set({ error: null });
    try {
      await api.createAgentRelation(agentId, data);
      const refreshed = await api.getAgentRelations(agentId, 'both');
      set({ agentRelations: refreshed.relations ?? [] });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  deleteAgentRelation: async (agentId, relationId) => {
    set({ error: null });
    try {
      await api.deleteAgentRelation(agentId, relationId);
      const refreshed = await api.getAgentRelations(agentId, 'both');
      set({ agentRelations: refreshed.relations ?? [] });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  fetchAgentTypes: async () => {
    set({ typesLoading: true });
    try {
      const data = await api.getAgentTypes();
      const types = Array.isArray(data) ? data : (data as { types: AgentType[] }).types ?? [];
      set({ agentTypes: types, typesLoading: false });
    } catch (err) {
      set({
        typesLoading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));

export default useWargameStore;
