/**
 * SSE 事件分发器（gateway 路径专用）
 *
 * 解析 BFF 透传的 `{event, data}` JSON 帧，按 `event` 字段路由到对应处理器，
 * 并将 snake_case 字段名转换为前端 camelCase 约定。
 *
 * 仅服务 gateway 路径（BFF `/agents/chat/completions` → IntellectEnterpriseAdapter /
 * IntellectRagAdapter）。其他调用方走 intellect-rag-app envelope-wrapped 格式，
 * 继续使用 `useSendMessageWithSse`。
 *
 * Constitution Principle IV v1.3.0: BFF serializeChunk 输出 9 种 event:
 *   message / tool_start / tool_complete / tool_progress / message_end /
 *   workflow_finished / error / approval_request / approval_responded
 *
 * clarify 支持: BFF 额外转发 clarify_request 事件(intellect-team clarify SSE),
 *   前端 ClarifyCard 渲染问题与输入框,提交回答经 BFF /sessions/:sessionId/clarify。
 *
 * 字段命名转换规则（snake_case → camelCase）:
 *   tool_name → toolName
 *   tool_call_id → toolCallId
 *   start_to_think → startToThink
 *   end_to_think → endToThink
 *   _metadata → metadata
 *   run_id → runId
 *   promptTokens / completionTokens（BFF 已是 camelCase）保持不变
 *
 * reasoning 开闭状态由本分发器维护（不依赖 BFF 有状态序列化）:
 *   - startToThink: true 时设 reasoningOpen = true（去重，BFF 每条 reasoning chunk 都附带）
 *   - endToThink: true 时设 reasoningOpen = false
 *   - tool_start / tool_complete 事件前若 reasoningOpen，隐式闭合（先调用 onReasoning('', false, true)）
 *   - workflow_finished 事件前若 reasoningOpen，隐式闭合
 *
 * v1.3.0 审批事件:
 *   - approval_request: BFF 在 approval_request 后过滤 tool_* 事件，前端不会同时收到
 *     tool_start 与 approval_request。ApprovalCard 由 approval_request 渲染。
 *   - approval_responded: 用户提交审批后由 BFF 路由触发(intellect-team 不一定回推
 *     approval_responded 到 SSE 流；前端 onApprovalResponded 主要由 submitApproval
 *     fetch 调用成功后驱动)。
 */

import type { TokenUsage } from '@/interfaces/database/chat';

// ---------------------------------------------------------------------------
// 类型定义（与 BFF serializeChunk 输出对齐，已转 camelCase）
// ---------------------------------------------------------------------------

export interface MessageData {
  content: string;
  answer: string;
  startToThink?: boolean;
  endToThink?: boolean;
  final?: boolean;
  metadata?: { reference?: unknown };
}

export interface ToolStartData {
  toolName: string;
  toolCallId: string;
  args?: unknown;
}

export interface ToolCompleteData {
  toolCallId: string;
  result?: unknown;
}

export interface ToolProgressData {
  toolName: string;
  toolCallId?: string;
  content: string;
}

export interface ErrorData {
  message: string;
  answer: string;
  toolCallId?: string;
  /** P3: Provider 错误详情（BFF 透传的上游原始 JSON） */
  errorDetails?: unknown;
}

/**
 * v1.3.0 审批请求数据（approval_request 事件）。
 *
 * Constitution Principle IV v1.3.0: BFF serializeChunk 透传 approval_request 事件,
 * 前端 ApprovalCard 组件渲染此数据。`arguments` 是原始 JSON 字符串(非对象),
 * 组件按需 JSON.parse。`runId` 用于提交审批时回传到 BFF /runs/:runId/approval 路由。
 */
export interface ApprovalRequestData {
  /** 工具名称 */
  toolName: string;
  /** 原始 JSON 字符串(intellect-team 透传,组件按需 parse) */
  arguments: string;
  /** 审批选项 */
  choices: Array<'once' | 'session' | 'always' | 'deny'>;
  /** 关联的 run ID(提交审批时回传) */
  runId: string;
}

/**
 * v1.3.0 审批响应数据(approval_responded 事件)。
 *
 * 注:intellect-team 不一定通过 SSE 流回推此事件,前端主要由 submitApproval
 * fetch 调用的返回值驱动 ApprovalCard 状态更新。此处保留 handler 以兼容
 * SSE 主动推送的场景。
 */
export interface ApprovalRespondedData {
  /**
   * 用户选择的审批选项。
   * P2-Q6 修复:null 表示收到非法 choice(数据被篡改或上游异常),
   * 调用方应跳过状态更新而非回退 'deny'。
   */
  choice: 'once' | 'session' | 'always' | 'deny' | null;
  /** 已解决的审批请求数量 */
  resolved: number;
  /** 关联的 run ID */
  runId: string;
}

/**
 * clarify 澄清请求数据(clarify_request 事件)。
 *
 * BFF 转发 intellect-team clarify SSE 事件,前端 ClarifyCard 组件渲染此数据。
 * `clarifyId` 用于提交回答时回传到 BFF;`sessionId` 用于构造 BFF URL。
 */
export interface ClarifyRequestData {
  /** 澄清问题文本 */
  question: string;
  /** 候选答案列表(可为空) */
  choices: string[];
  /** clarify ID(提交回答时回传,格式 session_id:timestamp_ms) */
  clarifyId: string;
  /** 关联的 session ID(构造提交 URL) */
  sessionId: string;
}

export type SseFrame =
  | { event: 'message'; data: MessageData }
  | { event: 'tool_start'; data: ToolStartData }
  | { event: 'tool_complete'; data: ToolCompleteData }
  | { event: 'tool_progress'; data: ToolProgressData }
  | { event: 'message_end'; data: { usage: TokenUsage } }
  | { event: 'workflow_finished'; data: true }
  | { event: 'error'; data: ErrorData }
  | { event: 'approval_request'; data: ApprovalRequestData }
  | { event: 'approval_responded'; data: ApprovalRespondedData }
  | { event: 'clarify_request'; data: ClarifyRequestData };

// ---------------------------------------------------------------------------
// 事件处理器接口
// ---------------------------------------------------------------------------

export interface SseEventHandlers {
  /** 收到 delta 文本增量（`message` 事件且非 reasoning） */
  onDelta: (content: string, metadata?: { reference?: unknown }) => void;
  /** 收到 reasoning 增量（`message` 事件且 startToThink/endToThink） */
  onReasoning: (content: string, isStart: boolean, isEnd?: boolean) => void;
  /** 收到 tool_start 事件 */
  onToolStart: (data: ToolStartData) => void;
  /** 收到 tool_complete 事件 */
  onToolComplete: (data: ToolCompleteData) => void;
  /** 收到 tool_progress 事件 */
  onToolProgress: (data: ToolProgressData) => void;
  /** 收到 usage 事件（message_end） */
  onUsage: (usage: TokenUsage) => void;
  /** 收到 error 事件 */
  onError: (message: string, toolCallId?: string, errorDetails?: unknown) => void;
  /** 收到 done 事件（workflow_finished） */
  onDone: () => void;
  /**
   * v1.3.0 收到 approval_request 事件(工具审批请求)。
   * 前端 ApprovalCard 组件据此渲染,并保存 runId 用于提交审批。
   */
  onApprovalRequest: (data: ApprovalRequestData) => void;
  /**
   * v1.3.0 收到 approval_responded 事件(审批已提交)。
   * 注:intellect-team 不一定通过 SSE 回推此事件,前端主要由 submitApproval
   * fetch 调用驱动状态更新。此处保留 handler 以兼容 SSE 主动推送场景。
   */
  onApprovalResponded: (data: ApprovalRespondedData) => void;
  /**
   * 收到 clarify_request 事件(澄清请求)。
   * 前端 ClarifyCard 组件据此渲染问题与输入框,并保存 clarifyId/sessionId
   * 用于提交回答。
   */
  onClarifyRequest: (data: ClarifyRequestData) => void;
}

// ---------------------------------------------------------------------------
// 分发器状态（reasoning 开闭跟踪）
// ---------------------------------------------------------------------------

export interface DispatcherState {
  reasoningOpen: boolean;
}

// ---------------------------------------------------------------------------
// 字段命名转换
// ---------------------------------------------------------------------------

/**
 * 将 BFF 输出的 snake_case 字段名转换为前端 camelCase。
 * 仅处理已知字段，未知字段原样保留。
 */
function convertMessageData(raw: Record<string, unknown>): MessageData {
  const data: MessageData = {
    content: String(raw.content ?? ''),
    answer: String(raw.answer ?? ''),
  };
  if (raw.start_to_think !== undefined) data.startToThink = Boolean(raw.start_to_think);
  if (raw.end_to_think !== undefined) data.endToThink = Boolean(raw.end_to_think);
  if (raw.final !== undefined) data.final = Boolean(raw.final);
  // L4 修复:_metadata 类型校验,避免 string/number 等非对象类型被强转为 {reference?: unknown}
  // 导致下游 metadata?.reference 访问语义错误。
  if (
    raw._metadata !== undefined &&
    typeof raw._metadata === 'object' &&
    raw._metadata !== null
  ) {
    data.metadata = raw._metadata as { reference?: unknown };
  }
  return data;
}

function convertToolStartData(raw: Record<string, unknown>): ToolStartData {
  const data: ToolStartData = {
    toolName: String(raw.tool_name ?? ''),
    toolCallId: String(raw.tool_call_id ?? ''),
  };
  if (raw.args !== undefined) data.args = raw.args;
  return data;
}

function convertToolCompleteData(raw: Record<string, unknown>): ToolCompleteData {
  const data: ToolCompleteData = {
    toolCallId: String(raw.tool_call_id ?? ''),
  };
  if (raw.result !== undefined) data.result = raw.result;
  return data;
}

function convertToolProgressData(raw: Record<string, unknown>): ToolProgressData {
  const data: ToolProgressData = {
    toolName: String(raw.tool_name ?? ''),
    content: String(raw.content ?? ''),
  };
  if (raw.tool_call_id !== undefined) data.toolCallId = String(raw.tool_call_id);
  return data;
}

function convertErrorData(raw: Record<string, unknown>): ErrorData {
  const data: ErrorData = {
    message: String(raw.message ?? ''),
    answer: String(raw.answer ?? ''),
  };
  if (raw.tool_call_id !== undefined) data.toolCallId = String(raw.tool_call_id);
  // P3: 透传 errorDetails（BFF safeJsonSerialize 后的纯数据）
  if (raw.errorDetails !== undefined) data.errorDetails = raw.errorDetails;
  return data;
}

/**
 * v1.3.0 转换 approval_request 事件数据(snake_case → camelCase)。
 * BFF serializeChunk 输出 tool_name/arguments/choices/run_id,前端转 toolName/arguments/choices/runId。
 * choices 强制校验为合法值,过滤掉非法项。
 */
function convertApprovalRequestData(raw: Record<string, unknown>): ApprovalRequestData {
  const rawChoices = Array.isArray(raw.choices) ? raw.choices : [];
  const choices = rawChoices.filter(
    (c): c is 'once' | 'session' | 'always' | 'deny' =>
      c === 'once' || c === 'session' || c === 'always' || c === 'deny',
  );
  return {
    toolName: String(raw.tool_name ?? ''),
    arguments: typeof raw.arguments === 'string' ? raw.arguments : '',
    // choices 为空时使用默认 4 个选项(与 BFF parse 层兜底一致)
    choices:
      choices.length > 0 ? choices : ['once', 'session', 'always', 'deny'],
    runId: String(raw.run_id ?? ''),
  };
}

/**
 * v1.3.0 转换 approval_responded 事件数据(snake_case → camelCase)。
 *
 * P2-Q6 修复:choice 非法时返回 null 而非回退 'deny'。
 * - 回退 'deny' 会误导 UI 显示"已拒绝",实际是数据错误。
 * - null 表示收到非法 choice,调用方(onApprovalResponded)应跳过状态更新,
 *   保留 pending 状态等待用户手动操作或服务端纠正。
 * - 这也作为数据完整性异常的信号,便于诊断上游问题。
 */
function convertApprovalRespondedData(
  raw: Record<string, unknown>,
): ApprovalRespondedData {
  const rawChoice = raw.choice;
  const choice =
    rawChoice === 'once' ||
    rawChoice === 'session' ||
    rawChoice === 'always' ||
    rawChoice === 'deny'
      ? rawChoice
      : null;
  return {
    choice,
    resolved: typeof raw.resolved === 'number' ? raw.resolved : 0,
    runId: String(raw.run_id ?? ''),
  };
}

/**
 * 转换 clarify_request 事件数据(snake_case → camelCase)。
 * BFF 输出 question/choices/clarify_id/session_id,前端转 question/choices/clarifyId/sessionId。
 * choices 强制校验为字符串数组,过滤非字符串项。
 */
function convertClarifyRequestData(raw: Record<string, unknown>): ClarifyRequestData {
  const rawChoices = Array.isArray(raw.choices) ? raw.choices : [];
  const choices = rawChoices.filter(
    (c): c is string => typeof c === 'string',
  );
  return {
    question: String(raw.question ?? ''),
    choices,
    clarifyId: String(raw.clarify_id ?? ''),
    sessionId: String(raw.session_id ?? ''),
  };
}

// ---------------------------------------------------------------------------
// 分发器主逻辑
// ---------------------------------------------------------------------------

/**
 * 解析单个 SSE 帧的 `data` 字段（JSON 字符串），按 event 字段路由到处理器。
 *
 * @param rawData SSE 帧的 `data` 字段值（JSON 字符串）
 * @param handlers 事件处理器集合
 * @param state 分发器状态（reasoning 开闭跟踪），调用方需保持引用稳定
 * @returns true 表示流应终止（收到 workflow_finished 或 error），false 表示继续
 */
export function dispatchSseFrame(
  rawData: string,
  handlers: SseEventHandlers,
  state: DispatcherState,
): boolean {
  if (!rawData) return false;

  let parsed: { event?: string; data?: unknown };
  try {
    parsed = JSON.parse(rawData);
  } catch {
    // JSON 解析失败容错：静默跳过（与 useSendMessageWithSse 行为一致）
    return false;
  }

  const event = parsed.event;
  const rawDataObj = (parsed.data ?? {}) as Record<string, unknown>;

  switch (event) {
    case 'message': {
      const data = convertMessageData(rawDataObj);

      // reasoning 信号判断
      if (data.startToThink || data.endToThink) {
        // 隐式闭合逻辑：startToThink 时若已 open，先闭合（去重 BFF 重复发送的 startToThink）
        if (data.startToThink && !state.reasoningOpen) {
          state.reasoningOpen = true;
          handlers.onReasoning(data.content, true, false);
        } else if (data.startToThink && state.reasoningOpen) {
          // BFF 重复发送 startToThink，仅追加 content 不重复触发 isStart
          handlers.onReasoning(data.content, false, false);
        } else if (data.endToThink) {
          state.reasoningOpen = false;
          handlers.onReasoning(data.content, false, true);
        }
        return false;
      }

      // 普通 delta：工具调用前若 reasoningOpen，隐式闭合
      if (state.reasoningOpen) {
        state.reasoningOpen = false;
        handlers.onReasoning('', false, true);
      }
      handlers.onDelta(data.content, data.metadata);
      return false;
    }

    case 'tool_start': {
      // 工具调用前隐式闭合 reasoning
      if (state.reasoningOpen) {
        state.reasoningOpen = false;
        handlers.onReasoning('', false, true);
      }
      const data = convertToolStartData(rawDataObj);
      handlers.onToolStart(data);
      return false;
    }

    case 'tool_complete': {
      if (state.reasoningOpen) {
        state.reasoningOpen = false;
        handlers.onReasoning('', false, true);
      }
      const data = convertToolCompleteData(rawDataObj);
      handlers.onToolComplete(data);
      return false;
    }

    case 'tool_progress': {
      const data = convertToolProgressData(rawDataObj);
      handlers.onToolProgress(data);
      return false;
    }

    case 'message_end': {
      const usage = (rawDataObj.usage ?? {}) as TokenUsage;
      handlers.onUsage({
        promptTokens: Number(usage.promptTokens ?? 0),
        completionTokens: Number(usage.completionTokens ?? 0),
      });
      return false;
    }

    case 'workflow_finished': {
      // done 事件前隐式闭合 reasoning
      if (state.reasoningOpen) {
        state.reasoningOpen = false;
        handlers.onReasoning('', false, true);
      }
      handlers.onDone();
      return true;
    }

    case 'error': {
      if (state.reasoningOpen) {
        state.reasoningOpen = false;
        handlers.onReasoning('', false, true);
      }
      const data = convertErrorData(rawDataObj);
      handlers.onError(data.message, data.toolCallId, data.errorDetails);
      return true;
    }

    case 'approval_request': {
      // v1.3.0 工具审批请求:不闭合 reasoning(approval_request 可能在 reasoning 中产生)，
      // ApprovalCard 作为独立 UI 元素渲染。
      // BFF streamChunksAsSSE 已在 approval_request 后过滤 tool_* 事件,前端不会重复渲染。
      const data = convertApprovalRequestData(rawDataObj);
      handlers.onApprovalRequest(data);
      return false;
    }

    case 'approval_responded': {
      // v1.3.0 审批响应:不终止流,run 继续执行产出后续事件(delta/done 等)。
      // 注:intellect-team 通常不通过 SSE 主动回推此事件,前端主要由 submitApproval
      // fetch 调用驱动状态更新。此处仅作为兼容路径。
      const data = convertApprovalRespondedData(rawDataObj);
      handlers.onApprovalResponded(data);
      return false;
    }

    case 'clarify_request': {
      // clarify 澄清请求:不闭合 reasoning,ClarifyCard 作为独立 UI 元素渲染。
      // 不终止流,run 在用户提交回答后继续执行产出后续事件。
      const data = convertClarifyRequestData(rawDataObj);
      handlers.onClarifyRequest(data);
      return false;
    }

    default: {
      // 未知 event 容错：静默跳过
      return false;
    }
  }
}

/**
 * 创建新的分发器状态（reasoning 开闭跟踪）。
 * 调用方在每个流的开始时调用此函数获取新状态。
 */
export function createDispatcherState(): DispatcherState {
  return { reasoningOpen: false };
}
