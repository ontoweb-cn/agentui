# 调研 — T4.1a Web Search Gateway/BFF(module: t4-1a-web-search)

> 日期:2026-11-22;九步步骤 1。

## 条目状态

| # | 内容 | 状态 |
|---|---|---|
| ① | Gateway `prompt_config` 透传 | ✅ T2.10 已打通 |
| ② | `has_web_search_provider` 聚合位(分享页) | ⚠ **受限 L-T41A-01** |
| ③ | PATCH provider↔key 校验 | ✅ T2.7 已落地 |
| ④ | 存储侧按活动 provider 过滤 key | ✅ **本 module 实施(BFF)** |

## L-T41A-01 说明

分享页 `useFetchExternalChatInfo` → `/api/bff/proxy/v1/chatbots/{id}/info`(intellect-rag)。  
Chat 持久化已在 Rust Gateway session;`computeHasWebSearchProvider` 已在 BFF 纯函数就绪,但 **公开 chatbot info 仍属 RAG/Gateway 契约**,本仓无法单独让分享页拿到聚合位。需 Gateway 或 RAG 在 info 响应写入该字段(或改分享页数据源)。

本仓已导出 `computeHasWebSearchProvider` 供上游接入时复用语义。
