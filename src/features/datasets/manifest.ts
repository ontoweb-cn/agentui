import { Routes } from '@/constants/routes';

import { redirectPreservingSearch } from '../redirect';
import type { ModuleDefinition } from '../_types';
import { DatasetRoutes } from './routes';

const definition: ModuleDefinition = {
  name: 'datasets',
  order: 30,
  // Multi-Harness P2 (US2):knowledgeBase=false 时隐藏知识库菜单/路由。
  // capabilities 为空(加载中/未注入)时默认启用(Progressive Enhancement)。
  enabled: (ctx) =>
    ctx.capabilities.size === 0 || ctx.capabilities.has('knowledgeBase'),
  routes: [
    {
      path: '/',
      Component: () => import('@/layouts/root-layout'),
      children: [
        {
          // 知识库列表已并入知识 hub(/knowledge/dataset),旧链接带 query 重定向
          path: DatasetRoutes.Datasets,
          loader: redirectPreservingSearch(Routes.KnowledgeDataset),
        },
        {
          path: DatasetRoutes.DatasetBase,
          Component: () => import('@/pages/dataset'),
          children: [
            {
              path: `${DatasetRoutes.Dataset}/:id`,
              Component: () => import('@/pages/dataset/dataset'),
            },
            {
              path: `${DatasetRoutes.DatasetBase}${DatasetRoutes.DatasetTesting}/:id`,
              Component: () => import('@/pages/dataset/testing'),
            },
            {
              path: `${DatasetRoutes.DatasetBase}${DatasetRoutes.KnowledgeGraph}/:id`,
              Component: () => import('@/pages/dataset/knowledge-graph'),
            },
            {
              path: `${DatasetRoutes.DatasetBase}${DatasetRoutes.DataSetOverview}/:id`,
              Component: () => import('@/pages/dataset/dataset-overview'),
            },
            {
              path: `${DatasetRoutes.DatasetBase}${DatasetRoutes.DataSetSetting}/:id`,
              Component: () => import('@/pages/dataset/dataset-setting'),
            },
          ],
        },
      ],
    },
  ],
  i18n: {
    namespaces: ['datasets'],
    lazy: {
      zh: () => import('./locales/zh'),
      en: () => import('./locales/en'),
    },
  },
};

export default definition;
