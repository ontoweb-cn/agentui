import { Routes } from '@/constants/routes';

import { redirectPreservingSearch } from '../redirect';
import type { ModuleDefinition } from '../_types';
import { AgentRoutes } from './routes';

const definition: ModuleDefinition = {
  name: 'agents',
  order: 20,
  enabled: () => true,
  routes: [
    {
      path: AgentRoutes.AgentList,
      Component: () => import('@/pages/agents'),
    },
    {
      path: `${AgentRoutes.AgentLogPage}/:id`,
      Component: () => import('@/pages/agents/agent-log-page'),
    },
    {
      path: '/',
      Component: () => import('@/layouts/root-layout'),
      children: [
        {
          // 智能体列表已并入任务 hub(/tasks/agent),旧链接带 query 重定向
          path: AgentRoutes.Agents,
          loader: redirectPreservingSearch(Routes.TasksAgent),
        },
        {
          path: AgentRoutes.AgentTemplates,
          layout: false,
          Component: () => import('@/pages/agents/agent-templates'),
        },
      ],
    },
  ],
  i18n: {
    namespaces: ['agents'],
    lazy: {
      zh: () => import('./locales/zh'),
      en: () => import('./locales/en'),
    },
  },
};

export default definition;
