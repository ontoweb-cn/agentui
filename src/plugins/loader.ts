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

/**
 * dev 热更(#6):VITE_PLUGIN_DEV_ENTRIES 列出的插件直接从其 vite dev
 * server 拉取入口(默认 9395,插件 npm run dev)——改源码刷新页面即生效,
 * 免 build+reinstall。不走宿主代理:dev server 产物的内部 import 是指向
 * 自身的绝对路径,经代理会被宿主 9391 错误接管;直连时模块链自洽回 9395,
 * vite dev 对 localhost 各端口的 CORS 默认放行。
 * 生产构建 import.meta.env.DEV=false,此覆盖不存在。
 */
const DEV_PLUGIN_ENTRIES = new Set(
  import.meta.env.DEV
    ? String(import.meta.env.VITE_PLUGIN_DEV_ENTRIES ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [],
);
const DEV_PLUGIN_PORT = import.meta.env.VITE_PLUGIN_DEV_PORT ?? '9395';

export function pluginEntryUrl(meta: PluginAppMetadata): string {
  if (DEV_PLUGIN_ENTRIES.has(meta.id)) {
    return `http://localhost:${DEV_PLUGIN_PORT}/src/index.tsx`;
  }
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
