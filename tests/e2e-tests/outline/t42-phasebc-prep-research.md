# 调研 — t42-phasebc-prep(建议下一刀 1–3)

> 2026-11-23。用户九步预授权「实施上面的1-3」。

## 项1 T4.2 M1/M2

| 检查 | 结果 |
|---|---|
| Gateway `web_search_secrets` 路由/表 | **不存在**(intellect-gateway + agentui 全仓检索) |
| 设计文档 | 有;推荐方案 C;明确禁止无表 prune |
| BFF sanitize 函数 | 就绪未接线 |

**可交付**:Gateway API 契约草案。**不可交付**:M1/M2 生产接线 → **L-T42-01**。

## 项2 D1 或 Phase B/C 准备

| 检查 | 结果 |
|---|---|
| D1 kubeconfig / 首装 | L-09/L-10 仍成立 |
| Phase B 事件真源 | `agent-go-port-design.md` SSE + cancel |
| 前端枚举 | `MessageEventType` 无 `waiting_for_user`/`done`/`error` |
| NormalizeForCanvas | Go 有;前端无同名 |

**可交付**:前端对齐准备文档(差距矩阵 + checklist)。

## 项3 清单 v9

followup-tasks 停在 v8,与 `642d643` remaining-backlog 漂移(applications/admin、T3.2/3.4–3.6 已合入)。

## 运行库

本批纯文档 + 清单;不改 BFF/SPA 运行行为。门禁:文档链接自洽 + type-check 可选冒烟。
