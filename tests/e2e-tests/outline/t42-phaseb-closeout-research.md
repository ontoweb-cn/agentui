# 调研 — t42-phaseb-closeout

> 2026-11-26;`dev` @ 合并后的 `e1ff7c1` 工作区

## 1. 画布 SSE(L-PHASEB-01)

| 层 | 路径 | 接线前 |
|---|---|---|
| 前端 live | `POST /api/bff/canvas/chat/completions` → `canvas-service.streamAgentCompletion` 原样代理 RAG SSE → `useSendMessageBySSE` 把 JSON 直接推进 `answerList` | Go 专有事件名不会变成 `user_inputs` / `workflow_finished` |
| 消费 | `packages/canvas-plugin` 时间线、填表、节点 loading 只认 `MessageEventType` | `waiting_for_user` 被当成未知对象推进列表 |
| BFF 聊天解析 | `parseCanvasWorkflowSSE` | `waiting_for_user` / `error` / `done` / `cancelled` 落入 default,丢弃;Go `message.answer` 变成空 delta |
| 映射器 | `src/utils/go-canvas-sse-adapter.ts`、`bff/src/utils/map-go-stream-agent-event.ts` | 有单测,注释写明未接线 |

Python 事件(`workflow_started`、`node_started`、`node_finished`、`message`+`content`、`message_end`、`workflow_finished`)必须原样保留。`node_*` 仍不进 BFF StreamChunk(时间线看的是前端原样 SSE)。

本机 `D:\workspace` 没有 `intellect-rag/internal/agent/canvas`。`scripts/check-exec-gates.mjs` 因此仍会把 L-PHASEB-01 标为 BLOCK。接线做成「原事件透传 + Go 专有名改写」,不依赖该目录在不在。

## 2. T4.2 密钥

| 层 | 现状 |
|---|---|
| 设置页 M3 | 已有「已配置 — 留空保持」 |
| BFF 校验 | 已配置 provider 允许空 key |
| Enterprise `updateSession` | 接线前把 `prompt_config` 整包 PATCH。Gateway 文档 §3.4 会自己提取并剥离,但 BFF 没有自己的 PUT |
| `sanitizePromptConfigWebSearchKeys` | 只保留活动 provider 的 key,不能当「全部入库存后再删除」用 |
| M4 主密钥 | 设计在 `docs/t42-secret-master-key-rotation-design.md`;实现应在 `secret_crypto.rs`。本机无该仓库 |
| M2 生产回填 | CLI 文档已有;无 kubeconfig(L-09) |
| native/Python 其余 provider | 契约写在 `docs/t42-runtime-web-search-consumer-contract.md`;代码不在 agentui |

安全做法(评审后):BFF 不单独 PUT。`omitBlankWebSearchApiKeys` 只去掉空白 provider key,非空 key 留在 PATCH 里,由 Gateway §3.4 同一次事务入库并剥离。单独 PUT 再 PATCH 会在 PATCH 失败时已经改掉密钥,并且每次 PUT 都增加 `key_version`。

画布 `done`:Go 在 `workflow_finished` 之后还会补一条 `done`。live 路径记下已经见过流程结束,再遇到 `done` 就忽略。还没见过流程结束时,`done` 仍展开成消息结束 + 流程结束。

## 3. 运行库

- 前端 dev 口令 `npm run dev`(9391),BFF `npm run dev:bff`(9390)。本批没有可登录的 Go 画布和带 secrets 的 Gateway,不能做真实 UI 回合。
- 可执行验收是 jest / vitest 里的映射与 PUT/PATCH 顺序。
