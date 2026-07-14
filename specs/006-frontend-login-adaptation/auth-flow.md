# AgentUI 登录 INTELLECT-TEAM 代码实现流程

> 本文档基于 P2 评审报告修正,覆盖企业版 + 社区版双轨认证,包含 OAuth、RSA 加密、中间件注册、probe 探测等关键设计。

## 整体架构

```
[用户浏览器]
    │
    │ credentials: 'include' (自动带 HttpOnly cookie)
    ▼
[Vite Dev Proxy / 前端同源]
    │
    ▼
[BFF Hono :9390]  /api/bff/auth/*
    │
    │ 按 BffTenant.authMode 路由
    ├─────────────────────────────┐
    ▼                             ▼
[intellect-team 实例]      [intellect-rag 实例]
/api/members/*              /api/v1/auth/*
/api/oauth/*                /api/v1/users/*
```

### 双轨认证模式对比

| 维度 | 企业版 (intellect-enterprise) | 社区版 (intellect-rag) |
|------|-------------------------------|------------------------|
| token 存储 | HttpOnly + SameSite=Lax cookie | localStorage `Authorization`/`Token` |
| 前端 JS 可读 token | 否 | 是 |
| 登录字段 | `login_name` + `password` | `email` + `password` |
| 注册字段 | `login_name` + `display_name` + `password` | `email` + `nickname` + `password` |
| isLogin 判断 | localStorage `authMode` 标记 + probe 探测 | `!!getAuthorization()` |
| 登出后端调用 | intellect-team `/api/members/logout` (via cookie token) | Intellect-RAG `/api/v1/auth/logout` (via Authorization header) |
| 登出后清除 | deleteCookie + removeAll (含 AuthMode/TenantId) | removeAll (含 Authorization/Token) |
| BFF 响应格式 | `ok()` 包装 `{code:0, data:{...}}` | 直接透传 Intellect-RAG `{code:0, data:{...}, message}` |
| 密码加密 | **TODO: 明文(待实现 RSA)** | RSA + Base64(已实现) |
| Admin 登录 | 不走 BFF /auth/* | 不走 BFF /auth/* (独立 admin-service.ts) |

## 关键文件索引

| 层 | 文件 | 作用 |
|----|------|------|
| 前端 UI | [src/pages/login-next/index.tsx](file:///Users/simon/project/agentui/src/pages/login-next/index.tsx) | 登录/注册表单,按 authMode 切字段 |
| 前端 Hook | [src/hooks/use-login-request.ts](file:///Users/simon/project/agentui/src/hooks/use-login-request.ts) | useLogin/useRegister/useLogout/useAuthMode |
| 前端 Hook | [src/hooks/auth-hooks.ts](file:///Users/simon/project/agentui/src/hooks/auth-hooks.ts) | useAuth/isLogin + useEnterpriseCookieProbe |
| 前端请求层 | [src/utils/request.ts](file:///Users/simon/project/agentui/src/utils/request.ts) | credentials: 'include' + 401 拦截 |
| 前端 Service | [src/services/user-service.ts](file:///Users/simon/project/agentui/src/services/user-service.ts) | login/register/logoutWithHeaders |
| 前端存储 | [src/utils/authorization-util.ts](file:///Users/simon/project/agentui/src/utils/authorization-util.ts) | localStorage KeySet 管理 |
| 前端常量 | [src/constants/authorization.ts](file:///Users/simon/project/agentui/src/constants/authorization.ts) | AuthMode/TenantId 常量 |
| 前端加密 | [src/utils/index.ts](file:///Users/simon/project/agentui/src/utils/index.ts) | rsaPsw (Base64 + RSA 公钥加密) |
| BFF 路由 | [bff/src/routes/auth.ts](file:///Users/simon/project/agentui/bff/src/routes/auth.ts) | 8 个认证端点(config/login/me/register/logout/channels/login:channel/callback) |
| BFF 中间件 | [bff/src/middleware/auth-session.ts](file:///Users/simon/project/agentui/bff/src/middleware/auth-session.ts) | cookie → AuthSession 注入 |
| BFF 入口 | [bff/src/index.ts](file:///Users/simon/project/agentui/bff/src/index.ts) | authSessionMiddleware 注册 (仅 /auth/me + /auth/logout) |

## BFF 中间件注册策略

`authSessionMiddleware` **只在** `/auth/me` 和 `/auth/logout` 注册([bff/src/index.ts:149-150](file:///Users/simon/project/agentui/bff/src/index.ts#L149-L150)):

```typescript
app.use('/auth/me', authSessionMiddleware);
app.use('/auth/logout', authSessionMiddleware);
```

其他 5 个公开端点(config/login/register/channels/oauth/login/:channel/oauth/callback)**不注入** AuthSession,因为:
- 公开端点无需鉴权,请求时用户尚未登录,cookie 中无 token
- `authMiddleware`(全局 Authorization header 校验)不拦截 `/auth/*`,因社区版透传用前端自带 Authorization,企业版用 cookie 而非 Authorization header

---

## BFF 路由前缀路径映射表

### Vite Dev Proxy 规则([vite.config.ts:53-69](file:///Users/simon/project/agentui/vite.config.ts#L53-L69))

| 前端请求前缀 | Vite rewrite | 目标 | 说明 |
|-------------|-------------|------|------|
| `/api/bff/*` | 去掉 `/api/bff` | `http://localhost:9390`(BFF) | 主入口,所有 BFF 路由经此代理 |
| `/api/v1/admin/*` | 不 rewrite | `http://{API_HOST}:9381`(intellect-rag admin) | Admin 独立端口,不经 BFF |
| `/api/*` | 不 rewrite | `http://{API_HOST}:9380`(intellect-rag) | 旧 Vite proxy,保留用于瞬时回滚 |
| `/v1/*` | 不 rewrite | `http://{API_HOST}:9380`(intellect-rag) | OpenAI 兼容端点直连 |

### BFF 路由前缀 → 后端端点映射

| BFF 路由前缀 | 后端类型 | 后端端点 | 中间件 | Constitution |
|-------------|---------|---------|--------|-------------|
| `/auth/config` | 按 authMode | intellect-rag 或 intellect-team | 公开(无) | Principle I |
| `/auth/login` | 按 authMode | intellect-rag `/api/v1/auth/login` 或 intellect-team `/api/members/login` | 公开(无) | Principle I + VIII |
| `/auth/register` | 按 authMode | intellect-rag `/api/v1/users` 或 intellect-team `/api/members/register` | 公开(无) | Principle I |
| `/auth/login/channels` | enterprise | intellect-team `/api/oauth/providers` | 公开(无) | Principle I |
| `/auth/login/:channel` | enterprise | intellect-team `/api/oauth/login/{channel}` | 公开(无) | Principle I |
| `/auth/oauth/callback` | enterprise | intellect-team `/api/oauth/callback` + `/api/members/{id}/token` | 公开(无) | Principle I + VIII |
| `/auth/me` | 按 authMode | intellect-rag `/api/v1/users/me` 或 intellect-team `/api/members/me` | authSession | Principle I |
| `/auth/logout` | 按 authMode | intellect-rag `/api/v1/auth/logout` (via Authorization header) 或 intellect-team `/api/members/logout` (via cookie token) | authSession | Principle I |
| `/agents/*` | 按 tenant | intellect-rag 或 intellect-team(via Adapter) | auth + tenantContext | Principle II |
| `/admin/harness-backends/*` | — | BFF 内部(HarnessStore) | auth(非租户隔离) | Principle I + V |
| `/capabilities/*` | 按 tenant | BFF 内部(AdapterRegistry) | auth + tenantContext | Principle II + V |
| `/admin/teams/*` | enterprise | intellect-team `/api/teams` | auth(非租户隔离) | Principle V |
| `/admin/projects/*` | enterprise | intellect-team `/api/projects` | auth(非租户隔离) | Principle V |

### 代理前缀设计原则

- **`/api/bff/proxy/v1/*`**: 代理透传前缀(P0 遗留),对应 intellect-rag `/api/v1/*`,保留用于瞬时回滚
- **`/api/bff/auth/*`**: 统一认证入口,前端单入口调用,按 `BffTenant.authMode` 分发
- **`/api/v1`**: 旧 Vite proxy 直连 intellect-rag,不走 BFF,仅在 BFF 不可用时回滚

---

## 流程 1: 登录页加载 + authMode 探测

```
1. 页面挂载 → useAuthMode() (use-login-request.ts)
   └─ TanStack Query GET /api/bff/auth/config (5min 缓存)
      └─ BFF auth.ts GET /auth/config
         └─ X-Tenant-Id 缺省 '0'(公开端点)
         └─ tenantStore.getTenant('0').authMode
         └─ 返回 { code:0, data:{ authMode: 'intellect-enterprise' } }

2. 登录页 (login-next/index.tsx) 拿到 authMode
   ├─ 'intellect-enterprise' → 显示 login_name + display_name(仅注册)字段
   └─ 'intellect-rag'        → 显示 email + nickname(仅注册)字段
```

---

## 流程 2: 用户名密码登录(企业版)

### 2.1 前端字段组装 + 密码处理

```
1. login-next/index.tsx:419 按 authMode 决定密码处理方式:
   const password = isEnterprise ? params.password : (rsaPsw(params.password) as string);
   └─ 企业版:明文 password(intellect-team 尚未实现 RSA 解密,依赖 HTTPS 传输安全)
   └─ 社区版:rsaPsw(password)
      └─ rsaPsw (src/utils/index.ts:14-22):
         Base64.encode(password) → RSA 公钥加密 → 返回密文字符串

2. login-next/index.tsx:422-426 按 authMode 组装登录字段:
   企业版: { login_name, password }           ← 明文密码(待 intellect-team 实现 RSA 后切换)
   社区版: { email,    password: rsaPassWord }  ← RSA 加密后的密码

3. useLogin() mutation (use-login-request.ts)
   └─ userService.login(params)
      └─ POST /api/bff/auth/login
         (request.ts 自动携带 credentials: 'include')
```

### 2.2 BFF 处理 + intellect-team 调用

```
                                    3. auth.ts POST /auth/login
                                       X-Tenant-Id: '0' (公开端点兜底)
                                       authMode = 'intellect-enterprise'
                                       └─ getEnterpriseBackend (auth.ts)
                                          从 harnessStore 按
                                          tenant.intellectBackendId 读取
                                          baseUrl + apiServerKey
                                          (多实例=多租户隔离)
                                       └─ fetch POST {baseUrl}/api/members/login
                                       body: { login_name, password }  ← 明文密码(待实现 RSA)
                                                                       4. intellect-team 校验密码
                                                                       返回 { member_id, display_name,
                                                                              role, token, permissions }
                                    5. auth.ts setCookie('imt_token', token,
                                       { httpOnly, sameSite:'Lax',
                                         path:'/', maxAge:86400,
                                         secure: NODE_ENV==='production' })
                                    6. 返回 body (不含 token):
                                       { code:0, data:{ member_id,
                                         display_name, role } }
```

### 2.3 前端登录态写入

```
7. useLogin 前端处理 (use-login-request.ts)
   └─ saveSetting({ language: storage.getLanguage() })  ← 先保存语言偏好
   └─ authMode === 'intellect-enterprise' 分支
      └─ 不读 response.headers.Authorization (token 仅在 cookie)
      └─ localStorage 写非敏感标记:
         - authMode: 'intellect-enterprise'
         - tenantId: '0'
         - userInfo: { name, memberId, role, ...(email) }  ← BFF /auth/login 已返回 email(P1 改进)
      └─ 注意:不写 Authorization/Token 到 localStorage

8. navigate('/')

9. 后续受保护页面挂载 → useAuth() (auth-hooks.ts)
   └─ localStorage.getItem('authMode') === 'intellect-enterprise'
   └─ setIsLogin(true)
```

### 2.4 社区版对比

社区版 useLogin 分支:
- 从 response body 取 `access_token`
- localStorage 写:`Authorization: 'Bearer xxx'` + `Token: 'xxx'` + `UserInfo`
- `isLogin = !!getAuthorization()`,无需 probe 探测

**P1 修复:BFF 社区版响应直接透传**

Intellect-RAG 响应已是 `{code:0, data:{...}, message}` 格式,BFF **不再用 `ok()` 包装**,
直接透传给前端,避免双层嵌套 `{code:0, data:{code:0, data:{...}}}`。

```
auth.ts POST /auth/login (authMode === 'intellect-rag')
   └─ fetch POST {ragBaseUrl}/api/v1/auth/login
   └─ Intellect-RAG 返回 {code:0, data:{access_token, email, nickname, avatar}, message}
   └─ 从 resp.headers 提取 Authorization (Bearer xxx)
   └─ 补充 access_token 到 data(若 body 中缺失)
   └─ c.json(data) 直接透传  ← 不用 ok() 包装
   └─ response.headers.set('Authorization', authorizationHeader)
```

`/auth/me` 和 `/auth/register` 社区版分支同理直接透传 Intellect-RAG 响应。

---

## 流程 3: OAuth 第三方登录(企业版)

### 3.1 获取 OAuth 渠道列表

```
1. useLoginChannels() (use-login-request.ts)
   └─ GET /api/bff/auth/login/channels
                                    2. auth.ts
                                       fetch {baseUrl}/api/oauth/providers
                                       过滤 enabled && usage.includes('login')
                                       返回 [{ channel, display_name, icon }]
```

### 3.2 发起 OAuth 跳转 + state CSRF 防护

```
3. 用户点 OAuth 按钮 → useLoginWithChannel (use-login-request.ts)
   └─ loginWithChannel(channel)
      └─ window.location.href = /api/bff/auth/login/{channel}
                                    4. auth.ts GET /auth/login/:channel
                                       fetch {baseUrl}/api/oauth/login/{channel}?usage=login
                                       { redirect: 'manual' }  ← 不自动跟 302
                                                                       5. intellect-team 返回
                                                                       302 + Location: {provider_url}?state=xxx
                                    6. BFF 从 Location 提取 state
                                       setCookie('oauth_state', state,
                                         { maxAge:600 })  ← 10 分钟有效,CSRF 防护
                                       302 重定向浏览器到 provider_url
```

### 3.3 OAuth Provider 回调 BFF + token 签发

**关键**:OAuth Provider 的 `redirect_uri` 配置为 **BFF** `/api/bff/auth/oauth/callback`,不是 intellect-team。

```
7. 浏览器跟 302 → OAuth Provider 授权页 → 用户授权
   └─ Provider 回调 BFF /api/bff/auth/oauth/callback?code=&state=
     (redirect_uri 在 OAuth Provider 端配置为 BFF 地址)

8. BFF auth.ts GET /auth/oauth/callback
   └─ 校验 state: getCookie('oauth_state') === query.state
      └─ 不匹配 → 400 'Invalid OAuth state'
      └─ 匹配 → deleteCookie('oauth_state')  ← 一次性使用
   └─ fetch {baseUrl}/api/oauth/callback?code=&state=
     ← BFF 主动调 intellect-team 交换授权码
     返回 { ok, provider_id, member_id }
   └─ fetch POST {baseUrl}/api/members/{member_id}/token
     Authorization: Bearer {apiServerKey}  ← BFF 用 API_SERVER_KEY 签发
     返回 { token_id, token }
   └─ setCookie('imt_token', token, { httpOnly, ... })
   └─ 302 → frontendHome (默认 '/')
```

### 3.4 前端 probe 探测补全登录态

```
9. 前端首页挂载 → useAuth()
   └─ localStorage 无任何标记(首次进入)
   └─ useEnterpriseCookieProbe 启用 (auth-hooks.ts)
      enabled 4 个条件全部满足:
        1. authMode === 'intellect-enterprise'  (企业版模式)
        2. !hasAuthorization                   (无社区版 token)
        3. !hasMarker                          (无企业版 authMode 标记)
        4. !isAdminPath                        (非 /admin 路径)

      └─ queryFn: fetch(api.userInfo, { credentials:'include', headers:{'X-Tenant-Id':'0'} })
         使用 fetch() 绕开 request.ts 401 拦截器:
           - request.ts 401 时会 removeAll + redirectToLogin
           - probe 场景下 401 是预期行为(未登录),不应触发跳转/清标记
           - fetch() 直接返回 resp,由 probe 自行判断 ok/!ok
                                    10. auth.ts GET /auth/me
                                        严格校验 X-Tenant-Id (缺失 400)
                                        authSessionMiddleware 从 cookie 提取 token
                                        fetch {baseUrl}/api/members/me
                                        Authorization: Bearer {session.token}
                                                                        11. intellect-team 验证 token
                                                                        返回 { member_id, display_name,
                                                                               role, email }
                                    12. 返回 { code:0, data:{ member_id,
                                        display_name, role, email } }
      └─ probe 写 localStorage(补全登录态):
         - authMode: 'intellect-enterprise'
         - tenantId: '0'
         - userInfo: { name, email, memberId, role }  ← 补全 email(/auth/me 返回)
      └─ probe.data = true → 触发 useAuth 的 useEffect
         └─ setIsLogin(true) → 渲染受保护页面
```

---

## 流程 4: 登出(双轨)

### 4.1 前端调用(通用)

```
1. useLogout() mutation (use-login-request.ts)
   └─ tenantId = localStorage.getItem('tenantId') || '0'
   └─ try:
      logoutWithHeaders({ 'X-Tenant-Id': tenantId })
      └─ POST /api/bff/auth/logout
         (credentials: 'include' 带 cookie;社区版还带 Authorization header)
   └─ finally (P2-A 防御性清除):
      authorizationUtil.removeAll()  ← 清 KeySet:
        Authorization, Token, UserInfo, AuthMode, TenantId
      redirectToLogin()
```

### 4.2 BFF 企业版登出(authMode === 'intellect-enterprise')

```
auth.ts POST /auth/logout
   严格校验 X-Tenant-Id (缺失 400)
   authMode = getAuthMode(tenantStore, tenantId)
   session = getAuthSession(c)  ← 从 HttpOnly cookie 提取 token
   enterpriseToken = session?.token

   if (!enterpriseToken):
      deleteCookie('imt_token')  ← 防御性清 cookie
      return { code:0, data:{ logged_out: true } }

   └─ fetch POST {baseUrl}/api/members/logout
      Authorization: Bearer {enterpriseToken}
                                       └─ intellect-team 失效 token
   └─ fetch 网络错误:
      deleteCookie('imt_token')  ← 清 cookie(本地登出)
      return { code:0, data:{ logged_out: true } }  ← 与社区版一致:用户视角已登出
   └─ fetch 成功(无论上游状态码):
      deleteCookie('imt_token')  ← 无论上游响应如何都清 cookie
      return { code:0, data:{ logged_out: true } }
```

### 4.3 BFF 社区版登出(authMode === 'intellect-rag')

**P0 修复**:社区版 token 在前端 localStorage,通过 `Authorization` header 传入 BFF,
BFF 用该 header 直接调 Intellect-RAG `/api/v1/auth/logout`。
此前 bug:logout 依赖 `getAuthSession(c)` 读 cookie,但社区版不写 cookie,
导致 `session=undefined` 直接返回,从未调 Intellect-RAG,token 未失效。

```
auth.ts POST /auth/logout
   严格校验 X-Tenant-Id (缺失 400)
   authMode = getAuthMode(tenantStore, tenantId)  ← 从 tenantStore 读取,不依赖 session
   communityAuthHeader = c.req.header('Authorization')  ← 前端从 localStorage 注入

   if (!communityAuthHeader):
      return { code:0, data:{ logged_out: true } }  ← 无 token 视为已登出

   └─ fetch POST {ragBaseUrl}/api/v1/auth/logout
      headers: { Authorization: communityAuthHeader }
                                       └─ Intellect-RAG 失效 token
   └─ 无论上游响应如何(网络错误/token 已过期),都返回 { logged_out: true }
      (用户视角已登出,前端 finally 分支会清 localStorage)
```

### 4.4 登出后状态

```
2. useAuth 的 useEffect 重新计算
   └─ localStorage 无 authMode 标记(企业版)/ 无 Authorization(社区版)
   └─ setIsLogin(false) → 跳登录页

3. 验证:登出后 GET /auth/me 返回 401(token 已失效)
   - 企业版:cookie 已删,authSessionMiddleware 无 token → 401
   - 社区版:前端 localStorage 已清,无 Authorization header → 401
```

---

## 流程 5: 401 拦截(token 过期/无效)

```
1. 任意受保护接口返回 401
   └─ request.ts response 拦截器
      └─ authorizationUtil.removeAll()  ← 清所有标记
      └─ redirectToLogin() → /login

2. 登录页重新加载 → 回到流程 1
```

---

## 流程 6: Admin 登录(独立流程,不走 BFF /auth/*)

Admin 登录页 `src/pages/admin/login.tsx` 走独立认证流,与 BFF /auth/* 完全分离:

```
1. admin/login.tsx
   └─ adminService.login({ username, password })
      └─ POST /api/v1/admin/login  ← 直接到 intellect-rag admin 端点
         (不经 /api/bff/auth/*)
                                    2. intellect-rag 校验
                                       返回 { admin_token, ... }
3. 前端 localStorage 写 admin_token
   └─ Admin 路由守卫检查 admin token
```

**设计原因**:Admin 是 intellect-rag 社区版内置功能,不涉及企业版 intellect-team 集成,无需 BFF 中转。`useEnterpriseCookieProbe` 显式跳过 `/admin` 路径(auth-hooks.ts:67),避免误触发企业版 cookie 探测。

---

## 关键设计要点

### 1. 多租户隔离(Constitution Principle V)

- 通过 **多实例** 实现:不同 `BffTenant.intellectBackendId` 绑定不同 intellect-team 实例
- `getEnterpriseBackend` 从 `harnessStore` 按 `intellectBackendId` 读取 baseUrl,而非单一环境变量
- 当前阶段缺省 `TenantID=0`,不注入 `X-Intellect-Team` 头

### 2. Token 安全(Constitution Principle I + VIII)

- 企业版 member token(`imt_*`)仅在 BFF ↔ intellect-team 之间流动
- 浏览器通过 HttpOnly + SameSite=Lax cookie 自动携带,前端 JS 永远不可读
- localStorage 仅存非敏感标记(`authMode`/`tenantId`/`userInfo`),用于前端状态判断
- 密码传输前经 RSA + Base64 加密(`rsaPsw`),前端不接触明文密码传输

### 3. X-Tenant-Id 统一策略

- 公开端点(login/register/channels/oauth/login/:channel/oauth/callback/config):缺失时 `'0'` 兜底
- 需认证端点(me/logout):缺失时严格 `400`(登录后前端必然知道 tenantId)

### 4. OAuth CSRF 防护

- `/auth/login/:channel`:从 302 Location 提取 `state` 存入 10 分钟 cookie
- `/auth/oauth/callback`:校验 `query.state === cookie.state`,一次性使用后清除
- OAuth Provider `redirect_uri` 配置为 BFF 地址,BFF 主动调 intellect-team 交换授权码

### 5. Cookie 模式登录态探测(P2 T006)

- OAuth callback 302 到前端首页时,localStorage 无标记,`isLogin=false`
- `useEnterpriseCookieProbe` 通过 `fetch()`(绕开 401 拦截器)调 `/auth/me` 探测 cookie 有效性
- 200 → 补全 localStorage 标记 → `isLogin=true`;401 → 视为未登录,保持登录页
- 跳过 `/admin` 路径(admin 走独立认证流)
- probe enabled 需同时满足 4 个条件:企业版模式 + 无社区版 token + 无企业版标记 + 非 admin 路径

### 6. 错误信息脱敏

- BFF 5xx 错误不透传 intellect-team 原始 text 给前端
- 仅 `console.error` 记录日志,响应使用通用消息(`'intellect-team unreachable'` 等)

### 7. BFF 中间件精准注册

- `authSessionMiddleware`(cookie → token 提取)只在 `/auth/me` + `/auth/logout` 注册
- 公开端点无需鉴权,不注入中间件
- `authMiddleware`(全局 Authorization header 校验)不拦截 `/auth/*`

### 8. RSA 密码加密链路(社区版 Intellect-RAG,端到端)

社区版密码在前端加密、BFF 透传、Intellect-RAG 解密,全链路不传输明文密码。
企业版(intellect-team)尚未实现 RSA 解密,当前用明文(依赖 HTTPS),待后续统一。

```
[前端 rsaPsw]                    [BFF auth.ts]                 [Intellect-RAG]
  password (明文)
    │
    ▼ 1. Base64.encode(password)
    │   → "c2VjcmV0" (Base64 字符串)
    │
    ▼ 2. RSA 公钥加密(Base64 字符串)
    │   JSEncrypt.encrypt("c2VjcmV0")
    │   → "Z3mK9...长密文..." (RSA-2048 密文,Base64 编码)
    │
    ▼ 3. 组装登录请求体
    │   { email: "alice@example.com",
    │     password: "Z3mK9...长密文..." }  ← RSA 密文
    │
    ▼ POST /api/bff/auth/login
    │                              4. BFF 收到 body.password (RSA 密文)
    │                                 不解密,直接透传
    │                                 fetch POST {ragBaseUrl}/api/v1/auth/login
    │                                 body: { email, password: "Z3mK9..." }
    │                                                            5. RSA 私钥解密
    │                                                               → "c2VjcmV0" (Base64 字符串)
    │                                                            6. Base64.decode("c2VjcmV0")
    │                                                               → "secret" (明文密码)
    │                                                            7. 与 DB 存储的哈希比对
    │                                                               (argon2/bcrypt)
```

**关键实现**:

| 层 | 文件 | 实现 |
|----|------|------|
| 前端加密 | [src/utils/index.ts:14-22](file:///Users/simon/project/agentui/src/utils/index.ts#L14-L22) | `rsaPsw(password)`: Base64.encode → JSEncrypt RSA-2048 公钥加密 |
| 前端调用 | [src/pages/login-next/index.tsx:419](file:///Users/simon/project/agentui/src/pages/login-next/index.tsx#L419) | `isEnterprise ? params.password : rsaPsw(params.password)` — 社区版加密 |
| BFF 透传 | [bff/src/routes/auth.ts:243-247](file:///Users/simon/project/agentui/bff/src/routes/auth.ts#L243-L247) | `body: JSON.stringify(body)` — 不解密,原样转发到 Intellect-RAG |
| Intellect-RAG 解密 | Intellect-RAG RSA 私钥解密 + Base64.decode | 私钥不离开服务端 |

**安全要点**:
- RSA 公钥硬编码在前端([src/utils/index.ts:16](file:///Users/simon/project/agentui/src/utils/index.ts#L16)),公钥可公开,无私钥泄露风险
- RSA 私钥仅存在于 Intellect-RAG 服务端,BFF 不持有私钥,无法解密密码
- Base64 编码在 RSA 加密前,确保密码中的特殊字符(如换行、Unicode)不影响 RSA 加密
- 密码明文仅在浏览器内存(用户输入)和 Intellect-RAG 内存(解密后比对)中短暂存在,传输链路全程密文

---

## P0/P1 修复记录(2026-07-14)

全流程验证发现 2 个 BFF bug,已修复并验证通过。

### P0: 社区版 logout 未调 Intellect-RAG(token 未失效)

**现象**:社区版登出后,`/auth/me` 仍返回 200 + 用户信息,token 未失效。

**根因**:[bff/src/routes/auth.ts](file:///Users/simon/project/agentui/bff/src/routes/auth.ts) logout 端点原逻辑依赖 `getAuthSession(c)` 获取 session,
但 `authSessionMiddleware` 只从 HttpOnly cookie 读取 token。社区版不写 cookie(token 在前端 localStorage),
导致 `session=undefined`,logout 在早期分支直接返回 `logged_out: true`,从未调 Intellect-RAG `/api/v1/auth/logout`。

**修复**:logout 端点改为按 `authMode`(从 `tenantStore` 按 `X-Tenant-Id` 读取)分支:
- 社区版:用前端 `Authorization` header 直接调 Intellect-RAG `/api/v1/auth/logout`
- 企业版:用 cookie 中的 `session.token` 调 intellect-team `/api/members/logout`

**验证**:登出后 `/auth/me` 返回 401(token 已失效)。

### P1: BFF 社区版响应双层嵌套

**现象**:BFF 用 `ok()` 包装 Intellect-RAG 响应,造成 `{code:0, data:{code:0, data:{...}}}` 结构。
前端 `use-login-request.ts` 检查 `res.code === 0` 通过,但实际数据在 `res.data.data` 中,`res.data.access_token` 取不到值。

**根因**:`ok(data)` 会构造 `{code:0, message:'success', data}`,而 Intellect-RAG 响应本身已是 `{code:0, data:{...}, message}` 格式。

**修复**:社区版 `/auth/login`、`/auth/me`、`/auth/register` 三个端点移除 `ok()` 包装,直接 `c.json(data)` 透传 Intellect-RAG 响应。
同时 `/auth/login` 从 `resp.headers.get('Authorization')` 提取 token,补充到 `data.access_token` 并回写到响应 header。

**验证**:三个端点响应均为单层 `{code:0, data:{...}, message}` 结构,前端 `data.access_token` 正常取值。

### P1 回归遗漏(评审发现,同日修复)

首轮 P1 修复漏掉了两个社区版透传端点,评审发现后补修:

**B1: `/auth/login/channels` 社区版 `ok()` 双重嵌套**

[auth.ts:658-659](file:///Users/simon/project/agentui/bff/src/routes/auth.ts#L658-L659) 社区版 channels 分支仍用 `ok(data)` 包装 Intellect-RAG 响应(已是 `{code:0, data:[...], message}` 格式)。
修复:改为 `c.json(data)` 直接透传(与 login/me/register 一致)。

**B2: `/auth/oauth/callback` 社区版分支三重错误**

[auth.ts:860-882](file:///Users/simon/project/agentui/bff/src/routes/auth.ts#L860-L882) 社区版 callback 分支存在三个叠加问题:
1. 路径不匹配:BFF 调 `/api/v1/auth/oauth/callback`,Intellect-RAG 实际路由是 `/api/v1/auth/oauth/<channel>/callback`(channel 在路径中)
2. 302 被吞:上游返回 302 重定向,BFF `fetch` 未设 `redirect: 'manual'`,自动跟随到 HTML 页面,`resp.json()` 解析失败
3. `ok()` 包装:fallback 到 `ok({})`,丢失上游通过 `/?auth=...` 传递的登录态

修复:社区版 OAuth callback 本就不走 BFF — `/auth/login/:channel` 社区版分支直接 302 浏览器到 Intellect-RAG,OAuth Provider 回调 Intellect-RAG `/api/v1/auth/oauth/<channel>/callback`,Intellect-RAG 处理后 302 到前端 `/?auth=<token>`,前端 `useOAuthCallback` hook 读取 query param。移除错误的社区版透传分支,替换为 400 错误响应(提示 OAuth redirect_uri 配置错误)。

**B3: 企业版 logout 网络错误返回 502(UX 不一致)**

[auth.ts:553-557](file:///Users/simon/project/agentui/bff/src/routes/auth.ts#L553-L557) 企业版 logout fetch 网络错误时返回 `fail(502)`,而社区版返回 `ok({logged_out: true})`。cookie 已清,前端 `finally` 兜底清 localStorage,但 502 会触发错误通知。
修复:企业版网络错误也返回 `ok({logged_out: true})`(与社区版一致:用户视角已登出)。

### 回归验证结果

社区版(Intellect-RAG :9380):
- register → 单层 `{code:0, data:{...}}`
- login → 单层响应,token 在 Authorization header
- /auth/me → 单层用户信息
- logout → `{logged_out: true}`
- 登出后 /auth/me → **401 Unauthorized**(token 已失效)

企业版(mock-intellect-team :8642):
- register → `{member_id, registration_pending}`
- login → `{member_id, display_name, role, email}` + Set-Cookie
- /auth/me → 用户信息(via cookie)
- logout → `{logged_out: true}`
- 登出后 /auth/me → **401 Unauthorized**(cookie 已失效)

TypeScript 编译:`cd bff && npx tsc --noEmit` 零错误。

---

## TODO: Intellect-Team Password RSA 加密(待实现)

**日期**: 2026-07-14
**关联**: intellect-team [docs/agentui-integration/password-rsa-encryption-todo.md](../../../../intellect-team/docs/agentui-integration/password-rsa-encryption-todo.md)
**优先级**: P1(安全增强,非阻塞 AgentUI 集成)

### 现状

intellect-team 的 `/api/members/login` 和 `/api/members/register` 当前接受**明文 password**,
而 Intellect-RAG 已实现 RSA 加密传输。前端 [src/utils/index.ts](file:///Users/simon/project/agentui/src/utils/index.ts) 的 `rsaPsw()` 已对两个后端统一加密,
但 intellect-team 后端**尚未实现 RSA 解密**,导致企业版登录时前端发加密密码、后端按明文验证,密码必然不匹配。

### 临时兼容策略(过渡期)

前端根据 `authMode` 决定是否加密:
- `intellect-rag`: 调用 `rsaPsw(password)` 加密后发送(现状,正常工作)
- `intellect-enterprise`: **暂不加密**,直接发送明文 password(直到 intellect-team 实现 RSA 解密)

### 待 intellect-team 实现后

intellect-team 完成 RSA 解密后,前端移除 authMode 判断,两个后端统一用 `rsaPsw(password)` 加密。
详见 intellect-team 侧 [password-rsa-encryption-todo.md](../../../../intellect-team/docs/agentui-integration/password-rsa-encryption-todo.md)。
