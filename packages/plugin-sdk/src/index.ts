/**
 * @agentui/plugin-sdk — AgentUI 运行时插件 SDK(第三方插件开发唯一声明依赖)。
 *
 * 两个职责:
 * 1. **契约类型单源化**:AgentUIHostGlobal 等类型是宿主 src/plugins/types.ts
 *    的单一事实源——宿主经 workspace 反向 re-export,插件仓直接 import 本包,
 *    不再手抄接口(手抄漂移是第三方生态的第一兼容性杀手);
 * 2. **最小运行时 helper**:definePlugin(带类型的注册入口)与
 *    satisfiesApiVersion(宿主 API 版本区间判定,宿主装载校验同语义)。
 *
 * 版本纪律:package.json version 与宿主 HOST_API_VERSION 同步演进
 * (契约加法演进 bump minor,破坏性变更 bump major——同 major 内保证
 * 旧插件可装载,见 docs/plugin-development-guide.md 兼容性策略)。
 *
 * 本包零依赖、零副作用:类型 + 纯函数,浏览器/Node 皆可加载;
 * 全局读取走 globalThis 而非 window,便于 Node 侧单测。
 */

// ---------------------------------------------------------------------------
// 契约类型(单一事实源;宿主 src/plugins/types.ts re-export 本节)
// ---------------------------------------------------------------------------

/** 插件入口模块经 window.AgentUI.registerApp 注册的挂载函数。 */
export interface PluginAppRegistration {
  id: string;
  mount(container: HTMLElement): void | (() => void) | { dispose(): void };
}

/** 宿主→插件事件契约(载荷语义见宿主 host-global.ts HostEventMap)。 */
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

/** 审批选项(与 BFF VALID_APPROVAL_CHOICES / 宿主审批路由同契约)。 */
export type ChatApprovalChoice = 'once' | 'session' | 'always' | 'deny';

/**
 * 宿主 chat 能力(1.2.0)。插件用 feature-detect:`if (window.AgentUI.chat) { ... }`。
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
   * 每帧 {event,data} 与宿主 chat 帧协议一致;error 帧是协议内数据
   * (yield 后正常结束),HTTP/网络层失败才 throw;插件必须忽略未知 event。
   */
  completions(
    pluginId: string,
    request: ChatCompletionsRequest,
    options?: ChatStreamOptions,
  ): AsyncGenerator<ChatFrame, void, undefined>;
  /**
   * 工具审批响应(1.3.0,消费 completions 流中的 approval_request 帧;
   * runId 须经该流产出——BFF 按 runId→backend 归属校验,跨流 403)。
   */
  submitApproval(
    pluginId: string,
    runId: string,
    choice: ChatApprovalChoice,
  ): Promise<{ resolved: number }>;
  /** 澄清答案提交(1.3.0,消费 clarify_request 帧中的 clarifyId)。 */
  submitClarify(
    pluginId: string,
    sessionId: string,
    answer: string,
    clarifyId: string,
  ): Promise<unknown>;
  /** 会话历史读取(1.3.0;形状与宿主 /agents messages 一致)。 */
  history(pluginId: string, sessionId: string): Promise<{ messages: unknown[] }>;
}

/** 宿主注入的全局对象形态(window.AgentUI)。 */
export interface AgentUIHostGlobal {
  /** 宿主插件 API 版本(契约快照测试锁定,变更须显式 bump)。 */
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

// ---------------------------------------------------------------------------
// 运行时 helper
// ---------------------------------------------------------------------------

/** 本 SDK 包版本(与宿主 HOST_API_VERSION 同步演进,见文件头版本纪律)。 */
export const SDK_VERSION = '1.3.0';

/** 读取宿主注入的 API 版本;宿主全局不存在(非宿主环境/单测)时返回 null。 */
export function getHostApiVersion(): string | null {
  const host = (globalThis as { AgentUI?: { HOST_API_VERSION?: unknown } })
    .AgentUI;
  return typeof host?.HOST_API_VERSION === 'string'
    ? host.HOST_API_VERSION
    : null;
}

/** 带类型的注册入口:等价 window.AgentUI.registerApp,宿主全局缺失时抛错。 */
export function definePlugin(registration: PluginAppRegistration): PluginAppRegistration {
  const host = (globalThis as { AgentUI?: AgentUIHostGlobal }).AgentUI;
  if (!host || typeof host.registerApp !== 'function') {
    throw new Error(
      '[plugin-sdk] window.AgentUI 不存在:插件产物须经 AgentUI 宿主装载后运行',
    );
  }
  host.registerApp(registration);
  return registration;
}

interface ParsedRange {
  op: '^' | '~' | '>=' | '>' | '=';
  major: number;
  minor: number;
  patch: number;
}

/**
 * 解析版本区间;非法形态返回 null。支持(与宿主 peer.react 校验同族):
 * `*`、`^1.2.3`、`~1.2.3`、`>=1.2.3`、`>1.2.3`、`=1.2.3`(精确)、
 * `1.2.3`/`1.2`/`1`(裸版本,按 >= 语义——"基于该版本开发,更新宿主可装载")。
 */
export function parseApiVersionRange(range: string): ParsedRange | null {
  const trimmed = range.trim();
  if (trimmed === '*') {
    return { op: '>=', major: 0, minor: 0, patch: 0 };
  }
  const match = trimmed.match(/^(\^|~|>=|>|=)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match || match[2] === undefined) {
    return null;
  }
  return {
    op: (match[1] as ParsedRange['op']) ?? '>=',
    major: Number(match[2]),
    minor: Number(match[3] ?? 0),
    patch: Number(match[4] ?? 0),
  };
}

/** 逐段比较宿主版本与声明版本:return > 0 宿主更新,< 0 更旧,= 0 相等。 */
function compareHost(host: number[], min: ParsedRange): number {
  return (
    host[0] - min.major || host[1] - min.minor || host[2] - min.patch
  );
}

/**
 * 宿主 API 版本是否满足插件声明的区间(app.json `apiVersion` 字段)。
 *
 * 兼容语义(docs/plugin-development-guide.md「兼容性策略」):
 * - 缺省/`*`:任何宿主版本可装载;
 * - `^X.Y.Z`:同 major 且宿主 ≥ X.Y.Z(major 内只做加法演进的契约承诺);
 * - `~X.Y.Z`:同 major.minor 且宿主 ≥ 补丁;
 * - `>=X.Y.Z` / 裸版本:不低于声明;
 * - `=X.Y.Z` / `>X.Y.Z`:精确相等 / 严格更新;
 * - **非法形态返回 true(宽容)**——格式问题由安装侧(BFF readPluginMeta)
 *   硬校验拒绝,装载侧不做二次裁决,避免双端语义漂移。
 *
 * @param range 插件声明的宿主 API 版本区间;缺省视为兼容。
 * @param hostVersion 宿主 API 版本;缺省读全局(非宿主环境返回 true——
 *        单测/独立运行不应因缺宿主而误判不兼容)。
 */
export function satisfiesApiVersion(
  range: string | undefined,
  hostVersion?: string,
): boolean {
  if (range === undefined || range === null || range === '') {
    return true;
  }
  const parsed = parseApiVersionRange(range);
  if (!parsed) {
    return true;
  }
  const host = hostVersion ?? getHostApiVersion();
  if (host === null) {
    return true;
  }
  const parts = host.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length === 0 || Number.isNaN(parts[0])) {
    return true;
  }
  const hostTuple = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  const cmp = compareHost(hostTuple, parsed);
  if (parsed.op === '^') {
    return hostTuple[0] === parsed.major && cmp >= 0;
  }
  if (parsed.op === '~') {
    return hostTuple[0] === parsed.major && hostTuple[1] === parsed.minor && cmp >= 0;
  }
  if (parsed.op === '>') {
    return cmp > 0;
  }
  if (parsed.op === '=') {
    return cmp === 0;
  }
  return cmp >= 0;
}
