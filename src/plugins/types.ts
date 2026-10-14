/**
 * 运行时插件契约(对齐 bff/src/routes/plugins.ts 的 app.json)。
 *
 * 参考 QwenPaw PawApp 机制:插件是自包含单文件 ESM 产物,自带 React 与 UI 依赖;
 * 宿主在自己的 React 树里只渲染挂载 div,插件经独立 React root 渲染,
 * 两侧不共享 React 实例,天然规避 hooks 交叉。
 *
 * 契约类型(AgentUIHostGlobal 等)自 2026-10-14 起单源化到
 * `@agentui/plugin-sdk`(packages/plugin-sdk,第三方插件直接 import),
 * 本文件仅保留宿主内部类型并 re-export 契约——禁止在此处新增插件可见契约,
 * 否则 SDK 包与宿主面将漂移(契约纪律见 __tests__ 快照)。
 */

export type {
  AgentUIChatApi,
  AgentUIHostGlobal,
  ChatApprovalChoice,
  ChatCompletionsRequest,
  ChatFrame,
  ChatStreamOptions,
  PluginAppRegistration,
  PluginHostEventMap,
} from '@agentui/plugin-sdk';

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
  /**
   * 插件开发所依据的宿主 API 版本区间(如 '^1.3.0'),语义与 @agentui/plugin-sdk
   * satisfiesApiVersion 一致(第三方生态兼容策略,见 plugin-development-guide.md)。
   * 缺省视为任意版本;格式非法在 BFF 安装侧拒绝,区间不满足时宿主标记不兼容
   * (卡片可见 + 明确原因,不装载 JS)。
   */
  apiVersion?: string;
  /** 宿主 i18n 词条 key(词条经 i18nResources 注入后优先于 label 字面值)。 */
  labelKey?: string;
  descriptionKey?: string;
  /** BFF 内联下发的词条产物(lang → bundle),i18n init 后同步注入宿主实例。 */
  i18nResources?: Record<string, Record<string, unknown>>;
  /**
   * 能力声明(BFF chat 路由逐请求校验;元数据仅作展示/feature-detect 参考,
   * 真实裁决在 BFF——403)。
   */
  capabilities?: string[];
}
