import { redirect } from 'react-router';

import { Routes } from '@/constants/routes';

import type { ModuleDefinition } from '../_types';
import { MemoriesRoutes } from './routes';

/**
 * 记忆：已并入「知识」hub，作为其二级菜单（`/knowledge/memories`）。
 *
 * 本模块只保留旧路径重定向与 i18n 词条：
 * - `/memories` → `/knowledge/memories`
 * - `/memory/*` → `/knowledge/memory/*`
 *
 * 页面路由注册在 knowledge manifest 内，以保证始终渲染在知识 hub 的
 * 左侧菜单布局中。能力门控（memory=false 隐藏菜单项）由 knowledge 页面处理。
 */
const definition: ModuleDefinition = {
  name: 'memories',
  order: 50,
  // 仅保留旧路径重定向与 i18n；页面路由与能力门控在 knowledge hub 内处理。
  routes: [
    {
      path: '/',
      Component: () => import('@/layouts/root-layout'),
      children: [
        {
          path: MemoriesRoutes.LegacyMemories,
          loader: ({ request }) => {
            const { search } = new URL(request.url);
            return redirect(`${Routes.Memories}${search}`);
          },
        },
        {
          path: `${MemoriesRoutes.LegacyMemory}/*`,
          loader: ({ request, params }) => {
            const { search } = new URL(request.url);
            const rest = params['*'];
            return redirect(
              `${Routes.Memory}${rest ? `/${rest}` : ''}${search}`,
            );
          },
        },
      ],
    },
  ],
  nav: [],
  i18n: {
    namespaces: ['memories'],
    lazy: {
      zh: () => import('./locales/zh'),
      en: () => import('./locales/en'),
    },
  },
};

export default definition;
