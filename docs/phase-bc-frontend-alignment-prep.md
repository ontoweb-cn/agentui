# Phase B/C 前端对齐准备(画布事件 + DSL 边界)

> 日期:2026-11-23;九步 module: `t42-phasebc-prep`
> 状态:**准备文档**(无生产行为变更);D1 生产执行仍受限 L-09/L-10
> 真源:intellect-rag [`agent-go-port-design.md`](../../intellect-rag/docs/develop/agent-go-port-design.md) §5.1 / §7.5 / §11;agentui `MessageEventType` + canvas-plugin

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

Go 设计同时强调节点开始/结束与 Python `agent_api` 对齐;canvas-plugin **依赖** `node_started` / `node_finished` 驱动时间线。Phase B 接线时:

1. 确认 Go runner 是否仍发射 RAGFlow 风格节点事件;若仅 `message/waiting_for_user/error/done`,前端时间线需降级或 BFF 补齐合成事件;
2. **禁止**在未确认前删除 `NodeStarted`/`NodeFinished` 消费。

### 2.4 Cancel(两段式 §7.5)

| 层 | 现状 |
|---|---|
| Go | Redis `{task_id}-cancel` + `compose.WithGraphInterrupt` + 30s timeout |
| BFF canvas | `POST /canvas/tasks/:taskId/cancel` → adapter `POST /api/v1/tasks/:id/cancel` |
| BFF chat session | `adapter.cancelMessage`(社区实证路径);部分 adapter stub/no-op |
| 前端画布 | 走 canvas cancel;与 chat cancel **分路** |

准备项:

- [ ] Phase B 接通后核对 cancel key 命名与 Go 一致(`{task_id}-cancel`);
- [ ] 验证「请求 cancel → ≤5s 节点停」的用户可见态(按钮 disabled / 时间线 cancelled);
- [ ] chat 路径 `cancelMessage` 与 canvas task cancel **勿混用同一语义** unless 统一任务模型。

## 3. DSL:`NormalizeForCanvas`

| 事实 | 含义 |
|---|---|
| Go 唯一入口 `dsl.NormalizeForCanvas` | 扁平 `name`/`params`;handleIds;fold legacy loop |
| canvas-plugin 当前 | 编辑器读写既有 DSL;仓内 **无**同名 TS 实现 |
| 风险 | 前端仍写嵌套/legacy loop 形态 → Go Compile 警告或失败 |

准备项(实现批再做):

1. 在 BFF 或 plugin-sdk 增加「保存前 normalize」可选调用(代理 Go `/normalize` 或移植纯函数)— **等 Go API 稳定**;
2. 保存/发布路径断言:出站 DSL 已过 normalize(契约测试夹具来自 `tools/migrate-canvas`);
3. 文档化前端**禁止**绕过 normalize 直写 storage。

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
