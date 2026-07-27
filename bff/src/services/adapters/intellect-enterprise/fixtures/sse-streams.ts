// Multi-Harness P3 US3:SSE fixture 数据(录制 intellect-team /api/sessions/{id}/chat/stream)。
// Constitution Principle IV (v1.2.0):事件名从 adapter.py:1711-1762 实证。

/**
 * intellect-team SSE 帧格式: `event: <name>\ndata: <json>\n\n`
 * 不同于 Intellect RAG Canvas Workflow(纯 data: {event:...})
 */

/** 将 SSE 文本帧编码为 Uint8Array(模拟 ReadableStream chunk) */
export function encodeSSE(frames: string[]): Uint8Array[] {
  return frames.map((f) => new TextEncoder().encode(f));
}

/** 构造完整 SSE 流的 Uint8Array 数组 */
export function makeStream(frames: string[]): Uint8Array[] {
  return encodeSSE(frames);
}

// ---------------------------------------------------------------------------
// Fixture 1: 完整正常流(delta + reasoning + usage + done)
// ---------------------------------------------------------------------------

export const fullConversationFrames = [
  'event: run.started\ndata: {"user_message":{"role":"user","content":"你好"}}\n\n',
  'event: message.started\ndata: {"message":{"id":"msg-1","role":"assistant"}}\n\n',
  'event: tool.progress\ndata: {"message_id":"msg-1","tool_name":"_thinking","delta":"思考中"}\n\n',
  'event: assistant.delta\ndata: {"message_id":"msg-1","delta":"你好"}\n\n',
  'event: assistant.delta\ndata: {"message_id":"msg-1","delta":"!"}\n\n',
  'event: run.completed\ndata: {"session_id":"sess-1","message_id":"msg-1","completed":true,"messages":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
  'event: done\ndata: {}\n\n',
];

// ---------------------------------------------------------------------------
// Fixture 2: 工具调用流(tool.started + tool.progress + tool.completed)
// ---------------------------------------------------------------------------

export const toolCallFrames = [
  'event: run.started\ndata: {"user_message":{"role":"user","content":"读文件"}}\n\n',
  'event: message.started\ndata: {"message":{"id":"msg-2","role":"assistant"}}\n\n',
  'event: tool.started\ndata: {"message_id":"msg-2","tool_name":"read_file","args":{"path":"/a.txt"}}\n\n',
  'event: tool.progress\ndata: {"message_id":"msg-2","tool_name":"read_file","delta":"读取中"}\n\n',
  'event: tool.completed\ndata: {"message_id":"msg-2","tool_name":"read_file","result":"文件内容"}\n\n',
  'event: assistant.delta\ndata: {"message_id":"msg-2","delta":"完成"}\n\n',
  'event: run.completed\ndata: {"session_id":"sess-2","message_id":"msg-2","completed":true,"messages":[],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n',
  'event: done\ndata: {}\n\n',
];

// ---------------------------------------------------------------------------
// Fixture 3: 工具失败流(tool.failed)
// ---------------------------------------------------------------------------

export const toolFailedFrames = [
  'event: run.started\ndata: {"user_message":{"role":"user","content":"x"}}\n\n',
  'event: message.started\ndata: {"message":{"id":"msg-3","role":"assistant"}}\n\n',
  'event: tool.started\ndata: {"message_id":"msg-3","tool_name":"read_file","args":{}}\n\n',
  'event: tool.failed\ndata: {"message_id":"msg-3","tool_name":"read_file","error":"文件不存在"}\n\n',
  'event: run.completed\ndata: {"session_id":"sess-3","message_id":"msg-3","completed":true,"messages":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
  'event: done\ndata: {}\n\n',
];

// ---------------------------------------------------------------------------
// Fixture 4: 错误流(error 事件)
// ---------------------------------------------------------------------------

export const errorFrames = [
  'event: run.started\ndata: {"user_message":{"role":"user","content":"x"}}\n\n',
  'event: error\ndata: {"message":"内部错误"}\n\n',
  'event: done\ndata: {}\n\n',
];

// ---------------------------------------------------------------------------
// Fixture 5: JSON 解析失败帧(容错测试)
// ---------------------------------------------------------------------------

export const malformedFrames = [
  'event: assistant.delta\ndata: {invalid json}\n\n',
  'event: assistant.delta\ndata: {"message_id":"msg-1","delta":"正常"}\n\n',
  'event: done\ndata: {}\n\n',
];

// ---------------------------------------------------------------------------
// Fixture 6: 未知事件(容错测试)
// ---------------------------------------------------------------------------

export const unknownEventFrames = [
  'event: unknown.future.event\ndata: {"foo":"bar"}\n\n',
  'event: assistant.delta\ndata: {"message_id":"msg-1","delta":"ok"}\n\n',
  'event: done\ndata: {}\n\n',
];

// ---------------------------------------------------------------------------
// Fixture 7: 无 done 事件,流自然结束(ReadableStream close)
// ---------------------------------------------------------------------------

export const streamClosedPrematurelyFrames = [
  'event: assistant.delta\ndata: {"message_id":"msg-1","delta":"部分内容"}\n\n',
  // 无 done,流直接 close
];

// ===========================================================================
// /v1/runs/{run_id}/events fixtures (v1.3.0 主通道,parseIntellectEnterpriseRunEventsSSE)
// ===========================================================================
//
// SSE 帧格式(与 legacy chat/stream 不同):
//   `data: {"event":"<name>","run_id":"...","timestamp":<f64>,...payload}\n\n`
//   (无独立 `event:` 行,事件名嵌入 JSON `event` 字段)
//
// 从 intellect-team `api_server.rs:handle_run_events` + `map_event_to_sse` 实证。

/**
 * 构造 /v1/runs events SSE 帧(data: <json>\n\n 格式)。
 */
export function runEventFrame(event: string, payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ event, ...payload })}\n\n`;
}

// ---------------------------------------------------------------------------
// Fixture 8: /v1/runs 完整正常流(reasoning + delta + usage + done)
// ---------------------------------------------------------------------------

export const runEventsFullConversationFrames = [
  runEventFrame('run.started', { run_id: 'run-1', timestamp: 1.0 }),
  runEventFrame('message.delta', {
    run_id: 'run-1',
    timestamp: 1.1,
    type: 'reasoning.delta',
    delta: '思考中',
  }),
  runEventFrame('message.delta', {
    run_id: 'run-1',
    timestamp: 1.2,
    type: 'assistant.delta',
    delta: '你好',
  }),
  runEventFrame('message.delta', {
    run_id: 'run-1',
    timestamp: 1.3,
    type: 'assistant.delta',
    delta: '!',
  }),
  runEventFrame('run.completed', {
    run_id: 'run-1',
    timestamp: 2.0,
    output: '你好!',
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }),
];

// ---------------------------------------------------------------------------
// Fixture 9: /v1/runs 工具调用流(tool.started + tool.completed)
// ---------------------------------------------------------------------------

export const runEventsToolCallFrames = [
  runEventFrame('run.started', { run_id: 'run-2', timestamp: 1.0 }),
  runEventFrame('tool.progress', {
    run_id: 'run-2',
    timestamp: 1.1,
    type: 'tool.started',
    tool_id: 'tool-abc',
    tool_name: 'read_file',
    arguments: { path: '/a.txt' },
  }),
  runEventFrame('tool.progress', {
    run_id: 'run-2',
    timestamp: 1.2,
    type: 'tool.completed',
    tool_id: 'tool-abc',
    tool_name: 'read_file',
    result: '文件内容',
    duration_s: 0.5,
  }),
  runEventFrame('message.delta', {
    run_id: 'run-2',
    timestamp: 1.3,
    type: 'assistant.delta',
    delta: '完成',
  }),
  runEventFrame('run.completed', {
    run_id: 'run-2',
    timestamp: 2.0,
    output: '完成',
    usage: { prompt_tokens: 5, completion_tokens: 3 },
  }),
];

// ---------------------------------------------------------------------------
// Fixture 10: /v1/runs 审批流(approval.request + approval.responded)
// ---------------------------------------------------------------------------

export const runEventsApprovalFrames = [
  runEventFrame('run.started', { run_id: 'run-3', timestamp: 1.0 }),
  runEventFrame('approval.request', {
    run_id: 'run-3',
    timestamp: 1.1,
    tool_name: 'bash',
    arguments: JSON.stringify({ command: 'rm -rf /tmp/test' }),
    choices: ['once', 'session', 'always', 'deny'],
  }),
  // 用户提交审批后
  runEventFrame('approval.responded', {
    run_id: 'run-3',
    timestamp: 1.5,
    choice: 'once',
    resolved: 1,
  }),
  runEventFrame('message.delta', {
    run_id: 'run-3',
    timestamp: 1.6,
    type: 'assistant.delta',
    delta: '已执行',
  }),
  runEventFrame('run.completed', {
    run_id: 'run-3',
    timestamp: 2.0,
    output: '已执行',
    usage: { prompt_tokens: 8, completion_tokens: 4 },
  }),
];

// ---------------------------------------------------------------------------
// Fixture 11: /v1/runs 错误流(run.failed)
// ---------------------------------------------------------------------------

export const runEventsErrorFrames = [
  runEventFrame('run.started', { run_id: 'run-4', timestamp: 1.0 }),
  runEventFrame('run.failed', {
    run_id: 'run-4',
    timestamp: 1.5,
    message: '内部错误',
  }),
];

// ---------------------------------------------------------------------------
// Fixture 12: /v1/runs run.cancelled 流
// ---------------------------------------------------------------------------

export const runEventsCancelledFrames = [
  runEventFrame('run.started', { run_id: 'run-5', timestamp: 1.0 }),
  runEventFrame('run.cancelled', {
    run_id: 'run-5',
    timestamp: 1.5,
    message: '用户取消',
  }),
];

// ---------------------------------------------------------------------------
// Fixture 13: /v1/runs 未知事件(容错测试)
// ---------------------------------------------------------------------------

export const runEventsUnknownEventFrames = [
  runEventFrame('unknown.future.event', { run_id: 'run-6', foo: 'bar' }),
  runEventFrame('message.delta', {
    run_id: 'run-6',
    timestamp: 1.0,
    type: 'assistant.delta',
    delta: 'ok',
  }),
  runEventFrame('run.completed', {
    run_id: 'run-6',
    timestamp: 2.0,
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }),
];

// ---------------------------------------------------------------------------
// Fixture 14: /v1/runs JSON 解析失败帧(容错测试)
// ---------------------------------------------------------------------------

export const runEventsMalformedFrames = [
  'data: {invalid json}\n\n',
  runEventFrame('message.delta', {
    run_id: 'run-7',
    timestamp: 1.0,
    type: 'assistant.delta',
    delta: '正常',
  }),
  runEventFrame('run.completed', {
    run_id: 'run-7',
    timestamp: 2.0,
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }),
];

// ---------------------------------------------------------------------------
// Fixture 15: /v1/runs 无终态事件,流自然结束(容错测试)
// ---------------------------------------------------------------------------

export const runEventsStreamClosedPrematurelyFrames = [
  runEventFrame('message.delta', {
    run_id: 'run-8',
    timestamp: 1.0,
    type: 'assistant.delta',
    delta: '部分内容',
  }),
  // 无 run.completed/run.failed/run.cancelled,流直接 close
];

// ---------------------------------------------------------------------------
// Fixture 16: /v1/runs keepalive 心跳(SSE 注释帧)
// ---------------------------------------------------------------------------

export const runEventsKeepaliveFrames = [
  ': keepalive\n\n',
  runEventFrame('message.delta', {
    run_id: 'run-9',
    timestamp: 1.0,
    type: 'assistant.delta',
    delta: '心跳后内容',
  }),
  runEventFrame('run.completed', {
    run_id: 'run-9',
    timestamp: 2.0,
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }),
];

// ---------------------------------------------------------------------------
// Fixture 17: /v1/runs 实际 Gateway 字段名(Rust api_server.rs 格式)
// ---------------------------------------------------------------------------
// intellect-team Rust Gateway (api_server.rs) 与 Python adapter.py 字段名不同:
// - message.delta: 用 `text` 而非 `delta`
// - tool.progress: 用 `name` 而非 `tool_name`
// - run.completed: usage 用 `input_tokens`/`output_tokens` 而非 `prompt_tokens`/`completion_tokens`
// BFF 解析器通过字段名兼容逻辑同时支持两种格式,此 fixture 确保 Rust 格式被测试覆盖。

export const runEventsGatewayActualFrames = [
  runEventFrame('run.started', { run_id: 'run-g1', timestamp: 1.0 }),
  runEventFrame('message.delta', {
    run_id: 'run-g1',
    timestamp: 1.1,
    type: 'reasoning.delta',
    text: '思考中',
  }),
  runEventFrame('message.delta', {
    run_id: 'run-g1',
    timestamp: 1.2,
    type: 'assistant.delta',
    text: '你好',
  }),
  runEventFrame('message.delta', {
    run_id: 'run-g1',
    timestamp: 1.3,
    type: 'assistant.delta',
    text: '!',
  }),
  runEventFrame('run.completed', {
    run_id: 'run-g1',
    timestamp: 2.0,
    output: '你好!',
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  }),
];

// ---------------------------------------------------------------------------
// Fixture 18: /v1/runs 实际 Gateway 工具调用流(Rust api_server.rs 字段名)
// ---------------------------------------------------------------------------

export const runEventsGatewayToolCallFrames = [
  runEventFrame('run.started', { run_id: 'run-g2', timestamp: 1.0 }),
  runEventFrame('tool.progress', {
    run_id: 'run-g2',
    timestamp: 1.1,
    type: 'tool.started',
    tool_id: 'call_00_abc123',
    name: 'search_files',
    arguments: { path: '.', pattern: '*.md' },
  }),
  runEventFrame('tool.progress', {
    run_id: 'run-g2',
    timestamp: 1.2,
    type: 'tool.completed',
    tool_id: 'call_00_abc123',
    name: 'search_files',
    result: '{"total_count": 3, "files": ["a.md", "b.md", "c.md"]}',
    duration_s: 0.001,
  }),
  runEventFrame('message.delta', {
    run_id: 'run-g2',
    timestamp: 1.3,
    type: 'assistant.delta',
    text: '找到 3 个文件',
  }),
  runEventFrame('run.completed', {
    run_id: 'run-g2',
    timestamp: 2.0,
    output: '找到 3 个文件',
    usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
  }),
];

// ---------------------------------------------------------------------------
// Fixture 19: /v1/runs 仅 run.completed.output 有内容(无 message.delta)
// ---------------------------------------------------------------------------
// 测试 output 兜底逻辑:Gateway 不发增量 delta,只在 run.completed 返回完整答案。

export const runEventsOutputOnlyFrames = [
  runEventFrame('run.started', { run_id: 'run-g3', timestamp: 1.0 }),
  runEventFrame('run.completed', {
    run_id: 'run-g3',
    timestamp: 2.0,
    output: '这是完整答案',
    usage: { input_tokens: 3, output_tokens: 2 },
  }),
];
