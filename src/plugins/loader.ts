/**
 * 插件装载器:同源 HTTP 动态 import(经 BFF 文件路由)。
 *
 * 插件产物是自包含单文件 ESM(无裸模块导入),同源 URL 下可直接 import;
 * 模块执行时会调用 window.AgentUI.registerApp 完成注册(QwenPaw 同款侧效果契约)。
 * 装载按插件单飞去重,失败不缓存(挂载页可重试)。
 *
 * 已知限制(评审记录):运行中经 BFF 卸载插件后,本页已装载的模块不会失效,
 * 刷新页面即恢复一致;不做运行时卸载(当前无卸载 UI 入口)。
 */

import { getPluginRegistration } from './host-global';
import type { PluginAppMetadata, PluginAppRegistration } from './types';

const loadCache = new Map<string, Promise<PluginAppRegistration>>();

export function pluginEntryUrl(meta: PluginAppMetadata): string {
  return `/api/bff/plugins/${meta.id}/files/${meta.entry}`;
}

export function loadPluginApp(
  meta: PluginAppMetadata,
): Promise<PluginAppRegistration> {
  const cached = loadCache.get(meta.id);
  if (cached) {
    return cached;
  }
  const pending = import(/* @vite-ignore */ pluginEntryUrl(meta))
    .then(() => {
      const registration = getPluginRegistration(meta.id);
      if (!registration) {
        throw new Error(
          `插件 ${meta.id} 已加载但未调用 window.AgentUI.registerApp 注册`,
        );
      }
      return registration;
    })
    .catch((error: unknown) => {
      loadCache.delete(meta.id);
      throw error;
    });
  loadCache.set(meta.id, pending);
  return pending;
}
