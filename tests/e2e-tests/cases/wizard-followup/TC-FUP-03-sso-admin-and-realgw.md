# TC-FUP-03 — 统一认证设置页(A7)+ 真网关取证(A3)

截图目录:`tests/e2e-tests/results/wizard-sso-followup/`

## TC-FUP-03-01 管理端页面渲染(受限:L-02 需管理员会话)

| 项 | 内容 |
|---|---|
| 步骤 | 1. `/admin/sso-settings`(有会话时) |
| 预期 | 表单渲染:启用开关/公开来源(http 警告)/渠道白名单/静默重登;展示各项来源(runtime/env);提示"密钥由部署配置管理" |
| 受限 | 无会话环境以 API 层替代 + 截图留待联调 |

## TC-FUP-03-02 API:GET 生效配置与来源标记

| 项 | 内容 |
|---|---|
| 步骤 | `GET /api/bff/admin/sso/config`(带会话/单测 mock) |
| 预期 | 返回 `{config, sources}`;无 runtime 文件时 sources 全为 `env`;有文件时被覆盖字段标 `runtime` |

## TC-FUP-03-03 API:PUT 校验矩阵(BFF 单测)

| # | 输入 | 预期 |
|---|---|---|
| 1 | publicOrigin 非法 | 400 |
| 2 | providers 非数组元素 | 400/清洗 |
| 3 | 合法最小集 | 200 + 文件落盘(无 secret 字段) |
| 4 | 合并语义:runtime 覆盖 env,未覆盖字段回落 env | 单测断言 |
| 5 | 未鉴权访问 | 401(中间件) |

## TC-FUP-03-04 A3 真网关渠道取证

| 步骤 | 向导 SSO 区块填真网关 `https://ai.wust.edu.cn/intellect-gateway` → 获取渠道 |
|---|---|
| 预期 | 可达:展示真实渠道列表(截图);不可达:502 提示(截图);闭环(点渠道登录)留人工联调清单 |
| 截图 | `TC-FUP-03-04-real-gw.png` |

## 人工联调清单(A3 交付物,写入报告)

1. 浏览器打开登录页 → 点击统一认证渠道;
2. IdP 登录(人工输入凭据)→ 应回 agentui 首页;
3. `GET /api/bff/auth/me` 返回 member 信息;
4. 登出后不触发静默重登(与 BFF_SSO_SILENT_RELOGIN 一致)。
