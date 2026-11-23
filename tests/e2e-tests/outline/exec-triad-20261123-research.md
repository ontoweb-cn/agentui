# 调研 — exec-triad-20261123

> 用户九步预授权实施三连:t42-m1-wire / prod-d1-exec / phase-b-sse-adapter。

## 1) Gateway secrets → t42-m1-wire

| 探查 | 结果(2026-11-23) |
|---|---|
| `intellect-gateway` 源码 `web_search_secret*` | **0 命中** |
| `/api/sessions/{id}/web-search-secrets` 路由 | **不存在**(api_server 仅有 sessions CRUD/chat) |
| agentui 契约草案 | 已有 |

**裁决**:不可接线 sanitize / PUT secret。交付 `probeWebSearchSecretsApi` + URL builder;**L-T42-01 延续**(不宣称关闭)。

## 2) 持权 kubeconfig → prod-d1-exec

| 探查 | 结果 |
|---|---|
| `which kubectl` | **not found** |
| intellect ns Deployment 变更 | 不可达 |

**裁决**:**L-09/L-10** 复证;不伪造集群变更。

## 3) Go SSE 稳定 → phase-b-sse-adapter

| 探查 | 结果 |
|---|---|
| `internal/agent/canvas` 运行时 | 本 checkout **无**完整 Go canvas 树(仍以 Python `agent/` 为主) |
| `waiting_for_user` 于 `*.go` | 仅设计文档 / migrate-canvas 注释引用 NormalizeForCanvas |
| 前端 `MessageEventType` | 仍无 Go 专有事件 |

**裁决**:**L-PHASEB-01** — SSE 未稳定。交付 BFF `mapGoStreamAgentEventToChunks` + 前端 `mapGoCanvasSseEventToMessageEvents`(**未接线** live 解析器)。

## 可交付

预备代码(单测绿)+ 九步文档 + 清单注记;无 SPA/BFF 默认路径行为变更。
