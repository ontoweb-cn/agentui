# TC-SOA-04 — 安全边界

## TC-SOA-04-01 密钥不回显

| 项 | 内容 |
|---|---|
| 目的 | §11.3/§12 R-5 |
| 优先级 | P0 |
| 步骤 | GET /admin/sso/config（含 check=1）/providers 全响应体检 |
| 预期 | `stateSecretStatus` 三态布尔化呈现;任何响应不含 stateSecret/API_SERVER_KEY/clientId 明文 |
| 自动化 | BFF V-01（不含密钥值断言）/V-05（不透出 clientId） |
