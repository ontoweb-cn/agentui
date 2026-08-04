// @see specs/004-intellect-enterprise-adapter/contracts/intellect-enterprise-sse-mapping.ts
/**
 * parseIntellectEnterpriseRunEventsSSE — Intellect 企业版 /v1/runs/{run_id}/events SSE 解析器。
 *
 * Constitution references (v1.3.0):
 * - Principle IV (SSE Dual-Protocol): /v1/runs/{run_id}/events 走 `data: <json with event field>` 格式
 *   禁止复用 parseIntellectEnterpriseSSE(legacy chat/stream 用 `event: <name>\ndata: <json>` 格式)
 * - Principle VIII (BFF ↔ Intellect Enterprise Access Contract): v1.3.0 主通道
 *
 * 事件映射(从 intellect-team `api_server.rs:handle_run_events` + `map_event_to_sse` 实证,v1.3.0 新增):
 *   run.started                          → (internal, not emitted)
 *   message.delta + type:"assistant.delta" → StreamDelta
 *   message.delta + type:"reasoning.delta" → StreamReasoning
 *   tool.progress + type:"tool.started"   → StreamToolStart(tool_id 作为 toolCallId)
 *   tool.progress + type:"tool.completed" → StreamToolComplete
 *   approval.request                      → StreamApprovalRequest
 *   approval.responded                    → StreamApprovalResponded
 *   clarify                               → StreamClarifyRequest(v1.4.0 防御性解析,主要通道为 /v1/chat/completions)
 *   run.completed                         → StreamUsage 后接 StreamDone
 *   run.failed / run.cancelled            → StreamError(带 message)
 *   error                                 → StreamError
 *   lagged                                → (internal, not emitted)
 *   : keepalive                           → (internal, SSE 注释心跳)
 *
 * SSE 帧格式(与 legacy chat/stream 不同):
 *   `data: {"event":"<name>","run_id":"...","timestamp":<f64>,...payload}\n\n`
 *   (无独立 `event:` 行,事件名嵌入 JSON `event` 字段)
 *
 * 容错策略(与 parseIntellectEnterpriseSSE 一致):
 * - JSON 解析失败:console.warn + 跳过该帧,不中断流
 * - 未知事件:console.warn + 跳过,不中断流
 * - 流提前断开(无终态事件):产出 StreamError('stream interrupted')
 * - 终态事件(run.completed/run.failed/run.cancelled)后 SSE 流自动关闭
 */

import type { StreamChunk, StreamIterable } from '../../../types/stream';

/**
 * 解析 intellect-team /v1/runs/{run_id}/events 的 SSE 流。
 *
 * 与 parseIntellectEnterpriseSSE(legacy)的差异:
 * 1. 帧格式:无独立 `event:` 行,事件名在 JSON `event` 字段
 * 2. 事件名:用 `message.delta`(含内层 `type` 区分子类型)替代 `assistant.delta`
 * 3. 新增 `approval.request` / `approval.responded` 事件
 * 4. 终态事件:`run.completed` / `run.failed` / `run.cancelled`(无独立 `done` 事件)
 */
export async function* parseIntellectEnterpriseRunEventsSSE(
  stream: ReadableStream<Uint8Array>,
): StreamIterable {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawTerminal = false;
  let producedAny = false;
  let hasDelta = false;

  try {
    while (!sawTerminal) {
      const { done, value } = await reader.read();
      if (done) {
        // 处理 buffer 中剩余帧
        if (buffer.trim()) {
          for (const chunk of parseFrame(buffer, { hasDelta })) {
            yield chunk;
            producedAny = true;
            if (chunk.type === 'delta') hasDelta = true;
            if (isTerminalChunk(chunk)) {
              sawTerminal = true;
              break;
            }
          }
        }
        // 流自然结束但未见终态事件 → 产出 error(Constitution Principle IV 容错)
        if (!sawTerminal && producedAny) {
          yield { type: 'error', message: 'stream interrupted: no terminal event' };
        } else if (!sawTerminal && !producedAny) {
          // 整个流无任何产出,也产出 error(避免前端无限等待)
          yield { type: 'error', message: 'stream interrupted: empty stream' };
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let frameEnd: number;
      while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);

        for (const chunk of parseFrame(frame, { hasDelta })) {
          yield chunk;
          producedAny = true;
          if (chunk.type === 'delta') hasDelta = true;
          if (isTerminalChunk(chunk)) {
            sawTerminal = true;
            break;
          }
        }
        if (sawTerminal) break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 判断 chunk 是否为终态(done / error)。
 * /v1/runs events 的终态事件(run.completed/run.failed/run.cancelled)映射为 done/error。
 */
function isTerminalChunk(chunk: StreamChunk): boolean {
  return chunk.type === 'done' || chunk.type === 'error';
}

/**
 * 解析单个 SSE 帧。
 *
 * /v1/runs events 帧格式:`data: <json>\n\n`(json 含 `event` 字段)
 * 也兼容 SSE 注释帧(`: keepalive`),静默跳过。
 *
 * @param ctx 解析上下文，包含 hasDelta 标志用于 run.completed 的 output 兜底
 */
function parseFrame(
  frame: string,
  ctx: { hasDelta: boolean },
): StreamChunk[] {
  const lines = frame.split('\n');
  const dataLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // SSE 注释帧(`: keepalive\n\n`)跳过
    if (trimmed.startsWith(':')) {
      continue;
    }
    if (trimmed.startsWith('data:')) {
      const dataContent = trimmed.slice(5).trimStart();
      // Gateway 用 axum `.data(": keepalive")` 发送 keepalive,
      // 实际生成 `data: : keepalive\n\n`(不是注释帧 `: keepalive\n\n`)。
      // data 内容以 ':' 开头视为 keepalive/stream closed 等控制帧,跳过。
      if (dataContent.startsWith(':')) {
        continue;
      }
      dataLines.push(dataContent);
    }
  }

  if (dataLines.length === 0) {
    return [];
  }

  const raw = dataLines.join('\n');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.warn(
      `[parseIntellectEnterpriseRunEventsSSE] JSON parse failed: ${(err as Error).message}`,
    );
    return [];
  }

  const eventName = typeof data.event === 'string' ? data.event : '';
  if (!eventName) {
    console.warn(
      '[parseIntellectEnterpriseRunEventsSSE] frame missing "event" field, skipping',
    );
    return [];
  }

  return mapEventToChunks(eventName, data, ctx);
}

/**
 * 按 Constitution Principle IV v1.3.0 映射规则转换。
 *
 * 注:`message.delta` 和 `tool.progress` 事件用内层 `type` 字段区分子类型,
 * 这是 /v1/runs events 与 legacy chat/stream 的关键差异。
 */
function mapEventToChunks(
  event: string,
  data: Record<string, unknown>,
  ctx: { hasDelta: boolean },
): StreamChunk[] {
  switch (event) {
    case 'run.started':
    case 'lagged':
      // 内部状态,不产出
      return [];

    case 'message.delta': {
      const innerType = typeof data.type === 'string' ? data.type : '';
      // Gateway 实际返回 text 字段（兼容旧版 delta 字段名）
      const delta =
        (typeof data.text === 'string' && data.text) ||
        (typeof data.delta === 'string' && data.delta) ||
        '';
      if (innerType === 'reasoning.delta') {
        return [{ type: 'reasoning', content: delta }];
      }
      // 默认 assistant.delta
      return [{ type: 'delta', content: delta }];
    }

    case 'tool.progress': {
      const innerType = typeof data.type === 'string' ? data.type : '';
      const toolId = typeof data.tool_id === 'string' ? data.tool_id : '';
      // Gateway 实际返回 name 字段（兼容旧版 tool_name 字段名）
      const toolName =
        (typeof data.name === 'string' && data.name) ||
        (typeof data.tool_name === 'string' && data.tool_name) ||
        '';

      if (innerType === 'tool.started') {
        return [
          {
            type: 'tool_start',
            toolName,
            toolCallId: toolId,
            args: data.arguments,
          },
        ];
      }
      if (innerType === 'tool.completed') {
        return [
          {
            type: 'tool_complete',
            toolCallId: toolId,
            result: data.result,
          },
        ];
      }
      // 未知 tool.progress 子类型,跳过
      console.warn(
        `[parseIntellectEnterpriseRunEventsSSE] unknown tool.progress type: ${innerType}, skipping`,
      );
      return [];
    }

    case 'approval.request': {
      const toolName = typeof data.tool_name === 'string' ? data.tool_name : '';
      // intellect-team 透传 arguments 为原始 JSON 字符串
      const args = typeof data.arguments === 'string' ? data.arguments : '';
      const runId = typeof data.run_id === 'string' ? data.run_id : '';
      // choices 默认 4 个选项
      const rawChoices = Array.isArray(data.choices) ? data.choices : [];
      const choices = rawChoices.filter(
        (c): c is 'once' | 'session' | 'always' | 'deny' =>
          c === 'once' || c === 'session' || c === 'always' || c === 'deny',
      );
      return [
        {
          type: 'approval_request',
          toolName,
          arguments: args,
          choices: choices.length > 0 ? choices : ['once', 'session', 'always', 'deny'],
          runId,
        },
      ];
    }

    case 'approval.responded': {
      const runId = typeof data.run_id === 'string' ? data.run_id : '';
      const choice = data.choice;
      const resolved = typeof data.resolved === 'number' ? data.resolved : 0;
      // choice 校验
      if (
        choice !== 'once' &&
        choice !== 'session' &&
        choice !== 'always' &&
        choice !== 'deny'
      ) {
        console.warn(
          `[parseIntellectEnterpriseRunEventsSSE] invalid approval choice: ${String(choice)}, skipping`,
        );
        return [];
      }
      return [{ type: 'approval_responded', choice, resolved, runId }];
    }

    case 'clarify': {
      // v1.4.0: clarify 工具事件(Gateway set_clarify_fn 注入)。
      // BFF 通过 /v1/runs/{run_id}/events 通道接收 SSE 流(不走 /v1/chat/completions 通道),
      // 因此 Intellect-Team 必须在 /v1/runs handler 注入 clarify_fn,BFF 才能收到 clarify 事件。
      // 若 clarify_fn 仅在 /v1/chat/completions handler 注入,BFF 永远收不到 clarify 事件。
      // 字段:question / choices / clarify_id,session_id 优先取顶层,缺失时从 clarify_id 中切分。
      const question = typeof data.question === 'string' ? data.question : '';
      const clarifyId =
        typeof data.clarify_id === 'string' ? data.clarify_id : '';
      const rawChoices = Array.isArray(data.choices) ? data.choices : [];
      const choices = rawChoices
        .filter((c): c is string => typeof c === 'string')
        .map((c) => c);
      const sessionId =
        typeof data.session_id === 'string'
          ? data.session_id
          : clarifyId.split(':')[0];
      // 缺关键字段(question 或 clarify_id)时产出 error chunk,让前端能清理 pending 状态。
      // (clarify 是需要前端交互的关键事件,不能静默跳过,否则前端会无限等待)
      if (!question || !clarifyId) {
        console.warn(
          `[parseIntellectEnterpriseRunEventsSSE] clarify event missing question or clarify_id, skipping`,
        );
        return [
          {
            type: 'error',
            message: 'clarify event missing required field (question or clarify_id)',
          },
        ];
      }
      return [
        {
          type: 'clarify_request',
          question,
          choices,
          clarifyId,
          sessionId,
        },
      ];
    }

    case 'run.completed': {
      const usage = (data.usage as Record<string, unknown>) ?? {};
      const output = data.output;
      // Gateway 返回 input_tokens/output_tokens（兼容 prompt_tokens/completion_tokens）
      // 注意:使用三元运算符而非 && 短路,避免 0 值被误判为 falsy 而跳过
      const promptTokens =
        typeof usage.input_tokens === 'number' ? usage.input_tokens :
        typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
      const completionTokens =
        typeof usage.output_tokens === 'number' ? usage.output_tokens :
        typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
      const usageChunk: StreamChunk = {
        type: 'usage',
        usage: {
          promptTokens,
          completionTokens,
        },
      };
      // 若 run.completed 带 error 字段,产出 error 而非 done
      const errorMsg = typeof data.error === 'string' ? data.error : '';
      if (errorMsg) {
        return [
          usageChunk,
          { type: 'error', message: errorMsg, details: output },
        ];
      }
      // 兜底:若整条流未产出任何 delta(如 Gateway 缓存命中只发 run.completed),
      // 将 output 作为最终内容产出,避免前端看到流结束但无内容。
      if (!ctx.hasDelta && typeof output === 'string' && output) {
        return [
          { type: 'delta', content: output },
          usageChunk,
          { type: 'done' },
        ];
      }
      // run.completed → usage 后接 done
      return [usageChunk, { type: 'done' }];
    }

    case 'run.failed':
    case 'run.cancelled': {
      const message =
        typeof data.message === 'string'
          ? data.message
          : `run ${event === 'run.failed' ? 'failed' : 'cancelled'}`;
      return [{ type: 'error', message }];
    }

    case 'error': {
      const message =
        typeof data.message === 'string' ? data.message : 'unknown error';
      return [{ type: 'error', message, details: data }];
    }

    default:
      console.warn(
        `[parseIntellectEnterpriseRunEventsSSE] unknown event: ${event}, skipping`,
      );
      return [];
  }
}
