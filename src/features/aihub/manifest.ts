import { LucideLibrary } from 'lucide-react';
import { redirect } from 'react-router';

import { Routes } from '@/constants/routes';

import type { ModuleDefinition } from '../_types';
import { DEFAULT_RESOURCE_TYPE } from './resource-types';

/**
 * AIHub「资源」入口（M0 骨架，M1 起为 `/hub` 资源市场）。
 *
 * - 编译期 feature，随宿主发版；非运行时插件。
 * - 导航是否可见由 global-navbar 按 features['aihub'] 过滤。
 * - 页面自身再次门控，能力关闭时不发起业务请求。
 * - `/resources*` 为历史路径，仅做重定向兼容。
 */
const definition: ModuleDefinition = {
  name: 'aihub',
  order: 90,
  enabled: () => true,
  routes: [
    {
      path: '/',
      Component: () => import('@/layouts/root-layout'),
      children: [
        {
          path: Routes.Hub,
          Component: () => import('./pages/hub'),
          children: [
            {
              index: true,
              loader: () => redirect(`${Routes.Hub}/${DEFAULT_RESOURCE_TYPE}`),
            },
            {
              path: 'library',
              Component: () => import('./pages/hub/installations'),
            },
            {
              path: ':type',
              Component: () => import('./pages/hub/asset-list'),
            },
            {
              path: ':type/:assetId',
              Component: () => import('./pages/hub/asset-list'),
            },
          ],
        },
        {
          path: Routes.Resources,
          loader: () => redirect(Routes.Hub),
        },
        {
          path: Routes.ResourcesType,
          loader: ({ params }) =>
            redirect(`${Routes.Hub}/${params.type ?? DEFAULT_RESOURCE_TYPE}`),
        },
      ],
    },
  ],
  nav: [
    {
      path: Routes.Hub,
      labelKey: 'header.resources',
      icon: LucideLibrary,
      // 默认导航项 order=100；「资源」放在既有五项之后。
      order: 110,
      feature: 'aihub',
      testId: 'nav-hub',
    },
  ],
  i18n: {
    namespaces: ['aihub'],
    lazy: {
      zh: () => import('./locales/zh'),
      en: () => import('./locales/en'),
    },
  },
};

export default definition;
