# Spec 批准门 — T4.1a(module: ragflow-t41a)

> 日期:2026-11-22;用户指令「调用九步法技能按推荐顺序开发」= 预授权连续执行本批至完成。

## 1. 范围

| 纳入 | 不纳入 |
|---|---|
| ① PATCH 多 key 透传复核 | T4.1b 检索分发 |
| ② BFF `external-info` 聚合 `has_web_search_provider` | T4.2 密钥独立存储 / 写侧 prune |
| ③ T2.7 回归 | T2.6 oxlint、T2.5 第二步 |
| GET `normalizeSession` metadata 透传 PC | 真浏览器嵌入走查(L-T41A-01) |
| 前端 chat 分享改打 Gateway info | agent 分享仍走 RAG |

## 2. 缺陷/差距清单(调研)

| ID | 描述 | 处置 |
|---|---|---|
| D1 | 分享页多 provider 无后端生产者 | **必修** external-info |
| D2 | GET session 丢 prompt_config | **必修** metadata |
| D3 | 写侧 prune 与「换回不丢 key」冲突 | **延期 T4.2**;本批断言不 prune |

## 3. 修复方案摘要

1. `web-search-capability.ts` 纯函数 + 单测
2. enterprise `normalizeSession` → metadata.prompt_config/kb_ids
3. `GET /agents/:agentId/sessions/:sessionId/external-info` → `{code:0,data}`
4. 前端 `useFetchExternalChatInfo`：chat → Gateway；agent → RAG
5. 清单升 v6 标记 T4.1a 代码项完成(④ 写侧注明延期)

## 4. 报告路径

`tests/e2e-tests/reports/REPORT-ragflow-t41a-20261122.md`
