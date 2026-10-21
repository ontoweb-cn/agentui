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

import type { ComponentType } from 'react';

import { getPluginRegistration } from './host-global';
import type { PluginAppMetadata, PluginAppRegistration } from './types';

const loadCache = new Map<string, Promise<PluginAppRegistration>>();

/**
 * dev 热更(#6):VITE_PLUGIN_DEV_ENTRIES 列出的插件直接从其 vite dev
 * server 拉取入口——改源码刷新页面即生效,免 build+reinstall。
 * 条目格式 `id` 或 `id@port`(端口缺省 9395,须为纯数字,评审 L1),
 * 多插件各自指定:`a,b@9396`。
 *
 * 信任边界(评审 L2):dev 直连**不经过 BFF 文件路由**,其校验面
 * (entry 白名单/MIME/ETag)与缓存全部旁路——仅限本机 dev server,
 * 且生产构建 import.meta.env.DEV 编译期为 false,此覆盖不存在。
 * 不走宿主代理的原因:dev server 产物的内部 import 是指向自身的
 * 绝对路径,经代理会被宿主 9391 错误接管;直连时模块链自洽,
 * vite dev 对 localhost 各端口的 CORS 默认放行。
 */
const DEV_PLUGIN_PORTS = new Map<string, string>();
if (import.meta.env.DEV) {
  for (const entry of String(
    import.meta.env.VITE_PLUGIN_DEV_ENTRIES ?? '',
  ).split(',')) {
    const [id, port] = entry.trim().split('@');
    if (!id) {
      continue;
    }
    DEV_PLUGIN_PORTS.set(id, /^\d+$/.test(port ?? '') ? port : '9395');
  }
}

export function pluginEntryUrl(meta: PluginAppMetadata): string {
  const devPort = DEV_PLUGIN_PORTS.get(meta.id);
  if (devPort) {
    return `http://localhost:${devPort}/src/index.tsx`;
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

/**
 * Tier B host 插件 bundle 装载(canvas-stage4 spec §9.2,懒两段式):
 * 启动期只注册元数据包装路由,首访命中才拉取 bundle。
 * 与 Tier A 的差异:产物多 chunk、default 导出为 host 插件定义
 * (SDK defineHostPlugin 形状),渲染发生在宿主 Provider 树内——
 * 本装载器只负责取回定义、形状校验与 CSS 注入,不建独立 root。
 */

/** host 插件定义的运行时形状(与 SDK HostPluginDefinition 结构一致,本地窄化)。 */
export interface HostPluginBundleDefinition {
  name: string;
  routes: Array<{
    path: string;
    Component?: () => Promise<{ default: ComponentType<Record<string, unknown>> }>;
    [key: string]: unknown;
  }>;
  i18n?: {
    namespaces: string[];
    lazy: Record<string, () => Promise<{ default: unknown }>>;
  };
  [key: string]: unknown;
}

const hostBundleCache = new Map<string, Promise<HostPluginBundleDefinition>>();

/** 幂等注入 Tier B CSS 产物(app.json style 声明;entry 同目录约定)。 */
function injectPluginStyle(meta: PluginAppMetadata): void {
  if (!meta.style) {
    return;
  }
  const styleId = `plugin-style-${meta.id}`;
  if (document.getElementById(styleId)) {
    return;
  }
  const link = document.createElement('link');
  link.id = styleId;
  link.rel = 'stylesheet';
  link.href = `/api/bff/plugins/${meta.id}/files/${meta.style}`;
  document.head.appendChild(link);
}

export function loadHostPluginBundle(
  meta: PluginAppMetadata,
): Promise<HostPluginBundleDefinition> {
  const cached = hostBundleCache.get(meta.id);
  if (cached) {
    return cached;
  }
  const pending = import(/* @vite-ignore */ pluginEntryUrl(meta))
    .then((mod) => {
      const def = mod?.default as HostPluginBundleDefinition | undefined;
      if (
        !def ||
        typeof def !== 'object' ||
        !Array.isArray(def.routes) ||
        def.routes.length === 0
      ) {
        throw new Error(
          `host 插件 ${meta.id} 入口缺少合法 default 导出(routes 非空数组)`,
        );
      }
      for (const route of def.routes) {
        if (typeof route?.path !== 'string' || typeof route.Component !== 'function') {
          throw new Error(
            `host 插件 ${meta.id} 路由定义非法:path/Component 缺失`,
          );
        }
      }
      injectPluginStyle(meta);
      return def;
    })
    .catch((error: unknown) => {
      hostBundleCache.delete(meta.id);
      throw error;
    });
  hostBundleCache.set(meta.id, pending);
  return pending;
}
