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
