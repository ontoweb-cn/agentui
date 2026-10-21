import type {
  AppPluginCard,
  LazyRouteConfig,
  ModuleContext,
  ModuleDefinition,
  NavItem,
} from './_types';

const moduleGlob = import.meta.glob<{ default: ModuleDefinition }>(
  './*/manifest.ts',
  { eager: true },
);

const moduleContext: ModuleContext = {
  isEnterprise:
    import.meta.env.VITE_INTELLECT_ENTERPRISE === 'INTELLECT_ENTERPRISE',
  capabilities:
    (typeof window !== 'undefined' &&
      (window as unknown as { __CAPABILITIES__?: Set<string> })
        .__CAPABILITIES__) ||
    new Set<string>(),
};

const allModules: ModuleDefinition[] = Object.values(moduleGlob)
  .map((m) => m.default)
  .filter((m): m is ModuleDefinition => Boolean(m && m.name));

export const enabledModules: ModuleDefinition[] = allModules
  .filter((m) => (m.enabled ? m.enabled(moduleContext) : true))
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

for (const m of enabledModules) {
  m.init?.(moduleContext);
}

export function collectRoutes(): LazyRouteConfig[] {
  return enabledModules.flatMap((m) => m.routes ?? []);
}

/**
 * 注册运行时插件模块(src/plugins/runtime.tsx 在 bootstrap 阶段调用)。
 *
 * 必须在 collectRoutes/collectApps/collectNav 首次求值前完成:
 * main.tsx 会先 await initRuntimePlugins() 再动态 import App(路由树随之构建)。
 * 就地变更 enabledModules(const 数组),保持既有导出引用不变。
 *
 * R2 运行时接管(canvas-stage4 spec §9.2):宿主不能只依赖 manifest 自身的
 * 压制判定——_registry 会被启动链(locales/config 等)静态引入,急求职值早于
 * 运行时插件标记写入,编译期 enabled() 那一刻必然读到空标记。故注册侧按
 * 「路由 path 精确重合」移除编译期同路径模块(路由/导航/卡片一并让位),
 * 与 manifest 的标记检查互为纵深防御;运行时插件卸载后下次启动自然回退。
 */
export function registerRuntimeModules(defs: ModuleDefinition[]) {
  const runtimePaths = new Set(
    defs.flatMap((d) => (d.routes ?? []).map((r) => r.path)),
  );
  for (let i = enabledModules.length - 1; i >= 0; i--) {
    const existing = enabledModules[i];
    if (existing.name.startsWith('plugin:')) {
      continue;
    }
    const overlaps = (existing.routes ?? []).some((r) =>
      runtimePaths.has(r.path),
    );
    if (overlaps) {
      enabledModules.splice(i, 1);
    }
  }
  for (const def of defs) {
    enabledModules.push(def);
    def.init?.(moduleContext);
  }
  enabledModules.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function collectNav(): NavItem[] {
  return enabledModules
    .flatMap((m) => m.nav ?? [])
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function collectApps(): AppPluginCard[] {
  return enabledModules
    .flatMap((m) => (m.app ? [m.app] : []))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function collectI18nLazy(): Record<string, () => Promise<{ default: any }>> {
  const map: Record<string, () => Promise<{ default: any }>> = {};
  for (const m of enabledModules) {
    if (!m.i18n) continue;
    for (const ns of m.i18n.namespaces) {
      for (const [lang, loader] of Object.entries(m.i18n.lazy)) {
        const key = `${ns}:${lang}`;
        map[key] = loader;
      }
    }
  }
  return map;
}

export function getModuleContext(): ModuleContext {
  return moduleContext;
}
