# Spec — BFF SSO P2 执行与修复（批准门）

日期：2026-11-20；模块：bff-sso-p2；关联方案：`specs/014-sso-token-exchange/plan-p2.md` v1.3。
用户指令：「调用九步交付技能，实施这个方案」——视为开工与修复范围已预先批准，批准门后连续执行。

## 一、步骤 5 执行基线（改动前）

| 检查 | 结果 | 说明 |
|---|---|---|
| BFF `/health` | PASS | `{"status":"ok",...}` |
| `/auth/config`（tenant 0） | PASS | `authMode=intellect-enterprise` |
| `/auth/login/channels` | PASS | 返回 10 个渠道（旧链路，带 `API_SERVER_KEY`） |
| `/auth/sso/authorize/*` | 404 | P2 新能力尚未实现（预期缺口） |
| 登录页渲染 | 见 L1 记录 | 浏览器冒烟结果归档到报告 |
| 真实 IdP 全链路 | 受限 L-02 | 本机无 IdP/网关源码 |

## 二、缺陷 / 缺口清单

| # | 级别 | 现象 | 根因 | 修复任务 |
|---|---|---|---|---|
| D-01 | P0 | 缺 `client_id`/`authorize_url` 的 provider 仍展示 | channels 只做 enabled/usage 过滤 | T3 |
| D-02 | P1 | SSO 失败只显示 JSON 或英文错误码 | 回调无统一 302 错误映射；前端无 i18n | T5/T7 |
| D-03 | P1 | 会话过期无静默重登 | 无 relogin 路由与前端触发 | T6/T7 |
| D-04 | P0 | 主动登出后深链可能被 IdP 会话自动登录 | 无 `sso_provider` Cookie，无抑制条件 | T5/T6 |
| D-05 | P0 | 非默认租户渠道/授权定位到 tenant 0 | 浏览器导航无法带 `X-Backend-Id`，跳转无 tenant 参数 | T3/T4/T7 |
| D-06 | P0（安全） | `oauth_state` 缺失时回调跳过 state 校验 | 现实现 `if (savedState && state !== savedState)` | T2/T5 |
| D-07 | P1 | 旧入口无 `no-store`；未知渠道可能静默走旧链 | 旧逻辑无 fail-closed 分支 | T4 |
| D-08 | P0 | 契约缺 `tenant_id`/`silent`，无法承载新流程 | `SsoStateCookiePayload` 未扩展 | T0 |
| D-09 | 受限 | 网关公开字段与 exchange 开关无法本地核实 | 无 intellect-team 源码 | T0（运维确认） |

## 三、修复方案（仅修上述范围）

| 任务 | 内容 | 文件 |
|---|---|---|
| T0 | 扩展 state 载荷契约；记录网关上线核对项 | `specs/014/contracts/sso-exchange.ts` |
| T1 | SSO 配置读取与启动校验（secret/origin/https/缓存/超时） | `bff/src/services/sso-config.ts`、`bff/src/index.ts`、`bff/.env.example` |
| T2 | 签名 Cookie + PKCE/nonce + tenant/silent 载荷 + 一次性消费 | `bff/src/services/sso-state.ts` |
| T3 | 公开 provider 客户端、字段校验、缓存、租户解析、应急名单 | `bff/src/services/sso-providers.ts`、`auth.ts` |
| T4 | authorize 路由、tenant 校验、旧入口转发/fail-closed、`no-store` | `bff/src/routes/auth.ts` |
| T5 | exchange 客户端、回调新分支、错误映射、登出清理、旧链路保留 | `bff/src/services/sso-exchange.ts`、`auth.ts` |
| T6 | relogin（`sso_provider` 前提）、silent 载荷、重试上限 | `bff/src/routes/auth.ts` |
| T7 | 前端渠道带租户、跳转带 tenant、probe 触发 relogin、错误文案 | `use-login-request.ts`、`user-service.ts`、`auth-hooks.ts`、`locales/en.ts`、`locales/zh.ts` |
| T8 | 审计日志（脱敏） | `auth.ts` |
| T9 | 新增路由单测（TC-BFFSSO-02-01~12） | `bff/src/routes/auth.test.ts` |

## 四、验收与证据

- L2：`cd bff && npx vitest run src/routes/auth.test.ts` 全绿；全量 `npx vitest run` 无新增失败。
- L1：登录页冒烟 PASS；受限项 L-01/L-02/L-03 记入报告。
- 构建：`bff npx tsc --noEmit`、根 `npm run type-check`。
- 报告：`tests/e2e-tests/reports/REPORT-bff-sso-p2-20261120.md`。
