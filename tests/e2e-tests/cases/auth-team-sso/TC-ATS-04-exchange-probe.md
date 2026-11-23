# TC-ATS-04 exchange 端点存在性(只读探针)

| 项 | 内容 |
|---|---|
| 目的 | 复证 team 是否暴露 `POST /api/members/oauth/exchange` |
| 前置 | 可访问公网 gateway 与本地 intellect-team 源码 |
| 优先级 | P0 |
| 手册 | §3.1(成功路径依赖此契约) |

| # | 操作 | 预期 | 证据 |
|---|---|---|---|
| 1 | `POST https://ai.wust.edu.cn/intellect-gateway/api/members/oauth/exchange` body `{}` | **当前预期 FAIL**:404 → 记 F-TEAM-RUST-01 | http_code |
| 2 | 源码 `rg oauth/exchange members_api.rs` | **当前预期 FAIL**:无路由 | rg 输出 |
| 3 | 历史提交 `1c034c51` 含路由 | 对比证明回归 | git show |
