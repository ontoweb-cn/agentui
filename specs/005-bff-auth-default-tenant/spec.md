# Feature Specification: BFF Auth Routing + Default TenantID

**Feature Branch**: `005-bff-auth-default-tenant`

**Created**: 2026-06-26

**Status**: Draft

**Input**: User description: "P4b:BFF 统一认证路由 + 缺省 TenantID=0 简化 intellect-team 对接。企业版登录/注册/登出/OAuth 经 BFF 路由,intellect-team 侧零多租户改动。同时为 intellect-team 设计 member 认证 + OAuth callback 补全方案(文档放 intellect-team 仓库)。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 企业版用户密码登录 (Priority: P1)

企业版部署模式下,用户用 login_name + password 登录 AgentUI。BFF 接收登录请求,根据 tenant 绑定的 `authMode=intellect-enterprise`,调用 intellect-team 的 member 登录接口,验证密码后签发 member token,存入 HttpOnly cookie 返回前端。前端无需感知后端差异,登录成功后进入主界面。

**Why this priority**:密码登录是企业版最基础的认证方式,OAuth 依赖密码登录作为兜底(未配置 OAuth 时唯一入口)。

**Independent Test**:配置 tenant-enterprise(authMode=intellect-enterprise,缺省 TenantID=0)→ `curl POST /api/bff/auth/login {login_name,password}` → 返回 200 + Set-Cookie → `curl GET /api/bff/auth/me`(带 cookie)→ 返回 member 信息。

**Acceptance Scenarios**:

1. **Given** tenant-enterprise 已配置 authMode=intellect-enterprise 且 intellect-team 可达, **When** 用户提交正确 login_name + password, **Then** BFF 调用 intellect-team /api/members/login 成功,返回 200,Set-Cookie 含 member token,响应体含 member_id/display_name
2. **Given** 同上配置, **When** 用户提交错误密码, **Then** BFF 返回 401,响应体含明确错误"Invalid credentials",不设置 cookie
3. **Given** tenant-enterprise 配置但 intellect-team 不可达, **When** 用户登录, **Then** BFF 返回 502,响应体含"Backend unavailable"
4. **Given** tenant-rag(authMode=intellect-rag), **When** 用户用 email+password 登录, **Then** BFF 透传到 intellect-rag /auth/login(现状不变,向后兼容)

---

### User Story 2 - 用户注册与登出 (Priority: P2)

企业版用户通过注册端点创建账号(login_name + password + display_name),登录后可登出撤销 token。BFF 根据 authMode 路由到对应后端。

**Why this priority**:注册和登出是认证闭环的必要组成,但依赖登录(US1)先行验证。

**Independent Test**:curl POST /api/bff/auth/register → 201 → curl POST /api/bff/auth/login(新账号)→ 200 → curl POST /api/bff/auth/logout → 200 → curl GET /api/bff/auth/me → 401。

**Acceptance Scenarios**:

1. **Given** 企业版模式且 intellect-team 开放注册, **When** 用户提交 login_name+password+display_name, **Then** BFF 调用 intellect-team /api/members/register,返回 201 + member_id
2. **Given** 用户已登录(带 cookie), **When** 调用 /api/bff/auth/logout, **Then** BFF 调用 intellect-team /api/members/logout 撤销 token,清除 cookie,返回 200
3. **Given** 用户已登出, **When** 调用 /api/bff/auth/me, **Then** 返回 401(未认证)
4. **Given** 注册时 login_name 已存在, **When** 提交注册, **Then** 返回 409,响应体含"login_name already in use"

---

### User Story 3 - OAuth 渠道登录 (Priority: P3)

企业版用户通过 OAuth(github/google 等)登录。BFF 统一 OAuth 流程:列出渠道→发起授权→回调→签发 token→重定向前端。前端 useLoginChannels/useLoginWithChannel 接口不变。

**Why this priority**:OAuth 是企业版常用登录方式,但依赖 US1(密码登录)的 token 机制和 cookie 存储先行就绪。

**Independent Test**:curl GET /api/bff/auth/login/channels → 返回渠道列表 → curl GET /api/bff/auth/login/github → 302 重定向到 GitHub → 模拟回调 /api/bff/auth/oauth/callback?code=x&state=y → 302 重定向前端首页 + Set-Cookie。

**Acceptance Scenarios**:

1. **Given** 企业版模式且 intellect-team 已配置 OAuth provider, **When** 调用 GET /api/bff/auth/login/channels, **Then** 返回渠道列表[{channel, display_name, icon}]
2. **Given** 用户点击 GitHub 登录, **When** 调用 GET /api/bff/auth/login/github, **Then** BFF 调用 intellect-team /api/oauth/authorize 获取 redirect_uri,302 重定向到 GitHub 授权页
3. **Given** GitHub 授权后回调, **When** 浏览器访问 /api/bff/auth/oauth/callback?code=x&state=y, **Then** BFF 调用 intellect-team /api/oauth/callback 获取 member_id,再调 /api/members/{id}/token 签发 token,Set-Cookie 后 302 重定向到前端首页
4. **Given** 社区版模式(authMode=intellect-rag), **When** 走 OAuth, **Then** BFF 透传到 intellect-rag /auth/login/{channel}(现状不变)

---

### Edge Cases

- **缺省 TenantID=0 不注入 X-Intellect-Team 头**:intellectTenantId==="0" 时,tenantContextMiddleware 不注入 X-Intellect-Team 头(intellect-team 用全局默认,不查 team_id="0")
- **cookie 过期/被清除**:用户请求 /api/bff/auth/me 时无 cookie 或 token 无效,返回 401,前端重定向登录页
- **intellect-team OAuth callback 不返回 token**:BFF 在 callback 后主动调 /api/members/{member_id}/token 签发(P4a intellect-team 侧新增端点)
- **跨域 cookie**:BFF 与前端同源(经 Vite proxy),cookie 的 SameSite=Lax,Path=/
- **login_name vs email 字段差异**:企业版用 login_name,社区版用 email;BFF /api/bff/auth/login 同时接受两个字段,企业版模式把 email 值映射为 login_name
- **OAuth state 过期**:intellect-team /api/oauth/callback 返回 "Invalid or expired state",BFF 重定向到登录页带 error 参数
- **intellect-team 未开启 members 功能**:`is_members_enabled(config)` 返回 false 时,登录/注册返回 503 "Member feature disabled"
- **并发登录同一账号**:允许多个 token 并存(不互斥),登出仅撤销当前 token
- **注册关闭**:intellect-team 配置关闭注册时,/api/bff/auth/register 返回 403

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST 在 BFF 新增统一认证路由 `/api/bff/auth/*`(login/register/logout/me/channels/oauth),按 tenant 的 authMode 路由到 intellect-rag 或 intellect-team
- **FR-002**: System MUST 支持 `authMode` 字段(intellect-rag | intellect-enterprise),配置在 BffTenant,默认 intellect-rag(向后兼容)
- **FR-003**: System MUST 在企业版模式下,将 POST /api/bff/auth/login 转发到 intellect-team member 登录接口,验证密码并获取 member token
- **FR-004**: System MUST 将 member token 存入 HttpOnly cookie(非 localStorage,防 XSS),后续请求自动携带
- **FR-005**: System MUST 在 BFF 新增认证中间件,从 cookie 提取 member token,注入到 intellect-team 请求的 Authorization 头(企业版模式)
- **FR-006**: System MUST 支持缺省 TenantID=0:当 BffTenant.intellectTenantId==="0" 时,tenantContextMiddleware 不注入 X-Intellect-Team 头(intellect-team 用全局默认)
- **FR-007**: System MUST 在企业版模式下,将 GET /api/bff/auth/login/channels 转发到 intellect-team /api/oauth/providers,转换响应格式为前端兼容的 [{channel, display_name, icon}]
- **FR-008**: System MUST 在企业版模式下,将 GET /api/bff/auth/login/{channel} 转发到 intellect-team /api/oauth/authorize,获取 redirect_uri 后 302 重定向
- **FR-009**: System MUST 在企业版模式下,处理 GET /api/bff/auth/oauth/callback:调 intellect-team /api/oauth/callback 获取 member_id,再调 /api/members/{id}/token 签发 token,Set-Cookie 后 302 重定向前端首页
- **FR-010**: System MUST 在社区版模式下(authMode=intellect-rag),认证路由透传到 intellect-rag /api/v1/auth/*(现状不变,零回归)
- **FR-011**: System MUST 在前端 api.ts 将认证路径从 /api/bff/proxy/v1/auth/* 迁移到 /api/bff/auth/*(单点改动,useLogin/useRegister/useLogout 接口不变)
- **FR-012**: System MUST 为 BFF 认证路由提供单元测试,Mock intellect-team/intellect-rag 响应,覆盖:企业版登录成功/失败、社区版登录(回归)、OAuth 渠道列表、OAuth callback 流程
- **FR-013**: System MUST 在 intellect-team 侧文档(放 intellect-team 仓库 docs/agentui-integration/)描述需新增的 member 认证 + OAuth callback 补全端点规范

### Key Entities *(include if feature involves data)*

- **BffTenant.authMode**:新增字段,值 'intellect-rag' | 'intellect-enterprise',决定认证路由目标
- **AuthSession**:BFF 内存中的认证会话(cookie token ↔ member_id ↔ tenantId),不持久化
- **MemberToken**:intellect-team 签发的 `imt_*` token,存 cookie,用于后续 intellect-team API 鉴权
- **OAuthFlowState**:OAuth 授权流程中的 state 参数,防 CSRF,intellect-team 侧管理(P4a)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 企业版用户通过密码登录,从提交到进入主界面 < 3 秒(intellect-team 正常负载下)
- **SC-002**: OAuth 登录完整流程(点击渠道→授权→回调→进入首页)< 10 秒(含用户操作时间)
- **SC-003**: 缺省 TenantID=0 模式下,企业版登录/对话/会话功能全部可用,不触发 intellect-team Team/Project 组织隔离逻辑
- **SC-004**: 社区版(authMode=intellect-rag)认证功能 100% 不回归,现有登录/注册/OAuth 流程行为不变
- **SC-005**: BFF 认证路由单元测试覆盖 ≥ 10 个场景(企业版登录/注册/登出/OAuth 渠道/OAuth callback + 社区版回归 + 错误场景),通过率 100%
- **SC-006**: 前端 useLogin/useRegister/useLogout/useLoginChannels/useLoginWithChannel 接口签名零改动,仅 api.ts 路径常量变更
- **SC-007**: intellect-team 侧方案文档完整,覆盖 member 认证端点规范 + OAuth callback token 补全 + 缺省 TenantID 兼容说明

## Assumptions

- **intellect-team 侧 P4a 端点就绪**:BFF 认证路由依赖 intellect-team 新增 /api/members/{login,register,logout,me,token} + /api/oauth/login/{provider} + /api/oauth/callback 补全 token 签发。P4b 可先用 mock server 开发,联调时切换真实
- **缺省 TenantID=0 足够 P4 场景**:P4 仅打通认证,不承载多租户生产数据;P5 上线 Team 管理后迁移到真实 team_id
- **cookie 同源**:BFF 与前端同源(前端经 Vite proxy 访问 BFF),无需处理跨域 cookie
- **intellect-rag 认证保持现状**:社区版 authMode=intellect-rag 透传 intellect-rag /api/v1/auth/*,不改动 intellect-rag 侧
- **member token 有效期由 intellect-team 控制**:BFF 不主动刷新 token,过期后 intellect-team 返回 401,BFF 清除 cookie 重定向登录
- **OAuth provider 配置在 intellect-team 侧**:BFF 不管理 OAuth provider,仅转发渠道列表和授权流程
- **P4b 不实现前端登录页 UI 改动**:api.ts 路径迁移 + 后端路由就绪后,前端登录页字段适配(login_name vs email)留待 P4d
- **P4b 不实现 Team/Project CRUD Admin 页面**:留待 P5
