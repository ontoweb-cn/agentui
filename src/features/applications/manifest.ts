import { LucideLayoutGrid } from 'lucide-react';

import type { ModuleDefinition } from '../_types';
import { ApplicationsRoutes } from './routes';

const definition: ModuleDefinition = {
  name: 'applications',
  order: 70,
  enabled: () => true,
  routes: [
    {
      path: '/',
      Component: () => import('@/layouts/root-layout'),
      children: [
        {
          path: ApplicationsRoutes.Applications,
          Component: () => import('./pages/application-list'),
        },
      ],
    },
  ],
  nav: [
    {
      path: ApplicationsRoutes.Applications,
      labelKey: 'header.applications',
      icon: LucideLayoutGrid,
      testId: 'nav-applications',
    },
  ],
  i18n: {
    namespaces: ['applications'],
    lazy: {
      zh: () => import('./locales/zh'),
      en: () => import('./locales/en'),
    },
  },
};

export default definition;
