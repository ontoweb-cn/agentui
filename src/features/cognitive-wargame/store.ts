/**
 * Cognitive Wargame 插件 Zustand store。
 *
 * 管理想定列表、当前选中想定以及加载状态。页面组件通过 useWargameStore 读取/操作状态。
 */
import { create } from 'zustand';
import { api, type Scenario } from './api';

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

  /** 拉取想定列表。 */
  fetchScenarios: (limit?: number, offset?: number) => Promise<void>;
  /** 设置当前想定。 */
  setCurrentScenario: (scenario: Scenario | null) => void;
  /** 按需加载单个想定并设为当前。 */
  loadScenario: (id: string) => Promise<void>;
  /** 设置当前回合。 */
  setCurrentRound: (round: number) => void;
  /** 清空错误。 */
  clearError: () => void;
}

export const useWargameStore = create<WargameState>((set) => ({
  scenarios: [],
  currentScenario: null,
  loading: false,
  error: null,
  total: 0,
  currentRound: 0,

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

  clearError: () => set({ error: null }),
}));

export default useWargameStore;
