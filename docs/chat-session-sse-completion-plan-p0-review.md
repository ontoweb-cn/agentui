# P0 实施前评审

> 评审对象：[chat-session-sse-completion-plan.md](file:///Users/simon/project/agentui/docs/chat-session-sse-completion-plan.md) §二 P0（修订后）
> 评审日期：2026-07-26
> 评审方法：实施前事实核验 + 实施细节推演

---

## 评审结论

**✅ P0 方案可进入实施。** 修订后的事实准确性、架构合理性、实施可行性均已达标。发现 3 个实施时需注意的细节（非阻塞），已在下方列出。

| 维度 | 评级 | 说明 |
|---|---|---|
| 事实准确性 | ✅ 通过 | 6 个调用方格式差异、BFF serializeChunk 现状、StreamError 类型定义均已核实 |
| 架构合理性 | ✅ 通过 | 新增独立 hook 方案零回归，BFF 最小改动合理 |
| 实施可行性 | ✅ 通过 | 实施步骤清晰，关键接口签名已确认 |
| 实施细节 | ⚠️ 3 个注意点 | 见下方 §三 |

---

## 一、事实核验通过项

### 1.1 `useSendMessageWithSse` 调用方格式差异 ✅

已核实 6 个调用方中：
- `use-send-chat-message.ts` L114-140 确实按 `isGatewayChat` 分流：gateway 走 `api.agentChatCompletion`，RAG 增强走 `api.completionUrl`
- 其他 4 个调用方（`use-send-shared-message.ts` / `use-send-single-message.ts` / `next-search/hooks.ts` / `use-send-message.ts`）均走 `completionUrl` 或类似 intellect-rag-app 端点

**结论**：D4 决策（新增独立 hook）正确，零回归风险。

### 1.2 BFF `serializeChunk` `error` 分支丢弃 `toolCallId` ✅

已核实 [bff-agents.ts L357-362](file:///Users/simon/project/agentui/bff/src/routes/bff-agents.ts#L357-L362)：
```ts
case 'error':
  payload = {
    event: 'error',
    data: { message: chunk.message, answer: `**ERROR**: ${chunk.message}` },
  };
```

确实未透传 `chunk.toolCallId`。而 [StreamError 类型](file:///Users/simon/project/agentui/bff/src/types/stream.ts#L147-L156) 已定义 `toolCallId?: string`。

**结论**：§2.2.4 修复方案正确。

### 1.3 BFF `delta` 分支已透传 `metadata` ✅

已核实 [bff-agents.ts L290-302](file:///Users/simon/project/agentui/bff/src/routes/bff-agents.ts#L290-L302)：
```ts
case 'delta': {
  const d = chunk as ...;
  payload = {
    event: 'message',
    data: {
      content: d.content,
      answer: d.content,
      ...(d.metadata ? { _metadata: d.metadata } : {}),
    },
  };
```

**结论**：BFF 输出字段名是 `_metadata`（带下划线前缀），方案 §2.2.1 字段命名转换规则 `_metadata` → `metadata` 正确。

### 1.4 `useSendMessageWithSse.send()` 返回值结构 ✅

已核实 [logic-hooks.ts L320](file:///Users/simon/project/agentui/src/hooks/logic-hooks.ts#L320)：
```ts
return { data: await res, response };
```

`res = response.clone().json()`，对 gateway 路径而言 `res` 是 BFF SSE 流的克隆 JSON 解析（可能是 `{code: 502, message: ...}` 错误响应，或流式响应的非法 JSON）。

**结论**：[use-send-chat-message.ts L142](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-chat-message.ts#L142) `res?.data?.code !== 0` 检查对 gateway 路径是宽松的（`code` undefined 时 `!== 0` 为 true，会触发 `removeLatestMessage`）。新 hook 需保持 `send()` 返回值结构一致。

### 1.5 `useSendMessageWithSse` 内部 `body?.session_id ?? body?.conversation_id` ✅

已核实 [logic-hooks.ts L303](file:///Users/simon/project/agentui/src/hooks/logic-hooks.ts#L303)：
```ts
conversationId: body?.session_id ?? body?.conversation_id,
```

gateway 路径调用 `send()` 时传 `session_id`（[use-send-chat-message.ts L118](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-chat-message.ts#L118)），新 hook 需保持此语义。

---

## 二、架构合理性通过项

### 2.1 新增独立 hook 零回归 ✅

`useSendMessageWithSse` 保持不变，其他 4 个调用方零回归。新 hook `useSendAgentMessageWithSse` 仅服务 gateway 路径，风险隔离。

### 2.2 BFF 最小改动合理 ✅

仅修复 `error` 分支透传 `tool_call_id`，不引入有状态序列化。reasoning 开闭状态由前端 `dispatchSseFrame` 维护，符合 D3 决策。

### 2.3 字段命名转换职责清晰 ✅

`dispatchSseFrame` 内部负责 snake_case → camelCase 转换，调用方收到的全部是 camelCase 字段。转换规则明确（§2.2.1）。

### 2.4 reasoning 开闭状态由前端维护 ✅

`dispatchSseFrame` 内部维护 `reasoningOpen` 标志，处理：
- `startToThink: true` 去重（BFF 每条 reasoning chunk 都附带，需去重）
- 工具调用前隐式闭合
- `done` 事件前隐式闭合

逻辑清晰，避免 BFF 引入有状态序列化。

---

## 三、实施细节注意点（非阻塞）

### 3.1 【注意】`useSendAgentMessageWithSse` 需复用 `useSetDoneRecord` 和 `doneRecord` 逻辑

[logic-hooks.ts L178-201](file:///Users/simon/project/agentui/src/hooks/logic-hooks.ts#L178-L201) 的 `useSetDoneRecord` hook 提供 `doneRecord` / `setDoneRecordById` / `allDone` / `clearDoneRecord`，用于多 chat box 场景的 done 状态管理。

`useSendAgentMessageWithSse` 需复用此 hook（或类似逻辑），因为 gateway 路径也可能在多 chat box 模式下使用。

**实施建议**：新 hook 内部调用 `useSetDoneRecord()`，保持 `done` / `doneRecord` / `allDone` / `setDone` / `clearDoneRecord` 字段语义与 `useSendMessageWithSse` 一致。

### 3.2 【注意】`send()` 返回值对 gateway 路径的 `code` 检查

[use-send-chat-message.ts L142](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-chat-message.ts#L142)：
```ts
if (res && (res?.response.status !== 200 || res?.data?.code !== 0)) {
  removeLatestMessage();
}
```

gateway 路径的 BFF 响应：
- 流式成功：`response.status = 200`，`res.data` 是流式响应的克隆 JSON 解析（可能解析失败或为空对象）
- 流式错误：BFF 返回 `{code: 502, message: ...}`，`response.status = 502`

**实施建议**：新 hook 的 `send()` 返回值结构保持 `{ data: await res, response }`。gateway 路径切换后，L142 检查 `res?.response.status !== 200` 仍能工作（502 时触发 removeLatestMessage）。`res?.data?.code !== 0` 在流式成功时 `code` 为 undefined（`undefined !== 0` 为 true），会误触发 removeLatestMessage。

**修复方案**：切换 gateway 路径到新 hook 时，同时修改 L142 检查逻辑：
```ts
if (res && (res?.response.status !== 200 || (res?.data?.code !== undefined && res?.data?.code !== 0))) {
  removeLatestMessage();
}
```

或更优：新 hook 的 `send()` 在 gateway 路径流式成功时返回 `{ data: { code: 0 }, response }`，保持与 intellect-rag-app envelope 格式兼容。

### 3.3 【注意】`resetAnswer` 的 1 秒延迟逻辑

[logic-hooks.ts L219-227](file:///Users/simon/project/agentui/src/hooks/logic-hooks.ts#L219-L227)：
```ts
const resetAnswer = useCallback(() => {
  if (timer.current) clearTimeout(timer.current);
  timer.current = setTimeout(() => {
    setAnswer({} as IAnswer);
    clearTimeout(timer.current);
  }, 1000);
}, []);
```

`resetAnswer` 在流结束后延迟 1 秒清空 `answer`，避免 UI 闪烁。新 hook 需保留此逻辑。

**实施建议**：新 hook 内部复制 `resetAnswer` 逻辑，保持 1 秒延迟清空 `answer`。

---

## 四、实施步骤确认

按方案 §2.2 的改动范围，实施步骤如下（顺序敏感）：

1. **新增 `sse-event-dispatcher.ts` + 单测**
   - 类型定义（SseFrame / MessageData / ToolStartData 等）
   - `dispatchSseFrame(rawData, handlers)` 函数
   - 字段命名转换（snake_case → camelCase）
   - reasoning 开闭状态维护
   - 单测覆盖 7 种事件 + 字段转换 + 容错

2. **新增 `use-send-agent-message-with-sse.ts`**
   - 复用 `useSetDoneRecord`
   - 内部 state：`answer` / `reasoning`（useRef）/ `toolCalls`（useRef）/ `usage` / `error` / `done`
   - `send()` 函数：fetch + EventSourceParserStream + `dispatchSseFrame`
   - `stopOutputMessage()` / `reset()` / `resetAnswer()`（1 秒延迟）
   - 返回值结构 `{ data: await res, response }`

3. **修复 BFF `serializeChunk` `error` 分支**
   - [bff-agents.ts L357-362](file:///Users/simon/project/agentui/bff/src/routes/bff-agents.ts#L357-L362) 补充 `tool_call_id` 透传
   - BFF 测试验证

4. **切换 `use-send-chat-message.ts` gateway 分支**
   - [use-send-chat-message.ts L77](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-chat-message.ts#L77) `useSendMessageWithSse()` 改为根据 `isGatewayChat` 条件调用两个 hook
   - 或更优：同时调用两个 hook，根据 `isGatewayChat` 选择使用哪个的 `send`
   - 修改 L142 检查逻辑（见 §3.2）

5. **扩展 `IMessage` 类型**
   - [src/interfaces/database/chat.ts](file:///Users/simon/project/agentui/src/interfaces/database/chat.ts) 新增 `toolCalls?` / `reasoning?` / `usage?` / `contentSegments?` 字段

6. **验收测试**
   - `npm run type-check`
   - `cd bff && npm test`
   - 端到端：gateway 路径发送消息 → 流式响应 → done
   - 端到端：gateway 路径触发工具调用 → answer 不被清空
   - 端到端：RAG 增强路径（其他 4 个调用方）不回归

---

## 五、实施授权

P0 方案已通过实施前评审，可进入实施。实施时注意 §三 的 3 个细节点：
1. 复用 `useSetDoneRecord`
2. 修复 L142 `code` 检查逻辑
3. 保留 `resetAnswer` 1 秒延迟

实施完成后，跑 `npm run type-check` + `cd bff && npm test` + 端到端冒烟测试，确认零回归后标记 P0 完成。
