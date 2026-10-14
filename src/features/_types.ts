import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router';

export interface ModuleContext {
  isEnterprise: boolean;
  capabilities: Set<string>;
}

export interface NavItem {
  path: string;
  labelKey: string;
  icon?: ComponentType<{ className?: string }>;
  pathMap?: string[];
  order?: number;
  testId?: string;
  [key: string]: unknown;
}

/**
 * APP 插件卡片元数据:声明了 app 字段的模块会出现在"应用"(/applications)列表页。
 * 挂载路径由插件自治(如 /cognitive-wargame),不要求统一前缀。
 * labelKey 为宿主词条;label/description 为字面文案,运行时插件(词条随插件
 * bundle,宿主侧不可用)使用,渲染时优先于 labelKey。
 */
export interface AppPluginCard {
  id: string;
  path: string;
  labelKey?: string;
  label?: string;
  descriptionKey?: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  order?: number;
  /**
   * 非空 = 插件与宿主不兼容(版本声明不满足,第三方生态兼容策略):
   * 卡片仍展示(标注"不兼容"徽标),装载页显示原因且不加载插件 JS。
   */
  incompatibleReason?: string;
}

export interface FeatureI18n {
  namespaces: string[];
  lazy: Record<string, () => Promise<{ default: any }>>;
}

export type LazyRouteConfig = Omit<RouteObject, 'Component' | 'children'> & {
  Component?: () => Promise<{ default: ComponentType<any> }>;
  children?: LazyRouteConfig[];
  layout?: boolean;
  /**
   * 是否需要认证守卫(AuthWrapper)。
   * - true: 用 AuthWrapper 包裹 Component,未登录跳转登录页,探测中渲染空白
   * - false: 不添加守卫(登录页/404/admin 等自有认证机制的路由)
   * - undefined: 继承父路由的 authRequired(顶层路由默认不添加)
   */
  authRequired?: boolean;
};

export interface ModuleDefinition {
  name: string;
  enabled?: (ctx: ModuleContext) => boolean;
  order?: number;
  routes: LazyRouteConfig[];
  nav?: NavItem[];
  app?: AppPluginCard;
  i18n?: FeatureI18n;
  providers?: ComponentType[];
  init?: (ctx: ModuleContext) => void;
}

export type ModuleManifest = ModuleDefinition;
