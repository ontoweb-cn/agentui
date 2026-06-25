# 多步编排、会话管理、聚合查询的实现模块分析

## 结论：目前这三个能力**全部由 Intellect Python 后端实现**，前端直连调用，BFF 尚未参与

---

## 一、多步编排（Agent 执行引擎）

### 实现方：Intellect Python 后端

| 环节 | 实现位置 | 说明 |
|------|---------|------|
| **DSL 解析与执行** | Intellect `agent/` 模块 | 接收画布 DSL（nodes + edges），按拓扑顺序执行节点 |
| **SSE 流式输出** | `POST /api/v1/agents/chat/completions` | 通过 Server-Sent Events 逐步返回执行事件 |
| **节点调试** | `POST /api/v1/agents/{id}/components/{cid}/debug` | 单节点调试执行 |
| **执行追踪** | `GET /api/v1/agents/{id}/logs/{msgId}` | 返回每个节点的输入/输出/耗时 |

### 前端调用链

```
useSendAgentMessage (src/pages/agent/chat/use-send-agent-message.ts)
  ↓
useSendMessageBySSE (src/hooks/use-send-message.ts)
  ↓ fetchEventSource
POST /api/v1/agents/chat/completions  →  Intellect :9380
```

前端通过 `EventSourceParserStream` 解析 SSE 事件流，事件类型包括：

```typescript
enum MessageEventType {
  WorkflowStarted,    // 工作流开始
  NodeStarted,        // 节点开始
  NodeFinished,       // 节点完成
  Message,            // 消息片段
  MessageEnd,         // 消息结束
  WorkflowFinished,   // 工作流完成
  UserInputs,         // 用户输入
  NodeLogs,           // 节点日志
}
```

**画布上的执行路径高亮**就是基于 SSE 返回的 `NodeStarted`/`NodeFinished` 事件，在 `flowDetail.dsl.path` 中记录路径，由 [edge/index.tsx](../src/pages/agent/canvas/edge/index.tsx) 高亮显示。

## 二、会话管理（Session）

### 实现方：Intellect Python 后端

| 操作 | API | 前端调用方 |
|------|-----|-----------|
| 创建会话 | `POST /api/v1/agents/{id}/sessions` | [use-agent-request.ts](../src/hooks/use-agent-request.ts) → `createAgentSession` |
| 列出会话 | `GET /api/v1/agents/{id}/sessions` | `fetchAgentLogsByCanvasId` |
| 删除会话 | `DELETE /api/v1/agents/{id}/sessions/{sid}` | `deleteAgentSession` |
| 会话内消息 | SSE 流式返回 | `useSendAgentMessage` |

### 前端调用链

```
src/hooks/use-agent-request.ts
  ├── createAgentSession()     → POST /api/v1/agents/{id}/sessions
  ├── deleteAgentSession()     → DELETE /api/v1/agents/{id}/sessions/{sid}
  └── fetchAgentLogsByCanvasId → GET /api/v1/agents/{id}/sessions (带分页)
      ↓
src/services/agent-service.ts  (HTTP 封装)
      ↓
src/utils/request.ts           (axios 实例，自动加 Authorization)
      ↓
/api/v1/agents/*  →  Intellect :9380
```

会话 ID 在聊天过程中由 SSE 响应的 `session_id` 字段返回，前端缓存后用于后续消息发送：

```typescript
// use-send-agent-message.ts
useEffect(() => {
  if (firstAnswer?.session_id) {
    setSessionId(firstAnswer.session_id);  // 从首个 SSE 事件提取
  }
}, [firstAnswer]);
```

## 三、聚合查询

### 实现方：Intellect Python 后端 + 前端 TanStack Query 缓存

目前没有独立的"聚合查询"API，而是通过**前端组合多个 Intellect API** 实现：

| 场景 | 实现方式 |
|------|---------|
| **Agent 详情 + 消息列表** | `useFetchAgent` 获取 DSL，`buildMessageListWithUuid` 处理消息 |
| **执行追踪 + 日志** | `useFetchMessageTrace` 每 3 秒轮询 `GET /api/v1/agents/{id}/logs/{msgId}` |
| **会话列表 + 统计** | `useFetchSessionsByCanvasId` 一次请求获取分页数据 |
| **Dataflow 列表** | `useFetchDataflowList` 调用 `/api/v1/dataflows` |

前端使用 **TanStack Query (React Query)** 做客户端缓存和聚合：

```typescript
// 典型模式：useQuery + queryKey 缓存
const { data } = useQuery({
  queryKey: [AgentApiAction.FetchAgentDetail, id],
  queryFn: async () => {
    const { data } = await agentService.getAgent(id);
    // 前端加工：处理消息 UUID、初始化全局变量
    const messageList = buildMessageListWithUuid(get(data, 'data.dsl.messages', []));
    set(data, 'data.dsl.messages', messageList);
    return data?.data ?? {};
  },
});
```

## 四、整体数据流全景

```
┌──────────────────────────────────────────────────────────┐
│                    前端 (React SPA)                        │
│                                                           │
│  TanStack Query (缓存/聚合)                                │
│  ├── use-agent-request.ts    → Agent CRUD + Session       │
│  ├── use-dataflow-request.ts → Dataflow 管理              │
│  ├── use-send-message.ts     → SSE 流式聊天               │
│  └── use-chat-request.ts     → 普通聊天                   │
│         ↓                                                 │
│  services/agent-service.ts   (HTTP 封装)                  │
│  services/dataflow-service.ts                            │
│         ↓                                                 │
│  utils/request.ts (axios + Authorization)                 │
└──────────────────┬───────────────────────────────────────┘
                   │
                   │  /api/v1/*  和  /v1/*  直连
                   ↓
┌──────────────────────────────────────────────────────────┐
│              Intellect Python 后端 (:9380)                   │
│                                                           │
│  /api/v1/agents              → Agent CRUD                 │
│  /api/v1/agents/chat/completions → SSE 多步编排执行        │
│  /api/v1/agents/{id}/sessions → 会话管理                  │
│  /api/v1/agents/{id}/logs/{msgId} → 执行追踪              │
│  /api/v1/agents/{id}/components/{cid}/debug → 节点调试    │
│  /api/v1/dataflows           → Dataflow 管理              │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│              BFF (:9390) ← 当前未参与上述流程               │
│  仅代理 /api/agent CRUD，Session 路由还是 stub             │
└──────────────────────────────────────────────────────────┘
```

## 五、总结

| 能力 | 当前实现方 | BFF 是否参与 | 备注 |
|------|-----------|-------------|------|
| **多步编排** | Intellect Python (`agent/` 模块) | 否 | SSE 流式执行，前端直连 `/api/v1/agents/chat/completions` |
| **会话管理** | Intellect Python | 否 | 前端直连 `/api/v1/agents/{id}/sessions`，BFF 的 session 路由是 stub |
| **聚合查询** | Intellect Python + 前端 TanStack Query | 否 | 前端组合多个 API + 客户端缓存 |

## 六、BFF 的规划角色

根据 [BFF Session 路由](../bff/src/routes/session.ts) 中的注释 "to be implemented as Harness logic migrates"，未来这些 Harness 特有的逻辑（如会话管理、多步编排的编排层、聚合查询）会逐步从 Intellect 迁移到 BFF，但目前尚未开始这一迁移。

### 迁移路线展望

```
当前状态:
  前端 ──直连──→ Intellect (所有逻辑)

未来目标:
  前端 ──→ BFF (Harness 逻辑) ──→ Intellect (基础 RAG 能力)
           ├── 会话管理
           ├── 多步编排编排层
           └── 聚合查询
```

### 迁移判断依据

BFF 应当承接那些 **Agent Harness 特有**而非通用 RAG 的逻辑：

1. **会话管理** - Agent 会话与普通 Chat 会话不同，涉及 DSL 状态、变量持久化等
2. **多步编排编排层** - 在 Intellect 执行引擎之上，增加编排策略（重试、条件分支、并行等）
3. **聚合查询** - 将多个 Intellect API 的结果组合为前端所需的数据结构
4. **权限/配额** - Agent 级别的访问控制和资源配额管理
