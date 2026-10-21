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
 * - 兼容性声明(peer.react/apiVersion)不满足 → 卡片保留 +「不兼容」徽标 +
 *   挂载页明确原因,不装载插件 JS(第三方生态要求"不兼容永不静默";
 *   结构错误仍走 rejectReason 拒绝注册,见 compatibilityReason);
 * - 装载失败在挂载页显示错误占位与重试,不再只有 console。
 *
 * 降级:BFF 不可达/超时(1.5s)时读 localStorage 上次成功的列表,
 * 再失败则以空列表照常启动(宿主不因插件故障阻塞)。
 */

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { version as reactVersion } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type {
  AppPluginCard,
  LazyRouteConfig,
  ModuleDefinition,
} from '@/features/_types';
import { registerRuntimeModules } from '@/features/_registry';

import { satisfiesApiVersion } from '@agentui/plugin-sdk';
import { SHARED_API_VERSION } from '@agentui/plugin-sdk/host';
import { installAgentUIHostGlobal, HOST_API_VERSION } from './host-global';
import { installAgentUISharedHost } from './host-externals';
import { loadHostPluginBundle, loadPluginApp } from './loader';
import type { PluginAppMetadata } from './types';

const PLUGINS_LIST_CACHE_KEY = 'agentui.runtimePlugins';
/**
 * R2 压制标记(canvas-stage4 spec §9.2):结构性合法的运行时插件 id 集合,
 * 先于 App 求值写入(main.tsx await 时序保证)。编译期同路径模块
 * (features/canvas/manifest.ts)检测到自身 id 即放弃注册,消除双入口;
 * 运行时插件卸载后下次启动自动回归编译期版本(共存兜底)。
 */
export const RUNTIME_PLUGIN_IDS_KEY = '__AGENTUI_RUNTIME_PLUGIN_IDS__';
const FETCH_TIMEOUT_MS = 1500;
// 后台刷新监测(#10):API 侧启停/卸载发生后面板无感知,定时 + 聚焦时
// refetch 列表比对,变化则提示刷新(只提示不热替换路由树,维持"元数据先行")
const REFRESH_INTERVAL_MS = 60_000;
const FOCUS_THROTTLE_MS = 30_000;
const UPDATED_TOAST_DURATION_MS = 8_000;

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

/** 元数据结构校验;返回拒绝原因,null 表示结构可注册。 */
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
  if (meta.type === 'host') {
    if (!Array.isArray(meta.routes) || meta.routes.length === 0) {
      return 'host 插件缺少 routes 声明(声明式路由表)';
    }
    for (const route of meta.routes) {
      if (
        typeof route !== 'string' ||
        route.includes('..') ||
        !(route === meta.path || route.startsWith(`${meta.path}/`))
      ) {
        return `host 插件 route 非法或越出挂载前缀: ${String(route)}`;
      }
    }
  }
  return null;
}

/**
 * 兼容性校验(第三方生态,需求"老 SDK 插件兼容/明确不兼容提示"):
 * 结构合法但不满足版本声明时,插件**仍注册卡片与路由**(可见、可深链),
 * 装载页显示具体不兼容原因且不加载插件 JS——不兼容必须显性化,不静默。
 * 两类声明:
 * - peer.react:宿主 React 主版本硬要求(评审 M2);
 * - apiVersion:插件开发依据的宿主 API 版本区间,语义见 @agentui/plugin-sdk
 *   satisfiesApiVersion(缺省 = 任意版本;格式非法已在 BFF 安装侧拒绝)。
 * 返回原因文案,null 表示兼容。
 */
export function compatibilityReason(meta: PluginAppMetadata): string | null {
  if (!satisfiesPeerReact(meta.peer?.react)) {
    return `peer.react 不满足: 声明 ${meta.peer?.react},宿主 React ${reactVersion}`;
  }
  if (typeof meta.apiVersion === 'string' && !satisfiesApiVersion(meta.apiVersion, HOST_API_VERSION)) {
    return `apiVersion 不满足: 声明 ${meta.apiVersion},宿主 API ${HOST_API_VERSION}`;
  }
  if (
    typeof meta.sharedVersion === 'string' &&
    !satisfiesApiVersion(meta.sharedVersion, SHARED_API_VERSION)
  ) {
    return `sharedVersion 不满足: 声明 ${meta.sharedVersion},宿主共享面 ${SHARED_API_VERSION}`;
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

/** 宿主侧挂载页:渲染挂载 div,首载时装载插件 JS 并挂载独立 React root。
 * 不兼容插件(incompatibleReason 非空)不装载 JS,显示明确原因页。 */
function createPluginMountPage(
  meta: PluginAppMetadata,
  incompatibleReason?: string,
) {
  function PluginMountPage() {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState(0);

    useEffect(() => {
      if (incompatibleReason) {
        // 版本不兼容:重试无意义,不发起装载(宿主升级/插件升级前稳定提示)
        return;
      }
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

    if (incompatibleReason) {
      return (
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 rounded-lg border border-border-button bg-bg-card p-10 text-center">
          <p className="text-base font-medium">
            {t('plugins.incompatibleTitle', {
              name: meta.label ?? meta.id,
            })}
          </p>
          <p className="break-all text-sm text-text-secondary">
            {incompatibleReason}
          </p>
          <p className="text-xs text-text-secondary">
            {t('plugins.incompatibleHint')}
          </p>
        </div>
      );
    }

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

/** 导出供单测构造运行时模块(见 __tests__/runtime.test.ts)。
 * incompatibleReason 非空时卡片带不兼容标注(应用页可见),装载页显示原因。 */
export function toModuleDefinition(
  meta: PluginAppMetadata,
  incompatibleReason?: string,
): ModuleDefinition {
  const MountPage = createPluginMountPage(meta, incompatibleReason);
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
    incompatibleReason,
  };
  return {
    name: `plugin:${meta.id}`,
    order: meta.order ?? 60,
    routes,
    app,
  };
}

/**
 * Tier B host 插件注册(canvas-stage4 spec §9.2,懒两段式):
 * 启动期只按 app.json routes 造懒包装路由(元数据即可,零 bundle 拉取);
 * 首访命中才 loadHostPluginBundle 取定义,按声明 path 精确匹配渲染。
 * 渲染发生在宿主 Provider 树内(与编译期模块同位),context 全通。
 * 不兼容 Tier B 走 Tier A 原因页形态(单条 path/* 包装,不拉 bundle)。
 */
export function toHostModuleDefinition(
  meta: PluginAppMetadata,
  incompatibleReason?: string,
): ModuleDefinition {
  if (incompatibleReason) {
    return toModuleDefinition(meta, incompatibleReason);
  }
  const declared = meta.routes ?? [];
  const loadRoute = (routePath: string) => async () => {
    const bundle = await loadHostPluginBundle(meta);
    const inner = bundle.routes.find((route) => route.path === routePath);
    if (!inner?.Component) {
      throw new Error(
        `host 插件 ${meta.id} 未声明路由 ${routePath}(产物与 app.json routes 不一致)`,
      );
    }
    return inner.Component();
  };
  const routes: LazyRouteConfig[] = declared.map((path) => ({
    path,
    Component: loadRoute(path),
  }));
  return {
    name: `plugin:${meta.id}`,
    order: meta.order ?? 60,
    routes,
    // 词条不走 registry(app.json i18n.files 由 BFF 内联 + injectPluginI18n 注入,
    // 与 Tier A 同路径;bundle 内 i18n 字段不消费,保持注册期零拉取)
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
 * 插件词条顶层 key 冲突防护(评审 L2):
 * 插件词条理论上可声明与宿主/其他插件相同的顶层 key(如 header.applications)
 * 静默覆盖宿主文案。注入前剔除已存在的顶层 key 并告警——插件词条应使用
 * 自身命名空间前缀(如 cognitiveWargame.*)。
 */
function pruneConflictingKeys(
  pluginId: string,
  hostLang: string,
  bundle: Record<string, unknown>,
): Record<string, unknown> {
  const existing = i18next.getResourceBundle(hostLang, 'translation') as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    return bundle;
  }
  const pruned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bundle)) {
    if (key in existing) {
      console.warn(
        `[plugins] ${pluginId} 词条顶层 key "${key}" 与宿主已有词条冲突,已跳过(请使用插件命名空间前缀)`,
      );
      continue;
    }
    pruned[key] = value;
  }
  return pruned;
}

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
        const pruned = pruneConflictingKeys(meta.id, hostLang, bundle);
        if (Object.keys(pruned).length > 0) {
          i18next.addResourceBundle(hostLang, 'translation', pruned, true, true);
        }
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

/**
 * 列表指纹:只取影响卡片/路由/文案锚点/兼容判定的稳定字段,排序后拼接。
 * apiVersion 入指纹:重装仅改兼容声明(版本号不变)也提示刷新,避免过期
 * 兼容态展示。词条内联产物(i18nResources)不参与——内容微调不值得打扰用户。
 */
function pluginListFingerprint(metas: PluginAppMetadata[]): string {
  return metas
    .map((m) =>
      [
        m.id,
        m.version ?? '',
        m.entry,
        m.path,
        m.labelKey ?? '',
        m.descriptionKey ?? '',
        m.apiVersion ?? '',
        m.type ?? '',
        m.sharedVersion ?? '',
        (m.routes ?? []).join(','),
      ].join('|'),
    )
    .sort()
    .join('\n');
}

const watchState: {
  timer: ReturnType<typeof setInterval> | null;
  lastCheckAt: number;
  /** 启动时实际注册的列表指纹:翻回此状态 = 页面已一致,不提示(评审 P3)。 */
  registeredFingerprint: string | null;
  notifiedFingerprint: string | null;
} = {
  timer: null,
  lastCheckAt: 0,
  registeredFingerprint: null,
  notifiedFingerprint: null,
};

/**
 * 后台刷新监测(中期任务 #10,详见 docs/plugin-midterm-review.md):
 * 每 60s 或窗口聚焦(节流 30s)时 refetch 列表,指纹不同于启动注册基线
 * 且未提示过 → toast「刷新生效」。翻回注册基线不提示(页面本就一致),
 * 列表振荡不重复打扰。失败静默;返回清理函数供测试。
 */
export function startPluginListWatch(): () => void {
  if (typeof window === 'undefined' || watchState.timer) {
    return () => undefined;
  }
  const check = async () => {
    const now = Date.now();
    if (now - watchState.lastCheckAt < FOCUS_THROTTLE_MS) {
      return;
    }
    watchState.lastCheckAt = now;
    try {
      const metas = await fetchPluginList();
      localStorage.setItem(PLUGINS_LIST_CACHE_KEY, JSON.stringify(metas));
      const fingerprint = pluginListFingerprint(metas);
      // 独立启动(未经 initRuntimePlugins)时无注册基线:首个成功检查设基线
      if (watchState.registeredFingerprint === null) {
        watchState.registeredFingerprint = fingerprint;
      } else if (
        fingerprint !== watchState.registeredFingerprint &&
        fingerprint !== watchState.notifiedFingerprint
      ) {
        watchState.notifiedFingerprint = fingerprint;
        toast.info(i18next.t('plugins.updatedToast'), {
          duration: UPDATED_TOAST_DURATION_MS,
        });
      }
    } catch {
      // 后台刷新失败静默,下次触发再试
    }
  };
  const onWindowFocus = () => {
    void check();
  };
  window.addEventListener('focus', onWindowFocus);
  watchState.timer = setInterval(() => {
    void check();
  }, REFRESH_INTERVAL_MS);
  return () => {
    if (watchState.timer) {
      clearInterval(watchState.timer);
      watchState.timer = null;
    }
    window.removeEventListener('focus', onWindowFocus);
  };
}

/** 测试专用:重置监测状态(fake timers 下 Date.now 跨用例会污染节流时间戳)。 */
export function resetPluginListWatchForTests(): void {
  if (watchState.timer) {
    clearInterval(watchState.timer);
    watchState.timer = null;
  }
  watchState.lastCheckAt = 0;
  watchState.registeredFingerprint = null;
  watchState.notifiedFingerprint = null;
}

/** 测试专用:允许 initRuntimePlugins 在同进程内重跑(初始化幂等闸复位)。 */
export function resetInitForTests(): void {
  initialized = false;
}

let initialized = false;

export async function initRuntimePlugins(): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;
  installAgentUIHostGlobal();
  // Tier B 共享面(canvas 档):与窄面同点安装,幂等
  installAgentUISharedHost();

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

  // 逐插件隔离 + 注册前校验:结构错误只跳过自己;兼容性失败保留卡片并
  // 显性标注(第三方生态要求"不能兼容要有明确提示",不静默消失)
  const defs: ModuleDefinition[] = [];
  const registeredIds = new Set<string>();
  for (const meta of metas) {
    try {
      const reason = rejectReason(meta);
      if (reason) {
        console.warn(`[plugins] 拒绝注册插件 ${meta?.id}: ${reason}`);
        continue;
      }
      registeredIds.add(meta.id);
      const compat = compatibilityReason(meta);
      if (compat) {
        console.warn(`[plugins] 插件 ${meta?.id} 与宿主不兼容(卡片保留): ${compat}`);
        injectPluginI18n(meta);
        defs.push(
          meta.type === 'host'
            ? toHostModuleDefinition(meta, compat)
            : toModuleDefinition(meta, compat),
        );
        continue;
      }
      injectPluginI18n(meta);
      defs.push(
        meta.type === 'host'
          ? toHostModuleDefinition(meta)
          : toModuleDefinition(meta),
      );
    } catch (err) {
      console.error(`[plugins] 插件 ${meta?.id} 元数据异常,跳过:`, err);
    }
  }
  // R2 压制标记:结构性合法插件(含不兼容保留卡片者)由运行时接管路径,
  // 编译期同路径模块(features/canvas)据此放弃注册。先于 App 求值
  // (main.tsx await 时序保证),注册流程失败也不影响标记。
  (globalThis as Record<string, unknown>)[RUNTIME_PLUGIN_IDS_KEY] =
    registeredIds;
  try {
    registerRuntimeModules(defs);
  } catch (err) {
    // registry 变更异常也不允许阻塞宿主启动
    console.error('[plugins] 运行时模块注册失败:', err);
  }

  // 后台刷新监测(#10):基线取本次启动实际注册的列表(可能来自缓存)
  watchState.registeredFingerprint = pluginListFingerprint(metas);
  startPluginListWatch();
}
