# 方案评审：Chat Session SSE 事件处理补全

> 评审对象：[chat-session-sse-completion-plan.md](file:///Users/simon/project/agentui/docs/chat-session-sse-completion-plan.md)
> 评审日期：2026-07-26
> 评审方法：事实核验（代码库 + 上游契约）+ 架构推演 + 约束一致性

---

## 评审结论

| 维度 | 评级 | 说明 |
|---|---|---|
| 事实准确性 | ⚠️ **部分不准确** | §1.3 "前端 SSE 分发 bug" 描述过绝对；§4.3 数据源错误；遗漏 BFF `serializeChunk` 实际丢弃 `toolCallId` 的 bug |
| 架构合理性 | ⚠️ **有偏差** | 忽略 `useSendMessageWithSse` 6 个调用方中 3 个走 intellect-rag-app 原生格式；INFLIGHT 合并逻辑异步顺序未说明 |
| 完整性 | ⚠️ **有遗漏** | `message_end.reference`、`assistant.completed` 事件、i18n、多消息容器、`StreamToolStart` 字段命名转换均未覆盖 |
| 可实施性 | ⚠️ **有风险** | fetch monkey-patch 风险高；reasoning 双字符串用 useState 异步问题；tool call 卡片位置与 webui 实际行为不符 |
| 约束一致性 | ✅ **基本对齐** | Constitution Principle IV/VIII、project_memory YAGNI 等约束遵守良好 |

**总体建议**：方案方向正确，但 P0/P1 在事实层有重大偏差，需修订后再进入实施。P2/P3 在实施细节上需补充。

---

## 一、事实层问题（必须修订）

### 1.1 【严重】`useSendMessageWithSse` 多调用方格式差异被忽略

**方案 §1.3 声称**：前端 `useSendMessageWithSse` 完全忽略 `val.event`，导致 tool/usage 事件污染 answer 状态（功能性 bug）。

**实际事实**：`useSendMessageWithSse` 被 **6 个文件**调用，分两类路径：

| 调用方 | 调用 URL | 上游 | SSE 格式 | `val?.data?.answer` 是否正确 |
|---|---|---|---|---|
| `use-send-chat-message.ts` (gateway 分支) | `api.agentChatCompletion` | BFF `/agents/chat/completions` → IntellectEnterpriseAdapter 或 IntellectRagAdapter | `{event, data}` (BFF serializeChunk 输出) | ⚠️ delta/reasoning 巧合地工作；tool_*/usage 错误 |
| `use-send-chat-message.ts` (RAG 增强分支) | `api.completionUrl` | BFF proxy 透传 → intellect-rag-app `/api/v1/chat/completions` | `{code, message, data: {answer, ...}}` (envelope-wrapped) | ✅ 正确 |
| `use-send-shared-message.ts` | `completionUrl` | 同上 | envelope-wrapped | ✅ 正确 |
| `use-send-single-message.ts` | `api.completionUrl` | 同上 | envelope-wrapped | ✅ 正确 |
| `next-search/hooks.ts` | `api.askShare` / `api.searchCompletion` | intellect-rag-app 其他端点 | envelope-wrapped | ✅ 正确 |
| `use-send-message.ts` (canvas) | — | 不调用此 hook | — | — |

**结论**：方案 D3 决策"真正缺口在前端"**只对 gateway 分支成立**。其他 4 个调用方走 intellect-rag-app 原生 envelope-wrapped 格式，**现有 `val?.data?.answer` 逻辑是正确的，不应被重构破坏**。

**修订建议**：
- P0 重构 `useSendMessageWithSse` 时，**必须按调用 URL 区分分发逻辑**：仅当 URL 是 `api.agentChatCompletion` 时启用新 `dispatchSseFrame`，其他路径保持原逻辑
- 或更优：**新增 `useSendAgentMessageWithSse` 独立 hook**（仅服务 gateway 路径），`useSendMessageWithSse` 保持不变。零回归风险
- §1.3 "前端现状（关键 bug）" 表述需修正为"gateway 路径下的 bug"

### 1.2 【严重】BFF `serializeChunk` `error` 分支丢弃 `toolCallId`

**方案 §1.1 表格声称**：BFF `error` 事件 payload 是 `{message, answer}`。

**实际事实**：[bff/src/routes/bff-agents.ts](file:///Users/simon/project/agentui/bff/src/routes/bff-agents.ts) L358-363 的 `error` 分支：

```ts
case 'error':
  payload = {
    event: 'error',
    data: { message: chunk.message, answer: `**ERROR**: ${chunk.message}` },
  };
  break;
```

**丢弃了 `chunk.toolCallId` 字段**。而 [StreamError 类型](file:///Users/simon/project/agentui/bff/src/types/stream.ts#L147-L156) 定义了 `toolCallId?: string`，用于关联 `tool.failed` 时的工具调用 ID。

**影响**：方案 §3.1.3 "onError 且 toolCallId 存在 → 更新对应 record 的 status='failed'" 的实现无法工作，因为前端收到的 error 事件没有 toolCallId。

**修订建议**：P0 同时修复 BFF `serializeChunk` `error` 分支，补充 `toolCallId` 透传：

```ts
case 'error':
  payload = {
    event: 'error',
    data: {
      message: chunk.message,
      answer: `**ERROR**: ${chunk.message}`,
      ...(chunk.toolCallId ? { tool_call_id: chunk.toolCallId } : {}),
    },
  };
  break;
```

这违反方案 D3 "BFF 零改动" 决策，需修订决策。

### 1.3 【严重】Context ring 数据源错误

**方案 §4.3 声称**：数据源是 BFF `usage` 事件（携带 `promptTokens`/`completionTokens`）。

**实际事实**：
- BFF `usage` 事件**仅在 turn 结束时**（`run.completed`）发送一次
- webui context ring 数据源是 `metering` 事件（流式中持续推送 token 计数）和 `context_status` 事件（prefill 阶段的 context 加载状态）
- Constitution Principle IV 的 8 值 StreamChunk 枚举**不包含 `metering` 类型**，BFF 无法透传

**影响**：
- 方案的 Context ring 只能显示"上一 turn 的 token 用量"，无法实时显示"当前 turn 的 token 占用"
- 这与 webui 的体验差距很大，方案未承认此限制

**修订建议**：
- 明确说明 P2 Context ring 是"上一 turn 用量显示"，非 webui 的实时 context ring
- 或推迟 Context ring 到 P4，待 Constitution 修正 Principle IV 扩展枚举后再实施
- 或在 BFF `usage` chunk 中扩展 `contextLength` / `cumulativeTokens` 字段（属 Layer 3 透传，不破坏枚举）

### 1.4 【中等】`message_end` 事件的 `reference` 字段处理未说明

**方案遗漏**：BFF `serializeChunk` `delta` 分支已透传 `_metadata.reference`（来自 Intellect RAG `message_end` 事件），但方案 §2.2.1 的 `SseFrame` 类型定义中 `MessageData._metadata` 类型为 `{ reference?: unknown }`，**未说明前端如何消费这个字段**。

**实际影响**：
- AgentUI 现有 [ReferenceDocumentList](file:///Users/simon/project/agentui/src/components/next-message-item/index.tsx) 组件需要 `message.reference` 字段渲染引用文档列表
- 方案 §3.1.2 仅说明 "content 之前插入 tool call 卡片列表"，**未说明 reference 如何写入 message**
- 重构后，现有 RAG 增强 chat 的引用文档列表可能丢失

**修订建议**：P0 重构时明确 `onDelta` 的 `metadata` 参数如何写入 `message.reference`，并补充 P1 验收 checklist "RAG 增强 chat 的 ReferenceDocumentList 不回归"。

### 1.5 【中等】`assistant.completed` 事件处理未说明

**方案 §1.2 表格**列出了 `assistant.completed` 事件，但未说明 BFF 解析器如何处理。

**实际事实**：[parse-intellect-enterprise-sse.ts](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-sse.ts) 的 `mapEventToChunks` 函数**未处理 `assistant.completed` 事件**（switch 无此 case，走 default 警告并跳过）。

**影响**：流式中 `assistant.completed` 事件会被 BFF 静默丢弃，前端无法知道 assistant 消息已结束（只能等 `run.completed` 触发 usage+done）。

**修订建议**：方案 §1.2 表格补充说明 "BFF 解析器未处理 `assistant.completed`，由 `run.completed` 隐含通知"，避免实施时误以为前端会收到此事件。

---

## 二、架构层问题（建议修订）

### 2.1 【严重】fetch monkey-patch 风险极高，与现有架构冲突

**方案 §4.2 提议**：全局 `window.fetch = async (...args) => { ... }` monkey-patch 检测 TypeError。

**问题**：
1. **影响所有 HTTP 请求**：TanStack Query、axios、SSE EventSourceParserStream、BFF http-client 等全部受影响
2. **与 [project_memory 约束](file:///Users/simon/.trae-cn/memory/projects/-Users-simon-project-agentui/project_memory.md)** "`fetchWithRagToken` 显式列出参数，避免透传 signal/credentials/cache" 冲突：monkey-patch 会破坏显式参数列表
3. **重复检测**：`window.addEventListener('offline')` 已能检测浏览器离线，monkey-patch 多余
4. **webui 之所以 monkey-patch 是因为它没有统一 fetch 封装**；AgentUI 有 `axios` + `useSendMessageWithSse` 的 fetch 调用，可以分别处理

**修订建议**：
- 移除 fetch monkey-patch
- 仅用 `window.addEventListener('offline'/'online')` + `navigator.onLine`
- SSE `onError` 时检查 `navigator.onLine`，离线时延迟显示错误
- 普通请求错误由 TanStack Query 的全局 onError 处理

### 2.2 【严重】tool call 卡片位置与 webui 实际行为不符

**方案 §3.1.2 提议**："在 assistant 消息渲染中，**content 之前**插入 tool call 卡片列表"。

**实际 webui 行为**（[ui.js L6873-6921](file:///Users/simon/project/intellect-webui/static/ui.js), [messages.js L6983](file:///Users/simon/project/intellect-webui/static/messages.js)）：
- tool call 卡片**穿插在 content 流中**：`appendLiveToolCard(tc)` 在 `#liveAssistantTurn` 内按时间顺序插入
- 即：assistant.delta 文本 → tool card → assistant.delta 文本 → tool card → ...
- 时序语义：tool call 出现在它被调用时的文本位置

**方案的问题**：统一前置会破坏时序语义。例如："我先搜索了 X（tool card）然后发现 Y（tool card）最终得出结论 Z" 的叙事结构会丢失。

**修订建议**：
- 选项 A（推荐）：在消息内联渲染中，把 toolCalls 按 `startedAt` 时间戳与 content 文本片段交错渲染。需要在前端维护一个 "content + toolCalls 的有序事件列表"
- 选项 B（简化）：tool call 卡片列表放在 content **之后**，保留 content 完整性。这是 webui 在历史消息回看时的回退行为
- 不建议：统一前置

### 2.3 【中等】reasoning 双字符串模式用 useState 有异步问题

**方案 §3.2.1 提议**：

```ts
const [reasoning, setReasoning] = useState('');
const [liveReasoning, setLiveReasoning] = useState('');
reasoningOpenRef = useRef(false);

onReasoning(content, isStart, isEnd?) => {
  if (isStart) reasoningOpenRef.current = true;
  if (isEnd) reasoningOpenRef.current = false;
  setReasoning(prev => prev + content);
  setLiveReasoning(prev => prev + content);
}

onToolStart / onToolComplete => {
  setLiveReasoning('');
}
```

**问题**：
1. React 的 useState 是异步批量更新的，连续 `setReasoning` + `setLiveReasoning` + 立即读 `liveReasoning` 不会得到最新值
2. webui 用模块级变量（同步读写），React 需要用 useRef 模拟
3. `onToolStart` 后立即 `setLiveReasoning('')`，但下一次 `onReasoning` 时 `prev` 可能仍是旧值（React 批处理）

**修订建议**：改用 useRef 存储实时值，useEffect 同步到 useState 触发渲染：

```ts
const reasoningRef = useRef('');
const liveReasoningRef = useRef('');
const [, forceRender] = useReducer(x => x + 1, 0);

onReasoning(content, isStart) => {
  if (isStart) reasoningOpenRef.current = true;
  reasoningRef.current += content;
  liveReasoningRef.current += content;
  forceRender();  // 触发渲染
}

onToolStart => {
  liveReasoningRef.current = '';
  forceRender();
}
```

或用 `useSyncExternalStore`（React 18+）订阅外部存储。

### 2.4 【中等】INFLIGHT 合并逻辑的异步顺序未说明

**方案 §4.1.3 提议**："切换会话时检查 `loadInflight(newSessionId)`，若存在则合并到 `derivedMessages`"。

**问题**：实际场景的异步顺序是：
1. 用户切换会话 → URL 参数变化
2. TanStack Query 异步加载 server-side messages（可能需要 200-500ms）
3. 加载完成后，前端才能合并 inflight tail

**方案未说明**：
- server messages 加载中时，是否立即显示 inflight tail？
- server messages 加载完成后，如何与 inflight tail 合并（按 id 去重？）
- 如果 server 已经把 inflight 消息持久化了（流完成后但 inflight 未清理），如何避免重复？

**修订建议**：明确合并时序：
- 切换会话 → 立即显示 inflight tail（如果存在）
- server messages 加载完成后，用 `_mergeInflightTailMessages` 合并（参考 webui [sessions.js L1530-1547](file:///Users/simon/project/intellect-webui/static/sessions.js)）
- 流完成时（收到 `done` 事件）立即 `clearInflight(sessionId)`，避免重复

### 2.5 【中等】Approval/Clarify 推迟理由不充分

**方案 §6.1 声称**：approval 走 `/v1/runs/{run_id}/events` 独立 SSE 通道，需要 BFF 旁路端点。

**实际事实**：
- IntellectEnterpriseAdapter.sendMessage 调用的是 `/api/sessions/{id}/chat/stream`（[Constitution Principle VIII](file:///Users/simon/project/agentui/.specify/memory/constitution.md) 锁定）
- 该端点**根本不发** approval 事件（见调研结论）
- 如果未来要在 AgentUI 启用 approval，**必须切换 Adapter 主通道**到 `/v1/runs/*` 路径
- 这是 Constitution Principle VIII 的 NON-NEGOTIABLE 例外，需要宪法修正

**方案的问题**：方案 A（BFF 旁路端点）治标不治本。即使 BFF 提供 `/api/bff/agents/{agentId}/sessions/{sid}/events` 旁路，前端仍需知道何时开第二个 SSE 连接（approval 何时 pending？需要额外轮询端点）。

**修订建议**：明确 Approval/Clarify 推迟的真正原因是 **Constitution Principle VIII 锁定主通道**，需要宪法修正才能切换到 `/v1/runs/*` 路径。BFF 旁路不是可行方案，应删除。

---

## 三、完整性问题（建议补充）

### 3.1 `use-send-shared-message.ts` 的 `isCompletionError` 错误处理路径未考虑

**方案遗漏**：[use-send-shared-message.ts L113-115](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-shared-message.ts) 用 `send()` 返回值判断错误：

```ts
const ret = await send(completionUrl, { ...payload, ...data });
if (isCompletionError(ret)) {
  message.error(ret?.data.message ?? 'Unknown error');
}
```

`send()` 返回 `{ data: await res, response }`，其中 `data` 是 envelope-wrapped JSON。如果 P0 重构改变了 `send()` 返回值结构（如 `data` 不再是 envelope-wrapped），此调用方会破坏。

**修订建议**：P0 重构时明确 `send()` 返回值结构不变，保持与 intellect-rag-app envelope 格式兼容。

### 3.2 多消息容器场景未说明

**方案 §5.2 提议**：选中文本回复按钮验证选区在 `messageContainerRef` 内。

**实际事实**：AgentUI 独立聊天页支持多模型对比模式（`MultipleChatBox`），有多个消息容器并存。webui 是单消息容器，无此问题。

**修订建议**：选中文本回复的"聊天根"应该是包含所有消息容器的父元素，而非单个 `messageContainerRef`。或限制仅单 chat box 模式下启用。

### 3.3 i18n 未考虑

**方案遗漏**：新增 UI 文案（offline banner、context ring tooltip、slash command desc、provider error summary 等）如何接入 i18next？

**修订建议**：补充 §7 文件清单中 i18n 词条文件路径（`src/locales/`），并说明多语言键命名规范。

### 3.4 `StreamToolStart`/`StreamToolComplete`/`StreamToolProgress` 字段命名转换未说明

**方案 §3.1.1 `ToolCallRecord`** 用 camelCase（`toolCallId`、`toolName`），但 BFF serializeChunk 输出 snake_case（`tool_call_id`、`tool_name`）。

**修订建议**：方案 §2.2.1 的 `dispatchSseFrame` 应负责字段命名转换（snake_case → camelCase），并补充单测覆盖。

### 3.5 `listInflightSessions` API 违反 YAGNI

**方案 §4.1.2** 定义了 `listInflightSessions()` 但全文无调用方。

**修订建议**：删除该 API，符合 project_memory YAGNI 约束。

### 3.6 切换会话前确认 dialog 与 webui 行为不一致

**方案 §4.1.4 提议**："切换会话前，若有 INFLIGHT 状态，显示确认 dialog"。

**实际 webui 行为**：不弹 dialog，自动恢复（INFLIGHT 状态本身就是为了无缝恢复）。弹 dialog 反而打断用户体验。

**修订建议**：删除确认 dialog，直接自动恢复。INFLIGHT 的设计目标就是"用户无感"。

### 3.7 实施时间估计违反 system prompt 约束

**方案 §11** 给出了天数估计（P0: 1-2 天，P1-P3: 3-5 天）。

**约束**：system prompt 明确要求 "Avoid giving time estimates or predictions for how long tasks will take"。

**修订建议**：删除天数估计，仅保留阶段顺序与依赖关系。

---

## 四、风险层问题（建议补充）

### 4.1 P0 重构的回归风险被低估

**方案 §9 风险表**："重构 `useSendMessageWithSse` 破坏现有调用方" 风险"高"，缓解措施"保留 `answer` 字段语义不变"。

**实际风险**：
- 6 个调用方中 4 个走 intellect-rag-app envelope 格式（无 `event` 字段）
- 新 `dispatchSseFrame` 按 `val.event` 分发，对 envelope 格式会走 fallback 分支
- fallback 分支如何处理 `data: true` 哨兵、`data: {answer, start_to_think}` 等？方案未说明

**修订建议**：
- 强烈建议采用 §1.1 修订建议的"新增 `useSendAgentMessageWithSse` 独立 hook"方案
- 现有 `useSendMessageWithSse` 完全不动，零回归风险
- P0 工作量从"重构 + 测试 6 个调用方"降为"新增 hook + 测试 1 个调用方"

### 4.2 BFF `serializeChunk` 改动需要重新评估

**方案 D3 决策**："BFF 零改动"。

**实际需求**：
- §1.2 修复：`error` 分支需透传 `toolCallId`
- §2.2.3 修复：`reasoning` 分支需区分 first/subsequent chunk（备选方案）
- §3.4 修复：可能需要扩展 `usage` chunk 增加 `contextLength` 字段

**修订建议**：D3 决策修订为"BFF 仅做最小必要改动（透传 toolCallId），不引入有状态序列化"。

---

## 五、优点确认

为公平起见，方案中以下方面处理得当：

1. **宪法约束遵守**：D1 不修改 8 值 StreamChunk 枚举、D6 不动 canvas-plugin、Approval/Clarify 推迟处理均符合 Constitution
2. **上游契约调研扎实**：§1.2 intellect-team 事件清单准确（已通过子 agent 调研确认）
3. **BFF 序列化格式表格**（§1.1）清晰准确
4. **文件清单**（§7）按阶段划分明确
5. **测试策略**（§8）覆盖单元/集成/回归三层
6. **P4 deferred 决策合理**：approval/clarify 确实需要更大架构变更
7. **参考 webui 模式而非复用代码**（D5）方向正确

---

## 六、修订建议优先级

| 修订项 | 优先级 | 影响阶段 |
|---|---|---|
| §1.1 `useSendMessageWithSse` 多调用方格式差异 | P0 必修 | P0 |
| §1.2 BFF `serializeChunk` error 分支丢失 toolCallId | P0 必修 | P0 |
| §2.1 移除 fetch monkey-patch | P0 必修 | P2 |
| §2.2 tool call 卡片位置改为穿插/后置 | P1 必修 | P1 |
| §1.3 Context ring 数据源错误 | P1 必修 | P2 |
| §2.3 reasoning 双字符串改用 useRef | P1 必修 | P1 |
| §4.1 P0 改为新增独立 hook | P0 必修 | P0 |
| §1.4 `message_end.reference` 处理说明 | P1 应修 | P0/P1 |
| §1.5 `assistant.completed` 处理说明 | P2 应修 | 文档 |
| §2.4 INFLIGHT 合并时序说明 | P2 应修 | P2 |
| §2.5 Approval/Clarify 推迟理由修订 | P3 应修 | 文档 |
| §3.1 `isCompletionError` 兼容性 | P2 应修 | P0 |
| §3.2 多消息容器场景 | P3 应修 | P3 |
| §3.3 i18n 补充 | P3 应修 | 全阶段 |
| §3.4 字段命名转换说明 | P2 应修 | P0 |
| §3.5 删除 `listInflightSessions` | P3 应修 | P2 |
| §3.6 删除切换会话确认 dialog | P3 应修 | P2 |
| §3.7 删除时间估计 | P3 必修 | 文档 |

---

## 七、建议的方案修订路径

1. **立即修订**（影响 P0 启动）：
   - §1.1 改为新增 `useSendAgentMessageWithSse` 独立 hook
   - §1.2 BFF `serializeChunk` error 分支补充 toolCallId 透传
   - §4.1 P0 工作量从"重构 + 测试 6 个调用方"降为"新增 hook + 测试 1 个调用方"
   - D3 决策修订为"BFF 仅做最小必要改动"

2. **P1 启动前修订**：
   - §2.2 tool call 卡片位置改为穿插渲染或后置
   - §2.3 reasoning 双字符串改用 useRef
   - §1.4 `message_end.reference` 处理说明

3. **P2 启动前修订**：
   - §2.1 移除 fetch monkey-patch
   - §1.3 Context ring 数据源限制说明（或推迟到 P4）
   - §2.4 INFLIGHT 合并时序说明

4. **P3 启动前修订**：
   - §3.2 多消息容器场景
   - §3.3 i18n 补充
   - §2.5 Approval/Clarify 推迟理由修订

修订完成后，方案可进入 P0 实施。
