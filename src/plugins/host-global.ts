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

const registrations = new Map<string, PluginAppRegistration>();

export function installAgentUIHostGlobal() {
  if (typeof window === 'undefined') {
    return;
  }
  if ((window as unknown as { AgentUI?: AgentUIHostGlobal }).AgentUI) {
    return;
  }
  const global: AgentUIHostGlobal = {
    registerApp(registration) {
      registrations.set(registration.id, registration);
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
