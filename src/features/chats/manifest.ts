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
      path: '/',
      Component: () => import('@/layouts/root-layout'),
      children: [
        {
          path: ChatRoutes.Chats,
          Component: () => import('@/pages/next-chats'),
        },
      ],
    },
  ],
  nav: [
    {
      path: ChatRoutes.Chats,
      labelKey: 'header.chat',
      pathMap: [ChatRoutes.Chats, ChatRoutes.Chat],
      testId: 'nav-chat',
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
