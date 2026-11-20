# Feature Specification: SSO 登录 Token 交换（intellect-auth → intellect-team member token）

**Feature Branch**: `014-sso-token-exchange`

**Created**: 2026-11-20

**Status**: P1 Implemented (v1.5；已按两轮代码评审修复安全/一致性问题，BFF 侧 P2 待实施)

**Input**: 用户需求："在启用 SSO（例如 intellect-auth）的情形下，agentui 是否可以免除配置 TOKEN？直接通过 OAuth 登录 intellect-team，并可以访问其它应用资源（例如 aidevops）。" — 本 spec 落地方案 2（BFF 作为 OIDC RP，网关提供授权码兑换端点）。

## Constitution References

- **Principle I (BFF-Mediated Frontend, NON-NEGOTIABLE)**：前端所有后端调用必经 BFF；token 不出现在前端 JS
- **Principle V (Tenant Isolation via BFF)**：一个 BFF Tenant 绑定一个 intellect-team 实例；`X-Intellect-Tenant` 头必须校验
- **Principle VII (YAGNI + Test-First)**：v1 只实现授权码兑换一种模式，不做 token-exchange/refresh/SLO
- **Principle VIII (BFF ↔ Intellect Enterprise Access Contract, NON-NEGOTIABLE)**：**本 spec 对"所有 BFF 请求统一用 API_SERVER_KEY 鉴权"构成例外**，须按 Governance 要求显式记录并获得 maintainer 批准（见 §10 R-01）
- **Naming & Security Constraints / Token 安全**：敏感凭证经环境变量注入，不落盘 JSON

## 背景与问题陈述

启用 intellect-auth 作为统一 IdP 后，agentui 的登录链路目前存在以下事实与缺口（均已核实源码）：

1. **登录仍是账号密码**：企业版 BFF 调 `POST /api/members/login`（[auth.ts](../../bff/src/routes/auth.ts#L179-L245)）。OAuth 通道虽已接线（[auth.ts](../../bff/src/routes/auth.ts#L715-L910)），但依赖网关的浏览器重定向 + 回调签发，BFF 不是独立的 OIDC RP。
2. **BFF 回调链路有阻断缺陷**：回调后用 `API_SERVER_KEY` 调 `POST /api/members/{id}/token`（[auth.ts](../../bff/src/routes/auth.ts#L862-L898)），而该端点要求 Member 身份（[members_api.rs](../../../intellect-team/intellect-gateway/src/platform/members_api.rs#L664-L681)、[require_member_ctx](../../../intellect-team/intellect-gateway/src/platform/members_api.rs#L225-L257)），Profile 模式必然 401 `No member ID available`。回调本身已返回 `token`（[api_server.rs](../../../intellect-team/intellect-gateway/src/platform/api_server.rs#L10408-L10418)），该步属多余且失败。
3. **网关 OIDC 验签的 issuer 传错**：`extract_user_claims` 把 discovery URL 当作期望 issuer（[api_server.rs](../../../intellect-team/intellect-gateway/src/platform/api_server.rs#L10522-L10534)），`iss` 必然不匹配，只能回落到 userinfo。
4. **渠道列表仍依赖服务密钥**：`GET /api/oauth/providers` 需要身份（[api_server.rs](../../../intellect-team/intellect-gateway/src/platform/api_server.rs#L9807-L9822)），BFF 的 `/auth/login/channels` 因此仍持有 `API_SERVER_KEY`。网关另有**公开**的 `GET /api/members/oauth/providers`（[members_api.rs](../../../intellect-team/intellect-gateway/src/platform/members_api.rs#L793-L858)），但没有暴露 `client_id`。
5. **跨应用不可直通**：intellect-team 只认自签 `imt_*`（[auth.rs](../../../intellect-team/intellect-gateway/src/platform/auth.rs#L579-L596)），aidevops 只认 IdP RS256 或自签 HS256（[bearer_auth.py](../../../intellect-aidevops/myapp/kernel/security/bearer_auth.py#L1-L46)），二者互不认对方 token。

## 目标与非目标

### 目标

| 编号 | 目标 | 验收口径 |
|---|---|---|
| G-1 | BFF 成为独立 OIDC RP | BFF 自建 state/PKCE/nonce，浏览器只与 IdP 交互 |
| G-2 | 网关提供授权码兑换端点 | `POST /api/members/oauth/exchange` 返回 `imt_*`，BFF 无感知 IdP 细节 |
| G-3 | 用户零 TOKEN 配置 | 终端用户不填写任何 API Key；浏览器仅有 HttpOnly Cookie |
| G-4 | 服务密钥最小化 | 登录链路不再需要 `API_SERVER_KEY`；管理面继续保留 |
| G-5 | 可回滚 | 能力开关关闭时回退到账号密码/网关回调链路，行为不变 |

### 非目标（明确不做）

- 不做 `imt_*` → aidevops token 的二次交换或凭证分发（跨应用走 IdP 各自的 `client_credentials`/token-exchange）
- 不做 refresh token（网关不发；BFF 收到 401 后静默重登）
- 不做 IdP 单点登出（SLO）：IdP 侧端点齐备（`/api/logout`、`/api/sso-logout`，[router.go](../../../intellect-auth/routers/router.go#L54-L55)），但 BFF 不持有 `id_token`、`sid`，v1 仅清本地会话；SLO 另立 spec
- 不实现模式 A（BFF 自行 code→token 后再交 id_token），避免 client_secret 分发与双份 RP 逻辑（YAGNI）
- 不改变 aidevops 现有 OIDC 接入方式

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 通过 intellect-auth 一键登录 agentui (Priority: P1)

作为企业版用户，我希望在 agentui 登录页点击"统一认证"后跳转 intellect-auth，完成认证即回到 agentui 并进入工作台，全程不接触任何 Token。

**Independent Test**：在测试环境注册 provider 与 client 后，清空浏览器 Cookie，点击渠道按钮 → IdP 登录 → 回调 → 落地 `/`，`GET /api/bff/auth/me` 返回 member 信息。

**Acceptance Scenarios**：

1. **Given** BFF 已启用 SSO 且配置了 `intellect-auth` provider，**When** 用户点击渠道按钮，**Then** BFF 302 到 IdP authorize，URL 含 `client_id`、`redirect_uri`、`state`、`nonce`、`code_challenge`、`code_challenge_method=S256`
2. **Given** 用户在 IdP 完成认证并回跳 BFF，**When** BFF 校验 `state` 后调网关 exchange，**Then** 网关返回 `imt_*`，BFF 写入 HttpOnly Cookie 并 302 到 `returnTo`
3. **Given** 登录成功，**When** 前端请求 `/api/bff/auth/me`，**Then** 返回 `{member_id, display_name, role, email}`，Cookie 不可被 JS 读取
4. **Given** 用户已有 IdP 会话，**When** 会话过期后再次点击渠道按钮，**Then** IdP 静默回跳（无口令输入），重新签发 `imt_*`

---

### User Story 2 - 网关集中做身份映射与 token 签发 (Priority: P1)

作为平台维护者，我希望网关是唯一持有 OIDC client_secret、唯一执行验签与身份映射的组件，BFF 只做会话管理。

**Independent Test**：仅给 BFF 配置 `client_id` 与网关 endpoint（不给 secret），完成 US1 全流程。

**Acceptance Scenarios**：

1. **Given** provider 已配置 `client_secret`（加密存储），**When** BFF 提交 `code + code_verifier`，**Then** 网关解密 secret、调用 IdP token 端点、验签并签发 `imt_*`
2. **Given** BFF 未持有任何 IdP secret，**When** 检查 BFF 环境变量，**Then** 不存在 `*CLIENT_SECRET*`
3. **Given** 同一 `sub` 多次登录，**When** 重复调用 exchange，**Then** 返回同一 `member_id`
4. **Given** 成员在网关侧被禁用，**When** 再发起 exchange，**Then** 401 `account_disabled`，不签发 token

---

### User Story 3 - 服务密钥不再参与登录 (Priority: P2)

作为运维，我希望登录链路不依赖 `HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY`，从而在密钥轮换期间不影响用户登录。

**Independent Test**：临时清空该环境变量（保留管理面以外功能），登录仍成功；管理面请求按预期 502/403。

**Acceptance Scenarios**：

1. **Given** 渠道列表启用公开 provider 端点，**When** 未登录用户加载登录页，**Then** 渠道可见，无 401
2. **Given** `API_SERVER_KEY` 被置空，**When** 用户完成 SSO 登录，**Then** 登录成功（仅管理面受影响）

---

### User Story 4 - 失败可诊断、可回退 (Priority: P2)

作为值班人员，我希望 SSO 失败时返回明确错误码并保留审计，且能一键回退到账号密码登录。

**Acceptance Scenarios**：

1. **Given** IdP 不可达，**When** 用户点击渠道按钮，**Then** 前端显示可读错误，BFF 日志含 provider 与阶段，不泄露 token
2. **Given** 能力开关关闭，**When** 用户打开登录页，**Then** 仅显示账号密码登录，SSO 按钮消失
3. **Given** exchange 返回 401，**When** 查看审计，**Then** 存在 `sso.exchange` 失败记录（provider/sub 指纹/原因），无原始 code/token

### Edge Cases

- `state` 不匹配或缺失：BFF 返回 400 并清除 state cookie，不调用网关
- code 重放 / 过期：IdP 返回 `invalid_grant`，网关映射为 400 `token_exchange_failed`
- `redirect_uri` 不在白名单：400 `redirect_uri_not_allowed`
- 多标签页并发登录：state cookie 以最近一次为准，旧标签页失败后重试即可（写入验收说明）
- JIT 建号并发：依赖 `(provider_id, sub)` 唯一约束，冲突走 upsert，禁止产生两个 member
- 网关不可达：BFF 返回 502 `sso_backend_unreachable`，不写入 Cookie

## Requirements *(mandatory)*

### Gateway（intellect-team）

- **FR-001**: 网关 MUST 新增 `POST /api/members/oauth/exchange`，仅支持 `grant=authorization_code`；其他值返回 400 `unsupported_grant`
- **FR-002**: 网关 MUST 用 provider 的 `oidc_discovery_url` **去掉** `/.well-known/openid-configuration` 后缀作为 issuer 校验；该修复 MUST 同时应用到现有 `extract_user_claims`（缺陷见背景 3）
- **FR-003**: 网关 MUST 验签 `id_token`：算法白名单 `RS256/ES256`、`iss` 精确匹配、`aud` 含 `client_id`（多 aud 时校验 `azp`）、`exp/nbf` 容差 60s；禁止 `none` 与对称算法
- **FR-004**: 网关 MUST 校验请求 `redirect_uri` 命中 provider 的 `redirect_uris` 白名单（新增字段），否则 400
- **FR-005**: 网关 MUST 以 `(provider_id, sub)` 作为唯一身份键映射 member；**禁止**用 email/手机号匹配
- **FR-006**: JIT 建号 MUST 默认关闭（`auto_provision=0`），开启时并发安全（唯一索引 + upsert）
- **FR-007**: 网关 MUST 校验成员 `enabled==1`，否则 401 `account_disabled`
- **FR-008**: 网关 MUST 签发 `imt_*`（复用 `generate_member_token` + `create_api_token`，kind=`sso_login`），TTL 默认 28800s，可由 `INTELLECT_OAUTH_TOKEN_TTL_SECS` 或 provider `token_ttl_secs` 覆盖，且 MUST clamp 到 `[60, 7d]`
- **FR-009**: 网关 MUST 将审计事件持久化到 `member_admin_audit_log`（`source=sso`，action=`sso.login` / `sso.login.reject`），包含 provider/sub 指纹/member_id/tenant/结果，**不得**记录原始 code、code_verifier、id_token、token；审计写失败仅告警不影响登录
- **FR-010**: 网关 MUST 校验 `X-Intellect-Tenant` 与实例一致，不一致 403 `tenant_mismatch`
- **FR-011**: 网关 MUST 对该端点做调用方限制：默认仅内网/NetworkPolicy 可达；可配置 HMAC 头 `X-BFF-Signature`（时间戳 + 请求体摘要）；生产环境禁止直接暴露公网
- **FR-012**: 网关 MUST 在 provider 校验通过后按（**可信**客户端 IP + provider）以 **10 次/分钟**固定窗口限流，超限返回 429 + `Retry-After`；IP MUST 取 TCP peer，仅当 `INTELLECT_TRUST_PROXY_HEADERS=true` 时才信任 `X-Real-IP`/`X-Forwarded-For`；单副本进程内限流即可，多副本一致性列入遗留项
- **FR-013**: 网关 MUST 在公开的 `GET /api/members/oauth/providers` 中补充 `client_id`（OIDC client_id 非机密），供 BFF 构造 authorize 请求
- **FR-014**: 网关 MUST 校验 `azp`：intellect-auth 的 id_token 同时携带 `aud=[client_id]` 与 `azp=client_id`（[token_jwt.go](../../../intellect-auth/object/token_jwt.go#L606-L633)）；若客户端配置为 shared（`isShared=true`），`aud` 会变成 `clientId-org-<owner>`，网关 MUST 显式拒绝或按后缀匹配，**默认拒绝 shared client**
- **FR-015**: 网关 SHOULD 支持可选的 `member_id_claim`（provider 级配置，默认空）：当日志中该 claim 命中已存在的 member 且该 member 尚无该 `(provider_id, sub)` 绑定时，自动建立绑定而非新建账号；用于对接 hiedu 已同步的成员（详见 §intellect-auth 对接配置）
- **FR-016**: 上线 MUST 完成一次身份对账：把 IdP 的 `sub`（= `user.Name`）与 hiedu/intellect-team 已存在的 member 建立 `(provider_id, sub)` 绑定；否则 JIT 关闭时登录返回 403 `member_not_provisioned`
- **FR-017**: 网关 MUST 限制 id_token 长度（建议 ≤ 16KB）并在反序列化时只取白名单 claims
- **FR-018**: claim 接管 MUST 满足：成员 `enabled==1`、该成员未绑定同 provider 的其它 sub；绑定 MUST 使用 `bind_identity_if_absent`（`ON CONFLICT DO NOTHING`）并在冲突时回读赢家，禁止覆盖并发 JIT 绑定；冲突返回 403 `identity_conflict`
- **FR-019**: 同一 member 的 `sso_login` token SHOULD 只保留一个；签发前撤销旧 token，避免凭证堆积
- **FR-020**: 发布顺序 MUST 为「网关先行」；BFF 遇到旧网关缺 `token` 时返回 502 `GATEWAY_INCOMPATIBLE` 并在日志给出升级指引；intellect-auth 的 id_token 内容随 `tokenFormat` 变化（`JWT` 内嵌脱敏后的完整 `User`，[token_jwt.go](../../../intellect-auth/object/token_jwt.go#L28-L45)、[#L671-L706](../../../intellect-auth/object/token_jwt.go#L671-L706)），体积与字段数均可能高于最小 OIDC

### BFF（agentui）

- **FR-020**: BFF MUST 以 OIDC RP 身份构造授权请求：`response_type=code`、`scope=openid profile email`、`state`、`nonce`、PKCE S256
- **FR-021**: BFF MUST 用签名 Cookie 保存 `{state, code_verifier, nonce, provider_id, returnTo}`，有效期 10 分钟，HttpOnly + SameSite=Lax；**不得**依赖进程内内存（多副本必须可用）
- **FR-022**: 回调 MUST 校验 `state` 后再调网关 exchange；成功后写 `imt_token` Cookie（复用现有 `AUTH_COOKIE_NAME`/TTL），失败不得写 Cookie
- **FR-023**: BFF MUST 从公开 provider 端点获取 `authorize_url`/`scopes`/`pkce`/`client_id`，**不得**再为渠道列表调用需要认证的 `/api/oauth/providers`
- **FR-024**: BFF MUST 保留能力开关（如 `SSO_ENABLED` + provider 存在），关闭时回退现有密码登录；旧回调链路保留一个发布周期用于回滚
- **FR-025**: BFF MUST 在收到 401 时支持静默重登：携带 `returnTo` 以 `prompt=none` 发起 authorize；IdP 返回 `login_required` 时回退一次交互式授权，且不产生重定向循环（最多 1 次静默 + 1 次交互）
- **FR-026**: BFF MUST 记录登录审计（成功/失败、provider、member 指纹、requestId），不记录 token

### 契约与数据

- **FR-030**: provider 扩展配置 MUST 支持 `redirect_uris`（数组）、`auto_provision`（0/1）、`token_ttl_secs`、`member_id_claim`；**v1.3 实现落在 `OAuthProvider.extra_metadata`（JSON）**，不新增列（YAGNI），后续需要管理台可视化编辑时再升级为独立列并迁移
- **FR-031**: 错误响应 MUST 沿用 members API 的 `{error, message}` 扁平结构（与 `ErrorResp` 一致），不得混用 `{error:{code,message}}`
- **FR-032**: 响应 MUST 为 `{token, token_id, expires_at, member:{id,display_name,role,enabled}, email?, tenant_id}`；`expires_at` 为新增字段，向后兼容

## 端点契约

**契约权威源**：`contracts/sso-exchange.ts`（BFF）与 `contracts/sso-exchange.rs`（网关）。实施时以契约文件为准，本节的表格与错误码须与之一致。

```http
POST /api/members/oauth/exchange
Content-Type: application/json
X-Intellect-Tenant: <tenant_id>          # 可选，缺省用实例租户；不一致 403
X-BFF-Signature: <ts>.<hex-hmac-sha256>  # 可选，启用调用方限制时必填

{
  "grant": "authorization_code",
  "provider_id": "intellect-auth",
  "code": "<authorization code>",
  "code_verifier": "<PKCE verifier>",
  "redirect_uri": "https://agentui.example.com/api/bff/auth/oauth/callback",
  "nonce": "<BFF 生成的 nonce>"
}
```

```json
{
  "token": "imt_…",
  "token_id": "tok_…",
  "expires_at": 1769000000,
  "member": { "id": "mem_…", "display_name": "张三", "role": "member", "enabled": 1 },
  "email": "zhangsan@example.com",
  "tenant_id": "00000000000000000000000000000000"
}
```

| HTTP | error | 触发条件 |
|---|---|---|
| 400 | `invalid_request` | JSON 非法、缺字段、超长 |
| 400 | `unsupported_grant` | `grant != authorization_code` |
| 400 | `unknown_provider` / `provider_disabled` / `invalid_provider` | provider 不存在/禁用/无 discovery |
| 400 | `redirect_uri_not_allowed` | 不在白名单 |
| 400 | `token_exchange_failed` | IdP 拒绝 code 兑换 |
| 401 | `invalid_token` / `token_expired` / `nonce_mismatch` / `account_disabled` | 验签或成员状态失败 |
| 403 | `tenant_mismatch` / `member_not_provisioned` / `identity_conflict` / `forbidden` | 租户不一致 / 未建号且 JIT 关闭 / 该 member 已绑定同 provider 的其它身份 / members 系统关闭 |
| 429 | `too_many_requests` | 限流 |
| 500 | `internal_error` | 存储/解密失败 |
| 503 | `service_unavailable` | oauth store 或 member store 不可用 |

## intellect-auth 侧对接配置（源码实证）

### IdP 端点与 issuer

| 项 | 值 | 证据 |
|---|---|---|
| issuer | `https://<host>/auth`（子路径部署） | discovery/`iss` 由 `originBackend` 生成，[token_jwt.go](../../../intellect-auth/object/token_jwt.go#L601-L619) |
| discovery | `/auth/.well-known/openid-configuration`（支持 per-application 变体） | [intellect-auth 设计文档](../../../intellect-auth/docs/intellect-auth-方案设计.md)、[wellknown_oidc_discovery.go](../../../intellect-auth/object/wellknown_oidc_discovery.go#L193) |
| authorize | `/auth/login/oauth/authorize`（授权码 + PKCE S256，先 `fastAutoSignin`） | [static_filter.go](../../../intellect-auth/routers/static_filter.go#L210-L220) |
| token | `/auth/api/login/oauth/access_token` | [router.go](../../../intellect-auth/routers/router.go#L317-L320) |
| userinfo | `/auth/api/userinfo` | [router.go](../../../intellect-auth/routers/router.go#L58) |
| jwks | `/auth/.well-known/jwks` | [router.go](../../../intellect-auth/routers/router.go#L350-L351) |
| introspect / revoke | `/auth/api/login/oauth/introspect` `/revoke` | [router.go](../../../intellect-auth/routers/router.go#L319-L320) |
| end_session / SLO | `/auth/api/logout`、`/auth/api/sso-logout` | [router.go](../../../intellect-auth/routers/router.go#L54-L55) |

### agentui 专用 client 注册（`ia-agentui`）

| 字段 | 建议值 | 原因 |
|---|---|---|
| `grantTypes` | `authorization_code`、`refresh_token` | v1 只用授权码；refresh 供 IdP 侧能力预留 |
| `redirectUris` | 精确等于 BFF 回调 `https://<agentui-host>/api/bff/auth/oauth/callback` | Casdoor 精确匹配；必须与网关 `redirect_uris` 白名单一致 |
| `isShared` | **false** | shared 应用的 `aud` 为 `clientId-org-<owner>`（[token_jwt.go](../../../intellect-auth/object/token_jwt.go#L631-L633)），会导致网关 audience 校验失败 |
| `expireInHours` | 8 | 与 `INTELLECT_OAUTH_TOKEN_TTL_SECS=28800` 对齐，避免 IdP 会话早已过期而 `imt_*` 仍有效 |
| `refreshExpireInHours` | 8（或不启用） | 网关不发 refresh，保留无意义 |
| `scope` | `openid profile email` | `profile` 是读取 `unified_id` 的前置（见下） |
| `tokenFields` | `Cas,Email,Name,Groups,Roles` | `JWT-Custom` 时生效；`Cas` 即校园统一账号（id_token 顶层 claim 名仍为 `cas`，[token_jwt.go](../../../intellect-auth/object/token_jwt.go#L394-L444)） |
| `tokenFormat` | `JWT-Custom` | 控制 access token **和 id_token** 的字段集（[token_jwt.go](../../../intellect-auth/object/token_jwt.go#L671-L706)）；`JWT-Empty` 会把 id_token 裁到 owner/name，**禁止**使用 |
| `enableSigninSession` | **true** | 未开启时 IdP 会话不写 `username`，第二个应用无法静默 SSO（[multi-app-sso-research.md](../../../intellect-auth/tests/e2e-tests/outline/multi-app-sso-research.md#L63-L63)） |
| `enableAutoSignin` | true（可选） | 开启后 `/login/oauth/authorize` 走 `fastAutoSignin` 直接回跳；不做也可用 `prompt=none` |

### 跨应用静默 SSO 的前置

- 浏览器在 intellect-auth 的会话是**共享 IdP 会话**；agentui 与 aidevops 是两个独立 RP，各自持有自己的会话，不存在共享应用 Cookie。
- 要让"登录 agentui 后再打开 aidevops 免登录"，**两个 client 都必须** `enableSigninSession=true`；否则 IdP 会话无 `username`，aidevops 会重新要求登录。
- BFF 的静默重登使用标准 `prompt=none`：IdP 有会话则直接回 `code`；无会话返回 `login_required`，BFF 回退一次交互式授权（[multi-app-sso-research.md](../../../intellect-auth/tests/e2e-tests/outline/multi-app-sso-research.md#L52-L55)）。

### id_token 实际 claims（影响网关实现）

| claim | 位置 | 说明 |
|---|---|---|
| `iss` | 顶层 | `originBackend`（含 `/auth` 子路径），**不是** discovery URL |
| `sub` | 顶层 | `user.Name`（稳定用户名），[token_jwt.go](../../../intellect-auth/object/token_jwt.go#L620-L623) |
| `aud` / `azp` | 顶层 | 均为 `client_id`（shared 例外，见 FR-014） |
| `nonce` | 顶层 | 由 authorize 请求透传，[token_jwt.go](../../../intellect-auth/object/token_jwt.go#L606-L617) |
| `cas` | 顶层（`User` 内嵌展开） | 校园统一账号（学号/工号），[user.go](../../../intellect-auth/object/user.go#L200-L203)；**仅当 `tokenFormat=JWT` 或 `JWT-Custom` 且 TokenFields 含 `Cas` 时存在** |
| `roles` / `groups` | 顶层 | 角色名 / 组路径；`JWT-Custom` 下需显式加入 TokenFields，且可能较大 |
| `unified_id` | **仅 userinfo** | `Userinfo.UnifiedId`，需 `scope=profile` + TokenFields 含 `UnifiedId` |

> tokenFormat 对 id_token 的影响（源码实证）：
> - `JWT`（缺省）：内嵌 `UserWithoutThirdIdp`（已清密钥，含 `cas`）
> - `JWT-Custom`：仅保留注册声明 + `nonce`/`azp` + TokenFields 白名单字段
> - `JWT-Empty`：仅 `owner`/`name`，**不可用于本方案**
>
> 结论：推荐 `JWT-Custom + Cas`，网关**无需**为拿 `cas` 调 userinfo；若用 `unified_id` 对账则必须依赖 userinfo + TokenFields（语义与 `cas` 相同）。

### 与 hiedu 已同步成员的对账（关键运维前置）

hiedu 的 `external_identity` 是 **person → intellect member id** 的映射（`provider="intellect"`，[domain.go](../../../intellect-auth/hiedu/domain/domain.go#L123-L137)、[access.go](../../../intellect-auth/hiedu/app/access.go#L327-L376)），同步给 intellect-team 时携带 `member_external_id`（[apppush.go](../../../intellect-auth/hiedu/app/apppush.go#L572-L582)）。它**不包含** OIDC 的 `(provider_id, sub)` 绑定，因此：

- 若 JIT 关闭且未做对账 → SSO 登录 403 `member_not_provisioned`
- 若直接开启 JIT → 会为同一自然人新建第二个 member，与 hiedu 同步成员分裂
- 推荐路径：`member_id_claim = "cas"`（或 `unified_id`）+ 要求 hiedu 侧 `member_external_id` 使用同一口径；首次登录自动把 `(provider_id, sub)` 绑定到既有 member（FR-015），并保留审计

## 数据模型变更

**v1.3 实现**：全部扩展配置存放于既有 `OAuthProvider.extra_metadata`（JSON 字符串），**无需 DB 迁移**：

```json
{
  "redirect_uris": ["https://agentui.example.com/api/bff/auth/oauth/callback"],
  "auto_provision": 0,
  "member_id_claim": "cas",
  "token_ttl_secs": 28800
}
```

| 配置键 | 语义 |
|---|---|
| `redirect_uris` | 空数组 = 该 provider 禁用 exchange；非空必须精确匹配请求 |
| `auto_provision` | 1 = 允许 JIT 建号；缺省 0 |
| `member_id_claim` | 对账 claim 名（`cas`）；空 = 关闭自动接管 |
| `token_ttl_secs` | 覆盖全局 `INTELLECT_OAUTH_TOKEN_TTL_SECS` |

> 后续若要提供管理台可视化编辑与校验，再按原计划升级为独立列（此时需迁移脚本）；v1.3 不引入。
| `member_identity`（或等价表） | 唯一索引 `(provider_id, sub)` | 防并发重复建号；已存在则改为唯一约束 |
| `api_tokens` | `kind='sso_login'` | 复用现有表，无需结构变更 |

## 安全需求（威胁模型摘要）

| 威胁 | 控制 |
|---|---|
| 授权码拦截 | PKCE S256 + `redirect_uri` 白名单 + code 一次性 |
| token 重放 | 短 TTL（8h）+ logout 撤销；不做 SLO 是已知残余风险 |
| 算法混淆 | 算法白名单，禁用 `none`/HS*；JWKS 仅 HTTPS |
| 跨应用重放 | agentui 单独注册 IdP client `ia-agentui`，不复用 aidevops 的 `ia-ai-devops`；禁止 shared client |
| 大体积 id_token | id_token 内嵌完整 `User`（含 roles/groups），强制 ≤16KB 与字段白名单（FR-017） |
| 身份分裂 | `member_id_claim` 对账 + JIT 默认关闭；禁止按 email 合并 |
| 顶号 | 仅按 `(provider_id, sub)` 绑定；email 不参与匹配；JIT 默认关闭 |
| 兑换器滥用 | 内网限制 + 开关 + 限流 + 可选 HMAC |
| 日志泄露 | 只记录指纹；code/verifier/token 一律不入日志 |
| 成员禁用后残留 | 现有 token 需由管理操作批量撤销；exchange 侧校验 `enabled`（详见 R-04） |

## 成功标准

- **SC-001**：清空 Cookie 后 SSO 登录全流程 ≤ 3 次重定向，成功后 `/auth/me` 200
- **SC-002**：登录链路在 `API_SERVER_KEY` 置空时仍可用（管理面除外）
- **SC-003**：exchange 端点单测覆盖 §验收用例清单全部条目，且 `cargo test` 全绿
- **SC-004**：BFF 侧新增单测覆盖 state 校验失败、网关 401/502、静默重登上限
- **SC-005**：能力开关关闭时，前端行为与当前版本逐字段一致（回归）
- **SC-006**：BFF 环境变量中不存在任何 IdP `client_secret`

## 实施阶段

| 阶段 | 内容 | 前置 |
|---|---|---|
| P0 | 修复 issuer 推导 + BFF 回调改用回调返回的 token（方案 1，独立可发布） | 无 |
| P1 | 网关 exchange 端点 + provider 扩展配置 + 公开 provider 增加 `client_id` | P0 ✅ 2026-11-20 |
| P2 | BFF OIDC RP 改造（state cookie / PKCE / 静默重登）+ 能力开关 | P1 |
| P3 | 运维：IdP 注册 client、provider 配置、NetworkPolicy、审计看板 | P2 |

## 实现状态（v1.3）

| 项 | 状态 | 位置 |
|---|---|---|
| `POST /api/members/oauth/exchange` | ✅ | `intellect-gateway/src/platform/members_api.rs`（路由 + `handle_sso_exchange`） |
| 端点开关 `INTELLECT_OAUTH_EXCHANGE_ENABLED`（默认 false） | ✅ | 处理函数内按请求读取 |
| TTL `INTELLECT_OAUTH_TOKEN_TTL_SECS`（默认 28800） | ✅ | 同上，provider 可用 `token_ttl_secs` 覆盖 |
| issuer 从 discovery 剥离 | ✅ | `platform/oidc.rs::issuer_from_discovery_url`，`api_server::extract_user_claims` 复用 |
| `azp` 校验 + 多 aud 无 azp 拒绝 | ✅ | `platform/oidc.rs::validate_authorized_party` |
| 任意 claim 提取（`cas`） | ✅ | `IdTokenClaims.extra`（`#[serde(flatten)]`） |
| `(provider_id, sub)` 绑定 / `member_id_claim` 接管 / JIT | ✅ | `handle_sso_exchange`（接管前置 enabled/identity 冲突检查，`bind_identity_if_absent`） |
| 租户头校验、限流 | ✅ | `identity::resolve_request_tenant` + 可信 IP 限流（provider 校验后执行） |
| 接管并发安全 | ✅ | `MemberStore::bind_identity_if_absent`（新增，`ON CONFLICT DO NOTHING` + 回读） |
| TTL clamp / 单活跃 token | ✅ | `clamp_sso_ttl`（60s–7d）+ 签发前撤销旧 `sso_login` token |
| `validate_nbf` | ✅ | `oidc.rs` 已开启 |
| 持久审计 | ✅ | `member_admin_audit_log`（source=sso） |
| 10 次/分钟专用限流 + `Retry-After` | ✅ | `sso_exchange_rate_limit` / `sso_rate_limited_response` |
| 身份唯一约束 | ✅ | 迁移 `20261120000001_identities_unique_member_provider.sql` |
| token 原子轮换 | ✅ | `MemberStore::replace_api_token` |
| 验签失败 fail-closed | ✅ | `extract_user_claims` 不再回落 userinfo |
| 公开 provider 列表返回 `client_id` | ✅ | `OAuthProviderInfo.client_id` |
| 调用方 HMAC（FR-011 可选部分） | ⏸ 未实现 | 依赖内网/NetworkPolicy；如跨集群再补 |
| BFF OIDC RP 改造（P2） | ⏳ 待实施 | agentui `bff/src/routes/auth.ts` |

**验证**：
- `cargo test -p intellect-gateway platform::members_api --lib` → 13 passed
- `cargo test -p intellect-gateway platform::oidc --lib` → 12 passed
- BFF `tsc --noEmit` + `vitest auth.test.ts` → 46 passed
- 全量 `--lib`（改动前基线）：1351 passed / 19 failed；19 项均为 RAG proxy / STT / TTS / vision 的既有环境性失败，已用 `git stash` 在 baseline 复现确认与本特性无关

**已知缺口**：仍缺 DB 级 handler 集成测试（需 Postgres 测试夹具）；当前覆盖为纯函数逻辑 + 编译级路由验证，spec SC-003 的 T-01~T-17 只部分覆盖。

## 代码评审修复（v1.4）

> 对 v1.3 已落地代码做质量/安全评审，10 项全部修复。

| # | 严重度 | 问题 | 修复 |
|---|---|---|---|
| 1 | major | claim 接管无条件绑定，存在账号共享/接管面 | 接管前校验同 provider 其它 sub → 403 `identity_conflict`；`enabled` 前置校验（FR-018） |
| 2 | major | 先绑定后检查 `enabled`，禁用成员留下绑定 | 绑定前读取并校验 `enabled==1` |
| 3 | major | 限流 key 可伪造 + provider_id 可控 + 校验前执行 | provider 校验后限流；IP 默认取 TCP peer，转发头需显式 `INTELLECT_TRUST_PROXY_HEADERS`（FR-012） |
| 4 | major | `validate_nbf` 未开启 | `validation.validate_nbf = true` |
| 5 | major | 接管与 JIT 并发非原子 | 新增 `MemberStore::bind_identity_if_absent`，冲突时回读赢家 |
| 6 | major | 缺 handler 级测试 | 抽出 `validate_exchange_request` 等纯函数并补 7 个用例；DB 集成测试记为已知缺口 |
| 7 | minor | `usage.contains("login")` 子串误判 | `usage_allows_login` 按分隔符精确匹配 |
| 8 | minor | TTL 无上限 | `clamp_sso_ttl` 限制 60s–7d（FR-008） |
| 9 | minor | 旧 `sso_login` token 堆积 | 签发前撤销同 member 旧 token（FR-019） |
| 10 | minor | 旧网关兼容性问题 | BFF 返回 502 `GATEWAY_INCOMPATIBLE` + 升级指引；发布顺序写入 FR-020 |

## 第二轮代码评审修复（v1.5）

| # | 严重度 | 问题 | 修复 |
|---|---|---|---|
| 7 | major | 接管存在 TOCTOU（读写分离、无唯一约束） | 新增 `UNIQUE(member_id, provider)` 迁移，冲突在 DB 层兜底 |
| 8 | major | 缺少持久审计 | `record_audit(source=sso)`：成功、接管、禁用、身份冲突均落库 |
| 9 | major | id_token 验签失败回落 userinfo，绕过 azp/nbf | 验签失败直接 401，不再回落 |
| 10 | minor | 限流用 anonymous 桶（120/min）、429 无 `Retry-After` | 专用 10/min 固定窗口 + `Retry-After` |
| 11 | minor | 旧 token 撤销与新 token 创建非原子 | `replace_api_token`（DELETE+INSERT 单事务） |
| 12 | minor | 契约缺 `forbidden` 错误码 | TS/Rust 契约同步补齐 |

## 评审记录（v1.0 → v1.2）

> 评审对象：上一轮对话中提出的端点设计。结论：方向成立，但有 6 项必须修订、4 项需收敛表述、3 项降级为遗留项。

### 高优先级（已修订进正文）

| # | 问题 | 原设计表述 | 修订 |
|---|---|---|---|
| R-01 | **违反 Constitution VIII** | 未提及"所有 BFF 请求统一用 API_SERVER_KEY"的例外 | 显式声明为 Governance 例外，需 maintainer 批准；管理面继续保留密钥 |
| R-02 | **渠道列表仍要密钥** | 未说明 provider 元数据来源 | 改用公开的 `/api/members/oauth/providers`，并新增 `client_id`（FR-013/FR-023） |
| R-03 | **`sub` 可能不稳定** | "`claim_sub` 指向 `unified_id` 即可" | `IdTokenClaims` 仅反序列化固定字段（[oidc.rs#L13-L30](../../../intellect-team/intellect-gateway/src/platform/oidc.rs#L13-L30)），需扩展 extra map 或走 userinfo；且 `unified_id` 受 TokenFields 门控，缺配时回落 `sub`，改名即断链 → 绑定键仍用 `(provider_id, sub)`，`unified_id` 仅作对账 |
| R-04 | **成员禁用后 token 仍有效** | "TTL 收敛 + enabled 检查"含糊 | exchange 校验 `enabled`；禁用成员时**批量撤销**其 `imt_*`；`/v1/runs` 等通道不查库的残余窗口写入已知风险 |
| R-05 | **state/PKCE 存储方式未定** | 未说明 BFF 多副本 | 用签名 Cookie 保存 state/verifier（FR-021），禁止进程内 Map |
| R-06 | **并发 JIT 建号竞态** | "复用 upsert" | 要求 `(provider_id, sub)` 唯一索引，否则并发登录会建出两个 member（现有 `create_member` + `bind_identity` 非原子） |

### 中优先级（已收敛表述）

| # | 问题 | 处置 |
|---|---|---|
| R-07 | 模式 A 的 client_secret 分发未定义 | 移入非目标，v1 不实现（YAGNI） |
| R-08 | 声称 nonce 可"防重放" | 更正：模式 B 中网关只能做等值比较，重放防护依赖 IdP code 一次性 + PKCE |
| R-09 | 限流承诺过强 | 明确为进程内限流，多副本一致性列遗留项（FR-012） |
| R-10 | 错误结构混用 | 统一为 `{error, message}`（FR-031），与 `ErrorResp` 对齐 |

### 低优先级 / 遗留项

| # | 项 | 处置 |
|---|---|---|
| R-11 | SLO 单点登出 | 不在 v1；因 BFF 不保留 `id_token`，实现需网关中继，另立 spec |
| R-12 | 跨应用 token 直通 | 明确不在本 spec；aidevops 走自身 OIDC 会话或 M2M client |
| R-13 | 网关限流多副本 | 现有 `LOGIN_FAILURES` 亦为进程内（[members_api.rs#L117-L134](../../../intellect-team/intellect-gateway/src/platform/members_api.rs#L117-L134)），沿用并记债 |

### v1.2 增补（结合 intellect-auth 源码）

| # | 发现 | 影响 | 处置 |
|---|---|---|---|
| R-14 | `isShared=true` 时 `aud` 变为 `clientId-org-<owner>` | 网关 audience 校验必然失败，且难以区分应用 | 禁止 shared client，并新增 `azp` 校验（FR-014） |
| R-15 | hiedu `external_identity` 与网关 `member_identity` 是两套映射 | JIT 关闭无法登录；JIT 开启会与同步成员分裂 | 新增 `member_id_claim` 对账 + 上线前一次性绑定（FR-015/016） |
| R-16 | `unified_id` 只在 userinfo；id_token 顶层是 `cas`，且**是否出现取决于 tokenFormat/TokenFields** | 原 v1.1 推荐 `JWT-Short`（该值不存在）且误称 id_token 恒为完整 Claims | 更正为 `JWT-Custom + Cas`，并给出三种 tokenFormat 的差异（§intellect-auth 对接配置） |
| R-17 | id_token 字段集随 tokenFormat 变化（JWT 为脱敏完整 User，JWT-Empty 仅 owner/name） | 体积/敏感字段不可控，JWT-Empty 还会丢 `cas` | 限长 16KB + claims 白名单 + 禁用 JWT-Empty（FR-017） |
| R-18 | `expireInHours` 缺省可能远大于 8h | `imt_*` TTL 与 IdP 会话不一致，登出后仍有残留窗口 | 明确 client 配置 8h + TTL 对齐 |
| R-19 | 仅开 `enableAutoSignin` 不够，`enableSigninSession=false` 时 IdP 会话无 `username` | 跨应用静默 SSO 失效（aidevops 仍需登录） | client 配置新增两条硬要求（§intellect-auth 对接配置） |
| R-20 | 静默重登未指定 `prompt` | 无会话时会跳到登录页，破坏"无感"体验 | 改用 `prompt=none`，`login_required` 时回退一次交互（FR-025） |

### 评审未采纳的建议

- **建议网关直接复用 `POST /api/members/oauth/login`**：该端点 nonce 必须由网关签发（[members_api.rs#L1262-L1285](../../../intellect-team/intellect-gateway/src/platform/members_api.rs#L1262-L1285)），BFF 作为 RP 无法满足；且它不接受 `code_verifier`。故新增 exchange 端点，而非改造旧端点。

## 验收用例清单

| # | 用例 | 期望 |
|---|---|---|
| T-01 | 正常 code+PKCE 兑换 | 200，返回 `imt_*`，`/api/members/me` 通过 |
| T-02 | `redirect_uri` 不在白名单 | 400 `redirect_uri_not_allowed` |
| T-03 | issuer 不匹配 / 签名伪造 | 401 `invalid_token` |
| T-04 | `aud` 为其他应用 client | 401 `invalid_token` |
| T-05 | `nonce` 不一致 | 401 `nonce_mismatch` |
| T-06 | code 重放 / 过期 | 400 `token_exchange_failed` |
| T-07 | provider 禁用 / 无 discovery | 400 `provider_disabled` / `invalid_provider` |
| T-08 | 成员禁用 | 401 `account_disabled` |
| T-09 | JIT 关闭且无绑定 | 403 `member_not_provisioned` |
| T-10 | JIT 开启并发 10 次同 `sub` | 仅 1 个 member，10 次均成功 |
| T-11 | 租户头不一致 | 403 `tenant_mismatch` |
| T-12 | 超限请求体 / 超长 token | 413 / 400 |
| T-13 | 限流触发 | 429 且含 `Retry-After` |
| T-14 | 审计无原始凭证 | 日志扫描通过 |
| T-15 | BFF state 不匹配 | 400，不调用网关 |
| T-16 | BFF 收到网关 502 | 502，不写 Cookie |
| T-17 | 401 后静默重登 | 仅重试一次，无循环 |

## 待决问题

1. `client_id` 由公开 provider 端点返回，还是放入 BFF 配置？（建议前者，client_id 非机密）
2. 网关是否强制要求 HMAC？建议"内网 + 可选 HMAC"，若 BFF 与网关跨集群则强制。
3. 对账 claim 选 `cas`（id_token 顶层，无需 userinfo）还是 `unified_id`（需 userinfo + TokenFields）？建议 `cas`，并核对 hiedu `member_external_id` 是否与校园统一账号同口径；若不同，需要一次性映射表。
4. hiedu 同步成员与 SSO 新成员的优先级：是否允许 `member_id_claim` 自动接管既有 member（建议允许，但写入审计并要求 claim 唯一命中）。
