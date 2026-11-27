# Phase B/C 前端对齐准备(画布事件 + DSL 边界)

> 日期:2026-11-23;九步 module: `t42-phasebc-prep`
> 状态:**准备文档**(无生产行为变更);D1 生产执行仍受限 L-09/L-10
> 真源:intellect-rag [`agent-go-port-design.md`](../../intellect-rag/docs/develop/agent-go-port-design.md) §5.1 / §7.5 / §11;agentui `MessageEventType` + canvas-plugin
> Go 引擎剩余工作与对接顺序:[`agent-dsl-go-development-plan.md`](../../ragflow/docs/plans/agent-dsl-go-development-plan.md) 第 6–7 节(F-01 事件、F-02 取消、F-03 保存前归一)。2026-11-25 评审:Phase B live 仍关,直到 G-01 把 Go 实际发出的 SSE 事件写进手册。

## 1. 范围裁决

| 建议项 | 本批处置 |
|---|---|
| 有 Gateway secrets → T4.2 M1/M2 | **无契约实现** → 仅交付 [API 契约草案](./web-search-secrets-gateway-api-contract.md);**L-T42-01** |
| 无 Gateway → D1 生产 / Phase B·C 准备 | D1 **不可执行**(L-09/L-10);落地 **本准备文档** |
| 清单升 v9 | 见 followup-tasks |

## 2. 事件契约差距矩阵

### 2.1 前端现状(`src/hooks/use-send-message.ts`)

| `MessageEventType` | 字面值 | 画布消费点(抽样) |
|---|---|---|
| WorkflowStarted | `workflow_started` | timeline / loading |
| NodeStarted | `node_started` | `use-node-loading` / timeline |
| NodeFinished | `node_finished` | timeline / webhook-sheet |
| Message | `message` | `use-send-agent-message` |
| MessageEnd | `message_end` | chat utils / cache log |
| WorkflowFinished | `workflow_finished` | timeline 结束判定 |
| UserInputs | `user_inputs` | fillup / chat utils |
| NodeLogs | `node_logs` | 日志面板 |

**缺枚举**:`waiting_for_user`、`error`、`done`(Go StreamAgent 文档事件)。

### 2.2 Go StreamAgent 文档事件(`agent-go-port-design` §11)

| Go SSE `event` | payload 要点 | 与前端映射建议 |
|---|---|---|
| `message` | `answer` / `reference` | → 既有 `Message`(字段名可能要适配层:`answer`↔`content`) |
| `waiting_for_user` | `cpn_id` (+可选 `inputs`/`tips`) | → `UserInputs`;预备适配器透传 `inputs`/`tips`/`user_inputs` 别名 + `cpn_id` |
| `error` | `error` | → `streamError` 字段(无 MessageEventType);live 合入必须走流错误通道 |
| `done` | `[DONE]` | → `MessageEnd` + `WorkflowFinished` |

### 2.3 节点级事件

Go 画布实际发出的事件已冻结在 `ragflow/internal/agent/canvas/events_contract.go`(2026-11-25):`workflow_started`、`node_started`、`node_finished`、`message`、`message_end`、`workflow_finished`、`waiting_for_user`、`error`、`cancelled`、`done`。其中 `done` 由 handler 在流结束时补上,不是 runner 内部事件。`node_logs` 与 `user_inputs` 不是 Go 画布事件名;填表对应 `waiting_for_user`。

canvas-plugin 依赖 `node_started` / `node_finished`。这些 Python 事件名在 live 路径原样透传。Go 专有名由 `adaptCanvasLiveSsePayload`(2026-11-26)改写后再进入时间线:`waiting_for_user`→填表,未见流程结束时 `done`→`message_end`+`workflow_finished`,已见过则忽略尾部 `done`,`cancelled`→带 `cancelled: true` 的 `workflow_finished`,`error`→错误提示。BFF `parseCanvasWorkflowSSE` 对同一组事件产出 StreamChunk。禁止删除 `NodeStarted` / `NodeFinished` 的消费。本机没有 Go 画布进程,取消后 5 秒内停节点的可见态未实测。

### 2.4 Cancel(两段式 §7.5)

| 层 | 现状 |
|---|---|
| Go | Redis `{task_id}-cancel` + `compose.WithGraphInterrupt` + 30s timeout |
| BFF canvas | `POST /canvas/tasks/:taskId/cancel` → adapter `POST /api/v1/tasks/:id/cancel` |
| BFF chat session | `adapter.cancelMessage`(社区实证路径);部分 adapter stub/no-op |
| 前端画布 | 走 canvas cancel;与 chat cancel **分路** |

准备项:

- [x] 键名已核对（2026-11-25）：路径参数是 SSE 的 `task_id`，Go 把它当作 `session_id`，Redis 键为 `{session_id}-cancel`。`task_id` 与 `session_id` 相同。
- [ ] 验证「请求 cancel → ≤5s 节点停」的用户可见态(按钮 disabled / 时间线 cancelled);
- [ ] chat 路径 `cancelMessage` 与 canvas task cancel **勿混用同一语义** unless 统一任务模型。

## 3. DSL:`NormalizeForCanvas`

细化见 `ragflow/docs/plans/agent-dsl-go-development-plan.md` 第 8.2 节。

| 事实 | 含义 |
|---|---|
| Go 已在创建、更新、发布、重置和读取时调用 `dsl.NormalizeForCanvas` | BFF `PUT /api/v1/agents/:id` 进更新，库存会是归一后的 DSL |
| 没有单独的 `/normalize` | 保存本身就是归一边界。试算接口等编辑器确实要预览时再加 |
| `NormalizeForRun` 会折掉旧循环节点 | 只给编译用，不能回写画布 |
| canvas-plugin | 仓内不复制这份函数 |

还要做的:

1. 用 `tools/migrate-canvas` 夹具走保存，读回的 `graph` 已修 handle（F-03-1）。
2. 保存成功后，编辑器用响应里的 DSL 替换本地草稿，避免下一次保存把旧形态写回去（F-03-2）。
3. 浏览器只经 BFF 保存。

## 4. Phase C 前端触点(占位)

| 项 | 依赖 | 前端动作(将来) |
|---|---|---|
| T3.3 builtin-pipeline | Go pipeline 列表 API | `pages/builtin-pipeline` 只读 |
| T4.1b 检索 provider 分发 | Go 检索执行 + secrets.resolve | 设置保存后不再「静默失效」;错误揭示 |
| dev proxy 切 Go | Phase C 基座 | vite/nginx 上游切换 + 冒烟 |

本批不改 proxy、不建 pipeline 页。

## 5. D1 / 生产(复证受限)

依据 [model-mgmt-d1-d2-decision-brief.md](./model-mgmt-d1-d2-decision-brief.md) 与既有 `prod-d1-setup` 报告:

| ID | 内容 | 2026-11-23 |
|---|---|---|
| L-09 | 无 intellect ns kubeconfig / 跨 ns RBAC | **仍成立**(本环境无 kubectl 管理通道) |
| L-10 | 生产 BFF 未首装(needsSetup;非 enterprise / 缺省 `authMode=intellect-community`) | **仍成立**(凭据不可代输) |
| L-11 | RAG→gateway 9091 集群内连通 | 待持权者在 D1 时验证 |

运维手册已齐;本 agent **不伪造**集群变更。

## 6. 建议下一实现批(有契约/环境后)

1. `t42-m1-wire` — Gateway secrets 就绪 → BFF PUT+sanitize+GET 标志位;
2. `phase-b-sse-adapter` — BFF 或 canvas hook 适配 `waiting_for_user`/`done` ↔ `MessageEventType`;
3. `prod-d1-exec` — 持权者按决策简报 §三/§四执行并回填报告。

## 7. 执行三连复证(2026-11-23,module `exec-triad-20261123`)

| 闸门 | 复证 | 本批交付 |
|---|---|---|
| Gateway secrets | 源码 0 命中;`kubectl` N/A | `bff/.../web-search-secrets-client.ts` probe;**L-T42-01** |
| D1 kubeconfig | `kubectl: not found` | **L-09/L-10** |
| Go SSE 稳定 | 无完整 Go canvas SSE 运行时;`waiting_for_user` 仅设计文档 | `mapGoStreamAgentEventToChunks` + `mapGoCanvasSseEventToMessageEvents`;**未接线** parseCanvasWorkflowSSE;**L-PHASEB-01** |
