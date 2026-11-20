# TC-BFFSSO-02 — SSO 授权/回调/重登（路由层）

截图目录：`tests/e2e-tests/results/bff-sso-p2/`
前置依赖：`bff` 目录可运行 vitest；mock `global.fetch`；mock BackendStore/HarnessStore。
隔离声明：全部在进程内 mock，无外部写入（R3/R5）。
原生弹窗：无。
R6 现状口径：L-02 无真实 IdP/网关，断言止于 BFF 出站请求与响应；真实 IdP 完成度在报告受限专节说明。
夹具：`tests/e2e-tests/fixtures/bff-sso-p2/providers.json`。

## 用例清单

| 编号 | 目的 | 关联手册 | 优先级 |
|---|---|---|---|
| TC-BFFSSO-02-01 | 开启 SSO 后 channels 使用公开端点且不带 `Authorization` | §3.2 | P0 |
| TC-BFFSSO-02-02 | 缺 `client_id` 的 provider 不展示，记录 `sso_misconfigured` | §3.2 | P0 |
| TC-BFFSSO-02-03 | authorize 302 含全部 OIDC 参数与 `no-store` | §3.1 | P0 |
| TC-BFFSSO-02-04 | 多租户：tenant 写入 state 载荷，未知租户被拒绝 | §1/§3.1 | P0 |
| TC-BFFSSO-02-05 | 回调成功：exchange 入参正确、写 `imt_token` 与 `sso_provider` | §3.1 | P0 |
| TC-BFFSSO-02-06 | `returnTo` 注入（`//`、`https:`、`\`、CRLF、超长）回落 `/` | §3.1 | P0 |
| TC-BFFSSO-02-07 | state 缺失/不匹配/过期/重放 → `sso_state_invalid`，不调 exchange | §3.3 | P0 |
| TC-BFFSSO-02-08 | 网关 400/401/403/429/5xx/超时 → 对应错误码且不写 Cookie | §3.3 | P0 |
| TC-BFFSSO-02-09 | 静默重登：带 `prompt=none`，失败一次后交互，再失败回登录页 | §3.4 | P1 |
| TC-BFFSSO-02-10 | 登出后深链：`sso_provider` 缺失 → relogin 直接落登录页 | §3.4/§4 | P0 |
| TC-BFFSSO-02-11 | 旧入口 `/auth/login/:channel` 在开关开启时转发 authorize；未知渠道 fail-closed | §3.1/§6 | P1 |
| TC-BFFSSO-02-12 | 开关关闭：旧链路（`/api/oauth/providers`、`oauth_state`、`/api/oauth/callback`）逐字段不变 | §6 | P0 |

## 统一执行步骤

| # | 操作 | 预期结果 | 证据 |
|---|---|---|---|
| 1 | `cd bff && npx vitest run src/routes/auth.test.ts` | 新增用例与既有 46 项全部通过 | 终端日志 |
| 2 | 检查每个用例断言 | 与上表一致；失败标注 FAIL 并记录实际值 | vitest 输出 |
| 3 | 抽查日志 | 不含 code/verifier/nonce/token 原文 | 终端日志 |

## 断言要点

- Cookie：`sso_state` HttpOnly/Lax/Max-Age=600；`imt_token` HttpOnly；`sso_provider` 30 天。
- 出站：exchange 不得带 `Authorization`；channels 公开端点不得带 `Authorization`。
- 重放：同一 `sso_state` 第二次回调必须失败且不产生第二次 exchange 请求。
- 登出：清 `imt_token` 与 `sso_provider`。
