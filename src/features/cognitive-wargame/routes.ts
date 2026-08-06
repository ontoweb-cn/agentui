/**
 * Cognitive Wargame 插件路由配置。
 *
 * 使用 LazyRouteConfig 形式，组件通过 `() => import(...)` 懒加载。
 * 每个功能页有 index 路由（无 :id，用于导航入口）和 detail 路由（带 :id）。
 */
import type { LazyRouteConfig } from '../_types';

/** 路由路径常量，供 manifest 与页面导航复用。 */
export const WargameRoutes = {
  Dashboard: '/cognitive-wargame',
  Scenarios: '/cognitive-wargame/scenarios',
  ScenarioDetail: '/cognitive-wargame/scenarios/:id',
  Rounds: '/cognitive-wargame/rounds',
  RoundView: '/cognitive-wargame/rounds/:id',
  Metrics: '/cognitive-wargame/metrics',
  MetricsView: '/cognitive-wargame/metrics/:id',
  KG: '/cognitive-wargame/kg',
  KGView: '/cognitive-wargame/kg/:id',
  Reports: '/cognitive-wargame/reports',
  ReportView: '/cognitive-wargame/reports/:id',
  Playback: '/cognitive-wargame/playback',
  PlaybackView: '/cognitive-wargame/playback/:id',
  Approvals: '/cognitive-wargame/approvals',
} as const;

/** 构造想定详情等动态路径的工具函数。 */
export const WargamePath = {
  scenarioDetail: (id: string) => `/cognitive-wargame/scenarios/${id}`,
  roundView: (id: string) => `/cognitive-wargame/rounds/${id}`,
  metricsView: (id: string) => `/cognitive-wargame/metrics/${id}`,
  kgView: (id: string) => `/cognitive-wargame/kg/${id}`,
  reportView: (id: string) => `/cognitive-wargame/reports/${id}`,
  playbackView: (id: string) => `/cognitive-wargame/playback/${id}`,
};

const routes: LazyRouteConfig[] = [
  {
    path: WargameRoutes.Dashboard,
    Component: () => import('./pages/DashboardPage'),
  },
  {
    path: WargameRoutes.Scenarios,
    Component: () => import('./pages/ScenarioListPage'),
  },
  {
    path: WargameRoutes.ScenarioDetail,
    Component: () => import('./pages/ScenarioDetailPage'),
  },
  // rounds: index（导航入口）+ detail（带 scenarioId）
  {
    path: WargameRoutes.Rounds,
    Component: () => import('./pages/RoundViewPage'),
  },
  {
    path: WargameRoutes.RoundView,
    Component: () => import('./pages/RoundViewPage'),
  },
  // metrics: index + detail
  {
    path: WargameRoutes.Metrics,
    Component: () => import('./pages/MetricsViewPage'),
  },
  {
    path: WargameRoutes.MetricsView,
    Component: () => import('./pages/MetricsViewPage'),
  },
  // kg: index + detail
  {
    path: WargameRoutes.KG,
    Component: () => import('./pages/KGViewPage'),
  },
  {
    path: WargameRoutes.KGView,
    Component: () => import('./pages/KGViewPage'),
  },
  // reports: index + detail
  {
    path: WargameRoutes.Reports,
    Component: () => import('./pages/ReportViewPage'),
  },
  {
    path: WargameRoutes.ReportView,
    Component: () => import('./pages/ReportViewPage'),
  },
  // playback: index + detail（P3.4-3 历史回放）
  {
    path: WargameRoutes.Playback,
    Component: () => import('./pages/PlaybackPage'),
  },
  {
    path: WargameRoutes.PlaybackView,
    Component: () => import('./pages/PlaybackPage'),
  },
  // approvals: 想定审批（P3.3-3）
  {
    path: WargameRoutes.Approvals,
    Component: () => import('./pages/ApprovalListPage'),
  },
];

export default routes;
