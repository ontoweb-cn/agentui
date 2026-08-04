// @see specs/001-multi-harness-p0/contracts/stream-chunk.ts (authority source)
/**
 * parseOpenAISSE — OpenAI 兼容 SSE 解析器。
 *
 * Authority source: specs/001-multi-harness-p0/contracts/stream-chunk.ts
 * Runtime: bff/src/services/adapters/shared/sse-parser.ts
 *
 * Constitution references (v1.2.0):
 * - Principle IV (SSE Dual-Protocol): OpenAI 兼容 SSE → StreamChunk
 *   适用于 intellect-community / hermes / agent-scope 三个 OpenAI 兼容后端
 *   (v8.3 评审 D5 修复:KAG 移出,改 mcp-protocol,见 spec-012)
 *
 * 事件映射(OpenAI /v1/chat/completions stream 格式):
 *   data: {"choices":[{"delta":{"content":"..."}}]}            → StreamDelta
 *   data: {"choices":[{"delta":{"reasoning_content":"..."}}]}   → StreamReasoning
 *   data: {"choices":[{"delta":{"tool_calls":[...]}}]}          → StreamToolStart / StreamToolProgress
 *   data: {"choices":[{"finish_reason":"tool_calls"}]}          → StreamToolComplete(每个已跟踪工具)
 *   data: {"choices":[{"finish_reason":"stop"}]}                → (internal, 延迟 done)
 *   data: {"usage":{...}}                                       → StreamUsage(延迟发射)
 *   data: [DONE]                                                → StreamDone(终止信号)
 *   non-200 / parse failure                                     → StreamError
 *
 * M1 修正: finish_reason 不立即 return,延迟 done chunk 确保 usage 不丢失。
 * OpenAI 格式中 usage 可能紧跟在 finish_reason chunk 之后单独发送
 * (当 stream_options.include_usage=true 时)。本解析器在收到 [DONE] 或流自然结束时,
 * 先发射 pending usage chunk(如有),再发射 done chunk。
 *
 * 实现策略:无外部依赖,用 ReadableStream + TextDecoder 手动解析 SSE 帧。
 * SSE 帧以 `\n\n` 分隔,每帧含 `data: <json>` 行(与 parseCanvasWorkflowSSE 一致)。
 */

import type { StreamChunk, StreamIterable, TokenUsage } from '../../../types/stream';

/** OpenAI SSE chunk 的 JSON 结构(仅声明解析用到的字段) */
interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** 已跟踪的工具调用(按 index 索引,用于 finish_reason=tool_calls 时发射 tool_complete) */
interface TrackedToolCall {
  toolCallId: string;
  toolName: string;
}

/**
 * 将 OpenAI 兼容 SSE 字节流转换为 StreamChunk 迭代器。
 *
 * @param stream 上游 /v1/chat/completions 的响应流(response.body)
 * @returns StreamChunk 迭代器,以 StreamDone 或 StreamError 终止
 */
export async function* parseOpenAISSE(
  stream: ReadableStream<Uint8Array>,
): StreamIterable {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // M1: 延迟状态,确保 usage 不丢失
  let pendingUsage: TokenUsage | null = null;
  // 已跟踪的工具调用(index → info),finish_reason=tool_calls 时发射 tool_complete
  const trackedTools = new Map<number, TrackedToolCall>();
  let sawDone = false;

  try {
    while (!sawDone) {
      const { done, value } = await reader.read();
      if (done) {
        // 处理 buffer 中剩余的不完整帧
        if (buffer.trim()) {
          for (const chunk of parseFrame(buffer, trackedTools)) {
            if (chunk.type === 'usage') {
              pendingUsage = chunk.usage;
              continue;
            }
            if (chunk.type === 'done') {
              // M1: done 前发射暂存的 usage
              if (pendingUsage) {
                yield { type: 'usage', usage: pendingUsage };
                pendingUsage = null;
              }
              yield chunk;
              sawDone = true;
              break;
            }
            yield chunk;
          }
        }
        // 流自然结束但未见 [DONE]:发射延迟的 usage + done(M1 修正)
        if (!sawDone) {
          if (pendingUsage) {
            yield { type: 'usage', usage: pendingUsage };
            pendingUsage = null;
          }
          yield { type: 'done' };
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      // SSE 帧以 \n\n 分隔
      let frameEnd: number;
      while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);

        for (const chunk of parseFrame(frame, trackedTools)) {
          // M1: usage 不立即发射,暂存待 done 时一并发射
          if (chunk.type === 'usage') {
            pendingUsage = chunk.usage;
            continue;
          }
          if (chunk.type === 'done') {
            // M1: done 前发射暂存的 usage
            if (pendingUsage) {
              yield { type: 'usage', usage: pendingUsage };
              pendingUsage = null;
            }
            yield chunk;
            sawDone = true;
            break;
          }
          yield chunk;
          if (chunk.type === 'error') {
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
 * 解析单个 SSE 帧,提取 `data:` 行并转换为 StreamChunk。
 *
 * @param frame 单个 SSE 帧(不含尾随 \n\n)
 * @param trackedTools 已跟踪工具调用 Map(会被 mutate,用于跨帧关联 tool_complete)
 */
function parseFrame(
  frame: string,
  trackedTools: Map<number, TrackedToolCall>,
): StreamChunk[] {
  // 提取所有 data: 行,合并为单个 payload(OpenAI 通常单行,但合并更稳健)
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

  // [DONE] 哨兵 → 返回 done 信号(pending usage 由调用方在 done 前发射,M1 修正)
  if (raw === '[DONE]') {
    return [{ type: 'done' }];
  }

  let payload: OpenAIStreamChunk;
  try {
    payload = JSON.parse(raw) as OpenAIStreamChunk;
  } catch (err) {
    return [
      {
        type: 'error',
        message: `Failed to parse SSE payload: ${(err as Error).message}`,
      },
    ];
  }

  return mapChunkToStreams(payload, trackedTools);
}

/**
 * 将 OpenAI chunk 映射为 StreamChunk 数组。
 *
 * M1 修正: finish_reason 不立即触发 done,仅记录状态。
 * usage 单独返回由调用方暂存,在 [DONE] 或流结束时发射。
 */
function mapChunkToStreams(
  payload: OpenAIStreamChunk,
  trackedTools: Map<number, TrackedToolCall>,
): StreamChunk[] {
  const chunks: StreamChunk[] = [];

  // 处理 usage(OpenAI 在 stream_options.include_usage=true 时单独发送)
  if (payload.usage) {
    chunks.push({
      type: 'usage',
      usage: {
        promptTokens:
          typeof payload.usage.prompt_tokens === 'number'
            ? payload.usage.prompt_tokens
            : 0,
        completionTokens:
          typeof payload.usage.completion_tokens === 'number'
            ? payload.usage.completion_tokens
            : 0,
      },
    });
  }

  const choice = payload.choices?.[0];
  if (choice) {
    // 处理 delta
    if (choice.delta) {
      // 文本增量
      if (choice.delta.content) {
        chunks.push({ type: 'delta', content: choice.delta.content });
      }

      // 思考链增量(DeepSeek / 某些 OpenAI 兼容后端的 reasoning_content)
      if (choice.delta.reasoning_content) {
        chunks.push({
          type: 'reasoning',
          content: choice.delta.reasoning_content,
        });
      }

      // 工具调用增量
      if (choice.delta.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const hasName = typeof tc.function?.name === 'string' && tc.function.name;
          const hasArgs = typeof tc.function?.arguments === 'string' && tc.function.arguments;

          if (hasName) {
            // tool_start: 首次出现 function.name
            const toolCallId = tc.id ?? `call_${tc.index}`;
            const toolName = tc.function!.name!;
            trackedTools.set(tc.index, { toolCallId, toolName });
            chunks.push({
              type: 'tool_start',
              toolName,
              toolCallId,
            });
          }

          if (hasArgs) {
            // tool_progress: 参数流式增量(OpenAI 分批发送 arguments)
            const tracked = trackedTools.get(tc.index);
            chunks.push({
              type: 'tool_progress',
              toolName: tracked?.toolName ?? '',
              toolCallId: tracked?.toolCallId,
              content: tc.function!.arguments!,
            });
          }
        }
      }
    }

    // 处理 finish_reason(M1: 不立即发射 done)
    if (choice.finish_reason) {
      if (choice.finish_reason === 'tool_calls') {
        // 所有已跟踪的工具调用完成
        for (const tracked of trackedTools.values()) {
          chunks.push({
            type: 'tool_complete',
            toolCallId: tracked.toolCallId,
          });
        }
      }
      // M1: finish_reason 不发射 done,延迟到 [DONE] 或流结束
      // (usage 可能紧跟在 finish_reason 之后发送)
    }
  }

  return chunks;
}
