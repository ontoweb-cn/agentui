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
 */
export function registerRuntimeModules(defs: ModuleDefinition[]) {
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
