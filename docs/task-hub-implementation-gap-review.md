# Task Hub 差异分析评审

> **评审对象**:[task-hub-implementation-gap-analysis.md](./task-hub-implementation-gap-analysis.md)
> **参照模型**:[task-hub-task-model-recommendation.md](./task-hub-task-model-recommendation.md)
> **结论**:**方向正确,有条件通过**。差异清单能支撑“不要继续用 Session 冒充 Task”的判断,
> 但存在 **术语混淆、Task/Run 身份矛盾、来源范围不清、非功能要求缺失** 四类问题;
> 建议先修订分析,再进入实施。

---

## 一、总体评价

### 做得好的

1. 正确识别了核心问题:当前 `TaskList` 是 Session 列表,不是 Task 列表。
2. 正确指出 `status='completed'` 是伪状态,不能表达 running/failed/cancelled。
3. 正确区分了 Task、Step、Source 的目标语义,并给出 Chat/Agent 共用模型的建议。
4. 差异清单 G1-G12 有具体代码证据,能直接指导改造。
5. P0“先止血、改名/去伪状态”与 P2“后端 Task store”顺序合理。

### 评审结论

**不能直接按当前文档实施。** 需要先回答:

- 这里的 “Session” 指 Gateway Session(chat),还是聊天页的 `Sessions` 侧栏?
- Task 的身份是 `runId`,还是“用户意图”(可包含多个 run/attempt)?
- Agent 任务、Canvas task 是否属于同一个 Task Hub?
- Task API 的租户/RBAC、持久化、历史回填怎么做?

---

## 二、必须修正的歧义

### R1 “Session”一词被混用(高)

分析中把两个不同概念都叫 Session:

| 代码概念 | 实际含义 | 用途 |
|---|---|---|
| `useFetchChatList()` 返回的 Gateway Session | **session = chat(一对一)**,一个会话/一段对话 | `TaskList` 当前的数据源 |
| `useFetchSessionList()` | 聊天详情侧栏的“子会话”占位,只返回当前 chat | `Sessions` 侧栏,当前是单条占位 |

`gateway-chat-service.ts` 明确写着:

> Gateway session 模型:session = chat(一对一),无 intellect-rag 的 chat → sessions 嵌套概念。

因此:

- G9“Session 容器是单会话占位”是 **Sessions 侧栏**的问题,不是 `TaskList` 用 Session 当 Task 的原因;
- `TaskList` 用的是 **chat list**,每个 item 是一段完整对话,内部包含多个 user turn;
- “Session 是容器”成立,但必须说明是“Gateway Session = 会话/chat”,而不是 `useFetchSessionList` 的子会话。

**修订建议**:增加术语表,区分:

- `ChatSession` / `Gateway Session`(会话,Task 的容器);
- `SessionsSidebarEntry`(聊天页侧栏的子会话占位);
- `Task`(一次意图/执行);
- `Run`(一次执行尝试);
- `Step`(tool call/workflow node)。

### R2 Task 身份与 Run 身份矛盾(高)

推荐模型写:

```ts
interface Task {
  id: string;   // 一次执行的稳定标识,优先用 Gateway runId
  runId?: string;
}
```

同时又写“重试建议同一 Task 下挂 attempt”。这两者冲突:

- 如果 `Task.id = runId`,重试产生新 run,就会变成新 Task;
- 如果要“同一 Task 多 attempt”,Task 必须有独立于 run 的稳定 `taskId`,并维护 `runs/attempts`。

**修订建议**:二选一并写清楚:

- **方案 1(推荐)**:`taskId` 是用户意图的稳定 id;`runs: TaskRun[]` 记录每次 attempt;`activeRunId` 指向当前执行;
- **方案 2**:Task = 单次 run;重试生成新 Task,用 `retryOf` 关联。

否则 `id/runId/retryOf` 的语义会在前后端分叉。

### R3 Chat/Agent/Canvas 的来源范围不清(高)

分析写“Chat / Agent 是任务来源”,但当前代码里:

- `TaskList` 只读 chat sessions;
- Agent 有独立的 `agent-log-page`/agent 列表;
- BFF 还有 `canvas.ts` 的 `POST /canvas/tasks/:taskId/cancel`,属于画布/工作流任务。

需要明确:

1. Task Hub 是否包含 Agent 任务?
2. Canvas/workflow task 是否复用同一个 Task 模型?
3. `source: 'chat' | 'agent'` 是否足够,还是需要 `canvas`?
4. Agent 的 “template” 与 “run” 是两个概念,Task 只对应 run。

**修订建议**:增加 scope matrix:

| 来源 | 是否进入 Task Hub | Task id | 状态源 |
|---|---|---|---|
| Chat | 是 | runId/taskId | Chat SSE |
| Agent | 待定 | agent runId | Agent SSE |
| Canvas | 待定 | canvas taskId | canvas API |

### R4 状态、步骤、时长定义不足(中)

- `waitingApproval=true` 仍算 `running`:UI 如何分组?建议增加“Needs attention”派生视图,而不是新增状态。
- `stepCount`:是 tool call 次数、去重工具数,还是 workflow node 数?失败重试是否重复计数?
- `pending`:什么场景触发?`POST /v1/runs` 返回 started,是否真的有 queued 状态?
- `duration`:墙钟时长(含审批等待)还是 active 时长?TaskCard 展示哪一个?
- `failed` 的 `error` 是否展示给用户?是否包含上游敏感信息?

**修订建议**:在分析中补一张“状态/步骤/时长口径表”,明确每个字段的计算方式和展示方式。

---

## 三、分析遗漏

### R5 租户/RBAC/可见性(高,安全)

Task API 必须继承 Session 的租户与可见性约束:

- `GET /api/tasks?sessionId=` 不能绕过 session 权限;
- 插件会话(`plugin:`)已被主列表过滤,Task API 也要一致;
- Agent/Canvas 任务可能有独立 RBAC;不能只按 sessionId 过滤;
- 任务详情/删除/取消都要做权限校验。

当前分析完全未提这一层,实施时容易产生越权列表/越权深链。

### R6 持久化与事件幂等(高)

- `sessionRuns` 是进程内 `Map`,上限 512,只保留“最近 runId”;刷新/重启/多 worker 都会丢;
- 分析没有说明 Task store 选型(DB/Redis/文件)、并发更新、SSE 重连后的状态补偿;
- `run.completed`/`run.failed` 可能重复/乱序,Task 更新需要幂等键(至少 `runId + eventId/sequence`);
- 前端断线重连后如何从 Task API 恢复状态?

### R7 历史任务回填(中)

- 现有 Session 历史没有独立 task/run 记录;
- 若 turn 投影,历史 user message 可能缺失(现有占位兜底),不能保证标题/状态;
- 分析需要明确:历史数据是“不回填、只从新 run 开始”,还是“估算回填”;后者必须标注精度。

### R8 IA/路由改名的影响(中)

P0 建议把当前 `/tasks` 索引改名“会话”,但没有说明:

- 一级导航仍叫“任务”时,任务 Hub 下没有任务,是否可接受?
- 是否把会话列表移回 Chat,Task Hub 只保留“建设中”空态?
- 路由/深链/书签兼容:`/tasks` 是否保留 redirect?
- 子菜单“任务/聊天/智能体”如何调整?

**建议**:P0 不改路由,只改页面标题/状态展示;真正的任务中心在 P2 上线后再切换 `/tasks`。

### R9 分页/分组范围(中)

分析遗漏了当前已知的 R2:TaskList 只对**当前分页(默认 50)**分组;搜索/分页是客户端切片。Task API 设计必须明确:

- 服务端分页/排序;
- 状态/来源筛选在服务端;
- 分组是 UI 层还是 API 层。

### R10 测试与验收缺口(中)

- 差异分析没有列出测试项;
- 当前 TaskList 测试 mock 了 `TaskCard` 和分页,无法验证真实状态/深链;
- 需要补:
  - Task 状态机单测(成功/失败/取消/审批);
  - 事件乱序/重复的幂等测试;
  - RBAC/租户隔离测试;
  - 深链定位测试;
  - 历史回填精度测试。

---

## 四、对分析结论的修正建议

| 原表述 | 建议修正 |
|---|---|
| “Session 是会话容器” | 明确“Gateway Session = chat/会话容器”;`useFetchSessionList` 是侧栏占位,另列问题 |
| “Task 是一次完整交互过程” | 明确 Task 与 Run 的身份关系;重试是 attempt 还是新 Task |
| “Chat/Agent 是来源” | 增加 Canvas/Agent template/run 的范围矩阵 |
| “工具调用是 step” | 定义 stepCount 口径(调用次数/去重/节点) |
| “所有任务 completed” | 保留,但补充“TaskList 只对当前分页分组”“TaskCard 测试 mock”等已知问题 |
| “P0 改名” | 改为“先改页面文案/状态,不动路由”;避免一级导航语义冲突 |

---

## 五、评审结论与下一步

### 结论

- **方向正确**:Session 不能冒充 Task,必须引入 Task/Run/Step 与真实状态。
- **暂不具备实施条件**:Task 身份、来源范围、RBAC、持久化、历史回填未定。
- **建议**:先修订分析文档的术语与边界,再启动 P0/P1/P2。

### 建议的决策顺序

1. 定术语:Gateway Session / Task / Run / Attempt / Step / Source。
2. 定 Task 身份:稳定 `taskId` + runs,还是 `runId` 即 Task。
3. 定来源范围:Chat / Agent / Canvas 是否同一 Task Hub。
4. 定非功能:租户/RBAC、持久化、幂等、保留/删除。
5. 再改 UI 与 API。

### 最小可行下一步

- 只做 **P0 文案/状态止血**:当前页面标为“会话”,不再展示伪 `completed`;
- 不改 `/tasks` 路由;
- 暂不实现 turn 投影(历史数据不可靠);
- 等 Task 身份与 RBAC 明确后,再建 BFF Task store。

---

## 六、参考

- 差异分析:[task-hub-implementation-gap-analysis.md](./task-hub-implementation-gap-analysis.md)
- 目标模型:[task-hub-task-model-recommendation.md](./task-hub-task-model-recommendation.md)
- Gateway Session 语义:`src/services/gateway-chat-service.ts`
- 当前 TaskList:`src/pages/tasks/task-list.tsx`
- 当前 Session 占位:`src/hooks/use-chat-request.ts` 的 `useFetchSessionList`
- BFF run 跟踪:`bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts` 的 `sessionRuns`
