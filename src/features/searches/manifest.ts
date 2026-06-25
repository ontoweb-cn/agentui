import type { ModuleDefinition } from '../_types';
import { SearchRoutes } from './routes';

const definition: ModuleDefinition = {
  name: 'searches',
  order: 30,
  enabled: () => true,
  routes: [
    {
      path: SearchRoutes.SearchShare,
      Component: () => import('@/pages/next-search/share'),
    },
    {
      path: '/',
      Component: () => import('@/layouts/root-layout'),
      children: [
        {
          path: SearchRoutes.Searches,
          Component: () => import('@/pages/next-searches'),
        },
        {
          path: `${SearchRoutes.Search}/:id`,
          layout: false,
          Component: () => import('@/pages/next-search'),
        },
      ],
    },
  ],
  nav: [
    {
      path: SearchRoutes.Searches,
      labelKey: 'header.search',
      pathMap: [SearchRoutes.Searches, SearchRoutes.Search],
      testId: 'nav-search',
    },
  ],
  i18n: {
    namespaces: ['searches'],
    lazy: {
      zh: () => import('./locales/zh'),
      en: () => import('./locales/en'),
    },
  },
};

export default definition;
