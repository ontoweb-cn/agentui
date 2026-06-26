import type { ModuleDefinition } from '../_types';
import { MemoriesRoutes } from './routes';

const definition: ModuleDefinition = {
  name: 'memories',
  order: 50,
  // Multi-Harness P2 (US2):memory=false 时隐藏对话历史/总结入口。
  // capabilities 为空(加载中/未注入)时默认启用(Progressive Enhancement)。
  enabled: (ctx) =>
    ctx.capabilities.size === 0 || ctx.capabilities.has('memory'),
  routes: [
    {
      path: '/',
      Component: () => import('@/layouts/root-layout'),
      children: [
        {
          path: MemoriesRoutes.Memories,
          Component: () => import('@/pages/memories'),
        },
        {
          path: MemoriesRoutes.Memory,
          Component: () => import('@/pages/memory'),
          children: [
            {
              path: `${MemoriesRoutes.Memory}/${MemoriesRoutes.MemoryMessage}/:id`,
              Component: () => import('@/pages/memory/memory-message'),
            },
            {
              path: `${MemoriesRoutes.Memory}/${MemoriesRoutes.MemorySetting}/:id`,
              Component: () => import('@/pages/memory/memory-setting'),
            },
          ],
        },
      ],
    },
  ],
  nav: [
    {
      path: MemoriesRoutes.Memories,
      labelKey: 'header.memories',
      pathMap: [
        MemoriesRoutes.Memories,
        MemoriesRoutes.Memory,
        MemoriesRoutes.MemoryMessage,
      ],
      testId: 'nav-memory',
    },
  ],
  i18n: {
    namespaces: ['memories'],
    lazy: {
      zh: () => import('./locales/zh'),
      en: () => import('./locales/en'),
    },
  },
};

export default definition;
