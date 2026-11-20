# 调研笔记 — BFF SSO P2（OIDC RP 改造）

日期：2026-11-20；范围：`specs/014-sso-token-exchange/plan-p2.md` v1.3（T0~T10）。

## 一、前端组件树与登录链路

| 位置 | 职责 | 关键事实 |
|---|---|---|
| [login-next/index.tsx](../../../src/pages/login-next/index.tsx) | 登录/注册页 | `disablePasswordLogin` 控制密码表单；渠道按钮来自 `useLoginChannels`；点击调用 `useLoginWithChannel` |
| [hooks/use-login-request.ts](../../../src/hooks/use-login-request.ts) | 登录/渠道/登出 hooks | `useLoginChannels` 未带 `X-Backend-Id`；`useAuthMode` 已支持 `?tenant=` 写 localStorage |
| [services/user-service.ts](../../../src/services/user-service.ts) | 请求封装 | `loginWithChannel` 直接 `window.location.href`，无法携带 header |
| [hooks/auth-hooks.ts](../../../src/hooks/auth-hooks.ts) | 登录态探测 | `useEnterpriseCookieProbe` 在非 login/admin 路径用裸 fetch 调 `/auth/me`；401 时清标记，目前无静默重登 |
| [utils/request.ts](../../../src/utils/request.ts) | axios 拦截器 | 企业版 HTTP 401 被刻意忽略（避免 probe 循环），因此静默重登需另起触发点 |

## 二、后端路由与管线

| 端点（BFF 内部路径） | 现状 | 依据 |
|---|---|---|
| `POST /auth/login` | 企业版调网关 `/api/members/login`，写 `imt_token` Cookie | [auth.ts](../../../bff/src/routes/auth.ts#L167-L245) |
| `GET /auth/login/channels` | 企业版调 `/api/oauth/providers`（带 `API_SERVER_KEY`） | [auth.ts](../../../bff/src/routes/auth.ts#L635-L709) |
| `GET /auth/login/:channel` | 透传网关 302，并把 `state` 存明文 `oauth_state` Cookie | [auth.ts](../../../bff/src/routes/auth.ts#L715-L792) |
| `GET /auth/oauth/callback` | 调网关 `/api/oauth/callback`，**仅在 Cookie 存在时**校验 state，直接使用返回 token | [auth.ts](../../../bff/src/routes/auth.ts#L798-L898) |
| `GET /auth/me` | 用 Cookie 中 token 调网关 `/api/members/me` | [auth.ts](../../../bff/src/routes/auth.ts#L295-L382) |
| `POST /auth/logout` | 调网关 logout 并清 `imt_token` | [auth.ts](../../../bff/src/routes/auth.ts#L531-L611) |

挂载：`app.route('/', authRoutes)`；仅 `/auth/me`、`/auth/logout` 挂 `authSessionMiddleware`（[index.ts](../../../bff/src/index.ts#L261-L271)）。
前端路径 `/api/bff/auth/*` 由 Vite dev proxy 去掉 `/api/bff` 前缀（[vite.config.ts](../../../vite.config.ts#L129-L134)），生产需等价反代规则。

## 三、配置与数据

- 租户：`bff/data/bff-tenants.json`（当前仅 `id=0`，企业版绑定 `intellect-enterprise-default`）。
- 后端：`bff/data/harness-backends.json`；运行时 `HarnessBackend` 含 `endpoint` 与 `adminToken`。
- 环境：`bff/.env`（`BFF_PORT=9390`、`HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY` 等）。
- 契约：`specs/014-sso-token-exchange/contracts/sso-exchange.ts`（`SsoStateCookiePayload` 目前无 `tenant_id`/`silent`）。

## 四、环境基线（开工时实测）

| 项 | 状态 |
|---|---|
| BFF | `http://localhost:9390`，`/health` 200（tsx watch） |
| 前端 | `http://localhost:9391`，HTTP 200（vite） |
| 网关源码 | 本机无 `intellect-team` 仓库 → T0 的网关字段/开关核对**受限**（R6） |
| IdP | 本机无可用 intellect-auth 实例 → 完整 SSO 端到端**受限**（R6） |
| 构建产物链 | 本地 dev 直跑源码；无部署真源，改动即生效（tsx watch + Vite HMR） |

## 五、测试设施

- BFF：`vitest`（`bff/package.json`），`auth.test.ts` 以 mock fetch + mock Store 直测 Hono 路由，可复用 `createApp`。
- 前端：`jest`（根 `package.json`），当前无 auth hooks 测试文件。
- `tests/e2e-tests/` 目录不存在，本次按九步法规范新建 outline/cases/fixtures/reports/spec。

## 六、初步结论

1. 现状 SSO 依赖网关发起授权，BFF 不持有 PKCE；回调用返回 token 的修复已合入。
2. 新增 P2 能力（authorize/relogin/state Cookie/exchange）在代码中**尚不存在**，执行阶段将以「功能缺口」记录，而非回归缺陷。
3. 多租户与登出语义是本次改造的两个高风险点，需在用例中单列。
