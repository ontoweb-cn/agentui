# TC-ATS-06 BFF SSO vitest 回归

| 项 | 内容 |
|---|---|
| 目的 | agentui BFF RP/exchange 客户端在 mock 下仍绿 |
| 操作 | `cd bff && npx vitest run src/routes/auth.test.ts --reporter=dot` |
| 预期 | 相关 SSO/callback/relogin 用例通过 |
