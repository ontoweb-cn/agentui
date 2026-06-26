/**
 * Contract: StreamChunk — BFF Unified Streaming Output
 *
 * Authority source: specs/001-multi-harness-p0/contracts/stream-chunk.ts
 * Runtime copy: bff/src/types/stream.ts
 *
 * Constitution references (v1.1.0):
 * - Principle IV (SSE Dual-Protocol Parsing, NON-NEGOTIABLE):
 *   type enum is LOCKED to 8 values, covers both backends' events.
 *   - Intellect RAG (OpenAI compatible): produces delta / done / error
 *   - Intellect Enterprise /api/sessions/{id}/chat/stream (custom events):
 *     produces delta / reasoning / tool_start / tool_complete / tool_progress /
 *     usage / done / error
 *   - Intellect Enterprise /v1/chat/completions: NOT used by BFF (Principle VIII)
 *
 * Event → StreamChunk mapping (intellect-team source-confirmed, do NOT invent):
 *   Intellect Enterprise custom SSE (from adapter.py _handle_session_chat_stream):
 *     run.started             → (internal, not emitted)
 *     message.started         → (internal, not emitted)
 *     assistant.delta         → StreamDelta
 *     tool.progress + tool_name="_thinking" → StreamReasoning
 *     tool.progress + other tool_name       → StreamToolProgress
 *     tool.started            → StreamToolStart
 *     tool.completed          → StreamToolComplete
 *     tool.failed             → StreamError (with toolCallId)
 *     run.completed (data.usage) → StreamUsage, then StreamDone
 *     error                   → StreamError
 *     done                    → StreamDone (terminal signal)
 *   Intellect RAG OpenAI SSE:
 *     data: {"choices":[{"delta":{"content":"..."}}]} → StreamDelta
 *     data: {"choices":[{"delta":{"reasoning_content":"..."}}]} → StreamReasoning
 *     data: {"choices":[{"delta":{},"finish_reason":"stop"}]} → (internal)
 *     data: [DONE]           → StreamDone
 *     usage field in final chunk → StreamUsage
 *     non-200 response / parse failure → StreamError
 *
 * Parsers (implemented in P1/P3, NOT in P0):
 * - parseOpenAISSE: bff/src/services/adapters/shared/sse-parser.ts
 * - parseIntellectEnterpriseSSE: bff/src/services/adapters/shared/intellect-enterprise-sse.ts
 */

// ---------------------------------------------------------------------------
// Token Usage
// ---------------------------------------------------------------------------

/**
 * Token 用量,来自 Intellect RAG `usage` 字段或企业版 `run.completed` 的 `data.usage`。
 */
export interface TokenUsage {
  /** 输入 token 数 */
  promptTokens: number;
  /** 输出 token 数 */
  completionTokens: number;
}

// ---------------------------------------------------------------------------
// StreamChunk (Discriminated Union)
// ---------------------------------------------------------------------------

/**
 * BFF 统一流式输出格式。
 *
 * type 枚举锁定为 8 个值(Constitution Principle IV v1.1.0 NON-NEGOTIABLE),
 * 禁止 P1/P3 时回头扩展枚举(向后兼容)。
 */
export type StreamChunk =
  | StreamDelta
  | StreamReasoning
  | StreamToolStart
  | StreamToolComplete
  | StreamToolProgress
  | StreamUsage
  | StreamDone
  | StreamError;

export interface StreamDelta {
  /** 增量内容(模型输出文本) */
  readonly type: 'delta';
  /** 增量文本内容 */
  content: string;
}

export interface StreamReasoning {
  /** 思考链内容(企业版 reasoning,Intellect RAG 无此事件) */
  readonly type: 'reasoning';
  /** 思考链文本内容 */
  content: string;
}

export interface StreamToolStart {
  /** 工具调用开始(P3 企业版编码 Agent) */
  readonly type: 'tool_start';
  /** 工具名称 */
  toolName: string;
  /** 工具调用 ID(用于关联 tool_complete) */
  toolCallId: string;
  /** 工具参数(可选,后端可能流式分批) */
  args?: unknown;
}

export interface StreamToolComplete {
  /** 工具调用完成(P3) */
  readonly type: 'tool_complete';
  /** 工具调用 ID(关联 tool_start) */
  toolCallId: string;
  /** 工具返回结果(可选,后端可能不返回) */
  result?: unknown;
}

export interface StreamToolProgress {
  /** 工具进度增量(企业版 tool.progress 事件,非 _thinking) */
  readonly type: 'tool_progress';
  /** 工具名称 */
  toolName: string;
  /** 工具调用 ID(可选,后端可能不提供) */
  toolCallId?: string;
  /** 进度增量内容(preview / delta) */
  content: string;
}

export interface StreamUsage {
  /** Token 用量(企业版 run.completed.data.usage;Intellect RAG usage 字段) */
  readonly type: 'usage';
  /** Token 用量 */
  usage: TokenUsage;
}

export interface StreamDone {
  /** 流结束(Intellect RAG data: [DONE];企业版 done 事件 / run.completed 终止) */
  readonly type: 'done';
}

export interface StreamError {
  /** 流错误(任意后端错误) */
  readonly type: 'error';
  /** 错误消息 */
  message: string;
  /** 错误码(可选,后端特定) */
  code?: string;
  /** 关联的工具调用 ID(企业版 tool.failed 时填充) */
  toolCallId?: string;
}

// ---------------------------------------------------------------------------
// Stream Helpers
// ---------------------------------------------------------------------------

/**
 * 流式方法的返回类型。
 * Adapter 的 sendMessage 返回 AsyncIterable<StreamChunk>,
 * BFF 路由层用 for-await-of 消费并透传给前端 SSE。
 */
export type StreamIterable = AsyncIterable<StreamChunk>;

/**
 * 类型守卫:是否为终止 chunk(done / error)。
 * BFF 路由层据此关闭 SSE 连接。
 */
export function isTerminalChunk(chunk: StreamChunk): boolean {
  return chunk.type === 'done' || chunk.type === 'error';
}
