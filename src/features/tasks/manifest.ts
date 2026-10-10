import { LucideListTodo } from 'lucide-react';
import { redirect } from 'react-router';

import { Routes } from '@/constants/routes';

import type { ModuleDefinition } from '../_types';
import { AgentRoutes } from '../agents/routes';
import { ChatRoutes } from '../chats/routes';

/**
 * 任务 hub:一级导航"任务"收敛原"聊天/智能体"两个入口。
 * 侧栏子菜单切换内容区,复用 next-chats / agents 列表页组件。
 */
const definition: ModuleDefinition = {
  name: 'tasks',
  order: 10,
  enabled: () => true,
  routes: [
    {
      path: '/',
      Component: () => import('@/layouts/root-layout'),
      children: [
        {
          path: Routes.Tasks,
          Component: () => import('@/pages/tasks'),
          children: [
            {
              index: true,
              loader: () => redirect(Routes.TasksChat),
            },
            {
              path: Routes.TasksChat,
              Component: () => import('@/pages/next-chats'),
            },
            {
              path: Routes.TasksAgent,
              Component: () => import('@/pages/agents'),
            },
          ],
        },
      ],
    },
  ],
  nav: [
    {
      path: Routes.Tasks,
      labelKey: 'header.tasks',
      icon: LucideListTodo,
      // 聊天会话页(/chat/:id)与智能体模板页在任务域内,导航保持高亮
      pathMap: [Routes.Tasks, ChatRoutes.Chat, AgentRoutes.AgentTemplates],
      testId: 'nav-tasks',
    },
  ],
};

export default definition;
