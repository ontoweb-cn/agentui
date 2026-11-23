# TC-T41A-01 — hasWebSearchProviderConfig 纯函数

| 项 | 内容 |
|---|---|
| 目的 | BFF 聚合语义与前端 `hasWebSearchProvider` 对齐 |
| 层级 | BFF vitest |
| 优先级 | P0 |
| 关联手册 | §1.2 |

| # | 输入摘要 | 预期 |
|---|---|---|
| 1 | 无 provider、无 key | false |
| 2 | anysearch 无 key | true |
| 3 | youcom 无 key | true |
| 4 | tavily + 非空 tavily_api_key | true |
| 5 | tavily + 空 key | false |
| 6 | 无 provider + 非空 tavily_api_key(legacy) | true |
| 7 | web_search_provider='' | false |
| 8 | exa + 非空 exa_api_key | true |
| 9 | exa + 仅有 tavily_api_key(错配) | false |
