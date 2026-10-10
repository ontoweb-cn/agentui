import { LucideBookOpen } from 'lucide-react';
import { redirect } from 'react-router';

import { Routes } from '@/constants/routes';

import type { ModuleDefinition } from '../_types';
import { DatasetRoutes } from '../datasets/routes';
import { FileRoutes } from '../files/routes';
import { SearchRoutes } from '../searches/routes';

/**
 * 知识 hub:一级导航"知识"收敛原"知识库/文件管理/搜索"三个入口。
 * 侧栏子菜单切换内容区,复用 datasets / files / next-searches 列表页组件。
 *
 * 知识库子菜单的隐藏由页面内 useIsCapabilityEnabled 响应式处理(能力来自
 * 登录后的 /capabilities 查询,路由表加载期不可得);/knowledge/dataset
 * 路由保持常驻,无 RAG 时经 URL 仍可达——与被替代的旧 /datasets 路由一致。
 */
const definition: ModuleDefinition = {
  name: 'knowledge',
  order: 20,
  enabled: () => true,
  routes: [
    {
      path: '/',
      Component: () => import('@/layouts/root-layout'),
      children: [
        {
          path: Routes.Knowledge,
          Component: () => import('@/pages/knowledge'),
          children: [
            {
              index: true,
              loader: () => redirect(Routes.KnowledgeDataset),
            },
            {
              path: Routes.KnowledgeDataset,
              Component: () => import('@/pages/datasets'),
            },
            {
              path: Routes.KnowledgeFiles,
              Component: () => import('@/pages/files'),
            },
            {
              path: Routes.KnowledgeSearch,
              Component: () => import('@/pages/next-searches'),
            },
          ],
        },
      ],
    },
  ],
  nav: [
    {
      path: Routes.Knowledge,
      labelKey: 'header.knowledge',
      icon: LucideBookOpen,
      // 知识库详情(/dataset/:id)、文件管理(/files/*)、搜索详情(/search/:id)在知识域内,导航保持高亮
      pathMap: [
        Routes.Knowledge,
        DatasetRoutes.DatasetBase,
        FileRoutes.Files,
        SearchRoutes.Search,
      ],
      testId: 'nav-knowledge',
    },
  ],
};

export default definition;
