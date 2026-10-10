import { Routes } from '@/constants/routes';

import { redirectPreservingSearch } from '../redirect';
import type { ModuleDefinition } from '../_types';
import { FileRoutes } from './routes';

const definition: ModuleDefinition = {
  name: 'files',
  order: 60,
  enabled: () => true,
  routes: [
    {
      path: '/',
      Component: () => import('@/layouts/root-layout'),
      children: [
        {
          // 文件管理列表已并入知识 hub(/knowledge/files),旧链接带 query 重定向
          path: FileRoutes.Files,
          loader: redirectPreservingSearch(Routes.KnowledgeFiles),
        },
        {
          path: FileRoutes.Skills,
          Component: () => import('@/pages/skills'),
        },
      ],
    },
  ],
  i18n: {
    namespaces: ['files'],
    lazy: {
      zh: () => import('./locales/zh'),
      en: () => import('./locales/en'),
    },
  },
};

export default definition;
