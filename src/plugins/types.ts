/**
 * 运行时插件契约(对齐 bff/src/routes/plugins.ts 的 app.json)。
 *
 * 参考 QwenPaw PawApp 机制:插件是自包含单文件 ESM 产物,自带 React 与 UI 依赖;
 * 宿主在自己的 React 树里只渲染挂载 div,插件经独立 React root 渲染,
 * 两侧不共享 React 实例,天然规避 hooks 交叉。
 */

/** BFF /plugins 列表返回的插件元数据(安装时落地的 app.json)。 */
export interface PluginAppMetadata {
  id: string;
  name?: string;
  version?: string;
  /** 宿主侧挂载路径前缀,如 /cognitive-wargame,深链保持与编译期一致。 */
  path: string;
  /** 插件未装载时的卡片字面文案(词条随插件 bundle,宿主侧不依赖)。 */
  label: string;
  description?: string;
  /** emoji 字符,宿主渲染为图标组件。 */
  icon?: string;
  order?: number;
  /** 相对插件根目录的入口 JS,如 ui/dist/index.js。 */
  entry: string;
  /** 宿主侧装载前硬校验的版本声明(如 { react: '^18' }),不满足拒绝装载。 */
  peer?: { react?: string };
}

/** 插件入口模块经 window.AgentUI.registerApp 注册的挂载函数。 */
export interface PluginAppRegistration {
  id: string;
  mount(container: HTMLElement): void | (() => void) | { dispose(): void };
}

export interface AgentUIHostGlobal {
  registerApp(registration: PluginAppRegistration): void;
  host: {
    /** 宿主登录 token(localStorage 'Authorization',与宿主请求拦截器同源)。 */
    getApiToken(): string | null;
  };
}
