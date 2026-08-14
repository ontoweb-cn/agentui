/**
 * Cognitive Wargame 插件清单。
 *
 * 字段对齐 `ModuleDefinition`（见 features/_types.ts）：
 * - name/order/enabled 控制插件注册与排序
 * - routes 由 routes.ts 提供懒加载路由
 * - nav 暴露导航项（Dashboard/想定管理/推演监控/态势分析/知识图谱/评估报告/历史回放）
 * - i18n 提供中英文懒加载词条
 */
import type { ModuleDefinition } from '../_types';
import routes, { WargameRoutes } from './routes';

const definition: ModuleDefinition = {
  name: 'cognitive-wargame',
  order: 50,
  enabled: () => true,
  routes,
  nav: [
    {
      path: WargameRoutes.Dashboard,
      labelKey: 'cognitiveWargame.nav.dashboard',
      pathMap: [WargameRoutes.Dashboard],
      testId: 'nav-cw-dashboard',
    },
    {
      path: WargameRoutes.Scenarios,
      labelKey: 'cognitiveWargame.nav.scenarios',
      pathMap: [WargameRoutes.Scenarios, WargameRoutes.ScenarioDetail],
      testId: 'nav-cw-scenarios',
    },
    {
      path: WargameRoutes.Agents,
      labelKey: 'cognitiveWargame.nav.agents',
      pathMap: [WargameRoutes.Agents, WargameRoutes.AgentDetail, WargameRoutes.AgentTypes],
      testId: 'nav-cw-agents',
    },
    {
      path: WargameRoutes.Rounds,
      labelKey: 'cognitiveWargame.nav.rounds',
      pathMap: [WargameRoutes.Rounds, WargameRoutes.RoundView],
      testId: 'nav-cw-rounds',
    },

    {
      path: WargameRoutes.Approvals,
      labelKey: 'cognitiveWargame.nav.approvals',
      pathMap: [WargameRoutes.Approvals],
      testId: 'nav-cw-approvals',
    },
  ],
  i18n: {
    namespaces: ['cognitiveWargame'],
    lazy: {
      zh: () => import('./locales/zh'),
      en: () => import('./locales/en'),
    },
  },
};

export default definition;
