import type { ModuleDefinition } from '../_types';
import { FileRoutes } from './routes';

const definition: ModuleDefinition = {
  name: 'files',
  order: 60,
  enabled: () => true,
  routes: [
    {
      path: '/',
      Component: () => import('@/layouts/root-layout'),
      children: [
        {
          path: FileRoutes.Files,
          Component: () => import('@/pages/files'),
        },
        {
          path: FileRoutes.Skills,
          Component: () => import('@/pages/skills'),
        },
      ],
    },
  ],
  nav: [
    {
      path: FileRoutes.Files,
      labelKey: 'header.fileManager',
      pathMap: [FileRoutes.Files],
    },
  ],
  i18n: {
    namespaces: ['files'],
    lazy: {
      zh: () => import('./locales/zh'),
      en: () => import('./locales/en'),
    },
  },
};

export default definition;
