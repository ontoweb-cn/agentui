# TC-ATS-05 providers 含 client_id

| 项 | 内容 |
|---|---|
| 目的 | 公开 providers 响应含非机密 `client_id` |
| 优先级 | P0 |

| # | 操作 | 预期 |
|---|---|---|
| 1 | GET 公网 `/api/members/oauth/providers` | 启用渠道含 `client_id`;**当前缺则 F-TEAM-PROV-01** |
| 2 | Rust `OAuthProviderInfo` 结构 | 含 `client_id` 字段;**当前无则 FAIL** |
