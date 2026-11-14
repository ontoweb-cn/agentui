import { LucideLibrary } from 'lucide-react';

import { Routes } from '@/constants/routes';

import type { ModuleDefinition } from '../_types';

/**
 * AIHub「资源」入口（M0 骨架）。
 *
 * - 编译期 feature，随宿主发版；非运行时插件。
 * - 导航是否可见由 global-navbar 按 features['aihub'] 过滤。
 * - 页面自身再次门控，能力关闭时不发起业务请求。
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
          path: Routes.Resources,
          Component: () => import('./index'),
        },
        {
          path: Routes.ResourcesType,
          Component: () => import('./index'),
        },
      ],
    },
  ],
  nav: [
    {
      path: Routes.Resources,
      labelKey: 'header.resources',
      icon: LucideLibrary,
      // 默认导航项 order=100；「资源」放在既有五项之后。
      order: 110,
      feature: 'aihub',
      testId: 'nav-resources',
    },
  ],
};

export default definition;
