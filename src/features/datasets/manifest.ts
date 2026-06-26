import type { ModuleDefinition } from '../_types';
import { DatasetRoutes } from './routes';

const definition: ModuleDefinition = {
  name: 'datasets',
  order: 50,
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
          path: DatasetRoutes.Datasets,
          Component: () => import('@/pages/datasets'),
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
  nav: [
    {
      path: DatasetRoutes.Datasets,
      labelKey: 'header.dataset',
      pathMap: [DatasetRoutes.Datasets, DatasetRoutes.DatasetBase],
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
