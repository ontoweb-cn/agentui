# P0 代码评审

> 评审对象：P0 SSE 事件处理补全实施
> 评审日期：2026-07-27
> 评审方法：逐文件代码审查 + 行为推演 + 与原 `useSendMessageWithSse` 对比

---

## 评审结论

**⚠️ 发现 1 个 CRITICAL 缺陷（阻塞 P0 验收）+ 2 个 MODERATE 问题 + 3 个 MINOR 问题。**

CRITICAL 缺陷修复后可标记 P0 完成。

| 严重度 | 数量 | 阻塞验收 |
|---|---|---|
| CRITICAL | 1 | 是 |
| MODERATE | 2 | 否（建议修复） |
| MINOR | 3 | 否（可选） |

---

## 一、CRITICAL：`useDoneRecord.setDone` 不更新已存在的 `__default` 键

### 1.1 缺陷位置

[src/hooks/use-send-agent-message-with-sse.ts L58-61](file:///Users/simon/project/agentui/src/hooks/use-send-agent-message-with-sse.ts#L58-L61)

```ts
const setDone = useCallback((val: boolean) => {
  setDoneRecord((prev) => (isEmpty(prev) ? { __default: val } : prev));
}, []);
```

### 1.2 缺陷分析

`setDone` 仅在 `doneRecord` 为空时写入 `__default`。当 `doneRecord` 已含 `__default` 键时，直接返回 `prev`（不变）。

**行为推演**：

| 步骤 | 调用 | `doneRecord` 状态 | `done` 值 | 正确？ |
|---|---|---|---|---|
| 初始 | — | `{}` | `{}.__default ?? true = true` | ✅ |
| 发送消息 | `setDone(false)` | `{} → {__default: false}`（空，写入） | `false` | ✅ |
| 流完成 | `setDone(true)` | `{__default: false} → {__default: false}`（非空，不变） | `false` | ❌ |

**后果**：首条消息发送后 `done` 永远为 `false`，`sendLoading: !done` 永远为 `true`，用户无法发送第二条消息。**阻塞 P0 验收**。

### 1.3 与原 `useSendMessageWithSse` 的差异

原实现 [logic-hooks.ts L207-211](file:///Users/simon/project/agentui/src/hooks/logic-hooks.ts#L207-L211)：
```ts
const [done, setDone] = useState(true);           // 独立 useState
const { doneRecord, ... } = useSetDoneRecord();   // 仅服务多 chat box
```

原实现中 `done` 是独立 `useState`，`setDone(true/false)` 直接更新值，与 `doneRecord` 完全独立。本次实施错误地将两者合并到 `doneRecord.__default`，并引入了 `isEmpty(prev)` 守卫，破坏了更新语义。

### 1.4 修复方案

**方案 A（推荐）**：回归原设计，使用独立 `useState(true)` 管理 `done`，`doneRecord` 仅服务多 chat box。

```ts
export const useSendAgentMessageWithSse = () => {
  const [answer, setAnswer] = useState<IAnswer>({} as IAnswer);
  const [done, setDone] = useState(true);                        // ← 独立 useState
  const { doneRecord, clearDoneRecord, setDoneRecordById, allDone } =
    useSetDoneRecord();                                          // ← 复用共享 hook
  ...
  return {
    ...
    done,                        // ← 直接返回 useState 值
    doneRecord,
    allDone,
    setDone,                     // ← 直接返回 useState setter
    ...
  };
};
```

同时需将 `useDoneRecord` 替换为从 `@/hooks/logic-hooks` 导入 `useSetDoneRecord`（需确认其是否已 export，或复制实现并保留 `useEffect` 自动清理逻辑）。

**方案 B（最小改动）**：修复 `setDone` 逻辑，始终更新 `__default`：
```ts
const setDone = useCallback((val: boolean) => {
  setDoneRecord((prev) => ({ ...prev, __default: val }));
}, []);
```

方案 A 更优，因与原 `useSendMessageWithSse` 结构一致，可避免后续维护歧义。

---

## 二、MODERATE：`useDoneRecord` 缺少自动清理 `useEffect`

### 2.1 缺陷位置

[src/hooks/use-send-agent-message-with-sse.ts L43-70](file:///Users/simon/project/agentui/src/hooks/use-send-agent-message-with-sse.ts#L43-L70)

### 2.2 分析

原 `useSetDoneRecord` [logic-hooks.ts L192-196](file:///Users/simon/project/agentui/src/hooks/logic-hooks.ts#L192-L196) 含自动清理 effect：
```ts
useEffect(() => {
  if (!isEmpty(doneRecord) && allDone) {
    clearDoneRecord();
  }
}, [allDone, clearDoneRecord, doneRecord]);
```

本实施的 `useDoneRecord` 未包含此 effect。多 chat box 场景下，`doneRecord` 会在 `allDone` 后保留 `{[chatBoxId]: true}` 不被清理，导致：
- `allDone` 在后续 render 中始终为 `true`（因为 `Object.values({a:true}).every(v=>v)` 为 `true`）
- 下次 `setDoneRecordById(chatBoxId, false)` 会使其变 `false`，`allDone` 变 `false` —— 行为正确但 `doneRecord` 会无限累积旧 chatBoxId 条目

**影响**：内存泄漏（轻微），多 chat box 切换场景下 `allDone` 语义可能不准确。P0 单 chat box 场景不受影响（使用 `__default`），但 P1+ 多 chat box 场景会暴露。

### 2.3 修复

采用 §一 方案 A 后，直接复用 `useSetDoneRecord`（含自动清理 effect），无需单独维护。

---

## 三、MODERATE：`onToolProgress` 按 `toolName` 回退匹配可能误更新

### 3.1 缺陷位置

[src/hooks/use-send-agent-message-with-sse.ts L209-216](file:///Users/simon/project/agentui/src/hooks/use-send-agent-message-with-sse.ts#L209-L216)

```ts
onToolProgress: (data) => {
  toolCallsRef.current = toolCallsRef.current.map((tc) =>
    tc.toolCallId === data.toolCallId || tc.toolName === data.toolName
      ? { ...tc, preview: (tc.preview ?? '') + data.content }
      : tc,
  );
  forceRender();
},
```

### 3.2 分析

当 `data.toolCallId` 为 `undefined`（BFF `tool_progress` 事件可选字段），回退到按 `toolName` 匹配。若同名工具并发调用（如两个 `web_search` 同时运行），两条记录都会被更新，导致 preview 串扰。

**实际影响**：intellect-team 当前不并发同名工具，但 P3 企业版编码 Agent 可能触发。P0 阶段无实际影响。

### 3.3 建议

P0 可暂不修复，记录为 P1 TODO。P1 实现 tool call 卡片时改为：
- `data.toolCallId` 存在时按 ID 匹配
- 不存在时按 `(toolName, status==='running')` 匹配最新一条（而非全部）

---

## 四、MINOR 问题

### 4.1 `reset()` 未在 `use-send-chat-message.ts` 中接线

[src/hooks/use-send-agent-message-with-sse.ts L287-290](file:///Users/simon/project/agentui/src/hooks/use-send-agent-message-with-sse.ts#L287-L290) 暴露了 `reset()` 方法（切换会话时重置实时状态），但 [use-send-chat-message.ts](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-chat-message.ts) 未调用它。

**影响**：切换会话时 `reasoningRef`/`toolCallsRef`/`usageRef` 不会被清空。但 P0 不渲染这些字段（P1 启用），且 `send()` 开头会调用 `resetRealtimeState()`，所以下次发送时状态会被重置。无实际影响。

**建议**：P1 启用渲染时再接线。

### 4.2 `answer` 引用切换可能导致 `addNewestAnswer` 重复触发

[use-send-chat-message.ts L256-261](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-chat-message.ts#L256-L261) 的 `useEffect` 依赖 `answer`。当 `isGatewayChat` 切换时，`activeSse` 切换，`answer` 引用变化（从 `gatewaySse.answer` 到 `ragSse.answer`），即使两者都为 `{}`，引用不同也会触发 effect。

**实际影响**：`answer.answer` 为 falsy 时不调用 `addNewestAnswer`，无副作用。仅多一次 effect 调用。

**建议**：可选优化，P0 不修复。

### 4.3 `console.info('removeLatestMessage111')` 调试日志残留

[use-send-chat-message.ts L161](file:///Users/simon/project/agentui/src/pages/next-chats/hooks/use-send-chat-message.ts#L161) 含调试日志。这是原代码残留，非本次引入。eslint 已有 `no-console` warning。

**建议**：可选清理。

---

## 五、已验证通过项

### 5.1 架构设计 ✅
- D4 决策（新增独立 hook）正确实现，`useSendMessageWithSse` 零改动
- 同时调用两个 hook 符合 React Rules of Hooks
- `isGatewayChat` 提升到 render scope 使 `answer`/`done` 能从正确 hook 取值

### 5.2 `sse-event-dispatcher.ts` 实现 ✅
- 7 种事件路由正确
- snake_case → camelCase 转换完整
- reasoning 开闭状态维护（去重 + 隐式闭合）逻辑正确
- 容错处理（空数据 / JSON 解析失败 / 未知 event）正确
- 29 个单测全通过

### 5.3 BFF `serializeChunk` error 分支修复 ✅
- `tool_call_id` 透传正确
- 条件展开 `...(chunk.toolCallId ? { tool_call_id: chunk.toolCallId } : {})` 避免空字段

### 5.4 `use-send-chat-message.ts` L142 检查逻辑修复 ✅
- `res?.data?.code !== 0` → `res?.data?.code !== undefined && res?.data?.code !== 0`
- 正确处理 gateway 路径流式成功时 `code: undefined` 的场景

### 5.5 类型安全 ✅
- `metadata.reference as IReference` 类型断言合理（BFF 契约保证）
- `ToolCallRecord` / `TokenUsage` / `ContentSegment` 类型定义完整
- `tsc --noEmit` 通过

### 5.6 零回归 ✅
- BFF 414/414 测试通过
- `useSendMessageWithSse` 完全不变，其他 4 个调用方零回归
- TypeScript 编译通过

---

## 六、修复优先级

| 优先级 | 问题 | 修复时机 |
|---|---|---|
| **P0 阻塞** | §一 `setDone` 不更新已存在 `__default` | **立即修复** |
| P1 建议 | §二 缺少自动清理 effect | 与 §一 一起修复（方案 A 自动解决） |
| P1 建议 | §三 `onToolProgress` 按 toolName 回退 | P1 实现 tool call 卡片时修复 |
| P2 可选 | §四.1 `reset()` 未接线 | P1 启用渲染时 |
| P2 可选 | §四.2 effect 重复触发 | 可选优化 |
| P3 可选 | §四.3 调试日志残留 | 可选清理 |

---

## 七、实施授权

修复 §一 CRITICAL 缺陷后，重新运行 `npm run type-check` + `npx jest sse-event-dispatcher` + `cd bff && npm test`，确认全绿后标记 P0 完成。
