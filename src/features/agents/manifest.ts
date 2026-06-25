import type { ModuleDefinition } from '../_types';
import { AgentRoutes } from './routes';

const definition: ModuleDefinition = {
  name: 'agents',
  order: 40,
  enabled: () => true,
  routes: [
    {
      path: AgentRoutes.AgentList,
      Component: () => import('@/pages/agents'),
    },
    {
      path: AgentRoutes.AgentShare,
      layout: false,
      Component: () => import('@/pages/agent/share'),
    },
    {
      path: AgentRoutes.Agent,
      children: [
        {
          path: `${AgentRoutes.Agent}/:id`,
          Component: () => import('@/pages/agent'),
        },
        {
          path: AgentRoutes.AgentExplore,
          Component: () => import('@/pages/agent/explore'),
        },
      ],
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
          path: AgentRoutes.Agents,
          Component: () => import('@/pages/agents'),
        },
        {
          path: AgentRoutes.AgentTemplates,
          layout: false,
          Component: () => import('@/pages/agents/agent-templates'),
        },
      ],
    },
  ],
  nav: [
    {
      path: AgentRoutes.Agents,
      labelKey: 'header.flow',
      pathMap: [AgentRoutes.Agents, AgentRoutes.AgentTemplates],
      testId: 'nav-agent',
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
