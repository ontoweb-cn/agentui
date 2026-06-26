// @see specs/004-intellect-enterprise-adapter/contracts/intellect-enterprise-sse-mapping.ts
/**
 * parseIntellectEnterpriseSSE — Intellect 企业版(intellect-team)SSE 解析器。
 *
 * Authority source: specs/004-intellect-enterprise-adapter/contracts/intellect-enterprise-sse-mapping.ts
 * Runtime: bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-sse.ts
 *
 * Constitution references (v1.2.0):
 * - Principle IV (SSE Dual-Protocol): Intellect 企业版自定义事件 SSE → StreamChunk
 *   禁止复用 parseCanvasWorkflowSSE / parseOpenAISSE
 * - Principle VIII (BFF ↔ Intellect Enterprise Access Contract):
 *   解析 /api/sessions/{id}/chat/stream 主通道的 SSE 流
 *
 * 事件映射(从 intellect-team adapter.py:1711-1762 实证,禁止臆造):
 *   run.started                → (internal, not emitted)
 *   message.started            → (internal, not emitted)
 *   assistant.delta            → StreamDelta
 *   tool.progress(_thinking)   → StreamReasoning
 *   tool.progress(other)       → StreamToolProgress
 *   tool.started               → StreamToolStart
 *   tool.completed             → StreamToolComplete
 *   tool.failed                → StreamToolComplete(with error)
 *   run.completed              → StreamUsage 后接 StreamDone
 *   error                      → StreamError
 *   done                       → (terminal,关闭迭代器)
 *
 * 容错策略(与 P1 parseCanvasWorkflowSSE 一致):
 * - JSON 解析失败:console.warn + 跳过该帧,不中断流
 * - 未知事件:console.warn + 跳过,不中断流
 * - 流提前断开(无 done):产出 StreamError('stream interrupted')
 *
 * SSE 帧格式: `event: <name>\ndata: <json>\n\n`
 * (不同于 Intellect RAG Canvas Workflow 的纯 data: {event:...})
 */

import type { StreamChunk, StreamIterable } from '../../../types/stream';

/**
 * 解析 intellect-team /api/sessions/{id}/chat/stream 的 SSE 流。
 */
export async function* parseIntellectEnterpriseSSE(
  stream: ReadableStream<Uint8Array>,
): StreamIterable {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;
  let producedAny = false;

  try {
    while (!sawDone) {
      const { done, value } = await reader.read();
      if (done) {
        // 处理 buffer 中剩余帧
        if (buffer.trim()) {
          for (const chunk of parseFrame(buffer)) {
            yield chunk;
            producedAny = true;
            if (chunk.type === 'done') {
              sawDone = true;
              break;
            }
          }
        }
        // 流自然结束但未见 done 事件 → 产出 error(Constitution Principle IV 容错)
        if (!sawDone && producedAny) {
          yield { type: 'error', message: 'stream interrupted: no done event' };
        } else if (!sawDone && !producedAny) {
          // 整个流无任何产出,也产出 error(避免前端无限等待)
          yield { type: 'error', message: 'stream interrupted: empty stream' };
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let frameEnd: number;
      while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);

        for (const chunk of parseFrame(frame)) {
          yield chunk;
          producedAny = true;
          if (chunk.type === 'done') {
            sawDone = true;
            break;
          }
        }
        if (sawDone) break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 解析单个 SSE 帧(`event: <name>\ndata: <json>` 格式)。
 */
function parseFrame(frame: string): StreamChunk[] {
  let eventName = '';
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('event:')) {
      eventName = trimmed.slice(6).trim();
    } else if (trimmed.startsWith('data:')) {
      dataLines.push(trimmed.slice(5).trimStart());
    }
  }

  if (!eventName) {
    return [];
  }

  const raw = dataLines.join('\n');
  let data: Record<string, unknown> = {};
  if (raw) {
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      console.warn(
        `[parseIntellectEnterpriseSSE] JSON parse failed for event "${eventName}": ${(err as Error).message}`,
      );
      return [];
    }
  }

  return mapEventToChunks(eventName, data);
}

/**
 * 按 Constitution Principle IV v1.2.0 映射规则转换。
 */
function mapEventToChunks(
  event: string,
  data: Record<string, unknown>,
): StreamChunk[] {
  switch (event) {
    case 'run.started':
    case 'message.started':
      // 内部状态,不产出
      return [];

    case 'assistant.delta': {
      const delta = typeof data.delta === 'string' ? data.delta : '';
      return [{ type: 'delta', content: delta }];
    }

    case 'tool.progress': {
      const toolName = typeof data.tool_name === 'string' ? data.tool_name : '';
      const delta = typeof data.delta === 'string' ? data.delta : '';
      if (toolName === '_thinking') {
        return [{ type: 'reasoning', content: delta }];
      }
      return [
        {
          type: 'tool_progress',
          toolName,
          content: delta,
        },
      ];
    }

    case 'tool.started': {
      const toolName = typeof data.tool_name === 'string' ? data.tool_name : '';
      return [
        {
          type: 'tool_start',
          toolName,
          toolCallId: typeof data.message_id === 'string' ? data.message_id : '',
          args: data.args,
        },
      ];
    }

    case 'tool.completed': {
      const toolName = typeof data.tool_name === 'string' ? data.tool_name : '';
      return [
        {
          type: 'tool_complete',
          toolCallId: typeof data.message_id === 'string' ? data.message_id : '',
          result: data.result,
        },
      ];
    }

    case 'tool.failed': {
      const errorMsg = typeof data.error === 'string' ? data.error : 'tool failed';
      // Principle IV (stream.ts 注释):tool.failed → StreamError with toolCallId
      return [
        {
          type: 'error',
          message: `tool ${typeof data.tool_name === 'string' ? data.tool_name : ''} failed: ${errorMsg}`,
          toolCallId: typeof data.message_id === 'string' ? data.message_id : undefined,
        },
      ];
    }

    case 'run.completed': {
      const usage = (data.usage as Record<string, unknown>) ?? {};
      const usageChunk: StreamChunk = {
        type: 'usage',
        usage: {
          promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
          completionTokens:
            typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
        },
      };
      // run.completed → usage 后接 done
      return [usageChunk, { type: 'done' }];
    }

    case 'error': {
      const message =
        typeof data.message === 'string' ? data.message : 'unknown error';
      return [{ type: 'error', message }];
    }

    case 'done':
      // 终止信号,关闭迭代器
      return [{ type: 'done' }];

    default:
      console.warn(
        `[parseIntellectEnterpriseSSE] unknown event: ${event}, skipping`,
      );
      return [];
  }
}
