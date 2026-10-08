/**
 * Cognitive Wargame 插件清单。
 *
 * 字段对齐 `ModuleDefinition`（见 features/_types.ts）：
 * - name/order/enabled 控制插件注册与排序
 * - routes 由 routes.ts 提供懒加载路由
 * - app 声明为 APP 插件,出现在"应用"(/applications)列表页;
 *   顶部导航不再直接暴露入口,模块内导航由 components/section-menu.tsx 承担
 * - i18n 提供中英文懒加载词条
 */
import { Swords } from 'lucide-react';

import type { ModuleDefinition } from '../_types';
import routes, { WargameRoutes } from './routes';

const definition: ModuleDefinition = {
  name: 'cognitive-wargame',
  order: 50,
  enabled: () => true,
  routes,
  app: {
    id: 'cognitive-wargame',
    path: WargameRoutes.Dashboard,
    labelKey: 'cognitiveWargame.common.title',
    descriptionKey: 'cognitiveWargame.common.subtitle',
    icon: Swords,
  },
  i18n: {
    namespaces: ['cognitiveWargame'],
    lazy: {
      zh: () => import('./locales/zh'),
      en: () => import('./locales/en'),
    },
  },
};

export default definition;
