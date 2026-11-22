# 九步交付报告 — t42-phasebc-prep(2026-11-23)

> 用户指令:按九步实施建议下一刀 1–3。Spec:[t42-phasebc-prep-spec.md](../spec/t42-phasebc-prep-spec.md)

## 1. 结论摘要

| 项 | 结果 | 证据 |
|---|---|---|
| 1 T4.2 M1/M2 | **受限 L-T42-01**;交付契约草案 | [web-search-secrets-gateway-api-contract.md](../../../docs/web-search-secrets-gateway-api-contract.md);PATCH 未接线 sanitize(仅注释) |
| 2 D1 / Phase B·C | D1 **L-09/L-10**;交付 Phase B/C 准备 | [phase-bc-frontend-alignment-prep.md](../../../docs/phase-bc-frontend-alignment-prep.md) |
| 3 清单 v9 | **完成** | [ragflow-ui-alignment-followup-tasks.md](../../../docs/ragflow-ui-alignment-followup-tasks.md) v9 |

## 2. 用例执行

| TC | 结果 | 说明 |
|---|---|---|
| 01 契约草案 | PASS | PUT/GET/DELETE + 禁止无表 prune |
| 02 sanitize 未接线 | PASS | `bff-agents.ts` 仅注释提及 |
| 03 Phase B 准备 | PASS | 事件矩阵 + cancel + NormalizeForCanvas + D1 |
| 04 清单 v9 | PASS | T2.5/T3.2/3.4–3.6 标完成;余项清晰 |
| 05 手册无行为变更 | PASS | manual §1 |

## 3. 交付物

| 路径 | 说明 |
|---|---|
| `docs/web-search-secrets-gateway-api-contract.md` | Gateway 契约评审稿 |
| `docs/phase-bc-frontend-alignment-prep.md` | 画布/DSL/D1 准备 |
| `docs/t42-phasebc-prep-manual.md` | 业务手册 |
| `docs/web-search-secret-storage-design.md` §9 | 链契约 + L-T42 |
| `docs/ragflow-ui-alignment-followup-tasks.md` | **v9** |
| `tests/e2e-tests/{outline,cases,spec,reports}/t42-phasebc-prep*` | 九步资产 |

**无 SPA/BFF 生产行为变更。**

## 4. 受限注记

| ID | 内容 |
|---|---|
| L-T42-01 | Gateway 无 `web_search_secrets` 实现;M1/M2 接线延期 |
| L-09 | 无 intellect ns kubeconfig → D1 不可执行 |
| L-10 | 生产 BFF 未首装/凭据不可代输 |
| L-T33 / L-T41B / L-T5 | 既有:builtin-pipeline / 检索分发 / Go 化长期 |

## 5. 遗留建议

1. Gateway 评审并实现契约 → `t42-m1-wire`
2. 持权者执行 D1 → `prod-d1-exec`
3. Go SSE 稳定 → `phase-b-sse-adapter`

## 6. 九步闭环

调研/手册/检视/大纲用例/spec(预授权)/「修复」=文档落地/审查(文档自检+sanitize 未误接)/回归=TC 01–05/终检本报告 ✅。
