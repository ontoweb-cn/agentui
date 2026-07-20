// spec-009: 画布插件 ModuleDefinition
// _registry.ts 的 import.meta.glob 通过 features/canvas/manifest.ts 发现并加载
//
// LazyRouteConfig 使用 Component 字段(异步 import,由 withLazyRoute 包装 React.lazy+Suspense),
// layout: false 表示不使用根布局组件。

import type { ModuleDefinition } from '@/features/_types';
import { AgentRoutes } from '@/features/agents/routes';

const canvasModule: ModuleDefinition = {
  name: 'canvas',
  order: 40,
  enabled: (ctx) => ctx.capabilities.has('canvas'),

  routes: [
    // 画布编辑器 — /agent/:id
    {
      path: `${AgentRoutes.Agent}/:id`,
      Component: () => import('./editor'),
    },
    // 画布 explore — /agent/:id/explore
    {
      path: AgentRoutes.AgentExplore,
      Component: () => import('./editor/explore'),
    },
    // 画布分享页(无 layout)
    {
      path: AgentRoutes.AgentShare,
      layout: false,
      Component: () => import('./editor/share'),
    },
  ],

  i18n: {
    namespaces: ['translation'],
    lazy: {
      zh: () => import('./i18n/zh'),
      en: () => import('./i18n/en'),
    },
  },
};

export default canvasModule;
