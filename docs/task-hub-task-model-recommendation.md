# Task Hub 任务模型建议 — 从 Session 投影到 Task/Run

> **核心表述（定稿）**:
> **Session 是会话容器；Task 是一次“用户意图 → Agent 执行”的完整交互过程；Chat / Agent 是任务来源或入口，不是 Task 本身；工具调用是 Task 的 step，不是独立 Task。**

> **状态**:建议稿(未实施)
> **背景**:Route B 收尾中,Task Hub 索引页暂时用 Gateway Session 投影为 `TaskCard`。
> **结论**:**Task 应定义为一次交互/执行过程(Task/Run);Session 只是会话容器;Chat/Agent 是任务来源。**

---

## 一、结论

| 概念 | 定义 |
|---|---|
| **Session** | 会话容器,一段连续对话;可包含多个 Task |
| **Task / Run** | 一次“用户意图 → Agent 执行 → 结果”的完整交互过程 |
| **Step** | Task 内的一次 tool call / workflow node;不单独成为 Task |
| **Source** | `chat` 或 `agent`,表示任务从哪个入口发起 |
| **Chat** | 对话式交互入口;一次提问通常产生一个 Task |
| **Agent** | 智能体/工作流入口;一次 Agent 执行产生一个 Task |

一句话:

> **Session 是“聊天记录”,Task 是“这次让 Agent 做了什么”。**

当前把 Session 当 Task 的投影只能作为临时“最近会话列表”,不应作为最终 Task Hub 语义,尤其不能把所有 Session 都标成 `completed`。

---

## 二、为什么 Session 投影不合适

### 2.1 一个 Session 可能有多个 Task

同一会话中:

1. 用户:“分析这份财报” → Task A
2. 用户:“把结论导出 PDF” → Task B

Session 是同一个,但这是两个不同意图、不同执行过程、不同结果。

### 2.2 Session 没有真实任务状态

Session 存在只说明“有过对话”,不代表:

- Agent 正在运行;
- 是否等待审批/澄清;
- 是否失败;
- 是否被用户停止。

当前 `mapSessionToTask` 统一 `status: 'completed'`,是为了满足 `TaskCard` 的类型要求,不是事实。

### 2.3 标题和时长语义不对

- Session title 通常是自动摘要/首条消息摘要,不等于“本次任务目标”;
- Session 的 `create/update` 是会话生命周期,不是 Run 执行时长;
- 用 `update - create` 算“任务时长”会把用户闲置时间也算进去。

### 2.4 缺少步骤与定位

Task 需要展示:

- 调用了哪些工具/节点;
- 当前进行到哪一步;
- 点击后定位到哪条消息/哪个 run。

Session 投影无法提供 `stepCount`、`runId`、`lastMessageId`。

### 2.5 现有代码边界

当前实现:

- `src/pages/tasks/task-list.tsx`:用 `useFetchChatList()` 把 `IDialog` 映射成 `TaskCard`;
- `src/pages/tasks/task-list-utils.ts`:`mapSessionToTask()` 固定 `completed`;
- 分组/时长基于 Session 的 `create_date/update_date`;
- `Sessions` 侧栏仍是单会话占位,没有多 Session 列表。

因此它更适合叫 **“会话列表”**,而不是“任务中心”。

---

## 三、推荐的任务模型

```ts
type TaskSource = 'chat' | 'agent';

type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface Task {
  /** 一次执行的稳定标识,优先用 Gateway runId */
  id: string;

  /** 所属会话 */
  sessionId: string;

  /** chat / agent */
  source: TaskSource;

  /** Agent 任务必填 */
  agentId?: string;

  /** 首条用户意图,截断展示;不要用 session title 代替 */
  title: string;

  status: TaskStatus;

  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;

  /** tool call / workflow node 数 */
  stepCount?: number;

  /** 深链定位 */
  lastMessageId?: string;
  runId?: string;

  /** 等待审批/澄清时仍为 running,但 UI 需要突出 */
  waitingApproval?: boolean;

  error?: string;
}
```

### 3.1 任务边界规则

| 场景 | 是否同一 Task |
|---|---|
| 用户同一句话触发一次 run | 一个 Task |
| clarify/approval 后继续执行 | **同一 Task** |
| 用户在同一 Session 发新问题 | **新 Task** |
| 失败后重试 | 建议同一 Task 下挂 attempt,或至少 `retryOf`;不要伪装成全新任务 |
| Agent workflow 多个 node | 同一 Task,node 作为 Step |
| 用户手动 stop | 同一 Task 置 `cancelled` |

### 3.2 Chat 与 Agent 的关系

- 两者共享 Task 生命周期、TaskCard、分组/筛选;
- `source` 区分入口;
- Agent 任务可额外显示 `agentId/agentName`;
- 不建议拆成两套 Task 实体,否则筛选、统计、深链都会重复。

---

## 四、状态应该由 Run 生命周期驱动

Gateway/BFF 已有 `run_id` 和 run 事件;Task 状态不应靠 Session 猜。

| 事件 | Task 变化 |
|---|---|
| `POST /v1/runs` 成功 | 创建 Task,`status=running`,`startedAt=now` |
| `message.delta` / `tool.progress` | 保持 running,更新 `stepCount`/`lastMessageId` |
| `approval.request` | `waitingApproval=true`(状态仍 running) |
| `run.completed` | `completed`,`finishedAt/durationMs` |
| `run.failed` | `failed`,写 `error` |
| 用户 stop / `run.cancelled` | `cancelled` |
| 排队未开始 | `pending` |

**不要**根据“Session 存在”推导 `completed`。

---

## 五、UI 建议

### 5.1 Task Hub 列表

- 标题:首条用户意图,截断 40–60 字;空时回退“新任务”。
- 卡片字段:`Chat/Agent` 来源徽标、状态、时长、step 数、Agent 名称(Agent 任务)。
- 分组优先级:
  1. **Running / 等待审批**
  2. **Needs attention**(failed/cancelled)
  3. **Completed**
  4. 组内按时间倒序
- 筛选:来源(Chat/Agent)、状态、Agent。
- 点击:进入 `/chat/:sessionId?runId=...` 或 `?messageId=...`,滚动并高亮对应消息/run。

### 5.2 Session 与 Task 的关系

- Session 侧栏继续做“会话容器”;
- 会话详情可展示该 Session 下的 Task 列表(一个会话多个任务);
- Task 详情展示 steps(ActivityTree/ToolCallCard),不要另造一套。

### 5.3 不建议

- 不要把 Session 卡片的状态文案改成“已完成”来掩盖数据缺失;
- 不要在 Task Hub 里混用“会话”和“任务”两个概念;
- 不要把每个 tool call 都列成独立 Task,否则任务列表会被工具调用淹没。

---

## 六、落地路径

### P0:后端任务记录(推荐)

在 BFF 增加最小 Task store,由 run 生命周期驱动:

```text
POST /v1/runs                 → 创建 Task
GET  /v1/runs/:id/events      → 更新 Task 状态/步骤
GET  /api/tasks?status=&source=&sessionId=&page=
GET  /api/tasks/:taskId
```

要求:

- Task 持久化(数据库/可靠存储),不要只放内存;
- 记录 `runId/sessionId/source/status/startedAt/finishedAt/stepCount/agentId`;
- Session list 与 Task list 分开;
- 任务详情能关联回消息与 run。

### P1:前端适配

1. `TaskCard` 增加 `source`、`stepCount`、`waitingApproval`、`runId`;
2. `TaskList` 改为读 `/api/tasks`,按状态 + 时间分组;
3. 深链支持 `?runId=`/`?messageId=`;
4. 保留 Session 侧栏,增加“会话内任务”二级视图。

### P2:过渡方案(后端未就绪时二选一)

**方案 A:改名(推荐,最诚实)**

- 当前 `/tasks` 索引改叫“会话 / 最近会话”;
- 继续用 Session 数据,但不要显示 Task 状态/时长,或明确标注“会话视图”;
- 等 `/api/tasks` 就绪再切回任务中心。

**方案 B:按 turn 临时投影**

- 每条 user message 到下一个 user message 视为一个 Task;
- 状态从末条 assistant/tool 推断;
- 明确标注“估算状态”;
- 风险:Gateway 历史消息可能不保存 user 消息(现有代码已有占位兜底),所以只能过渡,不能作为最终任务中心。

---

## 七、验收标准

- [ ] Task 状态来自 run 生命周期,不存在“Session 存在即 completed”;
- [ ] Chat 与 Agent 任务共用同一模型,可用 `source` 筛选;
- [ ] 一个 Session 可展示多个 Task;
- [ ] Task 可深链定位到对应消息/run;
- [ ] 时长来自 run 的 started/finished,而非 session create/update;
- [ ] 失败/停止/等待审批状态可见;
- [ ] 任务列表分页/搜索/筛选在服务端完成(或明确标注客户端范围)。

---

## 八、开放问题

1. **Task 的最小单位**:一次 user turn,还是一次 `run`?建议以 `runId` 为准,user turn 只作为展示边界。
2. **重试**:同一 Task 的 attempt,还是新 Task?建议同 Task 下 attempts。
3. **Agent workflow**:整个 workflow 一个 Task,node 为 Step;是否允许 node 级重跑?
4. **跨 Session 任务**:同一长任务是否允许跨 Session?建议不允许,Task 必须属于一个 Session。
5. **保留策略**:Task 记录保留多久?是否需要与 Session 删除联动?
6. **权限**:Task list 是否复用 Session 的 RBAC/可见性?建议复用,避免越权。

---

## 九、参考

- 当前实现:`src/pages/tasks/task-list.tsx`、`src/pages/tasks/task-list-utils.ts`、`src/pages/tasks/index.tsx`
- 当前实现差异:[task-hub-implementation-gap-analysis.md](./task-hub-implementation-gap-analysis.md)
- 差异分析评审:[task-hub-implementation-gap-review.md](./task-hub-implementation-gap-review.md)
- 当前评审:[route-b-closeout-code-review.md](./route-b-closeout-code-review.md) A1
- 会话架构背景:[chat-session-gap-analysis.md](./chat-session-gap-analysis.md)
- BFF run 流:`bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts`
