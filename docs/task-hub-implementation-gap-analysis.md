# Task Hub 实现与目标模型差异清单

> **目标表述（定稿）**:
> **Session 是会话容器；Task 是一次“用户意图 → Agent 执行”的完整交互过程；Chat / Agent 是任务来源或入口，不是 Task 本身；工具调用是 Task 的 step，不是独立 Task。**
>
> **对照对象**:当前 `tasks` hub / `TaskList` / `TaskCard` / BFF run 链路
> **结论**:当前实现是 **Session 列表投影**,不是 Task 列表;语义、状态、时长、步骤、来源均不一致。
> **评审记录**:[task-hub-implementation-gap-review.md](./task-hub-implementation-gap-review.md)(有条件通过;术语/身份/来源/RBAC 需先修订)
> 完整目标模型见 [task-hub-task-model-recommendation.md](./task-hub-task-model-recommendation.md)。

---

## 一、逐条对照

| 目标表述 | 当前实现 | 是否一致 |
|---|---|---|
| Session 是会话容器 | `TaskList` 直接把 Session 当 Task;`mapSessionToTask(session)`;Task 的 `id` 就是 Session id | ❌ 容器与任务混为一谈 |
| Task 是一次完整交互过程 | 没有 Task/Run 实体;没有 run 开始/结束/步骤;没有任务详情 | ❌ 不存在任务实体 |
| Chat/Agent 是来源,不是 Task 本身 | `TaskList` 只读 `useFetchChatList()` 的 chat sessions;Agent 交互没有进入 Task 列表;`TaskCard` 没有 `source` 字段 | ❌ 来源未建模,Agent 完全缺失 |
| 工具调用是 Task 的 step | ActivityTree/ToolCallCard 只在消息内渲染;`TaskCard` 没有 `stepCount`;Task 与 toolCalls 无关联 | ❌ 步骤未归属于 Task |

---

## 二、当前实现事实

### 2.1 数据源

- `src/pages/tasks/task-list.tsx`
  - 调用 `useFetchChatList()`(Gateway Session 列表)。
  - `data.chats.map(mapSessionToTask)`。
  - 按 `updatedAt` 分 Today/Yesterday/Earlier。
- `src/pages/tasks/task-list-utils.ts`
  - `mapSessionToTask(session: IDialog)`:
    - `id = session.id`
    - `title = session.name`
    - `status = 'completed'`(固定)
    - `createdAt = session.create_date`
    - `durationMs = session.update_date - session.create_date`
- `src/pages/tasks/index.tsx`
  - `/tasks` 索引渲染 `TaskList`;子菜单“任务 / 聊天 / 智能体”。
- `src/components/trae-work/types.ts`
  - `TaskCardProps` 只有 `id/title/description/status/createdAt/updatedAt/currentStep/progress` 等;
  - 没有 `source/sessionId/runId/stepCount/waitingApproval/error/lastMessageId`。

### 2.2 Session 侧栏

`src/hooks/use-chat-request.ts` 的 `useFetchSessionList()` 当前是单会话占位:

```ts
return [{
  id: id!,
  chat_id: id!,
  name: sessionName,
  messages: [],
  is_new: true,
  create_date: '',
  update_date: '',
  ...
}]
```

因此:

- 一个 Session 内没有多 Task 列表;
- “会话容器”只剩一个占位项;
- 无法在 Session 维度展示多个 Task。

### 2.3 Run 数据

- BFF `IntellectEnterpriseAdapter` 已跟踪 `runId`:
  - `sessionRuns` 保存 `sessionId → 最近 runId`,用于 cancel;
  - 上限 512,进程内 Map,非持久化。
- 前端 SSE dispatcher 能拿到 `runId`:
  - `approval_request` 的 `runId` 用于提交审批;
  - `use-send-agent-message-with-sse` 有 `pending.runId`;
  - 但前端没有把 `runId` 写入 Task。
- BFF 没有 `/api/tasks` 路由;`bff/src/routes` 中只有:
  - `canvas.ts` 的 `POST /canvas/tasks/:taskId/cancel`(画布/工作流取消,不是 Task Hub 列表);
  - `plugins.ts` 的静态 `/tasks` 路径,与任务实体无关。

**结论**:Run 信息是“有但未建模”,没有成为 Task 的数据源。

### 2.4 状态与进度

- `TaskList` 全部 `completed`;
- 流式状态在 `StreamStatus`/Session 内展示,未回写 Task;
- `pendingApproval`/`pendingClarify` 只在消息级卡片;
- `ToolCallRecord` 只在 ActivityTree,未聚合到 Task 的 `stepCount`;
- 失败/停止/等待审批没有 Task 级状态。

### 2.5 深链与操作

- `TaskCard` 点击只调用 `navigateToChat(sessionId)`;
- 没有 `?runId=`/`?messageId=`;
- 没有 Task 详情页、重试、删除、取消;
- TaskCard 的 `onDelete/onRetry` 在 TaskList 未接入。

---

## 三、差异清单

| # | 差异 | 严重度 | 影响 | 证据 |
|---|---|---|---|---|
| G1 | Session 直接充当 Task | 高 | 一个会话多个任务无法表达;任务 id 与 session id 混淆 | `mapSessionToTask` |
| G2 | 所有任务固定 `completed` | 高 | 运行中/失败/停止/等待审批全部丢失,误导用户 | `status: 'completed'` |
| G3 | 标题取 Session name | 中 | 任务目标不准确;Session title 是摘要 | `title: session.name` |
| G4 | 时长取 Session create/update | 中 | 把会话闲置时间算进任务;不是执行时长 | `durationMs` |
| G5 | 无 `source`(Chat/Agent) | 高 | Agent 交互没有 Task 入口;无法按来源筛选 | `TaskCardProps` 无 source;TaskList 只读 chat sessions |
| G6 | Tool call 未成为 Task step | 高 | 无法看到任务步骤/进度/工具数 | ActivityTree 与 TaskCard 无关联 |
| G7 | 无 `runId`/消息深链 | 中 | 点击只能打开会话顶部,无法定位执行过程 | `navigateToChat(sessionId)` |
| G8 | 无等待审批/失败/停止状态 | 高 | 任务中心无法作为“需要处理”的入口 | `TaskStatus` 存在但未使用 |
| G9 | Session 容器是单会话占位 | 中 | 无法展示“一个会话多个任务” | `useFetchSessionList` |
| G10 | 无 Task 持久化/API | 高 | 刷新/重启后任务状态丢失;无法跨端 | BFF 无 `/api/tasks`;`sessionRuns` 内存 Map |
| G11 | TaskCard 字段不足 | 中 | 无法渲染来源、步骤、审批、run 深链 | `TaskCardProps` |
| G12 | 无状态/来源筛选、无任务详情 | 中 | 任务中心退化为“最近会话” | TaskList 只有日期分组 |

---

## 四、改进建议

### P0:先“止血”,不要把 Session 叫 Task

**目标**:避免把错误语义继续暴露给用户。

1. 当前 `/tasks` 索引改名为 **“会话 / 最近会话”**,或卡片加 `Session` 徽标;
2. 移除/弱化 `TaskCard` 的 `completed` 状态展示,改为“会话更新时间”;
3. 保留 TaskCard 组件,但暂不作为“任务中心”对外承诺;
4. 在页面说明中标注“任务模型建设中”。

> 这是最小改动,适合后端 Task API 未就绪时先合入。

### P1:前端按 turn 临时投影(可选过渡)

如果必须尽快提供“任务感”,在无后端 Task API 时:

- 每条 user message 到下一个 user message 视为一个 Task;
- `title` = user message 截断;
- `status`:
  - 末条 assistant 正在流式 → `running`;
  - 有 pendingApproval/clarify → `running` + `waitingApproval`;
  - 末条 toolCall failed → `failed`;
  - 用户 stop → `cancelled`;
  - 其余 → `completed`;
- `stepCount` = 该 turn 内 toolCalls 数;
- `durationMs` = 末条 assistant createdAt - user createdAt;
- `source = 'chat'`;
- **必须标记“估算状态”**。

风险:

- Gateway 历史消息可能不保存 user 消息(现有占位兜底);
- 无法可靠区分 run 重试/多 run;
- 刷新后状态可能变化。

因此 P1 只能过渡,不能替代 P0 后端 Task 记录。

### P2:后端 Task 记录(推荐最终方案)

在 BFF 增加最小 Task store:

```text
POST /v1/runs                 → 创建 Task(running)
GET  /v1/runs/:id/events      → 更新 status/stepCount/lastMessageId
GET  /api/tasks?status=&source=&sessionId=&page=
GET  /api/tasks/:taskId
```

字段:

```ts
interface Task {
  id: string;              // runId
  sessionId: string;
  source: 'chat' | 'agent';
  agentId?: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  stepCount?: number;
  waitingApproval?: boolean;
  lastMessageId?: string;
  runId?: string;
  error?: string;
}
```

关键:

- Task 与 Session 分离;
- Task 状态由 run 生命周期驱动,不由 Session 存在推导;
- 持久化,不要只放 `sessionRuns` 内存 Map;
- Agent run 与 Chat run 共用 Task 模型,`source` 区分。

### P3:前端 Task Hub

1. `TaskCard` 增加 `source/stepCount/waitingApproval/runId`;
2. `TaskList` 改读 `/api/tasks`,按 `Running / Needs attention / Completed` 分组;
3. 点击 `/chat/:sessionId?runId=...` 或 `?messageId=...`;
4. Session 侧栏展示“会话内任务”二级列表;
5. 筛选:来源 Chat/Agent、状态、Agent;
6. 任务详情复用 ActivityTree/ToolCallCard,不要另造步骤 UI。

---

## 五、建议的代码改动清单

| 文件 | 改动 |
|---|---|
| `src/components/trae-work/types.ts` | `TaskCardProps` 增加 `source/sessionId/runId/stepCount/waitingApproval/lastMessageId` |
| `src/components/trae-work/task-card.tsx` | 增加来源徽标、步骤数、等待审批提示 |
| `src/pages/tasks/task-list-utils.ts` | 用 `mapTaskToCard` 替换 `mapSessionToTask`;或保留 `mapTurnToTask` 过渡 |
| `src/pages/tasks/task-list.tsx` | 数据源切 `/api/tasks`;加来源/状态筛选、深链 |
| `src/hooks/use-chat-request.ts` 或新 hook | 新增 `useFetchTasks`(Query Key Factory) |
| `src/services/*-service.ts` | 新增 task list/detail service |
| `bff/src/routes/*` | 新增 `/api/tasks`;Task store |
| `bff/src/services/adapters/intellect-enterprise/*` | 在 run 创建/事件/完成时写入 Task |
| `src/pages/tasks/index.tsx` | 如果短期不改数据源,先把“任务”文案改为“会话” |

---

## 六、验收清单

- [ ] Task 与 Session 是两个实体,Task 有独立 id(runId);
- [ ] 一个 Session 可列出多个 Task;
- [ ] Chat 与 Agent 任务共用 Task 模型,`source` 可筛选;
- [ ] 状态来自 run 生命周期,不存在固定 `completed`;
- [ ] `stepCount`/`waitingApproval` 可用;
- [ ] 任务可深链到对应消息/run;
- [ ] 时长来自 run 开始/结束,不是 Session create/update;
- [ ] 后端 Task API 持久化,刷新不丢;
- [ ] TaskList 不再是 Session 投影(或明确标注为“会话视图”)。

---

## 七、建议决策

1. **短期**:把当前 `/tasks` 索引标为“会话”,不要继续用 `completed` 伪装任务状态。
2. **中期**:BFF 增加 run 驱动的 Task store + `/api/tasks`。
3. **前端**:TaskCard 扩展字段,TaskList 切数据源,深链定位 run/message。
4. **Agent**:Agent run 与 Chat run 共用 Task 模型,不做两套。
5. **不要**:把 tool call 当 Task、把 Session 当 Task、把 `sessionRuns` 内存 Map 当任务存储。

---

## 八、参考

- 目标模型:[task-hub-task-model-recommendation.md](./task-hub-task-model-recommendation.md)
- 当前实现:`src/pages/tasks/task-list.tsx`、`src/pages/tasks/task-list-utils.ts`、`src/hooks/use-chat-request.ts`
- 当前 TaskCard:`src/components/trae-work/types.ts`
- BFF run:`bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts`
- 会话架构:[chat-session-gap-analysis.md](./chat-session-gap-analysis.md)
