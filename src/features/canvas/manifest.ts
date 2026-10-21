// 画布插件薄封装:指向独立包 @agentui/canvas-plugin
// _registry.ts 的 import.meta.glob('./*/manifest.ts') 自动发现并加载
import canvasModule from '@agentui/canvas-plugin';
import type { ModuleContext, ModuleDefinition } from '@/features/_types';

// R2 压制(canvas-stage4 spec §9.2):运行时已安装 canvas 插件(host 档)时,
// 编译期注册必须退位——initRuntimePlugins 先于 App 求值把合法插件 id 写入
// window.__AGENTUI_RUNTIME_PLUGIN_IDS__,检测到即不注册,消除双入口。
// 运行时插件卸载/停用后,下次启动此处自动恢复编译期版本(共存兜底)。
const runtimePluginIds = () =>
  (globalThis as Record<string, unknown>).__AGENTUI_RUNTIME_PLUGIN_IDS__ as
    | Set<string>
    | undefined;

const defaultEnabled = canvasModule.enabled?.bind(canvasModule);

const manifest: ModuleDefinition = {
  ...canvasModule,
  enabled: (ctx: ModuleContext) => {
    if (runtimePluginIds()?.has('canvas')) {
      return false;
    }
    return defaultEnabled ? defaultEnabled(ctx) : true;
  },
};

export default manifest;
