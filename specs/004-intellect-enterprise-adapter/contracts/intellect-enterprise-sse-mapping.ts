/**
 * Contract: Intellect Enterprise SSE → StreamChunk 映射
 *
 * Authority source: specs/004-intellect-enterprise-adapter/contracts/intellect-enterprise-sse-mapping.ts
 * Implementation: bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-sse.ts (P3)
 *
 * Constitution references (v1.2.0):
 * - Principle IV (SSE Dual-Protocol): Intellect 企业版自定义事件 SSE,用 parseIntellectEnterpriseSSE
 *   禁止复用 parseCanvasWorkflowSSE / parseOpenAISSE
 * - Principle VIII (BFF ↔ Intellect Enterprise Access Contract): 主通道 /api/sessions/{id}/chat/stream
 *   输出此 SSE 协议
 *
 * Evidence (intellect-team source, do NOT invent):
 * - intellect-team/plugins/platforms/api_server/adapter.py:1711-1762 (_enqueue / _event_payload 调用)
 * - intellect-team/plugins/platforms/api_server/adapter.py:1722-1723 (run.started + message.started)
 * - intellect-team/plugins/platforms/api_server/adapter.py:1745-1750 (run.completed with usage)
 * - intellect-team/plugins/platforms/api_server/adapter.py:1756-1758 (error + done finally)
 *
 * P3 实现的解析器: parseIntellectEnterpriseSSE(stream: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk>
 */

// 契约文件独立,不复用运行时 import;StreamChunk 类型从 P1 契约复制(权威源)。
// 运行时实现(bff/src/services/adapters/intellect-enterprise/)从 bff/src/types/stream 导入。
/**
 * StreamChunk — 统一流式输出类型(8 值,Constitution Principle IV v1.2.0)。
 * 复用 P1 定义,权威源: specs/002-multi-harness-p1/contracts/harness-adapter.ts
 */
export type StreamChunk =
  | { type: 'delta'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_start'; toolName: string; args?: unknown }
  | { type: 'tool_complete'; toolName: string; result?: unknown; error?: string }
  | { type: 'tool_progress'; toolName: string; content: string }
  | {
      type: 'usage';
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    }
  | { type: 'done' }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Intellect Enterprise SSE 事件类型 (从 adapter.py 实证)
// ---------------------------------------------------------------------------

/**
 * intellect-team `/api/sessions/{id}/chat/stream` 输出的 SSE 事件名。
 * 从 adapter.py:1711-1762 的 _enqueue("event.name", {...}) 调用实证。
 */
export type IntellectEnterpriseEvent =
  | 'run.started'
  | 'message.started'
  | 'assistant.delta'
  | 'tool.progress'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'run.completed'
  | 'error'
  | 'done';

// ---------------------------------------------------------------------------
// SSE Payload 类型(对应 adapter.py _event_payload 调用的 data 字段)
// ---------------------------------------------------------------------------

export interface RunStartedPayload {
  user_message: { role: 'user'; content: string };
}

export interface MessageStartedPayload {
  message: { id: string; role: 'assistant' };
}

export interface AssistantDeltaPayload {
  message_id: string;
  delta: string;
}

export interface ToolProgressPayload {
  message_id: string;
  /** tool_name="_thinking" 时表示 reasoning 增量,映射到 StreamReasoning */
  tool_name: string;
  delta: string;
}

export interface ToolStartedPayload {
  message_id: string;
  tool_name: string;
  args: unknown;
}

export interface ToolCompletedPayload {
  message_id: string;
  tool_name: string;
  result: unknown;
}

export interface ToolFailedPayload {
  message_id: string;
  tool_name: string;
  error: string;
}

export interface RunCompletedPayload {
  session_id: string;
  message_id: string;
  completed: true;
  messages: unknown[];
  /** Token 用量,映射到 StreamUsage */
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface ErrorPayload {
  message: string;
}

export interface DonePayload {
  // 空对象,仅作流终止信号
}

// ---------------------------------------------------------------------------
// SSE 事件 → StreamChunk 映射规则 (Constitution Principle IV v1.2.0)
// ---------------------------------------------------------------------------

/**
 * 映射规则表(解析器实现依据,禁止偏离):
 *
 * | SSE 事件                  | 条件                          | → StreamChunk type   |
 * |--------------------------|-------------------------------|----------------------|
 * | run.started              | (无)                          | (不产出,BFF 内部状态) |
 * | message.started          | (无)                          | (不产出,BFF 内部状态) |
 * | assistant.delta          | (无)                          | 'delta'              |
 * | tool.progress            | tool_name === '_thinking'     | 'reasoning'          |
 * | tool.progress            | tool_name !== '_thinking'     | 'tool_progress'      |
 * | tool.started             | (无)                          | 'tool_start'         |
 * | tool.completed             | (无)                          | 'tool_complete'      |
 * | tool.failed                | (无)                          | 'error'(with toolCallId) |
 * | run.completed              | (无)                          | 'usage' 后接 'done'  |
 * | error                    | (无)                          | 'error'              |
 * | done                     | (无)                          | (不产出,关闭迭代器)  |
 *
 * 容错策略(与 P1 parseCanvasWorkflowSSE 一致):
 * - data 字段 JSON 解析失败:console.warn + 跳过该事件,不中断流
 * - 未知事件名:console.warn + 跳过,不中断流
 * - 流中途断开(ReadableStream 提前结束):产出 {type:'error', message:'stream interrupted'} 后关闭
 */
export type IntellectEnterpriseSSEMappingRule =
  | { event: 'run.started'; produces: null }
  | { event: 'message.started'; produces: null }
  | { event: 'assistant.delta'; produces: StreamChunk & { type: 'delta' } }
  | {
      event: 'tool.progress';
      condition: { tool_name: '_thinking' };
      produces: StreamChunk & { type: 'reasoning' };
    }
  | {
      event: 'tool.progress';
      condition: { tool_name: string; not: '_thinking' };
      produces: StreamChunk & { type: 'tool_progress' };
    }
  | { event: 'tool.started'; produces: StreamChunk & { type: 'tool_start' } }
  | { event: 'tool.completed'; produces: StreamChunk & { type: 'tool_complete' } }
  | { event: 'tool.failed'; produces: StreamChunk & { type: 'error' } }
  | { event: 'run.completed'; produces: [StreamChunk & { type: 'usage' }, StreamChunk & { type: 'done' }] }
  | { event: 'error'; produces: StreamChunk & { type: 'error' } }
  | { event: 'done'; produces: null };

// ---------------------------------------------------------------------------
// 解析器签名(实现契约)
// ---------------------------------------------------------------------------

/**
 * 解析 intellect-team `/api/sessions/{id}/chat/stream` 的 SSE 流。
 *
 * @param stream intellect-team 返回的 ReadableStream<Uint8Array>(SSE 格式)
 * @returns AsyncIterable<StreamChunk>,供 BFF 路由层转发给前端
 *
 * 实现要求:
 * 1. 按 SSE 协议解析 `event: <name>\ndata: <json>\n\n` 帧
 * 2. 按上述映射规则产出 StreamChunk
 * 3. 容错:JSON 解析失败/未知事件 → console.warn + 跳过,不中断
 * 4. 流结束(done 事件或 ReadableStream close)→ 关闭 AsyncIterable
 */
export declare function parseIntellectEnterpriseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<StreamChunk>;

// ===========================================================================
// /v1/runs/{run_id}/events 协议 (v1.3.0 主通道, Rust api_server.rs)
// ===========================================================================
//
// Authority source: intellect-team/intellect-gateway/src/platform/api_server.rs
//
// 与 legacy /api/sessions/{id}/chat/stream (Python adapter.py) 的关键差异:
// 1. 帧格式: 无独立 `event:` 行, 事件名嵌入 JSON `event` 字段
//    `data: {"event":"<name>","run_id":"...","timestamp":<f64>,...payload}\n\n`
// 2. 事件名: `message.delta` (含内层 `type` 区分子类型) 替代 `assistant.delta`
// 3. 字段名差异:
//    - message.delta 内容: `text` (非 `delta`)
//    - tool.progress 工具名: `name` (非 `tool_name`)
//    - run.completed usage: `input_tokens`/`output_tokens` (非 `prompt_tokens`/`completion_tokens`)
// 4. 终态事件: `run.completed`/`run.failed`/`run.cancelled` (无独立 `done` 事件)
// 5. 新增 `approval.request`/`approval.responded` 事件

/**
 * /v1/runs events 事件名 (从 Rust api_server.rs map_event_to_sse 实证)。
 */
export type RunEventName =
  | 'run.started'
  | 'message.delta'
  | 'tool.progress'
  | 'approval.request'
  | 'approval.responded'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

/**
 * message.delta 内层 type (区分 assistant 增量与 reasoning 增量)。
 * Rust api_server.rs:1474-1477:
 *   assistant.delta → {"type":"assistant.delta","text":text}
 *   reasoning.delta → {"type":"reasoning.delta","text":text}
 */
export type MessageDeltaType = 'assistant.delta' | 'reasoning.delta';

/**
 * tool.progress 内层 type (区分 started/completed)。
 * Rust api_server.rs:1484-1487:
 *   tool.started   → {"type":"tool.started","tool_id":id,"name":name,"arguments":args}
 *   tool.completed → {"type":"tool.completed","tool_id":id,"name":name,"result":result,"duration_s":duration_s}
 */
export type ToolProgressType = 'tool.started' | 'tool.completed';

/**
 * /v1/runs events 的 message.delta payload (Rust 格式)。
 * 与 legacy AssistantDeltaPayload 的差异: 用 `text` 而非 `delta`。
 */
export interface RunMessageDeltaPayload {
  type: MessageDeltaType;
  text: string;
}

/**
 * /v1/runs events 的 tool.progress payload (Rust 格式)。
 * 与 legacy ToolStartedPayload/ToolCompletedPayload 的差异: 用 `name` 而非 `tool_name`。
 */
export interface RunToolProgressPayload {
  type: ToolProgressType;
  tool_id: string;
  name: string;
  arguments?: unknown;
  result?: unknown;
  duration_s?: number;
}

/**
 * /v1/runs events 的 run.completed payload (Rust 格式)。
 * 与 legacy RunCompletedPayload 的差异: usage 用 `input_tokens`/`output_tokens`。
 *
 * Rust api_server.rs:3791-3800:
 *   usage = {"input_tokens": r.input_tokens, "output_tokens": r.output_tokens, "total_tokens": r.total_tokens}
 *   run.completed → {"event":"run.completed","output":r.final_response,"usage":usage}
 */
export interface RunCompletedPayload {
  output?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  error?: string;
}

/**
 * /v1/runs events 映射规则表 (v1.3.0, 禁止偏离):
 *
 * | SSE 事件           | 条件                      | → StreamChunk type             |
 * |-------------------|---------------------------|--------------------------------|
 * | run.started       | (无)                      | (不产出)                        |
 * | message.delta     | type==="reasoning.delta"  | 'reasoning'                    |
 * | message.delta     | type==="assistant.delta"  | 'delta'                        |
 * | tool.progress     | type==="tool.started"     | 'tool_start'                   |
 * | tool.progress     | type==="tool.completed"   | 'tool_complete'                |
 * | approval.request  | (无)                      | 'approval_request'             |
 * | approval.responded| (无)                      | 'approval_responded'           |
 * | run.completed     | error 非空                | 'usage' + 'error'              |
 * | run.completed     | 无 delta 且 output 非空    | 'delta'(output) + 'usage' + 'done' |
 * | run.completed     | (默认)                    | 'usage' + 'done'               |
 * | run.failed        | (无)                      | 'error'                        |
 * | run.cancelled     | (无)                      | 'error'                        |
 *
 * 字段名兼容策略 (BFF 解析器实现):
 * - message.delta: 优先读 `text`, 回退 `delta`
 * - tool.progress: 优先读 `name`, 回退 `tool_name`
 * - run.completed usage: 优先读 `input_tokens`/`output_tokens`, 回退 `prompt_tokens`/`completion_tokens`
 *
 * output 兜底逻辑:
 * - 当整条流未产出任何 delta chunk 时, 将 run.completed.output 作为最终 delta 产出
 * - 场景: Gateway 缓存命中, 只发 run.completed 不发 message.delta
 */

/**
 * 解析 intellect-team /v1/runs/{run_id}/events 的 SSE 流。
 *
 * @param stream intellect-team 返回的 ReadableStream<Uint8Array>(SSE 格式)
 * @returns AsyncIterable<StreamChunk>,供 BFF 路由层转发给前端
 *
 * 实现要求:
 * 1. 帧格式: `data: <json>\n\n`(json 含 `event` 字段, 无独立 event: 行)
 * 2. 按上述映射规则产出 StreamChunk
 * 3. 字段名兼容: 同时支持 Rust (text/name/input_tokens) 和 Python (delta/tool_name/prompt_tokens) 格式
 * 4. output 兜底: 无 delta 时将 run.completed.output 作为最终内容产出
 * 5. 容错: JSON 解析失败/未知事件 → console.warn + 跳过, 不中断
 * 6. 流结束(终态事件或 ReadableStream close)→ 关闭 AsyncIterable
 */
export declare function parseIntellectEnterpriseRunEventsSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<StreamChunk>;
