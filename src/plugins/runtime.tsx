/**
 * 运行时插件引导:拉取 BFF 插件元数据,并入 feature registry。
 *
 * 时序(参考 docs/cognitive-wargame-plugin-migration-design.md §4.1):
 * main.tsx 在动态 import App 之前 await initRuntimePlugins(),
 * 确保 collectRoutes()/collectApps() 求值时运行时路由/卡片已注册;
 * 插件 JS 仍按需装载——路由 Component 是懒加载包装,首次导航才动态 import。
 *
 * 健壮性(评审 H3/M1/M2 修复):
 * - 全链路 try/catch,initRuntimePlugins 永不 reject(坏数据不白屏宿主);
 * - 逐插件隔离:单条畸形元数据只跳过自己;
 * - mount path 与宿主保留路由冲突的元数据拒绝注册(纵深防御,BFF 侧同规则);
 * - peer.react 版本硬校验:宿主 React 主版本不满足时拒绝装载并记录;
 * - 装载失败在挂载页显示错误占位与重试,不再只有 console。
 *
 * 降级:BFF 不可达/超时(1.5s)时读 localStorage 上次成功的列表,
 * 再失败则以空列表照常启动(宿主不因插件故障阻塞)。
 */

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { version as reactVersion } from 'react';
import i18next from 'i18next';

import type {
  AppPluginCard,
  LazyRouteConfig,
  ModuleDefinition,
} from '@/features/_types';
import { registerRuntimeModules } from '@/features/_registry';

import { installAgentUIHostGlobal } from './host-global';
import { loadPluginApp } from './loader';
import type { PluginAppMetadata } from './types';

const PLUGINS_LIST_CACHE_KEY = 'agentui.runtimePlugins';
const FETCH_TIMEOUT_MS = 1500;

/** 与 bff/src/routes/plugins.ts 的 RESERVED_MOUNT_PATHS 保持一致。 */
const RESERVED_MOUNT_PATHS = new Set([
  '/',
  '/login',
  '/login-next',
  '/admin',
  '/wizard',
  '/applications',
  '/tasks',
  '/knowledge',
  '/memories',
  '/user-setting',
  '/document',
]);

function isValidMountPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    /^\/[a-z0-9][a-z0-9-]*$/i.test(path) &&
    !RESERVED_MOUNT_PATHS.has(path.toLowerCase())
  );
}

/**
 * peer.react 硬校验(评审 M2/设计 §5.4):
 * 支持 '^18'、'^18.2'、'^18.2.0'、'>=18'、'>=18.2'、裸 '18.2'(按 >=)形态,
 * 其余形态视为未声明(放行,由 BFF 安装侧承担强校验职责)。
 */
function satisfiesPeerReact(range: string | undefined): boolean {
  if (!range) {
    return true;
  }
  const match = range.match(/^(\^|>=?)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match || !match[2]) {
    return true;
  }
  const operator = match[1];
  const major = Number(match[2]);
  const minor = Number(match[3] ?? 0);
  const [hostMajor, hostMinor = 0] = reactVersion
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  if (operator === '^') {
    return hostMajor === major && hostMinor >= minor;
  }
  // '>=' 与裸版本:不低于声明最低版本
  return hostMajor > major || (hostMajor === major && hostMinor >= minor);
}

/** 元数据注册前统一校验;返回拒绝原因,null 表示可注册。 */
export function rejectReason(meta: PluginAppMetadata): string | null {
  if (!meta?.id || typeof meta.id !== 'string') {
    return '缺少 id';
  }
  if (!isValidMountPath(meta.path)) {
    return `path 非法或与宿主保留路由冲突: ${String(meta?.path)}`;
  }
  if (!meta?.entry || typeof meta.entry !== 'string') {
    return '缺少 entry';
  }
  if (meta.entry.split('/').includes('..') || meta.entry.startsWith('/')) {
    return `entry 非法: ${meta.entry}`;
  }
  if (!satisfiesPeerReact(meta.peer?.react)) {
    return `peer.react 不满足: 声明 ${meta.peer?.react},宿主 React ${reactVersion}`;
  }
  return null;
}

/** emoji 字符串 → 宿主侧图标组件(应用卡片 AppPluginCard.icon 兼容)。 */
function createPluginIcon(
  icon: string | undefined,
): ComponentType<{ className?: string }> | undefined {
  if (!icon) {
    return undefined;
  }
  function PluginIcon({ className }: { className?: string }) {
    return (
      <span
        className={`flex items-center justify-center text-lg leading-none ${className ?? ''}`}
        aria-hidden
      >
        {icon}
      </span>
    );
  }
  PluginIcon.displayName = 'PluginIcon';
  return PluginIcon;
}

/** 宿主侧挂载页:渲染挂载 div,首载时装载插件 JS 并挂载独立 React root。 */
function createPluginMountPage(meta: PluginAppMetadata) {
  function PluginMountPage() {
    const ref = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState(0);

    useEffect(() => {
      let disposed = false;
      let dispose: (() => void) | undefined;
      setError(null);
      loadPluginApp(meta)
        .then((registration) => {
          if (disposed || !ref.current) {
            return;
          }
          const result = registration.mount(ref.current);
          dispose =
            typeof result === 'function'
              ? result
              : result?.dispose?.bind(result);
        })
        .catch((err: unknown) => {
          if (disposed) {
            return;
          }
          console.error(`[plugin:${meta.id}] 装载失败:`, err);
          setError(
            err instanceof Error ? err.message : String(err ?? '未知错误'),
          );
        });
      return () => {
        disposed = true;
        dispose?.();
      };
    }, [retryCount]);

    if (error) {
      return (
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 rounded-lg border border-border-button bg-bg-card p-10 text-center">
          <p className="text-base font-medium">
            应用「{meta.label ?? meta.id}」装载失败
          </p>
          <p className="break-all text-sm text-text-secondary">{error}</p>
          <button
            type="button"
            className="rounded-md border border-border-button px-3 py-1.5 text-sm transition-colors hover:bg-bg-secondary"
            onClick={() => setRetryCount((n) => n + 1)}
          >
            重试
          </button>
        </div>
      );
    }

    return (
      <div ref={ref} data-plugin-app={meta.id} className="w-full min-h-full" />
    );
  }
  PluginMountPage.displayName = `PluginMountPage(${meta.id})`;
  return PluginMountPage;
}

/** 导出供单测构造运行时模块(见 __tests__/runtime.test.ts)。 */
export function toModuleDefinition(meta: PluginAppMetadata): ModuleDefinition {
  const MountPage = createPluginMountPage(meta);
  const loadPage = async () => ({ default: MountPage as ComponentType });
  const routes: LazyRouteConfig[] = [
    // '/x/*' 同时匹配 '/x'(splat 可为空)与全部子路径,深链直达
    { path: `${meta.path}/*`, Component: loadPage },
  ];
  const app: AppPluginCard = {
    id: meta.id,
    path: meta.path,
    labelKey: meta.labelKey,
    label: meta.label,
    descriptionKey: meta.descriptionKey,
    description: meta.description,
    icon: createPluginIcon(meta.icon),
    order: meta.order ?? 60,
  };
  return {
    name: `plugin:${meta.id}`,
    order: meta.order ?? 60,
    routes,
    app,
  };
}

/**
 * 插件词条语言码 → 宿主 i18next 语言码映射。
 * 插件产物按 ISO 简码组织(zh/en),宿主使用 BCP-47(zh-Hans/zh-Hant/en)。
 */
const PLUGIN_LANG_TO_HOST: Record<string, string[]> = {
  zh: ['zh-Hans', 'zh-Hant'],
  en: ['en'],
};

/**
 * 把 BFF 内联下发的插件词条注入宿主 i18n 实例(#7):
 * 词条结构为 { cognitiveWargame: {...} },deep-merge 进 translation 命名空间,
 * 与编译期 feature 词条同构(t('cognitiveWargame.common.title'))。
 * 在 initLanguage() 完成后调用(main.tsx 时序保证),切换语言时 i18next
 * 自动使用已注册资源。注入失败只影响卡片本地化(回退 label 字面值)。
 */
function injectPluginI18n(meta: PluginAppMetadata) {
  if (!meta.i18nResources) {
    return;
  }
  try {
    for (const [lang, bundle] of Object.entries(meta.i18nResources)) {
      if (!bundle || typeof bundle !== 'object') {
        continue;
      }
      for (const hostLang of PLUGIN_LANG_TO_HOST[lang] ?? [lang]) {
        i18next.addResourceBundle(hostLang, 'translation', bundle, true, true);
      }
    }
  } catch (err) {
    console.warn(`[plugins] ${meta.id} 词条注入失败,卡片回退字面文案:`, err);
  }
}

async function fetchPluginList(): Promise<PluginAppMetadata[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch('/api/bff/plugins', {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const list = (await response.json()) as PluginAppMetadata[];
    return Array.isArray(list) ? list : [];
  } finally {
    clearTimeout(timer);
  }
}

function readCachedPluginList(): PluginAppMetadata[] {
  try {
    const raw = localStorage.getItem(PLUGINS_LIST_CACHE_KEY);
    if (!raw) {
      return [];
    }
    const list = JSON.parse(raw) as PluginAppMetadata[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

let initialized = false;

export async function initRuntimePlugins(): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;
  installAgentUIHostGlobal();

  let metas: PluginAppMetadata[] = [];
  try {
    metas = await fetchPluginList();
    localStorage.setItem(PLUGINS_LIST_CACHE_KEY, JSON.stringify(metas));
  } catch {
    metas = readCachedPluginList();
    if (metas.length > 0) {
      console.warn('[plugins] BFF 插件列表不可达,使用本地缓存');
    }
  }

  // 逐插件隔离 + 注册前校验:任何单条坏数据只跳过自己,不影响宿主与其余插件
  const defs: ModuleDefinition[] = [];
  for (const meta of metas) {
    try {
      const reason = rejectReason(meta);
      if (reason) {
        console.warn(`[plugins] 拒绝注册插件 ${meta?.id}: ${reason}`);
        continue;
      }
      injectPluginI18n(meta);
      defs.push(toModuleDefinition(meta));
    } catch (err) {
      console.error(`[plugins] 插件 ${meta?.id} 元数据异常,跳过:`, err);
    }
  }
  try {
    registerRuntimeModules(defs);
  } catch (err) {
    // registry 变更异常也不允许阻塞宿主启动
    console.error('[plugins] 运行时模块注册失败:', err);
  }
}
