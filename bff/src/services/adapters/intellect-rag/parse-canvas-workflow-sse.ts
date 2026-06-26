// @see specs/002-multi-harness-p1/contracts/canvas-workflow-sse-mapping.ts (authority source)
// @see specs/002-multi-harness-p1/data-model.md (实体 4)
/**
 * parseCanvasWorkflowSSE — Intellect RAG Canvas Workflow SSE 解析器。
 *
 * Authority source: specs/002-multi-harness-p1/contracts/canvas-workflow-sse-mapping.ts
 * Runtime: bff/src/services/adapters/intellect-rag/parse-canvas-workflow-sse.ts
 *
 * Constitution references (v1.2.0):
 * - Principle IV (SSE Dual-Protocol): Intellect RAG Canvas Workflow SSE → StreamChunk
 * - Principle III (Canvas Hard-Bound): reference 字段透传到 metadata(Layer 3),不纳入 StreamChunk 一等字段
 *
 * 事件映射(从 intellect-rag/agent/canvas.py:419-592 实证):
 *   workflow_started                  → (internal, not emitted)
 *   node_started / node_finished      → (internal, not emitted; P3+ 可选 tool_*)
 *   message + data.content            → StreamDelta
 *   message + start_to_think/end_to_think → StreamReasoning
 *   message_end + data.reference      → StreamDelta (empty content) + metadata.reference (Layer 3)
 *   workflow_finished                 → StreamDone (no [DONE] sentinel, terminal signal)
 *   non-200 / parse failure           → StreamError
 *
 * 实现策略:无外部依赖,用 Node.js ReadableStream + TextDecoder 手动解析 SSE 帧。
 * SSE 帧以 `\n\n` 分隔,每帧含 `data: <json>` 行(可能多行,合并)。
 */

import type { StreamChunk, StreamDelta, StreamReasoning } from '../../../types/stream';

/** Canvas Workflow SSE payload(从 intellect-rag canvas.py 实证) */
interface CanvasWorkflowSSEPayload {
  event: string;
  data: {
    content?: string;
    start_to_think?: boolean;
    end_to_think?: boolean;
    reference?: {
      chunks: unknown[];
      doc_aggs: unknown[];
    };
    [key: string]: unknown;
  };
}

/**
 * 将 Intellect RAG Canvas Workflow SSE 字节流转换为 StreamChunk 迭代器。
 *
 * @param stream Intellect RAG /api/v1/agents/chat/completions 的响应流
 * @returns StreamChunk 迭代器,以 StreamDone 或流自然结束终止
 */
export async function* parseCanvasWorkflowSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<StreamChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminated = false;

  try {
    while (!terminated) {
      const { done, value } = await reader.read();
      if (done) {
        // 处理 buffer 中剩余的不完整帧(无尾随 \n\n 的最后帧)
        if (buffer.trim()) {
          for (const chunk of parseFrame(buffer)) {
            yield chunk;
            if (chunk.type === 'done') {
              terminated = true;
              break;
            }
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // SSE 帧以 \n\n 分隔
      let frameEnd: number;
      while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);

        for (const chunk of parseFrame(frame)) {
          yield chunk;
          if (chunk.type === 'done') {
            terminated = true;
            break;
          }
        }
        if (terminated) break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 解析单个 SSE 帧(可能含多行 data:,合并为一个 JSON)。
 * 返回 StreamChunk 数组(通常 0 或 1 个,错误情况可能 1 个 error)。
 */
function parseFrame(frame: string): StreamChunk[] {
  // 提取所有 data: 行,合并为单个 payload 字符串
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) {
      dataLines.push(trimmed.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return [];
  }

  const raw = dataLines.join('\n');
  if (!raw) {
    return [];
  }

  let payload: CanvasWorkflowSSEPayload;
  try {
    payload = JSON.parse(raw) as CanvasWorkflowSSEPayload;
  } catch (err) {
    return [
      {
        type: 'error',
        message: `Failed to parse SSE payload: ${(err as Error).message}`,
      },
    ];
  }

  return mapEventToChunks(payload);
}

/**
 * 按 Constitution Principle IV v1.2.0 映射规则,将 payload 转换为 StreamChunk。
 */
function mapEventToChunks(payload: CanvasWorkflowSSEPayload): StreamChunk[] {
  const { event, data } = payload;

  switch (event) {
    case 'message': {
      const content = data.content ?? '';
      const isThinking = data.start_to_think === true || data.end_to_think === true;
      if (isThinking) {
        const reasoning: StreamReasoning = { type: 'reasoning', content };
        return [reasoning];
      }
      const delta: StreamDelta = { type: 'delta', content };
      return [delta];
    }

    case 'message_end': {
      // 产出空 content delta + reference metadata(Principle III Layer 3 透传)
      const delta: StreamDelta & { metadata?: unknown } = {
        type: 'delta',
        content: data.content ?? '',
      };
      if (data.reference) {
        delta.metadata = { reference: data.reference };
      }
      return [delta];
    }

    case 'workflow_finished': {
      return [{ type: 'done' }];
    }

    case 'workflow_started':
    case 'node_started':
    case 'node_finished':
      // 内部状态,不产出 StreamChunk
      return [];

    default:
      // 未知事件类型,跳过(向前兼容,P3+ 新事件不破坏 P1 解析器)
      return [];
  }
}
