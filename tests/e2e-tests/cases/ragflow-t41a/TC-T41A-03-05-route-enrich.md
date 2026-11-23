# TC-T41A-03/04/05 — chatbots info enrich 路由

| 项 | 内容 |
|---|---|
| 目的 | Gateway 优先聚合;回落 RAG;响应无 key 泄漏 |
| 层级 | BFF vitest(mock adapter/upstream) |
| 优先级 | P0 |
| 关联手册 | §1.1–1.3、§3 |

| 用例 | 操作 | 预期 |
|---|---|---|
| 03 | Gateway session prompt_config=exa+key | 200;`has_web_search_provider:true`;`has_tavily_key` 按 tavily 字段 |
| 04 | Gateway 404/无 session,RAG 返回 has_tavily_key:true | 200;保留 RAG 字段;`has_web_search_provider` 在无 PC 时可为 false 或与 tavily 对齐(实现取:无 PC 则 `has_web_search_provider = has_tavily_key`) |
| 05 | Gateway PC 含多个 `*_api_key` | 响应 JSON 序列化后无 `_api_key` 键 |
