// spec-009: 画布插件 ModuleDefinition
// _registry.ts 的 import.meta.glob 通过 features/canvas/manifest.ts 发现并加载

import type { ModuleDefinition } from '@/features/_types';
import { AgentRoutes } from '@/features/agents/routes';

const canvasModule: ModuleDefinition = {
  name: 'canvas',
  order: 40,
  enabled: (ctx) => ctx.capabilities.has('canvas'),

  routes: [
    // 画布编辑器
    {
      path: AgentRoutes.Agent,
      children: [
        {
          path: `${AgentRoutes.Agent}/:id`,
          lazy: () => import('./editor').then((m) => ({ Component: m.default })),
        },
        {
          path: AgentRoutes.AgentExplore,
          lazy: () => import('./editor/explore').then((m) => ({ Component: m.default })),
        },
      ],
    },
    // 画布分享页(无 layout)
    {
      path: AgentRoutes.AgentShare,
      layout: false,
      lazy: () => import('./editor/share').then((m) => ({ Component: m.default })),
    },
  ],

  i18n: {
    namespaces: ['agents'],
    lazy: {},
  },
};

export default canvasModule;
