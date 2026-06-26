/**
 * Contract: Canvas Workflow SSE → StreamChunk 映射
 *
 * Authority source: specs/002-multi-harness-p1/contracts/canvas-workflow-sse-mapping.ts
 * Implementation: bff/src/services/adapters/intellect-rag/parse-canvas-workflow-sse.ts (P1)
 *
 * Constitution references (v1.2.0, pending ratification):
 * - Principle IV (SSE Dual-Protocol): Intellect RAG 双协议之一(canvas workflow),用 parseCanvasWorkflowSSE
 * - Principle III (Canvas Hard-Bound): reference 字段透传到 Layer 3 metadata,不纳入 StreamChunk 一等字段
 *
 * Evidence (intellect-rag source, do NOT invent):
 * - intellect-rag/agent/canvas.py:419-592 (Canvas.run async generator)
 * - intellect-rag/api/apps/restful_apis/agent_api.py:1210-1361 (agent_chat_completion)
 * - agentui/src/hooks/use-send-message.ts:10-22 (前端 MessageEventType 枚举,实证消费此协议)
 *
 * P1 实现的解析器: parseCanvasWorkflowSSE(stream: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk>
 */

import type { StreamChunk } from './stream';

// ---------------------------------------------------------------------------
// Intellect RAG Canvas Workflow SSE 事件类型 (从 canvas.py 实证)
// ---------------------------------------------------------------------------

export type CanvasWorkflowEvent =
  | 'workflow_started'
  | 'node_started'
  | 'node_finished'
  | 'message'
  | 'message_end'
  | 'workflow_finished';

export interface CanvasWorkflowSSEPayload {
  event: CanvasWorkflowEvent;
  message_id: string;
  session_id: string;
  created_at: number;
  data: CanvasWorkflowData;
}

export interface CanvasWorkflowData {
  // message event
  content?: string;
  audio_binary?: string;
  start_to_think?: boolean;
  end_to_think?: boolean;
  // message_end event
  reference?: {
    chunks: unknown[];
    doc_aggs: unknown[];
  };
  // workflow_started / node_started / node_finished events (共用 inputs 字段)
  inputs?: Record<string, unknown>;
  // node_started / node_finished events
  component_id?: string;
  component_name?: string;
  component_type?: string;
  outputs?: Record<string, unknown>;
  elapsed_time?: number;
  thoughts?: string;
  error?: string | null;
}

// ---------------------------------------------------------------------------
// 事件 → StreamChunk 映射规则 (P1 解析器实现依据)
// ---------------------------------------------------------------------------

export const CANVAS_WORKFLOW_SSE_MAPPING = {
  /**
   * workflow_started: 流开始,内部状态,不产出 StreamChunk。
   * 可选: 产出 metadata chunk 记录 inputs(Principle III Layer 3 透传)。
   */
  workflow_started: 'internal-only',

  /**
   * node_started: 节点开始,内部状态,不产出 StreamChunk。
   * P1 不映射,P3+ 可选产出 tool_start(若节点是工具调用)。
   */
  node_started: 'internal-only',

  /**
   * node_finished: 节点完成,内部状态,不产出 StreamChunk。
   * P1 不映射,P3+ 可选产出 tool_complete。
   */
  node_finished: 'internal-only',

  /**
   * message: 文本增量,产出 StreamDelta。
   * 特殊情况:
   * - data.start_to_think === true: 思考链开始,产出 StreamReasoning(标记思考链)
   * - data.end_to_think === true: 思考链结束,产出 StreamReasoning(标记结束)
   * - data.audio_binary: 音频二进制(P1 透传到 StreamDelta.content 或 metadata,P3+ 评估)
   * - data.content: 文本增量,产出 StreamDelta { type: 'delta', content }
   */
  message: 'delta-or-reasoning',

  /**
   * message_end: 消息结束,产出 StreamDelta(空 content)+ metadata.reference。
   * reference 是 RAG 引用(Principle III),透传到 Layer 3 metadata,不纳入 StreamChunk 一等字段。
   * P1 实现: 产出 StreamDelta { type: 'delta', content: '' } 并附加 metadata.reference。
   */
  message_end: 'delta-with-reference-metadata',

  /**
   * workflow_finished: 流终止,产出 StreamDone。
   * Canvas workflow 不使用 [DONE] 哨牌,用 workflow_finished 终止。
   */
  workflow_finished: 'done',

  /**
   * 非 200 响应或解析失败: 产出 StreamError。
   */
  error: 'error',
} as const;

// ---------------------------------------------------------------------------
// 解析器签名 (P1 实现)
// ---------------------------------------------------------------------------

/**
 * 将 Intellect RAG Canvas Workflow SSE 字节流转换为 StreamChunk 迭代器。
 *
 * @param stream Intellect RAG /api/v1/agents/chat/completions 的响应流
 * @returns StreamChunk 迭代器,以 StreamDone 或 StreamError 终止
 *
 * Implementation notes:
 * - 用 TextDecoderStream + EventSourceParserStream 解析 SSE 帧(与前端一致)
 * - 每个 event 的 data 字段是 JSON,解析为 CanvasWorkflowSSEPayload
 * - 按 CANVAS_WORKFLOW_SSE_MAPPING 规则映射到 StreamChunk
 * - workflow_finished 产出 StreamDone 后终止迭代
 * - 错误隔离: 单个事件解析失败产出 StreamError,不中断流(除非不可恢复)
 */
export type ParseCanvasWorkflowSSE = (
  stream: ReadableStream<Uint8Array>,
) => AsyncIterable<StreamChunk>;
