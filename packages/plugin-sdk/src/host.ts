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

/** 共享面契约版本(独立于窄面 HOST_API_VERSION 演进)。 */
export const SHARED_API_VERSION = '1.0.0';

/**
 * 宿主共享单例面形态。namespace 字段为宿主编译期模块单例:
 * - react/reactDom/reactDomClient/reactQuery:整包 namespace
 *   (Consumer 侧 `sharedHost.react as typeof React` 获得强类型);
 * - i18n:宿主 i18next 单例实例(与宿主 useTranslation 同源);
 * - ui:白名单模块表,键=宿主模块路径尾段(如 'button'、'modal'),值=
 *   该模块 namespace(全部命名导出,含组件与辅助导出);
 * - lib:宿主工具(cn 等)。
 */
export interface AgentUISharedHost {
  SHARED_API_VERSION: string;
  react: unknown;
  reactDom: unknown;
  /** react-dom/client(createRoot 等),与 reactDom 分开暴露。 */
  reactDomClient: unknown;
  reactQuery: unknown;
  /** 宿主 i18next 实例(非 namespace)。 */
  i18n: unknown;
  ui: Record<string, unknown>;
  lib: Record<string, unknown>;
}

/** 全局键名(与宿主 host-externals.ts 的 AGENTUI_SHARED_GLOBAL_KEY 一致)。 */
export const AGENTUI_SHARED_GLOBAL_KEY = '__AGENTUI_SHARED__';

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
