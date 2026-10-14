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

/** 插件入口模块经 window.AgentUI.registerApp 注册的挂载函数。 */
export interface PluginAppRegistration {
  id: string;
  mount(container: HTMLElement): void | (() => void) | { dispose(): void };
}

/** 宿主→插件事件契约(载荷见 host-global.ts HostEventMap)。 */
export type PluginHostEventMap = {
  localechange: { lng: string };
  /** 主题值同宿主 ThemeEnum('light' | 'dark' | 'system'),插件自行归一化。 */
  themechange: { theme: string };
};

// ---------------------------------------------------------------------------
// 宿主 chat 能力(docs/chat-sse-sdk-design.md,1.2.0 新增)
// ---------------------------------------------------------------------------

/** chat 流式帧:BFF {event,data} 协议原样透传(与宿主 chat 同一条帧协议)。 */
export interface ChatFrame {
  event: string;
  data: unknown;
}

export interface ChatCompletionsRequest {
  /** 必填,经 chat.createSession 创建的 gateway 会话 id。 */
  sessionId: string;
  /** 必填,用户输入文本。 */
  content: string;
  /** 可选,模型 id(gateway 语义,不传用部署默认模型)。 */
  modelId?: string;
  /** 可选,透传(v1 不承诺多模态行为)。 */
  attachments?: unknown;
}

export interface ChatStreamOptions {
  /** 中止信号:abort 后流终止(generator 正常 return,不 throw)。 */
  signal?: AbortSignal;
}

/**
 * 宿主 chat 能力(1.2.0)。设计参照 QwenPaw 前端 SDK(chatStream 返回已解析
 * 事件的 AsyncGenerator);网关凭据全程在 BFF 服务端,插件不接触。
 * 插件用 feature-detect:`if (window.AgentUI.chat) { ... }`。
 */
export interface AgentUIChatApi {
  /**
   * 建 gateway 会话(标题自动加 plugin:<id>: 前缀,宿主主聊天列表默认过滤)。
   * HTTP 失败(401 未登录 / 403 未声明 chat 能力 / 404 插件不存在或已停用 /
   * 503 无后端)→ reject。
   */
  createSession(
    pluginId: string,
    title?: string,
  ): Promise<{ id: string; title?: string }>;
  /**
   * 发送消息并流式消费帧(for-await 消费;提前 break 即中断上游)。
   * - 每帧 {event,data}:message/message_end/workflow_finished/error/
   *   tool_start、tool_complete、tool_progress/approval_request/
   *   clarify_request,与宿主 chat 帧协议一致;
   * - error 帧是协议内数据(yield 后正常结束),HTTP/网络层失败才 throw;
   * - 插件必须忽略未知 event 类型(前向兼容)。
   */
  completions(
    pluginId: string,
    request: ChatCompletionsRequest,
    options?: ChatStreamOptions,
  ): AsyncGenerator<ChatFrame, void, undefined>;
}

export interface AgentUIHostGlobal {
  /** 宿主插件 API 版本(契约快照测试锁定,变更须显式 bump,见 __tests__)。 */
  HOST_API_VERSION: string;
  registerApp(registration: PluginAppRegistration): void;
  /** 订阅宿主事件(语言/主题切换),返回取消函数。 */
  on<K extends keyof PluginHostEventMap>(
    event: K,
    listener: (payload: PluginHostEventMap[K]) => void,
  ): () => void;
  host: {
    /** 宿主登录 token(localStorage 'Authorization',与宿主请求拦截器同源)。 */
    getApiToken(): string | null;
  };
  /** 宿主 chat 能力(1.2.0;企业 gateway 通道,凭据服务端注入)。 */
  chat: AgentUIChatApi;
}
