import { Routes } from '@/constants/routes';

import { redirectPreservingSearch } from '../redirect';
import type { ModuleDefinition } from '../_types';
import { SearchRoutes } from './routes';

const definition: ModuleDefinition = {
  name: 'searches',
  order: 40,
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
          // 搜索列表已并入知识 hub(/knowledge/search),旧链接带 query 重定向
          path: SearchRoutes.Searches,
          loader: redirectPreservingSearch(Routes.KnowledgeSearch),
        },
        {
          path: `${SearchRoutes.Search}/:id`,
          layout: false,
          Component: () => import('@/pages/next-search'),
        },
      ],
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
