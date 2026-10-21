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
 * 社区版 api_server 词汇归一化(2026-10-16 实证:community adapter.py `_callback`/`_text_cb`
 * + 本机 8642 api_server /v1/runs/{run_id}/events 抓包):
 * 社区版使用独立事件名且无内层 type 字段,与本文件上述企业版词汇不同。归一化映射:
 *   message.delta {delta}                 → StreamDelta(delta 字段兜底,与企业版共用 case)
 *   tool.started {tool, preview}          → StreamToolStart(合成 toolCallId,关联后续 complete)
 *   tool.completed {tool, duration, error}→ StreamToolComplete(按同名 tool 关联最近 start)
 *   tool.failed {tool, ...}               → StreamToolComplete(result.error=true,不中断流)
 *   reasoning.available {text}            → StreamReasoning
 *   subagent_progress {text}              → StreamToolProgress(toolCallId='subagent')
 *   clarify.request {question, choices, clarify_id} → StreamClarifyRequest(与企业版 `clarify` 共用 case)
 *   approval.request {command, description}(无 tool_name/arguments)→ 字段回退
 *   run.failed {error}(无 message 字段)  → 错误消息回退读取 error 字段
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
  // 社区版工具事件无 tool_id,跨帧状态用于合成/关联 toolCallId
  const vocab = createVocabState();

  try {
    while (!sawTerminal) {
      const { done, value } = await reader.read();
      if (done) {
        // 处理 buffer 中剩余帧
        if (buffer.trim()) {
          for (const chunk of parseFrame(buffer, { hasDelta }, vocab)) {
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

        for (const chunk of parseFrame(frame, { hasDelta }, vocab)) {
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
 * 社区版词汇归一化的跨帧状态。
 * 社区版 api_server 工具事件不带 tool_id(tool.started/completed 仅有 tool 名称),
 * 用合成 id 让前端 ToolCallCard 关联 start/complete:同一工具名取最近一次未完成的 start。
 */
interface VocabState {
  /** 合成 id 计数器 */
  toolSeq: number;
  /** 工具名 → 最近一次 tool_start 的合成 id(完成后移除) */
  lastToolIdByName: Map<string, string>;
}

function createVocabState(): VocabState {
  return { toolSeq: 0, lastToolIdByName: new Map<string, string>() };
}

function synthesizeToolId(vocab: VocabState, toolName: string): string {
  vocab.toolSeq += 1;
  const id = `community-tool-${vocab.toolSeq}`;
  vocab.lastToolIdByName.set(toolName, id);
  return id;
}

function correlateToolId(vocab: VocabState, toolName: string): string {
  const existing = toolName
    ? vocab.lastToolIdByName.get(toolName)
    : undefined;
  if (existing) {
    vocab.lastToolIdByName.delete(toolName);
    return existing;
  }
  // 无匹配 start(乱序/丢失):补一个合成 id,前端 onToolComplete 对未知 id 会补建 record
  vocab.toolSeq += 1;
  return `community-tool-${vocab.toolSeq}`;
}

/**
 * 解析单个 SSE 帧。
 *
 * /v1/runs events 帧格式:`data: <json>\n\n`(json 含 `event` 字段)
 * 也兼容 SSE 注释帧(`: keepalive`),静默跳过。
 *
 * @param ctx 解析上下文，包含 hasDelta 标志用于 run.completed 的 output 兜底
 * @param vocab 社区版词汇归一化状态(合成/关联 toolCallId)
 */
function parseFrame(
  frame: string,
  ctx: { hasDelta: boolean },
  vocab: VocabState,
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

  return mapEventToChunks(eventName, data, ctx, vocab);
}

/**
 * 按 Constitution Principle IV v1.3.0 映射规则转换。
 *
 * 注:`message.delta` 和 `tool.progress` 事件用内层 `type` 字段区分子类型,
 * 这是 /v1/runs events 与 legacy chat/stream 的关键差异。
 * 社区版 api_server 的独立事件名(tool.started/reasoning.available 等)在本函数内归一化。
 */
function mapEventToChunks(
  event: string,
  data: Record<string, unknown>,
  ctx: { hasDelta: boolean },
  vocab: VocabState,
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

    // ── 社区版 api_server 独立事件名(无内层 type,载荷见文件头归一化表)──
    case 'tool.started': {
      const toolName =
        (typeof data.tool === 'string' && data.tool) ||
        (typeof data.tool_name === 'string' && data.tool_name) ||
        '';
      if (!toolName) {
        return [];
      }
      return [
        {
          type: 'tool_start',
          toolName,
          toolCallId: synthesizeToolId(vocab, toolName),
          // 社区版无结构化 args,preview 是最佳可用摘要(如 "ls -la")
          args: typeof data.preview === 'string' ? data.preview : data.args,
        },
      ];
    }

    case 'tool.completed':
    case 'tool.failed': {
      const toolName =
        (typeof data.tool === 'string' && data.tool) ||
        (typeof data.tool_name === 'string' && data.tool_name) ||
        '';
      const failed = event === 'tool.failed' || data.error === true;
      // 单个工具失败不等于 run 失败:映射为带错误标记的 complete,让流继续
      return [
        {
          type: 'tool_complete',
          toolCallId: correlateToolId(vocab, toolName),
          result: failed
            ? {
                error: true,
                ...(typeof data.preview === 'string'
                  ? { preview: data.preview }
                  : {}),
              }
            : data.result,
        },
      ];
    }

    case 'reasoning.available': {
      const text = typeof data.text === 'string' ? data.text : '';
      if (!text) {
        return [];
      }
      return [{ type: 'reasoning', content: text }];
    }

    case 'subagent_progress': {
      const text =
        (typeof data.text === 'string' && data.text) ||
        (typeof data.tool === 'string' && data.tool) ||
        '';
      if (!text) {
        return [];
      }
      // 固定合成 id:前端 onToolProgress 对未匹配 id 会补建 record,进度文本随之累积
      return [
        {
          type: 'tool_progress',
          toolName: 'subagent',
          toolCallId: 'subagent',
          content: text,
        },
      ];
    }

    case 'approval.request': {
      // 社区版载荷无 tool_name/arguments,回退 command(命令串)/description(人读摘要)
      const toolName =
        (typeof data.tool_name === 'string' && data.tool_name) ||
        (typeof data.command === 'string' && data.command) ||
        '';
      // intellect-team 透传 arguments 为原始 JSON 字符串
      const args =
        (typeof data.arguments === 'string' && data.arguments) ||
        (typeof data.description === 'string' && data.description) ||
        '';
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

    case 'clarify':
    case 'clarify.request': {
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
          // P1-4 防御性透传:/v1/runs 契约当前无 context_length,网关若补发则自动生效
          ...(typeof usage.context_length === 'number'
            ? { contextLength: usage.context_length }
            : {}),
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
      // 社区版把错误文本放在 error 字段(实测抓包),企业版为 message
      const message =
        (typeof data.message === 'string' && data.message) ||
        (typeof data.error === 'string' && data.error) ||
        `run ${event === 'run.failed' ? 'failed' : 'cancelled'}`;
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
