# AgentUI Chat Session SSE 事件处理补全方案

> 制定日期：2026-07-26
> 评审基线：[chat-session-gap-analysis.md](file:///Users/simon/project/agentui/docs/chat-session-gap-analysis.md) §四-五、[chat-session-gateway-migration-review.md](file:///Users/simon/project/agentui/docs/chat-session-gateway-migration-review.md) §四
> 参考实现：[intellect-webui](file:///Users/simon/project/intellect-webui) `static/messages.js` / `sessions.js` / `ui.js` / `commands.js`
> 上游契约：[bff/src/types/stream.ts](file:///Users/simon/project/agentui/bff/src/types/stream.ts) (Constitution Principle IV v1.2.0)、[intellect-team adapter.py `_handle_session_chat_stream`](file:///Users/simon/project/intellect-team/plugins/platforms/api_server/adapter.py)

---

## 〇、方案总览

### 0.1 目标

补全 AgentUI Chat Session 对 SSE 事件的处理能力，使其与 intellect-webui 的会话体验基本对齐，**但保留 AgentUI 现有架构（React + TanStack Query + shadcn/ui + BFF StreamChunk 抽象）**，不回退到 webui 的原生 JS + 全局 S 对象模式。

### 0.2 关键决策（已确认）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **不修改 Constitution Principle IV 的 8 值 StreamChunk 枚举** | 枚举锁定为 `delta\|reasoning\|tool_start\|tool_complete\|tool_progress\|usage\|done\|error`，NON-NEGOTIABLE。approval/clarify 不在枚举内 |
| D2 | **Approval/Clarify 推迟到 P3 之后** | `/api/sessions/{id}/chat/stream` 端点本身不发出 approval/clarify 事件（见 §1.2 调研结论）。Approval 走 `/v1/runs/{run_id}/events` 独立 SSE 通道，但 Constitution Principle VIII 锁定 IntellectEnterpriseAdapter 主通道为 `/api/sessions/{id}/chat/stream`，切换到 `/v1/runs/*` 路径需要宪法修正。BFF 旁路端点不可行（前端无法知道 approval 何时 pending，需要额外轮询）。推迟到独立 spec 推进宪法修正 |
| D3 | **BFF 做最小必要改动** | gap-analysis §1.3 "BFF serializeChunk 过滤 tool_* 事件" 是过期描述，`serializeChunk` 已透传全部 8 类事件。但 `error` 分支丢弃 `chunk.toolCallId`（见 §1.2），需补充透传。**不引入有状态序列化**（reasoning 开闭状态由前端维护） |
| D4 | **P0 改为新增独立 hook，不重构 `useSendMessageWithSse`** | `useSendMessageWithSse` 有 6 个调用方，其中 4 个走 intellect-rag-app envelope-wrapped 格式（`{code, message, data: {answer}}`），现有 `val?.data?.answer` 逻辑对它们是正确的。仅 gateway 路径（`use-send-chat-message.ts` 的 gateway 分支）走 BFF `{event, data}` 格式存在 bug。新增 `useSendAgentMessageWithSse` 独立 hook 仅服务 gateway 路径，零回归风险 |
| D5 | **UI 借鉴 webui 的模式，不复用其代码** | webui 是 Python + 原生 JS，无法直接复用；HTML/CSS 模式需用 React + Tailwind + shadcn/ui 重写 |
| D6 | **不动 canvas-plugin 的 SSE 路径** | 画布 chat 走 IntellectRagAdapter (Canvas Workflow SSE)，与本文档无关。本文档仅针对 `src/pages/next-chats/` 独立聊天页 |
| D7 | **Tool call UI 渲染在消息内联，不进 LogSheet** | webui 模式：每条 tool call 渲染为可折叠卡片，附在 assistant 消息内。AgentUI 现有 LogSheet/workflow-timeline 用于画布节点调试，不混用 |

### 0.3 阶段划分

| 阶段 | 主题 | 工作量 | 依赖 | 状态 |
|---|---|---|---|---|
| **P0** | 前端 SSE 事件分发修复 + 基础类型对齐 | 小 | 无 | 待实施 |
| **P1** | Tool call 内联卡片 + Reasoning 实时增量流 | 中 | P0 | 待实施 |
| **P2** | INFLIGHT 状态恢复 + Offline 横幅 + Context ring | 中 | P0 | 待实施 |
| **P3** | Slash 命令面板 + 选中文本回复 + Provider error 折叠 | 中 | P0 | 待实施 |
| **P4 (deferred)** | Approval/Clarify 卡片 | 大 | 宪法修正 + BFF 旁路 | 不在本方案范围 |

---

## 一、现状审计（BFF + 前端）

### 1.1 BFF 现状

| 组件 | 文件 | 状态 |
|---|---|---|
| StreamChunk 类型定义 | [bff/src/types/stream.ts](file:///Users/simon/project/agentui/bff/src/types/stream.ts) | ✅ 8 值枚举完整定义 |
| 企业版 SSE 解析器 | [parse-intellect-enterprise-sse.ts](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-sse.ts) | ✅ 解析 11 类 Gateway 事件：`run.started` / `message.started` / `assistant.delta` / `tool.progress(_thinking→reasoning)` / `tool.progress(其他)` / `tool.started` / `tool.completed` / `tool.failed` / `run.completed(→usage+done)` / `error` / `done` |
| IntellectEnterpriseAdapter.sendMessage | [intellect-enterprise-adapter.ts](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts) L173-177 | ✅ 调用 `POST /api/sessions/{id}/chat/stream` |
| serializeChunk | [bff-agents.ts](file:///Users/simon/project/agentui/bff/src/routes/bff-agents.ts) L288-367 | ✅ 8 类事件全部透传到前端 |

**BFF 序列化输出的 SSE 帧格式**：
```
data: {"event":"<event_name>","data":{<payload>}}\n\n
```

各事件对应的 `event` / `data` 字段：

| StreamChunk.type | `event` 字段 | `data` 字段 |
|---|---|---|
| `delta` | `"message"` | `{content, answer, _metadata?}` |
| `reasoning` | `"message"` | `{content, answer, start_to_think: true}` |
| `tool_start` | `"tool_start"` | `{tool_name, tool_call_id, args?}` |
| `tool_complete` | `"tool_complete"` | `{tool_call_id, result?}` |
| `tool_progress` | `"tool_progress"` | `{tool_name, tool_call_id?, content}` |
| `usage` | `"message_end"` | `{usage: {promptTokens, completionTokens}}` |
| `done` | `"workflow_finished"` | `true` |
| `error` | `"error"` | `{message, answer: "**ERROR**: ..."}` ⚠️ **当前丢弃 `chunk.toolCallId`，P0 修复为透传 `tool_call_id`** |

### 1.2 intellect-team `/api/sessions/{id}/chat/stream` 实际事件清单

来自 `_handle_session_chat_stream` (adapter.py L2451-2589) 调研结论：

| 事件名 | 何时发出 | payload 关键字段 |
|---|---|---|
| `run.started` | 流开始 | `user_message` |
| `message.started` | run.started 后立即 | `message: {id, role:"assistant"}` |
| `assistant.delta` | 每个文本 token | `message_id, delta` |
| `tool.progress` (tool_name=`_thinking`) | reasoning 增量 | `message_id, tool_name, delta` |
| `tool.progress` (其他 tool_name) | 工具进度预览 | `message_id, tool_name, delta` |
| `tool.started` | 工具调用开始 | `message_id, tool_name, preview, args` |
| `tool.completed` | 工具调用成功 | `message_id, tool_name, preview, args` |
| `tool.failed` | 工具调用失败 | `message_id, tool_name, preview, args` |
| `assistant.completed` | assistant 消息结束 | `message_id, content, completed:true` |
| `run.completed` | run 结束 | `message_id, messages, usage` |
| `error` | 异常 | `message` |
| `done` | 流终止（finally） | `{}` (envelope only) |

**关键事实**：
- **Approval/Clarify 事件 NOT 发自本端点**：approval 走 `/v1/runs/{run_id}/events` 独立 SSE 通道；clarify 在 intellect-team api_server 中**根本未实现**（grep 返回空）
- **BFF 解析器未处理 `assistant.completed` 事件**：[parse-intellect-enterprise-sse.ts](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-sse.ts) `mapEventToChunks` switch 无此 case，走 default 警告并跳过。前端无法直接收到 assistant 消息结束信号，由 `run.completed` 触发 usage+done 隐含通知。P0 不修复此缺口（无功能影响），仅记录
- BFF 解析器已覆盖主通道其他事件（`run.completed` 合并处理为 usage+done）
- KeepAlive 用 `: keepalive` SSE 注释（30s）

### 1.3 前端现状（多调用方格式差异）

[`useSendMessageWithSse`](file:///Users/simon/project/agentui/src/hooks/logic-hooks.ts) L207-346 的 SSE 消费循环只读取 `val?.data`（内层 data 对象），**完全忽略 `val.event`**：

```ts
const val = JSON.parse(value?.data || '');
const d = val?.data;              // ← 只取内层 data
if (typeof d !== 'boolean') {
  setAnswer((prev) => ({
    ...d,                          // ← d.answer 不存在时，currentAnswer = ''
    answer: newAnswer,             // ← 累加空字符串，污染状态
    ...
  }));
}
```

**关键：6 个调用方分两类 SSE 格式**：

| 调用方 | 调用 URL | 上游 | SSE 格式 | `val?.data?.answer` 是否正确 |
|---|---|---|---|---|
| `use-send-chat-message.ts` (gateway 分支) | `api.agentChatCompletion` | BFF `/agents/chat/completions` → IntellectEnterpriseAdapter / IntellectRagAdapter | `{event, data}` (BFF serializeChunk 输出) | ⚠️ delta/reasoning 巧合地工作；tool_*/usage 错误 |
| `use-send-chat-message.ts` (RAG 增强分支) | `api.completionUrl` | BFF proxy 透传 → intellect-rag-app `/api/v1/chat/completions` | `{code, message, data: {answer, ...}}` (envelope-wrapped) | ✅ 正确 |
| `use-send-shared-message.ts` | `completionUrl` | 同上 | envelope-wrapped | ✅ 正确 |
| `use-send-single-message.ts` | `api.completionUrl` | 同上 | envelope-wrapped | ✅ 正确 |
| `next-search/hooks.ts` | `api.askShare` / `api.searchCompletion` | intellect-rag-app 其他端点 | envelope-wrapped | ✅ 正确 |
| `use-send-message.ts` (canvas) | — | 不调用此 hook | — | — |

**结论**：仅 gateway 路径（`use-send-chat-message.ts` 的 gateway 分支）存在 bug。其他 4 个调用方走 intellect-rag-app envelope-wrapped 格式，**现有 `val?.data?.answer` 逻辑是正确的，不应被重构破坏**。P0 采用 D4 决策（新增独立 hook）。

**Gateway 路径的实际 bug**：
- 收到 `tool_start` 事件：`d = {tool_name, tool_call_id, args}`，`d.answer` undefined，`currentAnswer = ''`，answer 被设为 `''` —— **覆盖已生成内容**
- 收到 `tool_complete` 事件：同上，answer 被清空
- 收到 `tool_progress` 事件：同上
- 收到 `usage` (`message_end`) 事件：`d = {usage}`，answer 被清空
- 收到 `error` 事件：`d.answer = "**ERROR**: ..."` —— 巧合地能工作
- 收到 `done` 事件：`d = true`（boolean）—— 跳过 setAnswer，正确
- 收到 `reasoning` 事件：BFF 包装为 `{event:"message", data:{content, answer, start_to_think:true}}`，`d.answer = content` —— 巧合地能工作，但**没有 `end_to_think` 信号**，thinking 标签不闭合

### 1.4 与 webui 的差距矩阵

| 能力 | webui | AgentUI | 差距类型 |
|---|---|---|---|
| tool call 内联卡片 | ✅ `tool-card-row` 可折叠，含运行点/参数/结果，**穿插在 content 流中** | ❌ 走 LogSheet（画布路径） | UI 缺失 |
| reasoning 实时增量 | ✅ `reasoningText` + `liveReasoningText`（工具后重置）+ partial 标签剥离 | ⚠️ `start_to_think` 标签包裹，无增量、无工具后重置 | 实现 simplification |
| approval 卡片 | ✅ once/session/always/deny 四按钮 + 轮询 | ❌ | 上游不支持 + UI 缺失（P4） |
| clarify 卡片 | ✅ input + dock 折叠 + countdown | ❌ | 上游不支持 + UI 缺失（P4） |
| context ring | ✅ SVG 圆环 + token 百分比 + tooltip，**数据源是 `metering`/`context_status` 事件** | ❌ | UI 缺失（**BFF `usage` 事件仅 turn 结束时发一次，无法实时**） |
| offline 横幅 | ✅ `navigator.onLine` + fetch monkey-patch + 重连探针 | ❌ | UI 缺失（P2 简化为仅 `navigator.onLine`） |
| INFLIGHT 状态恢复 | ✅ 三层（内存 + localStorage 指针 + 完整快照），10 分钟 TTL | ❌ 切换会话丢失正在发送的消息 | 状态管理缺失 |
| slash 命令面板 | ✅ 四源（builtin/model/skill/agent）+ 子参数补全 | ❌ | UI 缺失 |
| 选中文本回复 | ✅ 浮动按钮 + Markdown 引用插入 | ❌ | UI 缺失 |
| provider error details | ✅ `<details>` 折叠 + `<pre>` 原文 | ❌ | UI 缺失（轻量） |
| 增量 streaming-markdown | ✅ smd 增量 DOM + KaTeX 节流 | ❌ 整段 markdown 重渲染 | 性能优化（可选） |

---

## 二、P0：前端 SSE 事件分发修复

### 2.1 目标

新增 `useSendAgentMessageWithSse` 独立 hook 服务 gateway 路径，按 `val.event` 路由到不同处理器，避免 tool/usage 事件污染 answer 状态。**`useSendMessageWithSse` 保持不变**，零回归风险。同时修复 BFF `serializeChunk` `error` 分支丢弃 `toolCallId` 的问题。

### 2.2 改动范围

#### 2.2.1 新增 SSE 事件分发器

**新文件**：`src/hooks/logic-hooks/sse-event-dispatcher.ts`

职责：解析 BFF 透传的 `{event, data}` JSON 帧，按 `event` 字段路由到对应处理器，并将 snake_case 字段名转换为前端 camelCase 约定。

```ts
// 类型定义（与 BFF serializeChunk 输出对齐，已转 camelCase）
export type SseFrame =
  | { event: 'message'; data: MessageData }
  | { event: 'tool_start'; data: ToolStartData }
  | { event: 'tool_complete'; data: ToolCompleteData }
  | { event: 'tool_progress'; data: ToolProgressData }
  | { event: 'message_end'; data: { usage: TokenUsage } }
  | { event: 'workflow_finished'; data: true }
  | { event: 'error'; data: ErrorData };

interface MessageData {
  content: string;
  answer: string;
  startToThink?: boolean;        // ← BFF snake_case `start_to_think` 转换而来
  endToThink?: boolean;          // ← BFF snake_case `end_to_think` 转换而来（当前 BFF 未发，保留兼容）
  final?: boolean;
  metadata?: { reference?: unknown };  // ← BFF `_metadata` 转换而来
}

interface ToolStartData {
  toolName: string;              // ← BFF `tool_name`
  toolCallId: string;            // ← BFF `tool_call_id`
  args?: unknown;
}

interface ToolCompleteData {
  toolCallId: string;            // ← BFF `tool_call_id`
  result?: unknown;
}

interface ToolProgressData {
  toolName: string;              // ← BFF `tool_name`
  toolCallId?: string;           // ← BFF `tool_call_id`
  content: string;
}

interface ErrorData {
  message: string;
  answer: string;
  toolCallId?: string;           // ← BFF `tool_call_id`（P0 修复后透传）
}

interface TokenUsage {
  promptTokens: number;          // ← BFF `promptTokens`（已是 camelCase）
  completionTokens: number;
}
```

**字段命名转换职责**：`dispatchSseFrame` 内部负责 snake_case → camelCase 转换，调用方收到的全部是 camelCase 字段。转换规则：
- `tool_name` → `toolName`
- `tool_call_id` → `toolCallId`
- `start_to_think` → `startToThink`
- `end_to_think` → `endToThink`
- `_metadata` → `metadata`
- `promptTokens` / `completionTokens`（BFF 已是 camelCase）保持不变

**分发器签名**：
```ts
export interface SseEventHandlers {
  onDelta: (content: string, metadata?: { reference?: unknown }) => void;
  onReasoning: (content: string, isStart: boolean, isEnd?: boolean) => void;
  onToolStart: (data: ToolStartData) => void;
  onToolComplete: (data: ToolCompleteData) => void;
  onToolProgress: (data: ToolProgressData) => void;
  onUsage: (usage: TokenUsage) => void;
  onError: (message: string, toolCallId?: string) => void;
  onDone: () => void;
}

export function dispatchSseFrame(rawData: string, handlers: SseEventHandlers): void;
```

**`message_end.reference` 处理**：BFF `delta` 分支在 `final: true` 时透传 `metadata.reference`。`dispatchSseFrame` 的 `onDelta` 回调在 `metadata.reference` 存在时，由调用方写入 `message.reference` 字段，供 [ReferenceDocumentList](file:///Users/simon/project/agentui/src/components/next-message-item/index.tsx) 组件渲染。**P0 验收必须包含 RAG 增强 chat 的引用文档列表不回归**（虽然 RAG 增强分支不走新 hook，但 gateway 路径的 IntellectRagAdapter 也会透传 reference，需验证）。

#### 2.2.2 新增 `useSendAgentMessageWithSse` 独立 hook

**新文件**：`src/hooks/use-send-agent-message-with-sse.ts`

仅服务 gateway 路径（`api.agentChatCompletion`），内部调用 `dispatchSseFrame` 替换 `setAnswer(...)` 逻辑。

**hook 签名**：
```ts
interface UseSendAgentMessageWithSse {
  send: (url: string, body: unknown) => Promise<{ data: unknown; response: Response }>;
  answer: IAnswer;                  // 兼容现有 derivedMessages 累积
  reasoning: string;                // 实时 reasoning 累积（P1 启用，P0 仅累积不渲染）
  toolCalls: ToolCallRecord[];      // tool call 列表（P1 启用，P0 仅累积不渲染）
  usage: TokenUsage | null;         // 本 turn 的 token 用量
  error: string | null;             // 错误信息
  done: boolean;                    // 流是否完成
  stopOutputMessage: () => void;    // 中止流
  reset: () => void;                // 重置状态（切换会话时调用）
}
```

**实现要点**：
- 复用 `useSendMessageWithSse` 的 fetch + `EventSourceParserStream` 基础设施（提取为共享工具函数 `fetchSseStream`）
- 状态管理用 `useRef` 存储实时值（reasoning/toolCalls 等），用 `useState` 触发渲染（详见 P1 §3.2 reasoning 双字符串实现）
- `answer` 字段语义与 `useSendMessageWithSse` 保持一致，便于 `use-send-chat-message.ts` 的 gateway 分支无缝切换

#### 2.2.3 切换 gateway 路径调用方

**修改文件**：[src/pages/next-chats/hooks/use-send-chat-message.ts](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-chat-message.ts)

将 gateway 分支（`chat.source === 'gateway'` 或 `dataset_ids` 为空时）的 `useSendMessageWithSse` 调用替换为 `useSendAgentMessageWithSse`。RAG 增强分支（`dataset_ids` 非空）保持使用 `useSendMessageWithSse` 不变。

**`isCompletionError` 兼容性**：[use-send-shared-message.ts L113-115](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-shared-message.ts) 用 `send()` 返回值判断错误，`send()` 返回 `{ data: await res, response }`。新 hook 的 `send()` 返回值结构保持一致，不影响 `use-send-shared-message.ts`（该文件不切换到新 hook，但需验证）。

#### 2.2.4 修复 BFF `serializeChunk` `error` 分支

**修改文件**：[bff/src/routes/bff-agents.ts](file:///Users/simon/project/agentui/bff/src/routes/bff-agents.ts) `serializeChunk` `error` 分支

当前：
```ts
case 'error':
  payload = {
    event: 'error',
    data: { message: chunk.message, answer: `**ERROR**: ${chunk.message}` },
  };
  break;
```

修复后：
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

[StreamError 类型](file:///Users/simon/project/agentui/bff/src/types/stream.ts#L147-L156) 已定义 `toolCallId?: string`，此修复仅补全透传，不改变类型契约。

#### 2.2.5 reasoning 开闭状态由前端维护

**不修改 BFF**。`dispatchSseFrame` 内部维护 `reasoningOpen` 标志：
- 收到 `message` 事件且 `startToThink: true` → 设 `reasoningOpen = true`，调用 `onReasoning(content, true)`
- 收到 `message` 事件且 `endToThink: true` → 设 `reasoningOpen = false`，调用 `onReasoning('', false, true)`
- 收到 `tool_start` / `tool_complete` 事件且 `reasoningOpen` → 隐式闭合：先调用 `onReasoning('', false, true)` 再处理 tool 事件
- 收到 `done` 事件且 `reasoningOpen` → 隐式闭合：先调用 `onReasoning('', false, true)` 再调用 `onDone`

**注意**：当前 BFF 每条 reasoning chunk 都附带 `start_to_think: true`，`dispatchSseFrame` 需去重（仅在 `!reasoningOpen` 时触发 `isStart: true`）。

### 2.3 P0 验收 checklist

- [ ] `sse-event-dispatcher.ts` 单元测试覆盖 7 种事件类型 + 字段命名转换 + 未知 event 容错 + JSON 解析失败容错
- [ ] `useSendAgentMessageWithSse` 新增 hook，gateway 路径切换后 `answer` 字段不再被 tool/usage 事件污染
- [ ] tool call 事件累积到 `toolCalls` 数组，按 `toolCallId` 索引
- [ ] `usage` 字段正确接收 `promptTokens` / `completionTokens`
- [ ] reasoning 标签正确开闭（无重复 `<think>` 开标签，工具调用前自动闭合）
- [ ] **`useSendMessageWithSse` 完全不变**，其他 4 个调用方（`use-send-shared-message.ts` / `use-send-single-message.ts` / `next-search/hooks.ts` / RAG 增强分支）零回归
- [ ] BFF `serializeChunk` `error` 分支透传 `tool_call_id`
- [ ] BFF `serializeChunk` `delta` 分支 `metadata.reference` 在 gateway 路径正确写入 `message.reference`（IntellectRagAdapter 场景）
- [ ] 现有独立聊天页（`/next-chats/chat/`）端到端流程不回归：发送消息 → 流式响应 → done
- [ ] gateway 路径发送消息 → 触发工具调用 → answer 不被清空 → done
- [ ] TypeScript 编译通过（`npm run type-check`）
- [ ] BFF 测试通过（`cd bff && npm test`）

---

## 三、P1：Tool call 内联卡片 + Reasoning 实时增量流

### 3.1 Tool call 内联卡片

#### 3.1.1 组件设计

**新文件**：`src/components/next-message-item/tool-call-card.tsx`

参考 webui `buildToolCard` ([ui.js L6873-6921](file:///Users/simon/project/intellect-webui/static/ui.js))，React + shadcn/ui 实现：

```tsx
interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  preview?: string;          // progress 累积
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  durationMs?: number;
}

interface ToolCallCardProps {
  record: ToolCallRecord;
  defaultOpen?: boolean;
}
```

UI 结构（Tailwind）：
```
<div class="rounded-md border bg-muted/30 my-1">
  <button class="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/50">
    {status === 'running' ? <Loader2 class="animate-spin h-3 w-3" /> : <ChevronRight class="h-3 w-3" />}
    <span class="font-mono text-xs">{toolName}</span>
    <span class="text-xs text-muted-foreground truncate">{preview}</span>
    {durationMs && <span class="ml-auto text-xs text-muted-foreground">{durationMs}ms</span>}
  </button>
  {open && (
    <div class="border-t p-2 text-xs">
      {args && <pre class="bg-muted p-2 rounded">{JSON.stringify(args, null, 2)}</pre>}
      {result && <pre class="bg-muted p-2 rounded mt-1">{truncate(result, 800)}</pre>}
    </div>
  )}
</div>
```

#### 3.1.2 集成到消息渲染（穿插模式）

**修改文件**：[src/components/next-message-item/index.tsx](file:///Users/simon/project/agentui/src/components/next-message-item/index.tsx)

参考 webui `appendLiveToolCard` ([messages.js L6983](file:///Users/simon/project/intellect-webui/static/messages.js))，tool call 卡片**穿插在 content 流中**，而非统一前置/后置。时序语义：tool call 出现在它被调用时的文本位置（例如"我先搜索了 X（tool card）然后发现 Y（tool card）最终得出结论 Z"）。

**实现方式**：前端维护一个有序的 "内容片段" 数组，按 SSE 事件到达顺序交替存储 text 段和 toolCall 段：

```ts
type ContentSegment =
  | { type: 'text'; content: string }
  | { type: 'tool'; toolCallId: string };

interface IMessage {
  // ...existing fields
  contentSegments?: ContentSegment[];  // 有序内容片段
  toolCalls?: ToolCallRecord[];        // toolCallId → record 索引
  reasoning?: string;
  usage?: TokenUsage;
}
```

渲染时按 `contentSegments` 顺序输出：

```tsx
{message.contentSegments?.map(seg =>
  seg.type === 'text' ? (
    <MarkdownContent key={seg.key} content={seg.content} />
  ) : (
    <ToolCallCard key={seg.key} record={message.toolCalls!.find(tc => tc.toolCallId === seg.toolCallId)!} />
  )
)}
```

**简化方案（备选）**：若穿插渲染的复杂度过高，P1 先采用"content 完整 + toolCalls 后置"方案（tool call 卡片列表放在 content 之后），保留 content 完整性。这是 webui 在历史消息回看时的回退行为。**推荐先采用备选方案**，穿插渲染作为 P1.5 优化。

#### 3.1.3 数据流：SSE → message

**修改文件**：`src/hooks/use-send-agent-message-with-sse.ts`（P0 新增的 hook）

- `onToolStart`：push 新 ToolCallRecord（status='running'）；若采用穿插方案，同时 push 一个 `{type:'tool', toolCallId}` 到 contentSegments
- `onToolProgress`：更新对应 record 的 preview 累积
- `onToolComplete`：更新对应 record 的 result + status='completed' + durationMs
- `onError` 且 `toolCallId` 存在：更新对应 record 的 status='failed'

**修改文件**：[src/pages/next-chats/hooks/use-send-chat-message.ts](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-chat-message.ts)

在 `useEffect(answer, ...)` 处理 answer 累积之外，新增 `useEffect(toolCalls, ...)` 把 toolCalls 写入最新 assistant 消息的 `toolCalls` 字段。

**修改文件**：`src/interfaces/database/chat.ts`

给 `IMessage` 增加可选字段（见 §3.1.2）。

### 3.2 Reasoning 实时增量流

#### 3.2.1 状态管理（useRef + forceRender）

参考 webui `reasoningText` + `liveReasoningText` 双字符串模式 ([messages.js L726-727](file:///Users/simon/project/intellect-webui/static/messages.js))：

- `reasoning`: 累积字符串，整 turn 内不重置（用于持久化）
- `liveReasoning`: 工具调用后重置的字符串（用于实时显示，避免跨工具污染）

**实现位置**：`useSendAgentMessageWithSse` 内部（P0 新增的 hook）

**关键：用 useRef 存储实时值，避免 useState 异步批处理问题**。React 的 useState 是异步批量更新的，连续 `setReasoning` + `setLiveReasoning` + 立即读 `liveReasoning` 不会得到最新值。webui 用模块级变量（同步读写），React 需用 useRef 模拟。

```ts
const reasoningRef = useRef('');         // 累积，整 turn 不重置
const liveReasoningRef = useRef('');     // 工具后重置
const reasoningOpenRef = useRef(false);
const [, forceRender] = useReducer(x => x + 1, 0);

// handlers:
onReasoning(content, isStart, isEnd?) => {
  if (isStart && !reasoningOpenRef.current) {
    reasoningOpenRef.current = true;
  }
  if (isEnd) reasoningOpenRef.current = false;
  reasoningRef.current += content;
  liveReasoningRef.current += content;
  forceRender();  // 触发渲染
}

onToolStart / onToolComplete => {
  // 工具调用后重置 liveReasoning，保留 reasoning
  liveReasoningRef.current = '';
  forceRender();
}

// 暴露给消费者的值（读取 ref 当前值）
const reasoning = reasoningRef.current;
const liveReasoning = liveReasoningRef.current;
```

**备选实现**：用 `useSyncExternalStore`（React 18+）订阅外部存储，更适合流式场景。P1 先用 useRef + forceRender，若性能问题再迁移到 useSyncExternalStore。

#### 3.2.2 渲染组件

**新文件**：`src/components/next-message-item/reasoning-panel.tsx`

```tsx
interface ReasoningPanelProps {
  reasoning: string;
  liveReasoning?: string;   // 流式中实时显示
  isStreaming: boolean;
}
```

- 折叠/展开（默认折叠，流式中自动展开）
- partial `<think>` 标签剥离（参考 webui `_liveThinkingText`）
- 流式增量渲染（避免整段重渲染，可用 `useMemo` + 字符串 diff）

#### 3.2.3 集成到消息渲染

**修改文件**：`src/components/next-message-item/index.tsx`

替换现有 thinking 折叠逻辑（基于 `<think>` 标签正则），改为显式 `ReasoningPanel` 组件渲染 `message.reasoning` 字段。

### 3.3 P1 验收 checklist

- [ ] 收到 tool_start / tool_progress / tool_complete 事件后，消息内出现可折叠 tool call 卡片
- [ ] tool call 卡片按 `tool_call_id` 增量更新（不重复添加）
- [ ] reasoning 流式实时显示，partial `<think>` 标签剥离
- [ ] 工具调用后 reasoning 重新开始累积（不混入工具前内容）
- [ ] 持久化的 reasoning 内容在切换会话后能恢复
- [ ] 现有 LogSheet/workflow-timeline（画布路径）不受影响
- [ ] TypeScript 编译通过

---

## 四、P2：INFLIGHT 状态恢复 + Offline 横幅 + Context ring

### 4.1 INFLIGHT 状态恢复

参考 webui 三层结构 ([sessions.js L807-880](file:///Users/simon/project/intellect-webui/static/sessions.js), [ui.js L4248-4365](file:///Users/simon/project/intellect-webui/static/ui.js))，简化为两层（去除中间 localStorage 指针，直接用 sessionStorage 完整快照）。

#### 4.1.1 状态结构

**新文件**：`src/hooks/use-inflight-state.ts`

```ts
interface InflightState {
  sessionId: string;
  streamId?: string;          // 可选，BFF 当前未透传 active_stream_id
  messages: IMessage[];       // 包含 user 乐观消息 + assistant 流式消息
  toolCalls: ToolCallRecord[];
  reasoning: string;
  uploadedFiles: string[];
  updatedAt: number;
}

const INFLIGHT_TTL_MS = 10 * 60 * 1000; // 10 分钟
const INFLIGHT_STORAGE_KEY = 'agentui-inflight-state';
```

#### 4.1.2 API

```ts
function saveInflight(state: InflightState): void;
function loadInflight(sessionId: string): InflightState | null;
function clearInflight(sessionId: string): void;
```

存储策略：
- 内存：`Map<sessionId, InflightState>`（切换会话时快速恢复）
- sessionStorage：完整快照（页面刷新后恢复，10 分钟 TTL）
- 节流写入：token 增量 2s 节流，状态转换（tool/done/error）立即写入

#### 4.1.3 集成（合并时序）

**修改文件**：[src/pages/next-chats/hooks/use-send-chat-message.ts](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-chat-message.ts)

- 发送消息时：`saveInflight({sessionId, messages: [...derivedMessages, optimisticUserMsg], ...})`
- 流式接收时：节流更新 inflight state
- 流完成时（收到 `done` 事件）：立即 `clearInflight(sessionId)`，避免与 server 持久化的消息重复
- 切换会话时：检查 `loadInflight(newSessionId)`，若存在则合并到 `derivedMessages`

**合并时序**（关键，参考 webui `_mergeInflightTailMessages` [sessions.js L1530-1547](file:///Users/simon/project/intellect-webui/static/sessions.js)）：

1. 用户切换会话 → URL 参数变化 → TanStack Query 异步加载 server-side messages（200-500ms）
2. **加载中**：立即从 `loadInflight(newSessionId)` 读取 inflight tail，先显示 inflight 消息（乐观 user 消息 + 已接收的 assistant 流式内容）
3. **加载完成**：用 `_mergeInflightTailMessages(baseMessages, inflightMessages)` 合并：
   - 找到 inflight 中最后一个 `_live: true` 的消息
   - 包含其前一条 user 消息
   - 追加到 server-side 消息列表尾部
   - 用 `id` 去重，避免与 server 持久化的消息重复
4. **流完成后**：`clearInflight(sessionId)` 立即执行，下次切换会话时 server 已持久化，inflight tail 不再显示

**注意**：若 server 已经把 inflight 消息持久化了（流完成但 inflight 未清理的边界场景），合并时通过 `id` 去重避免重复。

#### 4.1.4 会话切换行为（无确认 dialog）

**不修改** [src/pages/next-chats/chat/sessions.tsx](file:///Users/simon/project/agentui/src/pages/next-chats/chat/sessions.tsx)。

**理由**：webui 不弹 dialog，自动恢复（INFLIGHT 状态本身就是为了无缝恢复）。弹 dialog 反而打断用户体验。INFLIGHT 的设计目标就是"用户无感"。

### 4.2 Offline 横幅（简化版）

**新文件**：`src/components/offline-banner.tsx`

参考 webui `showOfflineBanner` ([ui.js L16-112](file:///Users/simon/project/intellect-webui/static/ui.js))，但**移除 fetch monkey-patch**（与 [project_memory 约束](file:///Users/simon/.trae-cn/memory/projects/-Users-simon-project-agentui/project_memory.md) "`fetchWithRagToken` 显式列出参数，避免透传 signal/credentials/cache" 冲突，且影响所有 HTTP 请求）：

```tsx
export function OfflineBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const updateOnlineStatus = () => setVisible(!navigator.onLine);
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  // 重连探针：每 30s 探测 /health，恢复在线时自动消失
  // ...

  return visible ? (
    <div class="bg-yellow-500 text-black px-4 py-2 text-sm flex items-center gap-2">
      <WifiOff class="h-4 w-4" />
      <span>{t('offline.browser')}</span>
      <Button variant="link" size="sm" onClick={probeNow}>{t('offline.retry')}</Button>
    </div>
  ) : null;
}
```

挂载位置：`src/app.tsx` 顶层，在路由 outlet 之上。

**SSE 错误延迟**：`useSendAgentMessageWithSse` 和 `useSendMessageWithSse` 在 `onError` 时检查 `navigator.onLine`，离线时不弹错误 toast，由 offline banner 统一处理。

**网络错误检测**：普通请求错误由 TanStack Query 的全局 onError 处理，不在此横幅职责内。横幅仅响应 `navigator.onLine` 状态变化。

### 4.3 Context ring（上一 turn 用量显示）

**新文件**：`src/components/context-ring.tsx`

参考 webui `ctxIndicator` ([index.html L805-813](file:///Users/simon/project/intellect-webui/static/index.html), [ui.js L2427-2530](file:///Users/simon/project/intellect-webui/static/ui.js))：

```tsx
interface ContextRingProps {
  promptTokens: number;       // 来自上一 turn 的 usage 事件
  contextLength: number;      // 默认 128000
  completionTokens?: number;
}
```

UI：
- SVG 圆环（r=9.75，circumference=61.261056745）
- `strokeDashoffset = circumference * (1 - pct/100)`
- 颜色阈值：`<50%` 默认 / `50-75%` 黄色 / `>75%` 红色
- tooltip 显示详细 token 数、context length

**数据源限制（重要）**：
- BFF `usage` 事件**仅在 turn 结束时**（`run.completed`）发送一次
- webui context ring 的实时数据源是 `metering` / `context_status` 事件（流式中持续推送），但 Constitution Principle IV 的 8 值 StreamChunk 枚举**不包含 `metering` 类型**，BFF 无法透传
- **本方案的 Context ring 只能显示"上一 turn 的 token 用量"**，无法实时显示"当前 turn 的 token 占用"
- 这与 webui 的体验有差距，方案明确承认此限制

**可选增强（需宪法修正）**：
- 方案 A：扩展 Constitution Principle IV，新增 `metering` chunk 类型
- 方案 B：在 BFF `usage` chunk 中扩展 `contextLength` / `cumulativeTokens` 字段（属 Layer 3 透传，不破坏枚举）

**本期不实施增强**，仅显示上一 turn 用量。若体验不可接受，推迟到 P4 待宪法修正。

**集成位置**：[src/components/message-input/next.tsx](file:///Users/simon/project/agentui/src/components/message-input/next.tsx) Composer 工具栏，Thinking / Internet 开关旁。

### 4.4 P2 验收 checklist

- [ ] 发送消息中切换到其他会话再切回，乐观消息和已接收的流式内容能恢复
- [ ] 页面刷新后，若有 INFLIGHT 状态，恢复未完成的回复
- [ ] INFLIGHT 状态 10 分钟后自动失效
- [ ] 流完成后 `clearInflight` 立即执行，下次切换不重复显示
- [ ] 浏览器离线时显示横幅，恢复在线时自动消失
- [ ] 离线期间的 SSE error 不弹 toast，由横幅统一处理
- [ ] Context ring 显示上一 turn 的 token 占用百分比（非实时）
- [ ] Token >50% 黄色 / >75% 红色
- [ ] TypeScript 编译通过

---

## 五、P3：Slash 命令 + 选中文本回复 + Provider error 折叠

### 5.1 Slash 命令面板

**新文件**：`src/components/message-input/slash-command-palette.tsx`

参考 webui `commands.js` + `boot.js` L1060-1081。

#### 5.1.1 命令注册

```ts
interface SlashCommand {
  name: string;               // 'retry' / 'undo' / 'status' / 'usage'
  desc: string;
  noEcho?: boolean;           // true = 不作为用户消息发送
  arg?: { name: string; type: 'model' | 'text' };
  handler: (args: string, ctx: CommandContext) => void | Promise<void>;
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'retry', desc: '重新生成最后一条回复', noEcho: true, handler: ... },
  { name: 'undo', desc: '撤销最后一条用户消息', noEcho: true, handler: ... },
  { name: 'status', desc: '查看会话状态', noEcho: true, handler: ... },
  { name: 'usage', desc: '查看 token 用量', noEcho: true, handler: ... },
  { name: 'model', desc: '切换模型', arg: { name: 'model_name', type: 'model' }, handler: ... },
];
```

#### 5.1.2 触发逻辑

- Composer value 以 `/` 开头且无换行 → 触发面板
- 输入 `/` 后无空格 → 显示命令列表，按前缀过滤
- 输入 `/<cmd> ` 后 → 显示该命令的子参数（如 `/model` 列出可用模型）
- 键盘：↑↓ 选择 / Enter 确认 / Esc 关闭

#### 5.1.3 子参数源

- `model` 子参数：复用 `useFetchDefaultModelDictionary` / `useFetchLlmList`
- 其他类型（skill/agent）：本期不接入，留待后续扩展

#### 5.1.4 集成

**修改文件**：[src/components/message-input/next.tsx](file:///Users/simon/project/agentui/src/components/message-input/next.tsx)

在 textarea 下方叠加 `SlashCommandPalette` 组件，根据 `value` 决定显示/隐藏。

### 5.2 选中文本回复（多消息容器场景）

**新文件**：`src/components/selected-text-reply-button.tsx`

参考 webui `_selectedTextReplyButton` ([messages.js L129-258](file:///Users/simon/project/intellect-webui/static/messages.js))。

实现要点：
- 监听 `selectionchange` / `mouseup` / `keyup`
- 验证选区在聊天消息容器内
- 浮动按钮定位在选区上方
- 点击插入 Markdown 引用到 Composer：每行加 `> ` 前缀

```tsx
function formatQuote(text: string): string {
  return text.split('\n').map(line => `> ${line}`).join('\n');
}
```

**多消息容器场景**：AgentUI 独立聊天页支持多模型对比模式（`MultipleChatBox`），有多个消息容器并存。webui 是单消息容器，无此问题。

**实现策略**：
- "聊天根"应该是包含所有消息容器的父元素（`chatRootRef`），而非单个 `messageContainerRef`
- 选区验证：检查 `selection.anchorNode` 是否在 `chatRootRef.current` 内（`chatRootRef.current.contains(selection.anchorNode)`）
- 浮动按钮定位：基于选区 `getBoundingClientRect()`，相对于 `chatRootRef` 定位
- **限制**：仅在单 chat box 模式下启用插入功能；多 chat box 模式下，按钮仅显示，点击时提示"请先切换到单 chat box 模式"

**集成位置**：[src/pages/next-chats/chat/index.tsx](file:///Users/simon/project/agentui/src/pages/next-chats/chat/index.tsx) 顶层渲染。

### 5.3 Provider error 折叠

**修改文件**：[src/components/next-message-item/index.tsx](file:///Users/simon/project/agentui/src/components/next-message-item/index.tsx)

参考 webui `<details class="provider-error-details">` ([ui.js L6347-6350](file:///Users/simon/project/intellect-webui/static/ui.js))。

```tsx
{message.errorDetails && (
  <details class="rounded-md border border-destructive/30 bg-destructive/5 p-2 my-1">
    <summary class="text-xs text-destructive cursor-pointer">
      {t('message.providerErrorDetails')}
    </summary>
    <pre class="text-xs mt-2 p-2 bg-muted rounded overflow-auto">
      {message.errorDetails}
    </pre>
  </details>
)}
```

数据源：BFF `error` 事件当前 payload 仅 `{message, answer}`。可选扩展：BFF 在 `error` chunk 中增加 `details` 字段（如上游 provider 返回的原始 JSON）。**本期暂不扩展 BFF**，前端预留字段，待 BFF 后续补充。

### 5.4 i18n 接入

所有新增 UI 文案通过 i18next 接入，多语言键命名规范：

| 命名空间 | 键 | 默认文案 |
|---|---|---|
| `offline` | `offline.browser` | "浏览器离线，请检查网络连接" |
| `offline` | `offline.retry` | "重试" |
| `message` | `message.providerErrorDetails` | "Provider 错误详情" |
| `command` | `command.retry.desc` | "重新生成最后一条回复" |
| `command` | `command.undo.desc` | "撤销最后一条用户消息" |
| `command` | `command.status.desc` | "查看会话状态" |
| `command` | `command.usage.desc` | "查看 token 用量" |
| `command` | `command.model.desc` | "切换模型" |
| `contextRing` | `contextRing.tooltip.tokens` | "Tokens: {{used}} / {{total}}" |
| `contextRing` | `contextRing.tooltip.compress` | "上下文接近上限，可使用 /compress 压缩" |
| `toolCall` | `toolCall.running` | "运行中" |
| `toolCall` | `toolCall.completed` | "已完成" |
| `toolCall` | `toolCall.failed` | "失败" |
| `reasoning` | `reasoning.thinking` | "思考中..." |
| `reasoning` | `reasoning.show` | "显示思考过程" |
| `reasoning` | `reasoning.hide` | "隐藏思考过程" |

**修改文件**：
- `src/locales/zh-cn.json`（或对应的多语言文件）
- `src/locales/en-us.json`

### 5.5 P3 验收 checklist

- [ ] 输入 `/` 弹出命令面板，↑↓ 选择 / Enter 确认 / Esc 关闭
- [ ] 内置命令 `retry` / `undo` / `status` / `usage` 可执行（noEcho 不发送为消息）
- [ ] `/model` 显示可用模型子参数
- [ ] 选中聊天消息文本后，浮动按钮出现（单 chat box 模式）
- [ ] 多 chat box 模式下，按钮点击提示切换到单 chat box 模式
- [ ] 点击浮动按钮，选中文本以 Markdown 引用插入 Composer
- [ ] 消息含 `errorDetails` 字段时显示折叠的 provider 错误详情
- [ ] 所有新增文案接入 i18next，中英文齐全
- [ ] TypeScript 编译通过

---

## 六、不在本方案范围（deferred）

### 6.1 Approval / Clarify 卡片

**原因**：
1. `/api/sessions/{id}/chat/stream` 端点本身不发出 approval/clarify 事件（见 §1.2）
2. approval 走 `/v1/runs/{run_id}/events` 独立 SSE 通道，格式与主通道不同（`data:`-only JSON，event 字段在 JSON 内）
3. clarify 在 intellect-team api_server 中**根本未实现**（grep 返回空）
4. Constitution Principle IV 的 8 值 StreamChunk 枚举 NON-NEGOTIABLE，无法在主通道透传 approval/clarify
5. **Constitution Principle VIII 锁定 IntellectEnterpriseAdapter 主通道为 `/api/sessions/{id}/chat/stream`**，切换到 `/v1/runs/*` 路径需要宪法修正

**后续路径**（独立 spec，需宪法修正）：
- 方案 A：Constitution 修正 Principle VIII，将 IntellectEnterpriseAdapter 主通道切换到 `/v1/runs/*` 路径，前端通过 `/v1/runs/{run_id}/events` SSE 接收 approval 事件
- 方案 B：Constitution 修正 Principle IV，扩展 StreamChunk 枚举新增 `approval_request` / `approval_responded` 类型，BFF 在主通道透传

**BFF 旁路端点不可行**（已否决）：前端无法知道 approval 何时 pending，需要额外轮询端点，违反 YAGNI 原则且体验差。

**推荐**：方案 A，切换主通道到 `/v1/runs/*` 是更彻底的解决方案，但需独立 spec 推进宪法修正。

### 6.2 增量 streaming-markdown 解析

webui 用 smd 增量 DOM 构建避免整段重渲染。AgentUI 当前 `MarkdownContent` 整段重渲染。

**原因暂不实施**：
- React 的 `useMemo` + key 稳定 + `dangerouslySetInnerHTML` 已能处理大部分场景
- 性能瓶颈未实测验证
- 增量 markdown 解析库选型需独立调研

**触发条件**：单条消息 >5000 字符时再评估。

### 6.3 BFF `/api/session/*` stub 清理

[chat-session-gap-analysis.md §1.3](file:///Users/simon/project/agentui/docs/chat-session-gap-analysis.md) 提及的 stub 路由处置，与 SSE 事件处理无关，留作单独清理任务。

### 6.4 跨来源聚合 / 压缩链 / Memory 生命周期 / FTS / Worktree

依赖 BFF 自建会话存储（方案 A）或 intellect-team 侧扩展，不在本方案范围。参考 [gap-analysis §五 阶段 5](file:///Users/simon/project/agentui/docs/chat-session-gap-analysis.md)。

---

## 七、文件清单（按阶段）

### 7.1 P0 改动文件

| 文件 | 类型 | 改动 |
|---|---|---|
| `src/hooks/logic-hooks/sse-event-dispatcher.ts` | 新增 | SSE 事件分发器 + 类型定义 + 字段命名转换（snake_case → camelCase） |
| `src/hooks/logic-hooks/sse-event-dispatcher.test.ts` | 新增 | 单元测试（7 种事件类型 + 字段命名转换 + 未知 event 容错 + JSON 解析失败容错） |
| `src/hooks/use-send-agent-message-with-sse.ts` | 新增 | 独立 hook，仅服务 gateway 路径，使用分发器；暴露 `answer` / `reasoning` / `toolCalls` / `usage` / `error` / `done` |
| `src/pages/next-chats/hooks/use-send-chat-message.ts` | 修改 | gateway 分支切换到新 hook；RAG 增强分支保持不变 |
| `src/interfaces/database/chat.ts` | 修改 | `IMessage` 新增 `toolCalls` / `reasoning` / `usage` / `contentSegments?` 字段 |
| `bff/src/routes/bff-agents.ts` | 修改 | `serializeChunk` `error` 分支透传 `tool_call_id` |

**注意**：`src/hooks/logic-hooks.ts` 的 `useSendMessageWithSse` **不修改**，保持其他 4 个调用方零回归。

### 7.2 P1 改动文件

| 文件 | 类型 | 改动 |
|---|---|---|
| `src/components/next-message-item/tool-call-card.tsx` | 新增 | Tool call 内联卡片组件 |
| `src/components/next-message-item/reasoning-panel.tsx` | 新增 | Reasoning 折叠面板组件 |
| `src/components/next-message-item/index.tsx` | 修改 | 集成 toolCalls 穿插渲染（或后置）+ reasoning 渲染 |
| `src/pages/next-chats/hooks/use-send-chat-message.ts` | 修改 | 把 SSE 状态写入最新 assistant 消息 |

### 7.3 P2 改动文件

| 文件 | 类型 | 改动 |
|---|---|---|
| `src/hooks/use-inflight-state.ts` | 新增 | INFLIGHT 两层状态管理（内存 + sessionStorage） |
| `src/components/offline-banner.tsx` | 新增 | 离线横幅组件（仅 `navigator.onLine`，无 fetch monkey-patch） |
| `src/components/context-ring.tsx` | 新增 | Context ring SVG 组件（上一 turn 用量显示） |
| `src/app.tsx` 或 `src/layouts/` | 修改 | 挂载 OfflineBanner |
| `src/components/message-input/next.tsx` | 修改 | 集成 Context ring |
| `src/pages/next-chats/hooks/use-send-chat-message.ts` | 修改 | INFLIGHT 保存/恢复/合并 |

### 7.4 P3 改动文件

| 文件 | 类型 | 改动 |
|---|---|---|
| `src/components/message-input/slash-command-palette.tsx` | 新增 | Slash 命令面板 |
| `src/components/selected-text-reply-button.tsx` | 新增 | 选中文本回复按钮（支持多 chat box 场景） |
| `src/components/message-input/next.tsx` | 修改 | 集成 Slash 命令面板 |
| `src/components/next-message-item/index.tsx` | 修改 | Provider error 折叠 |
| `src/pages/next-chats/chat/index.tsx` | 修改 | 挂载选中文本回复按钮 |
| `src/locales/zh-cn.json` | 修改 | 新增 i18n 词条 |
| `src/locales/en-us.json` | 修改 | 新增 i18n 词条 |

### 7.5 BFF 改动文件

| 文件 | 阶段 | 改动 |
|---|---|---|
| `bff/src/routes/bff-agents.ts` | P0 | `serializeChunk` `error` 分支透传 `tool_call_id`（最小必要改动） |

**说明**：P0 仅做 BFF `error` 分支的最小修复，不引入有状态序列化（reasoning 开闭状态由前端维护）。

---

## 八、测试策略

### 8.1 单元测试

| 测试对象 | 框架 | 覆盖点 |
|---|---|---|
| `sse-event-dispatcher.ts` | Vitest | 7 种事件类型的解析与分发；字段命名转换（snake_case → camelCase）；JSON 解析失败容错；未知 event 容错；reasoning 开闭状态去重 |
| `use-inflight-state.ts` | Vitest | save/load/clear；TTL 过期；sessionStorage quota 错误降级 |
| `tool-call-card.tsx` | Vitest + React Testing Library | running/completed/failed 状态；折叠展开；result 截断 |
| `slash-command-palette.tsx` | Vitest + RTL | 命令过滤；键盘导航；子参数加载 |

### 8.2 集成测试

| 场景 | 验证点 |
|---|---|
| 独立聊天页端到端 | 发送消息 → 收到 tool_start/tool_progress/tool_complete → 收到 usage → done |
| INFLIGHT 恢复 | 发送中切换会话 → 切回 → 乐观消息和已接收流式内容恢复 |
| 离线模拟 | DevTools offline → 横幅出现 → SSE error 不弹 toast → 恢复在线 → 横幅消失 |
| Slash 命令 | 输入 `/` → 面板出现 → 选择 `/retry` → 触发重新生成 |

### 8.3 回归测试

- 画布 chat（`packages/canvas-plugin/src/editor/chat/`）不受影响（D6 约束）
- 现有 `useSendMessageBySSE`（canvas）调用路径保持不变
- `use-send-chat-message.ts` 现有 `answer` 字段语义向后兼容
- BFF `bff-agents.ts` 路由层零改动（P0 备选方案除外）

---

## 九、风险与缓解

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| 重构 `useSendMessageWithSse` 破坏现有调用方 | 高 | 保留 `answer` 字段语义不变；新增字段为可选；逐步迁移调用方 |
| INFLIGHT sessionStorage quota 超限 | 中 | 写入失败时降级为仅内存；evict 最旧条目；节流写入 |
| Tool call 卡片渲染性能（长会话累积大量 toolCalls） | 中 | 单条消息渲染的 toolCalls 数组按需虚拟化；超过 50 条折叠为 "显示更多" |
| Slash 命令与现有 Composer 输入冲突 | 低 | 仅在 value 以 `/` 开头且光标在第一行时触发 |
| 离线横幅与现有 toast 通知重复 | 低 | SSE error handler 显式检查 `navigator.onLine`，离线时不弹 toast |
| BFF 8 值枚举限制无法承载 approval/clarify | 高 | 已在 §6.1 deferred，单独立 spec 推进 |

---

## 十、与现有文档的交叉引用

- **基线**：[chat-session-gap-analysis.md](file:///Users/simon/project/agentui/docs/chat-session-gap-analysis.md) §1.3 关键缺口 / §四 P2-P4 任务清单
- **架构决策**：[chat-session-gateway-migration-review.md](file:///Users/simon/project/agentui/docs/chat-session-gateway-migration-review.md) §三 按场景分流 / §四 实施计划
- **宪法约束**：[.specify/memory/constitution.md](file:///Users/simon/project/agentui/.specify/memory/constitution.md) Principle IV (SSE Dual-Protocol) / Principle VIII (BFF ↔ Intellect Enterprise Access Contract)
- **上游契约**：[intellect-team adapter.py `_handle_session_chat_stream`](file:///Users/simon/project/intellect-team/plugins/platforms/api_server/adapter.py) / [BFF parseIntellectEnterpriseSSE](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-sse.ts)
- **UI 参考**：[intellect-webui static/messages.js](file:///Users/simon/project/intellect-webui/static/messages.js) / [static/ui.js](file:///Users/simon/project/intellect-webui/static/ui.js) / [static/sessions.js](file:///Users/simon/project/intellect-webui/static/sessions.js) / [static/commands.js](file:///Users/simon/project/intellect-webui/static/commands.js)
- **project_memory 约束**：
  - StreamChunk 枚举锁定 8 值，P3 启用 `tool_progress` —— 本方案 P1 启用，符合约束
  - BFF 数据存储遵循 YAGNI 原则 —— INFLIGHT 状态用 sessionStorage，不引入 BFF 存储
  - 模块级读取环境变量导致测试无法 stub —— 不涉及环境变量读取
  - `fetchWithRagToken` 显式列出参数 —— P2 OfflineBanner 已移除 fetch monkey-patch，仅用 `navigator.onLine`

---

## 十一、实施顺序

```
P0
├─ sse-event-dispatcher.ts + 单测
├─ useSendAgentMessageWithSse 新 hook
├─ BFF serializeChunk error 分支透传 tool_call_id
├─ use-send-chat-message.ts gateway 分支切换
└─ 端到端回归（gateway 路径 + 其他 4 个调用方不回归）

P1
├─ ToolCallCard 组件
├─ ReasoningPanel 组件
├─ IMessage 类型扩展（contentSegments / toolCalls / reasoning / usage）
└─ 消息渲染集成（穿插或后置）

P2
├─ use-inflight-state hook
├─ OfflineBanner 组件（无 fetch monkey-patch）
├─ ContextRing 组件（上一 turn 用量）
└─ Composer 集成

P3
├─ SlashCommandPalette 组件
├─ SelectedTextReplyButton 组件（多 chat box 场景）
├─ Provider error 折叠
├─ i18n 接入
└─ Composer 集成

P4 (deferred, 独立 spec)
└─ Approval/Clarify 卡片（需宪法修正 Principle VIII 切换主通道到 /v1/runs/*）
```

每个阶段完成后跑 `npm run type-check` + 相关 Vitest 套件 + 端到端冒烟测试（登录 → 创建 chat → 发送消息 → 验证 tool call/reasoning 显示 → 切换会话 → 验证 INFLIGHT 恢复）。
