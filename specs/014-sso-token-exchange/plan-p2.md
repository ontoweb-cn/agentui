# Plan P2 — BFF OIDC RP 改造

> 对应 [spec.md](./spec.md) 实施阶段 P2（FR-020 ~ FR-026），前置 P1 已就绪（网关 exchange 端点、公开 provider 增加 `client_id`）。
> 状态：**v1.3 已按评审意见与三项设计决策完善，待实施**（评审记录见 §十五）。

## 一、范围

把 agentui 从「网关驱动的 OAuth 旁路」升级为**独立 OIDC RP**：BFF 自建 state / nonce / PKCE，浏览器只与 IdP 交互，BFF 用 `POST /api/members/oauth/exchange` 换取 `imt_*`。

不在 P2 范围：refresh token、IdP 单点登出（SLO）、跨应用 token 直通、exchange 端点的 HMAC 调用方限制。

## 二、现状与差距

| 现状 | 位置 | P2 目标 |
|---|---|---|
| 授权请求由网关拼装，BFF 只透传 302 | [auth.ts](../../bff/src/routes/auth.ts#L741-L771) | BFF 构造 authorize URL（含 PKCE/nonce） |
| `state` 由网关生成，BFF 存明文 Cookie 仅做等值比较 | [auth.ts](../../bff/src/routes/auth.ts#L759-L769) | BFF 自生成 state，与 verifier/nonce/tenant 一起存签名 Cookie |
| 回调走 `/api/oauth/callback`，网关内部完成 code 兑换 | [auth.ts](../../bff/src/routes/auth.ts#L829-L876) | 回调调 `/api/members/oauth/exchange`（BFF 持有 verifier） |
| 渠道列表走需鉴权的 `/api/oauth/providers`，依赖 `API_SERVER_KEY` | [auth.ts](../../bff/src/routes/auth.ts#L641-L684) | 改走公开 `/api/members/oauth/providers` |
| 登录页不携带租户标识，浏览器跳转无法带 header | [use-login-request.ts](../../src/hooks/use-login-request.ts#L42-L52)、[user-service.ts](../../src/services/user-service.ts#L69-L70) | 渠道 XHR 带 `X-Backend-Id`；跳转 URL 带 `tenant`，回调以 state Cookie 为准 |
| 无静默重登，会话过期只能回登录页 | [auth-hooks.ts](../../src/hooks/auth-hooks.ts#L65-L127) | `prompt=none` 静默重登，最多 1 次静默 + 1 次交互 |
| 无能力开关 | — | `BFF_SSO_ENABLED` 关闭时完整回退现网行为 |

## 三、设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | `GET /auth/login/channels` 保持 URL 与响应结构不变，内部按开关切换数据源；登录页仅做**租户传递**的最小改动 | 避免改页面结构；租户问题必须解决，见 §5.5 |
| D2 | state/verifier/nonce/tenant/silent 存**签名** Cookie（`sso_state`），不引进程内 Map | 多副本可用（FR-021）；PKCE verifier 对用户非机密，签名足够防篡改 |
| D3 | 开关为全局环境变量 `BFF_SSO_ENABLED`（默认 false）；provider 过滤默认交给网关，全局应急名单默认空 | 先灰度再按需扩到租户级；避免改动 wizard/JSON schema |
| D4 | 旧网关回调链路原样保留；新回调分支以 `sso_state` Cookie 存在判定 | 满足 FR-024 回滚要求，且开关切换不打断在途授权（B-01） |
| D5 | 浏览器可见的失败统一 302 到 `/login?error=<code>`，XHR 失败仍返回 `{error,message}` | 回调是导航请求，返回 JSON 用户无法处理 |
| D6 | `returnTo` 仅接受同源相对路径：`^/(?!/)`、拒绝 `\` 与 `[\x00-\x1F]`、≤512 字符，否则回落 `/` | 防开放重定向（J-01） |
| D7 | 静默重登由前端探测 401 发起；`silent` 标记写入 `sso_state` 载荷，不新增 Cookie | 少一个一次性 Cookie；重试次数由载荷自然收敛（见 §5.4） |
| D8 | 回调成功后写 `sso_provider`（最近一次 provider，30 天）；登出时清除 | 供静默重登选用，避免前端记忆渠道 |
| D9 | **回调只信任 state Cookie 中的 tenant**，忽略 query 中的 tenant | 防止跨租户劫持/篡改（A-01） |
| D10 | provider 元数据 30s 内存缓存；开关开启后未知 channel **fail-closed**，不回退旧链 | 减少网关往返；避免静默换链导致排障困难（F-01/F-02） |
| D11 | provider 元数据**只以网关公开列表为权威**，不引入 BFF 静态 provider 配置过渡 | 静态配置不能替代网关 exchange 能力，只会引入第三处配置源与漂移（Q1） |
| D12 | 静默重登**必须存在 `sso_provider` Cookie**；登出清除该 Cookie，从而抑制登出后的自动重登 | 无 SLO 时保证「登出」语义不被静默重登架空（Q2） |
| D13 | 默认**不设 provider 白名单**，渠道集合由网关 `enabled && usage` 决定；`BFF_SSO_PROVIDERS` 仅作全局应急 kill-switch | 白名单是租户级的，全局变量会误伤其它租户（Q3） |

## 四、配置项（`bff/.env`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `BFF_SSO_ENABLED` | `false` | 总开关；false 时所有 SSO 路由走旧链路 |
| `BFF_SSO_STATE_SECRET` | 空 | 签名 Cookie 密钥，启用时必填，≥32 字符；多副本必须一致 |
| `BFF_PUBLIC_ORIGIN` | 空 | 对外访问源，如 `https://agentui.example.com`；用于拼 `redirect_uri`，启用时必填 |
| `BFF_SSO_PROVIDERS` | 空 | **仅全局应急 kill-switch**：空（推荐）= 完全以网关 `enabled && usage` 为准；非空会对**所有租户**同时生效，仅供紧急下线渠道 |
| `BFF_SSO_SILENT_RELOGIN` | `true` | 是否允许 `prompt=none` 静默重登 |
| `BFF_SSO_EXCHANGE_TIMEOUT_MS` | `10000` | exchange 请求超时 |
| `BFF_SSO_PROVIDER_CACHE_MS` | `30000` | provider 元数据缓存时长 |
| `BFF_ALLOW_INSECURE_SSO` | `false` | 仅本地联调用：允许 http origin（生产禁止） |

启动校验（fail-fast）：
- `BFF_SSO_ENABLED=true` 时必须提供 `BFF_SSO_STATE_SECRET`（≥32 字符）与 `BFF_PUBLIC_ORIGIN`；
- `NODE_ENV=production` 且 origin 非 `https://` 时启动失败，除非 `BFF_ALLOW_INSECURE_SSO=true`；
- 启动日志打印回调地址、缓存时长，以及全局应急名单是否启用（不打印密钥）。

## 五、路由与流程

### 5.1 渠道列表（改造）

`GET /api/bff/auth/login/channels`
- 开关开：按 `X-Backend-Id`（缺省 `0`）解析租户，调该租户网关的**公开** `GET /api/members/oauth/providers`，不携带 `Authorization`；按 `enabled && usage` 含 `login` 过滤；仅当 `BFF_SSO_PROVIDERS` 非空时再套该全局应急名单；响应结构保持 `{channel, display_name, icon}`。
- **字段缺失即不展示**：公开列表未返回 `authorize_url` / `client_id` / `scopes` / `pkce` 的 provider 不进入渠道列表，记录 `sso_misconfigured` 与缺失字段名；不引入 BFF 静态 provider 配置（D11）。
- 元数据按 `tenant` 维度缓存 `BFF_SSO_PROVIDER_CACHE_MS`；刷新失败时允许使用 ≤5 分钟的旧结果，超过则返回 502（前端保留密码表单，只是不显示 SSO 按钮）。
- 开关关：保持现状（`/api/oauth/providers` + `API_SERVER_KEY`）。

### 5.2 发起授权（新增）

`GET /api/bff/auth/sso/authorize/:provider?tenant=&returnTo=&prompt=`
1. 校验开关；解析并校验 `tenant`（缺省 `0`）：必须存在于 BackendStore、`authMode=intellect-enterprise`，否则 302 `/login?error=tenant_not_found`。
2. 拉取该租户 provider 列表，校验 provider 存在、已启用、且命中全局应急名单（仅当其非空）；未知/缺字段 → 302 `/login?error=unknown_provider` 或 `sso_misconfigured`（不回退旧链）。
3. 校验 provider 支持 PKCE S256；不支持 → 302 `/login?error=sso_pkce_unsupported`。
4. 校验 `returnTo`（D6）。
5. 生成 `state`、`nonce`（32 字节随机，base64url）、`code_verifier`（32 字节），`code_challenge = base64url(SHA-256(verifier))`。
6. 写签名 Cookie `sso_state`（10 分钟，HttpOnly，SameSite=Lax，生产 Secure），载荷：`state`、`code_verifier`、`nonce`、`provider_id`、`tenant_id`、`return_to`、`issued_at`、`silent`。
7. 返回 302（`Cache-Control: no-store`），目标：
   `${authorize_url}?response_type=code&client_id=..&redirect_uri=..&scope=..&state=..&nonce=..&code_challenge=..&code_challenge_method=S256&response_mode=query[&prompt=none]`
   - `scope` 取 provider 下发值，缺省 `openid profile email`；
   - `redirect_uri` 固定 `${BFF_PUBLIC_ORIGIN}/api/bff/auth/oauth/callback`，不接受请求参数覆盖。

旧入口 `GET /auth/login/:channel`：开关开时按同样规则解析 `tenant`，命中 provider 则 302 到 `sso/authorize/:channel?tenant=..&returnTo=/`；未命中 → `unknown_provider`；开关关 → 原逻辑。

### 5.3 回调（改造，新分支）

`GET /api/bff/auth/oauth/callback?code=&state=&error=`

**先按 `sso_state` Cookie 是否存在分流**（D4）：无该 Cookie 时走旧链路（保留 `oauth_state` 校验），有则走新流程，与当前开关取值无关。

1. 验签并读取 `sso_state`；验签失败/`issued_at` 超 10 分钟/`state` 不等（`timingSafeEqual`）→ 302 `/login?error=sso_state_invalid`，不调网关、不读 `returnTo`。
2. 立即删除 Cookie（一次性）；同一 state 二次回调按上一步失败处理。
3. `error=` 分支：
   - `login_required` / `interaction_required` 且载荷 `silent=true` → 允许**一次**交互式重试：用载荷中的 tenant/provider 重新发起 authorize（`silent=false`，不带 `prompt`）；再次失败即 302 `/login?error=sso_session_expired`。
   - 其它 IdP 错误 → 302 `/login?error=sso_code_invalid`。
4. 用载荷中的 `tenant_id` 解析 backend（忽略 query 的 tenant），`POST ${baseUrl}/api/members/oauth/exchange`：
   - body：`grant=authorization_code`、`provider_id`、`code`、`code_verifier`、`redirect_uri`、`nonce`；
   - `AbortController` 超时 `BFF_SSO_EXCHANGE_TIMEOUT_MS`；
   - **不携带** `API_SERVER_KEY`；默认不带 `X-Intellect-Tenant`（BFF 与网关实例一一绑定），如后续需要多实例共享网关再补配置。
5. 成功：写 `imt_token`（复用 `AUTH_COOKIE_NAME` / `AUTH_COOKIE_MAX_AGE`）与 `sso_provider`，302 到校验后的 `return_to`。
6. 失败：不写任何 Cookie，按 §六 302 到 `/login?error=<码>`；日志仅记录 provider、tenant、错误码、requestId、member 指纹哈希。

### 5.4 静默重登（新增）

`GET /api/bff/auth/sso/relogin?tenant=&returnTo=`
- 解析租户（默认 `0`）；`BFF_SSO_SILENT_RELOGIN=false` 时直接 302 登录页。
- **前提：必须存在 `sso_provider` Cookie**（登出会清除）。缺失时直接 302 `/login`，不发起静默重登，避免登出后打开深链被自动重新登录（D12）。
- 存在时以该 provider 发起；该 provider 已下线或不在渠道列表 → 302 `/login?error=unknown_provider`。
- 以 `prompt=none` 复用 §5.2 构造，载荷 `silent=true`。

前端触发点（[auth-hooks.ts](../../src/hooks/auth-hooks.ts#L82-L127)）：
- `useEnterpriseCookieProbe` 返回 401 时，`window.location.replace('/api/bff/auth/sso/relogin?tenant=<id>&returnTo=<当前path>')`；是否真正静默由 BFF 开关与 `sso_provider` Cookie 决定（前端不感知开关）。
- `sessionStorage` 记录尝试，5 分钟内不重复；`/login` 与回调路径不触发。

循环上限：一次静默（silent=true）失败后只允许一次交互授权（silent=false），再失败即回登录页；无需额外计数器。

> 后续可选（H-01）：BFF 企业版 401 响应增加 `X-SSO-Relogin: 1`，前端仅在带该头时触发，覆盖会话中途过期；本版不实施。

### 5.5 租户传递（评审 A-01 落地）

浏览器导航无法携带 `X-Backend-Id`，因此：
1. 登录页 `useLoginChannels` 的 XHR 显式带 `X-Backend-Id`（来自 `localStorage[BackendId]`，缺省 `0`），渠道列表按租户正确返回。
2. 渠道按钮跳转 URL 追加 `tenant`：`/api/bff/auth/login/{channel}?tenant=<id>`，旧入口原样转发到 `sso/authorize`。
3. BFF 在 authorize/relogin 校验 tenant（存在 + 企业版），写入 `sso_state.tenant_id`。
4. 回调只读 Cookie 中的 tenant 解析 backend；query 中的 tenant 一律忽略。
5. 多租户覆盖验收：tenant A 与 tenant B 各自完成一次 SSO，`/auth/me` 返回各自成员，互不串号。

## 六、错误映射

| 网关/IdP/本地结果 | 用户可见 | BFF 行为 |
|---|---|---|
| 本地 state 失败/过期/重放 | `/login?error=sso_state_invalid` | 不写 Cookie、不调 exchange |
| 本地 tenant 不存在或非企业版 | `/login?error=tenant_not_found` | 不发起授权 |
| provider 未知/未启用/被全局应急名单排除 | `/login?error=unknown_provider` | 不回退旧链 |
| provider 不支持 PKCE S256 | `/login?error=sso_pkce_unsupported` | 不发起授权 |
| IdP `login_required` / `interaction_required` 且非静默 | `/login?error=sso_session_expired` | 不写 Cookie |
| exchange 400 `token_exchange_failed` | `/login?error=sso_code_invalid` | 不写 Cookie |
| 401 `account_disabled` | `/login?error=account_disabled` | 不写 Cookie |
| 403 `member_not_provisioned` | `/login?error=member_not_provisioned` | 不写 Cookie |
| 403 `identity_conflict` / `tenant_mismatch` | `/login?error=sso_forbidden` | 不写 Cookie |
| 429 `too_many_requests` | `/login?error=sso_rate_limited` | `Retry-After` 仅写日志；如需展示改为受控 `&retry=<clamped>` |
| 5xx / 网络 / 超时 | `/login?error=sso_unavailable` | 记录原因，不回显上游报文 |
| 网关缺 `client_id`/`authorize_url`/`scopes`/`pkce` | `/login?error=sso_misconfigured` | 渠道不进入列表；直接访问 authorize 时返回该错误并记录缺失字段 |

前端 `useOAuthCallback` 已能读取 `?error=` 并提示（[auth-hooks.ts](../../src/hooks/auth-hooks.ts#L12-L29)），需补齐上述 i18n 文案。

## 七、安全控制

- `state`/`verifier`/`nonce` 一次性，10 分钟过期，服务端二次校验 `issued_at`；state 比较用 `crypto.timingSafeEqual`。
- state Cookie 绑定 `tenant_id` 与 `provider_id`，回调不接受客户端传入的这两个值。
- `redirect_uri` 由 `BFF_PUBLIC_ORIGIN` 固定拼接；authorize 响应 `Cache-Control: no-store`。
- Cookie：HttpOnly + SameSite=Lax + 生产 Secure；`sso_state` 与 `imt_token` 分离，前者不参与业务鉴权。
- `returnTo` 白名单校验（D6），并拒绝反斜杠、控制字符与超长值。
- 日志白名单：tenant_id、provider_id、错误码、member_id 哈希前缀、requestId；禁止 code / verifier / nonce / token / id_token。
- exchange 不携带 `API_SERVER_KEY`，登录链路不依赖服务密钥；管理面继续保留。
- `BFF_SSO_STATE_SECRET` 轮换会使在途授权失败（可接受），文档中注明需与网关发布窗口错开。

## 八、测试计划

> 按 Principle VII：每个任务先写用例，T9 只做跨任务回归汇总。

### BFF 单测（`bff/src/routes/auth.test.ts` 扩展，mock `global.fetch`）

1. 开关关闭：channels 走 `/api/oauth/providers` 且带 `Authorization`；回调用 `oauth_state`（回归）。
2. 开关开启：channels 走公开端点、不带 `Authorization`；应急名单为空时不额外过滤，非空时按全局名单过滤。
3. 租户：channels 带 `X-Backend-Id`；authorize 的 `tenant` 写入 Cookie；不存在/非企业版 → `tenant_not_found`。
4. authorize：URL 含 `response_type`、`client_id`、`redirect_uri`、`scope`、`state`、`nonce`、`code_challenge`、`code_challenge_method=S256`、`response_mode=query`；带 `prompt=none` 时正确透传。
5. authorize 响应含 `Cache-Control: no-store`；Cookie 属性（HttpOnly/Lax/Max-Age=600/Secure 按环境）正确。
6. provider 不支持 PKCE → `sso_pkce_unsupported`，不写 Cookie。
7. 回调无 `sso_state`、state 不匹配、已过期、二次回调 → 均 302 `sso_state_invalid`，且未发出 exchange 请求。
8. 回调成功：exchange body 与 Cookie 载荷一致（含 verifier/nonce）；写 `imt_token` + `sso_provider`；302 `returnTo`。
9. 回调使用的 backend 由 Cookie 的 tenant 决定；query 传入其它 tenant 不生效。
10. `returnTo=//evil.com` / `https://evil.com` / `/\evil.com` / 含 CRLF / 超长 → 回落 `/`。
11. exchange 400/401/403/429/5xx/超时 → 对应 `/login?error=`，无 Cookie。
12. 静默重登：`login_required` 首次 → 交互式授权（silent=false）；交互仍失败 → `sso_session_expired`，无循环。
13. provider 缓存：TTL 内二次 authorize 不重复拉取；刷新失败时使用 ≤5 分钟旧值，超时返回 502。
14. 开关开启且未知 channel → `unknown_provider`，不回退旧链。
15. 启动校验：缺 secret/origin 失败；生产非 https 失败；`BFF_ALLOW_INSECURE_SSO=true` 放行。
16. 日志断言：console 不含 code/verifier/nonce/token 原文。
17. 登出后：`imt_token` 与 `sso_provider` 均被清除；带深链访问触发 probe 401 时**不**发起 relogin，直接落登录页。
18. 白名单：默认（空）时渠道集合与网关 `enabled && usage` 完全一致；非空时对所有租户生效（用例注明全局语义与误伤风险）。
19. 公开列表缺 `authorize_url`/`client_id`/`scopes`/`pkce`：该渠道不展示，记录 `sso_misconfigured`，密码表单仍可用。

### 前端

- `useLoginChannels` 请求带 `X-Backend-Id`；渠道跳转 URL 含 `tenant`。
- 探测 401 → 触发一次 relogin；5 分钟内二次 401 不重复跳转。
- `?error=` 全部新码有 i18n 文案且能渲染。

### 手工联调

默认租户：清 Cookie → 点渠道 → IdP 登录 → 落地 `/` → `/auth/me` 200；再清 `imt_token` 保留 IdP 会话 → 访问首页触发静默重登，无口令输入。
非默认租户：`?tenant=B` 登录页 → 渠道列表来自 B → SSO 成功 → `/auth/me` 为 B 成员。
回滚：关开关 → 全链路回到密码登录；切换开关时正在进行的授权仍能完成。

## 九、上线与回滚

1. 网关侧：确认 `INTELLECT_OAUTH_EXCHANGE_ENABLED=true`，provider 配好 `redirect_uris`、公开列表字段完整（§十一）；标定 IdP client；确认 `enableSigninSession=true`（静默重登前置）。
2. BFF 以 `BFF_SSO_ENABLED=false` 部署，验证登录回归。
3. 打开开关，先在默认租户验证 §5.1~5.3 与 §5.5；再验证第二个租户。
4. 打开静默重登（`BFF_SSO_SILENT_RELOGIN=true`），观察 `/login?error=` 比例与回调失败日志；未确认 IdP `enableSigninSession` 前保持 false。
5. 回滚：置开关为 false 并重启；在途授权因 Cookie 分流仍可完成；旧回调分支保留一个发布周期后删除。
6. 网关未开启 exchange 时，错误稳定落在 `sso_unavailable`，不会破坏密码登录。

## 十、任务拆分（按依赖顺序）

| # | 任务 | 主要文件 | 依赖 |
|---|---|---|---|
| T0 | 前置核对与契约：网关 exchange 开关、公开 provider 字段（`authorize_url`/`client_id`/`scopes`/`pkce`）、IdP client 与 `enableSigninSession`；扩展 `SsoStateCookiePayload`（`tenant_id`、`silent`） | `specs/014/contracts/sso-exchange.ts`、网关配置 | — |
| T1 | 配置与启动校验（开关/密钥/origin https/缓存/超时） | `bff/src/index.ts`、`bff/.env.example` | T0 |
| T2 | 签名 Cookie + PKCE/nonce 工具（生成、验签、一次性消费、tenant/silent 载荷） | `bff/src/utils/sso-state.ts`（新增） | T1 |
| T3 | 公开 provider 客户端 + 缓存 + 字段校验 + 渠道列表改造（含租户解析、全局应急名单） | `bff/src/services/sso-providers.ts`（新增）、`auth.ts` | T1 |
| T4 | authorize 路由 + tenant 校验 + 旧入口转发 | `bff/src/routes/auth.ts` | T2、T3 |
| T5 | exchange 客户端 + 回调改造 + 登出清理 `sso_provider` | `bff/src/services/sso-exchange.ts`（新增）、`auth.ts` | T2、T3 |
| T6 | 静默重登（relogin 需 `sso_provider` 前提、silent 载荷、重试上限） | `bff/src/routes/auth.ts` | T4、T5 |
| T7 | 前端：channels 带租户 header、跳转带 tenant、探测触发 relogin、i18n | `src/hooks/use-login-request.ts`、`auth-hooks.ts`、`src/services/user-service.ts`、`src/locales/*` | T6 |
| T8 | 审计日志（tenant/provider/错误码/指纹哈希） | `bff/src/routes/auth.ts` | T5 |
| T9 | 跨任务回归与文档一致性 | `bff/src/routes/auth.test.ts` 等 | T2~T8 |
| T10 | 运维文档：IdP client 注册、provider 配置、租户验收、回滚 | `docs/`、`bff/.env.example` | T9 |

## 十一、前置依赖与待核实

1. **公开 provider 端点字段**：需确认 `GET /api/members/oauth/providers` 返回 `authorize_url`、`scopes`、`pkce`（`client_id` 已在 P1 补齐）。缺失则 T3 阻塞，需网关先行。
2. **网关 exchange 开关**：`INTELLECT_OAUTH_EXCHANGE_ENABLED` 默认 false，上线前必须显式开启并回归。
3. **IdP client 注册**：`redirectUris` 精确等于 `${BFF_PUBLIC_ORIGIN}/api/bff/auth/oauth/callback`；`isShared=false`；`tokenFormat=JWT-Custom` 且 TokenFields 含 `Cas`；`enableSigninSession=true`。
4. **身份对账**：JIT 关闭时先完成 `(provider_id, sub)` 绑定，否则稳定 403 `member_not_provisioned`。
5. **多副本**：`BFF_SSO_STATE_SECRET` 必须一致；滚动发布期间旧副本需能验签。
6. **反向代理**：`BFF_PUBLIC_ORIGIN` 与实际对外地址一致，且代理需把 `/api/bff/*` 正确转发到 BFF（当前 Vite dev 会剥离 `/api/bff` 前缀）。
7. **多租户**：确认非默认租户的 IP/网络可达其绑定的网关实例，且各实例 provider 配置一致。

## 十二、风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 多租户传递被篡改 | 串号/越权 | tenant 只作定位线索；回调以签名 Cookie 为准；校验租户存在与企业版 |
| 旧前端缓存页面仍点旧按钮 | 走错分支 | 旧入口保留并转发；未知 channel fail-closed |
| `prompt=none` 循环 | 白屏/重定向风暴 | silent 载荷 + 仅一次交互重试 |
| 企业版 401 拦截器与探测互触发 | 登录页抖动 | 仅 probe 明确失败时触发；不走通用 401 分支 |
| 会话 8h 到期无 refresh | 用户中途失效 | 静默重登覆盖；失败文案区分「会话过期」 |
| provider 缓存过期/刷新失败 | 授权失败或短暂不可用 | 30s TTL + ≤5 分钟旧值 + 明确错误码 |
| exchange 超时 | 回调挂起 | AbortController + 5xx 映射 |
| 日志泄露凭证 | 安全事件 | 白名单字段 + 单测断言 |
| 网关与 BFF 版本错位 | SSO 不可用 | 开关默认关闭；`sso_misconfigured` / `sso_unavailable` 指引明确 |

## 十三、验收口径

- 开关关闭：登录链路与当前版本逐字段一致（channels 请求、Cookie、错误码、旧回调）。
- 开关开启：authorize URL 满足 FR-020；回调满足 FR-022；channels 不带 `Authorization`（FR-023）。
- 默认租户与非默认租户各自 SSO 成功，`/auth/me` 返回对应成员（§5.5）。
- 清空 Cookie 后 SSO 登录成功；`API_SERVER_KEY` 置空时 SSO 登录仍成功（SC-002）。
- 静默重登最多一次静默 + 一次交互，无循环（FR-025 / T-17）。
- 日志扫描无 code/verifier/nonce/token（T-14）。
- 发布过程中切换开关，不影响在途授权完成（D4）。
- 公开 provider 缺字段时渠道不展示、记录 `sso_misconfigured`，密码登录仍可用；BFF 无静态 provider 配置（Q1/D11）。
- 登出后打开深链不会被静默重登；`sso_provider` 缺失时 relogin 直接落登录页（Q2/D12）。
- 未设置 `BFF_SSO_PROVIDERS` 时，渠道集合与网关 `enabled && usage` 一致；设置后明确作用于所有租户（Q3/D13）。

## 十四、设计决策结论（v1.3）

| # | 问题 | 结论 | 理由 |
|---|---|---|---|
| Q1 | 公开 provider 字段不足时是否允许静态配置过渡 | **不允许**；以 T0 为门禁，缺字段的渠道不展示（`sso_misconfigured`） | 静态配置无法替代网关 exchange 能力，只会引入第三处配置源与漂移（D11） |
| Q2 | 静默重登默认开启是否可接受 | **默认开启**，但必须存在 `sso_provider` Cookie；登出清除该 Cookie | 登出语义不被静默重登架空；IdP 无会话时最多退化为一次交互授权（D12） |
| Q3 | 白名单全局还是按租户 | **默认不设白名单**；`BFF_SSO_PROVIDERS` 仅作全局应急 kill-switch，设置即影响所有租户 | provider 列表本身按租户拉取，全局过滤语义会误伤其它租户（D13）；租户级灰度留待后续 `BffTenant.ssoProviders` |

> 无未决事项。若后续需要按租户灰度，按 D13 的演进路径增加可选字段，不恢复全局语义。

## 十五、评审记录

### v1.3 设计决策（已落入正文）

| # | 决策 | 影响章节 |
|---|---|---|
| Q1 | 不引入 BFF 静态 provider 配置；公开字段缺失则该渠道降级不展示 | D11、§5.1、§5.2、§八-19、§十三 |
| Q2 | 静默重登默认开，但以 `sso_provider` Cookie 为前提；登出清除即抑制 | D12、§5.4、§八-17、§九-4、§十三 |
| Q3 | 默认不设白名单；全局变量仅为应急 kill-switch，设置即全租户生效 | D13、§四、§5.1、§5.2、§八-18、§十三 |

### v1.1 评审结论

> 评审对象：v1.0。结论：方向与 spec 一致，可进入实施，但需先修订 P0；v1.2 已全部落入正文。

| # | 问题 | 处置（v1.2） |
|---|---|---|
| A-01 | 多租户定位缺失：登录页渠道请求不带 `X-Backend-Id`，跳转无法带 header，BFF 一律 tenant `0` | 采用方案②，新增 §5.5；D1/D9、§5.1~5.4、T3/T4/T7 全部同步 |
| B-01 | 回调用全局开关判定新/旧分支，发布期断链 | 改为以 `sso_state` Cookie 判定（D4、§5.3） |
| C-01 | `Retry-After` 无法随 302 传递 | 仅写日志，可选 `retry` 参数（§六） |
| C-02 | state 失败返回 400 JSON，导航请求不可用 | 统一 302 `sso_state_invalid`（§5.3、§六） |
| D-01 | 契约缺 `silent`/`tenant_id`，且原方案要加第三个 Cookie | 扩展 `SsoStateCookiePayload`，`silent` 入载荷（T0、D7） |
| E-01 | 网关 exchange 开关与公开 provider 字段未核实 | 列为 T0 出口条件（§十一） |
| F-01 | authorize 每次拉取 provider，缺缓存 | 30s 缓存 + 旧值兜底（D10、§5.1） |
| F-02 | 未知 channel 静默回退旧链 | fail-closed `unknown_provider`（D10） |
| G-01 | 缺 `response_mode=query`/`no-store`；未兼容 `interaction_required`；无重放用例 | §5.2/§5.3/§八 已补 |
| G-02 | 未校验 provider 是否支持 PKCE | `sso_pkce_unsupported`（§5.2） |
| H-01 | 静默重登只挂 probe，覆盖不了会话中途过期 | 列为后续可选（§5.4 末尾） |
| I-01 | 测试堆到 T9，违背 Test-First | 各任务先写用例，T9 只做回归（§八、§十） |
| J-01 | `returnTo` 未挡反斜杠/控制字符；http origin 下 Secure Cookie 不下发 | D6、§四 启动校验、§八 用例 |
| K-01 | 审计字段与密钥轮换说明缺失 | T8、§七 |
| K-02 | 登出未清 `sso_provider` | 并入 T5 |
| K-03 | 多标签覆盖 state Cookie | 用例 7 覆盖（旧标签失败提示重试） |

### 评审未采纳

- 回调返回 JSON 由前端处理：导航请求无法读取 body，维持 302。
- BFF 统一拦截 401 并 302：XHR 不跟随 302，且与现有企业版 401 忽略策略冲突，维持前端探测触发。
