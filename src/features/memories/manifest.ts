import type { ModuleDefinition } from '../_types';
import { MemoriesRoutes } from './routes';

const definition: ModuleDefinition = {
  name: 'memories',
  order: 50,
  enabled: () => true,
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
