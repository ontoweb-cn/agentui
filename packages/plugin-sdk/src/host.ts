/**
 * @agentui/plugin-sdk/host — Tier B 共享面子入口
 * (docs/canvas-stage4-independent-build-spec.md §三,Tier B SDK-shim 档)。
 *
 * 与主入口(零依赖、纯契约类型)不同:host 子入口描述的是宿主经
 * `window.__AGENTUI_SHARED__` 暴露的**共享单例面**(React/react-query/
 * i18n/ui 白名单),供一方插件(canvas 档)消费。类型刻意保持结构化宽松:
 * namespace 的强类型由插件侧以自身依赖断言(`sharedHost.react as typeof React`),
 * 本包不依赖 react/query——保持 SDK 零依赖纪律。
 *
 * 契约纪律:SHARED_API_VERSION 与宿主 src/plugins/host-externals.ts 安装的
 * 版本同步演进(快照测试锁定模块清单与导出名);只加不改删——改签名/删
 * 导出 = 破坏性,必须 bump major 并同步本包 version 的 host 段。
 */

/** 共享面契约版本(独立于窄面 HOST_API_VERSION 演进)。
 * 1.1.0(2026-10-16,S2):加法增量——jsxRuntime/router/reactI18next/i18nModule/
 * themeProvider 五槽位(canvas 独立构建的单例外部化面,spec §9.1),既有槽位不变。 */
export const SHARED_API_VERSION = '1.1.0';

/**
 * ui 白名单模块键清单(单源)。
 * 宿主 host-externals.ts 按此构造 ui 表(快照测试断言一致);canvas 独立构建
 * 配置消费同一清单生成 '@/components/ui/<key>' → shared.ui.<key> 映射。
 */
export const SHARED_UI_MODULE_KEYS = [
  'accordion',
  'breadcrumb',
  'button',
  'card',
  'checkbox',
  'collapsible',
  'command',
  'date-picker',
  'dialog',
  'dropdown-menu',
  'form',
  'hover-card',
  'input',
  'intellect-pagination',
  'label',
  'message',
  'modal',
  'multi-select',
  'popover',
  'progress',
  'radio',
  'radio-group',
  'scroll-area',
  'select',
  'separator',
  'sheet',
  'skeleton',
  'spin',
  'switch',
  'table',
  'tabs',
  'textarea',
  'tooltip',
] as const;

/**
 * 宿主共享单例面形态。namespace 字段为宿主编译期模块单例:
 * - react/reactDom/reactDomClient/reactQuery:整包 namespace
 *   (Consumer 侧 `sharedHost.react as typeof React` 获得强类型);
 * - jsxRuntime:react/jsx-runtime(插件 JSX 自动编译产物的导入目标);
 * - router:react-router(context 绑定面,与宿主路由同 module);
 * - reactI18next:react-i18next(与宿主同 module → 同 I18n context);
 * - i18n:宿主 i18next 单例实例(与宿主 useTranslation 同源);
 * - i18nModule:@/locales/config 模块 namespace(default=实例+命名导出);
 * - themeProvider:宿主主题 Provider 模块 namespace(根级 context 单一来源);
 * - ui:白名单模块表,键=SHARED_UI_MODULE_KEYS,值=该模块 namespace;
 * - lib:宿主工具(cn 等)。
 */
export interface AgentUISharedHost {
  SHARED_API_VERSION: string;
  react: unknown;
  reactDom: unknown;
  /** react-dom/client(createRoot 等),与 reactDom 分开暴露。 */
  reactDomClient: unknown;
  reactQuery: unknown;
  /** react/jsx-runtime 命名空间(1.1.0)。 */
  jsxRuntime: unknown;
  /** react-router 命名空间(1.1.0)。 */
  router: unknown;
  /** react-i18next 命名空间(1.1.0)。 */
  reactI18next: unknown;
  /** 宿主 i18next 实例(非 namespace)。 */
  i18n: unknown;
  /** @/locales/config 模块 namespace(1.1.0,default+i18n 辅助导出)。 */
  i18nModule: unknown;
  /** @/components/theme-provider 模块 namespace(1.1.0)。 */
  themeProvider: unknown;
  ui: Record<string, unknown>;
  lib: Record<string, unknown>;
}

/** 全局键名(与宿主 host-externals.ts 的 AGENTUI_SHARED_GLOBAL_KEY 一致)。 */
export const AGENTUI_SHARED_GLOBAL_KEY = '__AGENTUI_SHARED__';

/**
 * Tier B host 插件入口定义(spec §9.2):形状与宿主 ModuleDefinition 结构同构
 * (routes/nav/i18n/app 字段,Component 为懒加载器),由宿主 runtime 消费。
 * 类型刻意保持结构化宽松(与 AgentUISharedHost 同纪律):宿主
 * `src/features/_types.ts` 仍是单一事实源,本类型只约束注册期必须可静态校验的
 * 形状;运行时宿主侧逐字段校验兜底。
 */
export interface HostPluginDefinition {
  name: string;
  routes: Array<{
    /** 与宿主 RouteObject 同构:编译期表可缺省(如父路径承载),运行时
     *  宿主 loader 会对非空 path 做注册前校验。 */
    path?: string;
    Component?: () => Promise<{ default: unknown }>;
    layout?: boolean;
    [key: string]: unknown;
  }>;
  nav?: unknown[];
  i18n?: {
    namespaces: string[];
    lazy: Record<string, () => Promise<{ default: unknown }>>;
  };
  app?: unknown;
  [key: string]: unknown;
}

/** Tier B host 插件入口 helper(带类型;零运行时逻辑,与 definePlugin 对称)。 */
export function defineHostPlugin(def: HostPluginDefinition): HostPluginDefinition {
  return def;
}

/**
 * 读取宿主共享单例面;宿主未安装(非宿主环境/Tier A 场景/宿主过旧)时返回 null。
 * Tier B 插件入口应在 mount 前判空并给出可诊断错误。
 */
export function getSharedHost(): AgentUISharedHost | null {
  const shared = (globalThis as Record<string, unknown>)[
    AGENTUI_SHARED_GLOBAL_KEY
  ] as AgentUISharedHost | undefined;
  if (
    shared &&
    typeof shared.SHARED_API_VERSION === 'string' &&
    shared.ui instanceof Object
  ) {
    return shared;
  }
  return null;
}
