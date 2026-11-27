# TC-TPB 画布事件与密钥保存

| 项 | 内容 |
|---|---|
| 截图目录 | 无。本环境没有 Go 画布和已登录设置页,不伪造截图 |
| 前置 | 仓库内 jest / vitest |
| 隔离 | 不写库,不建会话(R3/R5) |
| 原生弹窗 | 无 |
| R6 | 真实浏览器、真实 provider、生产回填、主密钥、取消 5 秒可见态未执行 |

| 编号 | 目的 | 步骤 | 预期 | 证据 |
|---|---|---|---|---|
| TC-TPB-01 | Python 节点事件不变 | `adaptCanvasLiveSsePayload` 喂 `node_started` | 原对象原样返回 | `go-canvas-sse-adapter.test.ts` |
| TC-TPB-02 | Go 消息进对话 | 喂 `message` + `answer` | `content` 等于 answer,信封字段还在 | 同上 |
| TC-TPB-03 | 填表 | 喂 `waiting_for_user` | 事件变为 `user_inputs`,带 cpn_id/tips/inputs | 同上 |
| TC-TPB-04 | 结束与取消 | 喂 `done`、`cancelled` | 未见流程结束时 done → message_end + workflow_finished;已见过则 `done` 被忽略;cancelled → workflow_finished 且 `cancelled: true` | 同上 |
| TC-TPB-05 | 错误 | 喂 `error` | `events` 为空,`streamError` 为文案 | 同上 |
| TC-TPB-06 | BFF 解析 | `parseCanvasWorkflowSSE` 喂 answer / waiting_for_user / error / done | delta / metadata / error / done;节点事件仍无 chunk | `parse-canvas-workflow-sse.test.ts` |
| TC-TPB-07 | 非空密钥一次 PATCH | adapter `updateSession` 带非空 key 和空白 key | 只调用一次 PATCH;空白字段消失;非空 key 仍在 body;无 PUT | `intellect-enterprise-adapter.test.ts` |
| TC-TPB-08 | 留空不提交空密钥 | 只带空白 `tavily_api_key` | PATCH 不含该字段,且没有第二次请求 | 同上 |

> 回归修订日期:2026-11-26,按评审撤回 BFF 单独 PUT。

> 回归修订日期:2026-11-26,首版。用例是自动化映射,不是浏览器点击。
