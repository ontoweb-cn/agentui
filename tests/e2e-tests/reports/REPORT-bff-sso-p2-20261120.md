# 交付报告 — BFF SSO P2（spec-014）

日期：2026-11-20；执行方式：九步交付法；方案：`specs/014-sso-token-exchange/plan-p2.md` v1.3；门禁 spec：`tests/e2e-tests/spec/bff-sso-p2-spec.md`。

## 一、结论摘要

| 缺陷/缺口 | 级别 | 状态 | 验收证据 |
|---|---|---|---|
| D-01 缺字段 provider 仍展示 | P0 | 已修复 | `channels` 仅返回 `intellect-auth`；单测 1/2 |
| D-02 SSO 失败提示不可读 | P1 | 已修复 | 浏览器 toast「登录请求已过期，请重新登录。」；截图 01-03 |
| D-03 无静默重登 | P1 | 已修复 | `relogin` 单测（prompt=none / 无 cookie 回登录页） |
| D-04 登出后可被自动重登 | P0 | 已修复 | 登出清 `sso_provider`；relogin 缺失即 302 `/login` |
| D-05 多租户定位缺失 | P0 | 已修复 | channels 带 `X-Backend-Id`；导航带 `tenant`；回调只信 state 载荷 |
| D-06 旧回调 state 可绕过 | P0 | 新链路已修复 | 签名 Cookie 严格校验；旧链路按 FR-024 保留 |
| D-07 旧入口无 fail-closed | P1 | 已修复 | 未知 channel → `/login?error=unknown_provider` |
| D-08 契约缺 tenant/silent | P0 | 已修复 | `sso-exchange.ts` 载荷扩展 |
| D-09 网关字段未核实 | 受限 | 未关闭 | L-01 |

## 二、用例执行结果

| 用例 | 结果 | 说明 |
|---|---|---|
| TC-BFFSSO-01-01 登录页可达 | PASS | 用户名/密码表单正常；截图 01-01 |
| TC-BFFSSO-01-02 开关关闭仅密码登录 | PASS | 无 SSO 按钮 |
| TC-BFFSSO-01-03 错误参数提示 | PASS | 中文 toast；截图 01-03 |
| TC-BFFSSO-01-04 直达 authorize（关闭） | PASS | HTTP 404 |
| TC-BFFSSO-02-01 公开端点/无 Authorization | PASS | vitest |
| TC-BFFSSO-02-02 缺字段降级 | PASS | `broken-provider` 被排除 |
| TC-BFFSSO-02-03 authorize 参数 | PASS | 参数 + `no-store` + Cookie 属性 |
| TC-BFFSSO-02-04 多租户 | PASS | 未知租户 `tenant_not_found`；tenant 入载荷 |
| TC-BFFSSO-02-05 回调成功 | PASS | exchange 入参、双 Cookie |
| TC-BFFSSO-02-06 returnTo 注入 | PASS | 单元断言 6 种输入 |
| TC-BFFSSO-02-07 state 失败 | PASS | 伪造/不匹配均 `sso_state_invalid`，不调 exchange |
| TC-BFFSSO-02-08 网关错误映射 | PASS | 403/网络异常 |
| TC-BFFSSO-02-09 静默重登 | PASS | `prompt=none`；无 cookie 回登录页 |
| TC-BFFSSO-02-10 登出后深链 | PASS | 合并到 02-09 断言 |
| TC-BFFSSO-02-11 旧入口转发 | PASS | 已知渠道转 IdP；未知渠道 fail-closed |
| TC-BFFSSO-02-12 开关关闭回归 | PASS | 既有 46 项通道/回调用例全绿 |

统计：BFF `auth.test.ts` 61/61 通过；BFF 全量 56 文件 1071/1071 通过（新增 15 项）。
前端：`tsc --noEmit` 通过；`npm run build` 成功（2m39s，仅 chunk 体积警告）；ESLint 0 error（2 条既有 warning）。

## 三、交付物清单

| 类型 | 路径 |
|---|---|
| 契约 | `specs/014-sso-token-exchange/contracts/sso-exchange.ts`（+tenant_id/silent） |
| BFF 服务 | `bff/src/services/sso-config.ts`、`sso-state.ts`、`sso-providers.ts`、`sso-exchange.ts` |
| BFF 路由 | `bff/src/routes/auth.ts`、`bff/src/index.ts` |
| BFF 配置样例 | `bff/.env.example` |
| 前端 | `src/services/user-service.ts`、`src/hooks/use-login-request.ts`、`src/hooks/auth-hooks.ts`、`src/locales/en.ts`、`src/locales/zh.ts` |
| 测试 | `bff/src/routes/auth.test.ts`（+15 用例） |
| 文档 | `docs/bff-sso-login-manual.md`、`tests/e2e-tests/outline/*`、`tests/e2e-tests/cases/bff-sso-p2/*`、`tests/e2e-tests/fixtures/bff-sso-p2/providers.json` |
| 证据 | `tests/e2e-tests/results/bff-sso-p2/TC-BFFSSO-01-01.jpg`、`TC-BFFSSO-01-03.jpg` |

## 四、受限注记（R6）

- **L-01**：本机无 `intellect-team` 源码，网关 exchange 开关、公开 provider 字段（`authorize_url`/`scopes`/`pkce`）与 IdP client 配置无法本地核实；上线前必须按 §十一 核对。
- **L-02**：无 intellect-auth 实例，未执行真实 IdP 跳转；SSO 端到端以路由层 mock 覆盖，真实联调需在测试环境补做。
- **L-03**：真实多租户仅 tenant `0`；多租户行为以 mock Store 验证，未做跨网关实例实测。
- **L-04**（基线观察）：`/auth/login/channels` API 返回 10 个渠道，但登录页未渲染 SSO 按钮；该现象在改动前后一致，非本次引入。建议前端专项排查（React Query 结果或渲染条件）。
- **L-05**：根 `npm run type-check` 被 hiedu shared 快照漂移阻断（`client.ts`/`contract.ts` 等 7 个文件），改用 `npx tsc --noEmit` 验证；漂移非本次改动。
- **L-06**：错误参数页面出现两条相同 toast（疑似 StrictMode 下 effect 执行两次），不影响可用性，列为遗留优化。

## 五、遗留建议

1. 网关先行核对（L-01）后再开启 `BFF_SSO_ENABLED`；建议先在默认租户灰度。
2. 在测试环境完成 IdP 真实联调（L-02）与第二个租户（L-03）。
3. 排查 L-04 渠道按钮未渲染问题。
4. 旧回调链路保留一个发布周期后删除；同步补充 SLO 独立 spec。
5. 全量用例复跑命令：`cd bff && npx vitest run src/routes/auth.test.ts`。

## 六、九步闭环声明

1 调研 ✅（`outline/bff-sso-p2-research.md`）；2 手册 ✅；3 双向检视 ✅（差异 X-01~X-06）；4 大纲/用例/夹具 ✅；5 执行 ✅（基线 + 61 用例）；批准门 ✅（用户预授权）；6 修复 ✅（T0~T8）；7 审查/构建/验证 ✅；8 回归 ✅；9 报告/归档 ✅。

本次改动未提交 Git，等待评审后执行 commit。

## 七、评审修复记录（2026-11-20）

| # | 修复 | 验证 |
|---|---|---|
| 1 | SSO 开启且无 `sso_state` 时不再回落旧链路，直接 `sso_state_invalid` | 新增单测「开关开启但无 sso_state」 |
| 2 | 新增 `BFF_FRONTEND_BASE`，`/login` 回跳支持子目录部署 | 单测「BFF_FRONTEND_BASE 生效」 |
| 3 | 登录页租户解析改为 URL `?tenant=` 优先，与 authConfig 对齐 | 前端 tsc/lint |
| 4 | 验签失败时删除坏 `sso_state` Cookie | 代码路径复核 |
| 5 | `imt_token` 的 Secure 统一用 `isSecureCookie` | 单测回归 |
| 6 | Cookie maxAge 取 `min(86400, expires_at-now)` | 单测回归 |
| 7 | provider 缓存 key 改为 `tenant@baseUrl` | 单测回归 |
| 8 | SSO 关闭时直达 authorize → 302 登录页 | 新增单测 + 运行时 302 复核 |
| 9 | `sso_provider` 改为签名 Cookie 并绑定 tenant | 新增伪造 Cookie 单测 |
| 10 | 补超时、`interaction_required` 重试、登出后 relogin 用例 | auth 67/67；全量 1077/1077 |

复跑命令：`cd bff && npx vitest run src/routes/auth.test.ts`。
