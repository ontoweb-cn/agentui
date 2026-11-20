# 测试大纲 — BFF SSO P2

关联手册：`docs/bff-sso-login-manual.md`；方案：`specs/014-sso-token-exchange/plan-p2.md` v1.3。

## 一、范围与基线

- 模块：企业版登录（账号密码 + SSO 渠道 + 静默重登 + 登出）。
- 代码域：`bff/src/routes/auth.ts`、新增 `bff/src/services/sso-*.ts`、前端登录页/hooks。
- 环境：本地 dev（BFF 9390 / Vite 9391），无真实 IdP 与网关源码。
- 隔离：本模块用例不写入网关数据；E2E 数据统一 `e2e-` 前缀（如租户 `e2e-tenant`）。

## 二、五轴覆盖矩阵

| 轴 | 覆盖用例 |
|---|---|
| 正常 | TC-01 登录页展示；TC-03 authorize 参数；TC-05 回调成功 |
| 边界 | TC-02 关闭 SSO/无渠道；TC-04 多租户；TC-06 returnTo 注入 |
| 错误 | TC-07 state 失败/重放；TC-08 网关 401/403/429/5xx |
| 联动 | TC-09 静默重登；TC-10 登出后深链 |
| 直达入口 | TC-11 旧入口 `/auth/login/:channel` 转发；TC-12 直连 authorize 未启用 |

## 三、执行方式

| 层 | 方式 | 说明 |
|---|---|---|
| L1 UI | 浏览器自动化（真实 UI） | 仅覆盖登录页展示与交互入口；SSO 跳转需 IdP，受限 |
| L2 API | `vitest` 路由级（mock fetch） | 覆盖全部 SSO 分支、Cookie、错误映射 |
| L3 回归 | 既有 BFF 全量 + 前端类型检查 | 保证密码登录/社区版不回归 |

## 四、手册 ↔ 代码双向检视差异清单（步骤 3）

| # | 手册口径 | 代码现状 | 处置 |
|---|---|---|---|
| X-01 | 渠道缺必要配置不展示 | channels 不校验 `client_id/authorize_url/scopes/pkce` | 缺陷 D-01，P2 T3 修复 |
| X-02 | SSO 失败有可读提示 | 回调失败返回 JSON 或 `?error=` 原码，无 i18n | 缺陷 D-02，P2 T5/T7 |
| X-03 | 会话过期可静默重登 | 无 relogin 路由与前端触发 | 缺陷 D-03，P2 T6/T7 |
| X-04 | 主动登出后不会被自动登录 | 无 `sso_provider` Cookie，无从抑制 | 缺陷 D-04，P2 T5/T6 |
| X-05 | 支持 `?tenant=` 指定租户登录 | 仅写 localStorage 用于 authConfig；channels/跳转未带租户 | 缺陷 D-05，P2 T3/T4/T7 |
| X-06 | （内部）回调必须校验 state | 仅当 `oauth_state` Cookie 存在时才校验，缺失可绕过 | 缺陷 D-06（安全），P2 T2/T5 |
| — | 账号密码/注册/登出 | 与手册一致 | 无需修改 |

## 五、R6 受限声明（预登记）

- L-01：无 intellect-team 源码，T0 的「公开 provider 字段/网关开关」无法本地核实。
- L-02：无 intellect-auth 实例，无法完成真实 IdP 跳转；SSO 端到端以 mock 路由测试 + 手工步骤说明替代。
- L-03：多租户网关实例只有一个（tenant `0`），多租户用例以 mock Store 验证，不做真实跨实例。

## 六、退出条件

- L2 用例全部通过；L1 登录页冒烟通过；L3 全量回归无新增失败。
- 每个缺陷 D-0x 有修复与验收证据；受限项在报告专节登记。
