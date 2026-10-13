/**
 * window.AgentUI 宿主全局:运行时插件装载前安装,是插件的唯一宿主 API 入口。
 *
 * 对应 QwenPaw 的 window.QwenPaw(host 全局 + registerRoutes 侧效果注册)。
 * v1 面:registerApp(注册挂载函数)+ host.getApiToken。
 * 注意:该导出面即事实公共 API,变更需同步插件侧并记录文档。
 *
 * 信任边界(评审 L1,必须知悉后再接入新插件):
 * 插件 JS 与宿主同源执行,可完整访问 DOM 与 localStorage(含宿主登录
 * token)。本机制只面向「内部可信仓库」的插件,不要用于不可信第三方
 * 代码;不可信场景请走 iframe 隔离档(设计文档 render:"iframe",未实现)。
 */

import type { AgentUIHostGlobal, PluginAppRegistration } from './types';

/**
 * 宿主插件 API 版本(语义化)。
 * 变更导出面(增删改 registerApp/host/事件 API)必须 bump 此值
 * 并更新 __tests__/runtime.test.ts 的契约快照;插件侧可读取此值做兼容判断。
 * 1.1.0:新增 on() 事件订阅(localechange/themechange)。
 */
export const HOST_API_VERSION = '1.1.0';

/** 宿主→插件的事件契约(载荷形态)。 */
export interface HostEventMap {
  localechange: { lng: string };
  themechange: { theme: string };
}

export type HostEventName = keyof HostEventMap;

const registrations = new Map<string, PluginAppRegistration>();
// 监听器以 unknown 载荷存储,收发两侧各自收窄(事件名↔载荷的关联由 on/emit 泛型保证)
const listeners = new Map<HostEventName, Set<(payload: unknown) => void>>();

/** 宿主内部发射事件(语言/主题切换点调用);不暴露给插件。 */
export function emitHostEvent<K extends HostEventName>(
  event: K,
  payload: HostEventMap[K],
) {
  listeners.get(event)?.forEach((listener) => {
    try {
      (listener as (p: HostEventMap[K]) => void)(payload);
    } catch (err) {
      console.error(`[plugins] 事件 ${event} 监听器异常:`, err);
    }
  });
}

export function installAgentUIHostGlobal() {
  if (typeof window === 'undefined') {
    return;
  }
  if ((window as unknown as { AgentUI?: AgentUIHostGlobal }).AgentUI) {
    return;
  }
  const global: AgentUIHostGlobal = {
    HOST_API_VERSION,
    registerApp(registration) {
      registrations.set(registration.id, registration);
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set<(payload: unknown) => void>();
      set.add(listener as unknown as (payload: unknown) => void);
      listeners.set(event, set);
      return () => {
        set.delete(listener as unknown as (payload: unknown) => void);
      };
    },
    host: {
      getApiToken() {
        try {
          return localStorage.getItem('Authorization');
        } catch {
          return null;
        }
      },
    },
  };
  (window as unknown as { AgentUI?: AgentUIHostGlobal }).AgentUI = global;
}

export function getPluginRegistration(
  id: string,
): PluginAppRegistration | undefined {
  return registrations.get(id);
}
