import { Routes } from '@/constants/routes';

import { redirectPreservingSearch } from '../redirect';
import type { ModuleDefinition } from '../_types';
import { ChatRoutes } from './routes';

const definition: ModuleDefinition = {
  name: 'chats',
  order: 10,
  enabled: () => true,
  routes: [
    {
      path: ChatRoutes.ChatShare,
      layout: false,
      Component: () => import('@/pages/next-chats/share'),
    },
    {
      path: ChatRoutes.ChatWidget,
      layout: false,
      Component: () => import('@/pages/next-chats/widget'),
    },
    {
      path: `${ChatRoutes.Chat}/:id`,
      Component: () => import('@/pages/next-chats/chat'),
    },
    {
      // 聊天列表已并入任务 hub(/tasks/chat),旧链接带 query 重定向
      path: ChatRoutes.Chats,
      loader: redirectPreservingSearch(Routes.TasksChat),
    },
  ],
  i18n: {
    namespaces: ['chats'],
    lazy: {
      zh: () => import('./locales/zh'),
      en: () => import('./locales/en'),
    },
  },
};

export default definition;
