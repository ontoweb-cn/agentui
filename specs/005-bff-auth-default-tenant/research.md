# Research: BFF Auth Routing + Default TenantID (P4b)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-06-26

## Phase 0: Research Tasks

### R1. Cookie 方案选型(HttpOnly + SameSite)

**Decision**: 用 Hono 内置 `setCookie`/`getCookie`,cookie 属性:
- `HttpOnly: true`(防 XSS 读取)
- `SameSite: Lax`(允许 OAuth 重定向回来时携带,防 CSRF)
- `Secure: true`(生产环境 HTTPS,开发环境 localhost 豁免)
- `Path: /`
- `Max-Age: 86400`(1 天,与 intellect-team token 默认有效期对齐)

**Rationale**: member token 存 cookie 而非 localStorage,避免 XSS 攻击窃取 token。Hono 内置 cookie 支持,无需额外依赖。

**Alternatives considered**:
- localStorage + Authorization header — 拒绝,XSS 风险高(前端 JS 可读取)
- Session ID + 服务端 session 存储 — 拒绝,需引入 session store(Redis/内存),P4b YAGNI
- BFF 自签 JWT — 拒绝,与 intellect-team token 体系重复,直接透传 imt_*

---

### R2. authMode 路由策略

**Decision**: `BffTenant.authMode` 字段决定认证路由目标:
- `authMode === 'intellect-rag'`(默认):BFF 透传到 intellect-rag `/api/v1/auth/*`(现状,零回归)
- `authMode === 'intellect-enterprise'`:BFF 调 intellect-team `/api/members/*` + `/api/oauth/*`

**路由实现**:BFF `/api/bff/auth/*` 路由内部根据 `X-Tenant-Id` header → 查 TenantStore → 读 `authMode` → 分发。

**Rationale**: 单一入口(`/api/bff/auth/*`)对前端透明,前端无需感知后端类型。authMode 配置在 BffTenant,运维通过 Admin 页面设置。

**Alternatives considered**:
- 前端根据 `useHarnessCapabilities` 判断走哪个端点 — 拒绝,前端逻辑复杂化,违反 SC-006
- 两套端点(`/api/bff/auth/rag/*` + `/api/bff/auth/enterprise/*`)— 拒绝,前端需知道调用哪个,违反单入口原则

---

### R3. OAuth callback token 补全流程

**问题**:intellect-team `/api/oauth/callback` 返回 `{member_id, claims}`,**不返回 token**。BFF 需要 token 存 cookie。

**Decision**: BFF 在 OAuth callback 后主动调 intellect-team 新增端点 `POST /api/members/{member_id}/token` 签发 token(用 API_SERVER_KEY 鉴权,BFF 内部调用)。

**完整 OAuth 流程**:
```
1. 前端 GET /api/bff/auth/login/channels
   BFF → intellect-team GET /api/oauth/providers
   返回 [{channel:"github", display_name:"GitHub", icon:"gh"}]

2. 前端 GET /api/bff/auth/login/github
   BFF → intellect-team POST /api/oauth/authorize {provider_id:"github", usage:"login"}
   返回 {state, redirect_uri}
   BFF 302 → redirect_uri

3. GitHub 回调 → 前端 GET /api/bff/auth/oauth/callback?code=x&state=y
   BFF → intellect-team GET /api/oauth/callback?code=x&state=y
   返回 {member_id, claims}
   BFF → intellect-team POST /api/members/{member_id}/token (Authorization: API_SERVER_KEY)
   返回 {token:"imt_xxx"}
   BFF setCookie + 302 → 前端首页
```

**Rationale**: intellect-team 现有 OAuthEngine.resolve_login 返回 member_id 但不签发 token(P4a 需补全)。BFF 用 API_SERVER_KEY 调 token 签发端点,是受信内部调用(Principle VIII 管理操作用 API_SERVER_KEY)。

**Alternatives considered**:
- 修改 intellect-team /api/oauth/callback 直接返回 token — 拒绝,改动 intellect-team 既有端点语义,影响其他调用方
- BFF 用 member_id + API_SERVER_KEY 代替 member token — 拒绝,API_SERVER_KEY 是全局管理 key,不能作为用户身份标识

---

### R4. 缺省 TenantID=0 兼容机制

**Decision**: 当 `BffTenant.intellectTenantId === "0"` 时:
- `tenantContextMiddleware` **不注入** `intellectTeamId` 到 TenantContext
- `IntellectEnterpriseHttpClient` 不注入 `X-Intellect-Team` 头
- intellect-team `_resolve_member_context` 收不到 team_header → `ctx` 无 team_id → 用全局默认

**配置**:
```json
{
  "id": "tenant-enterprise",
  "intellectTenantId": "0",
  "authMode": "intellect-enterprise"
}
```

**Rationale**: intellect-team 无 Tenant 实体,team_id="0" 不存在会报错。不传头让 intellect-team 用全局默认空间,P4 阶段所有企业版用户共享(无多租户隔离)。P5 上线 Team 管理后,把 "0" 改成真实 team_id 即可启用隔离,零代码改动。

**Alternatives considered**:
- 在 intellect-team 创建 team_id="0" 的默认 team — 拒绝,需 intellect-team 侧改动,违反"P4b intellect-team 零改动"目标
- BFF 传 X-Intellect-Team: default — 拒绝,intellect-team 仍需查 team,可能 404

---

### R5. BFF 认证中间件设计

**Decision**: 新增 `auth-session.ts` 中间件,从 cookie 提取 member token,注入到 Hono context:
- 企业版模式:cookie 含 `imt_*` token → 注入到后续 intellect-team 请求的 Authorization 头
- 社区版模式:不使用此中间件(intellect-rag 用自己的 access_token,前端 localStorage 存)

**中间件挂载**:仅挂载到需要认证的 `/api/bff/agents/*` + `/api/bff/capabilities/*`(企业版模式),不影响 `/api/bff/auth/*`(登录端点本身不需认证)。

**Rationale**: P3 的 IntellectEnterpriseHttpClient 已支持从 TenantContext 注入头,但 member token 是用户级的(非 tenant 级),需独立中间件从 cookie 提取。

**Alternatives considered**:
- 复用 tenantContextMiddleware 提取 cookie — 拒绝,职责混乱(租户上下文 vs 用户会话)
- 前端每次请求带 Authorization header — 拒绝,需改前端请求拦截器,违反 SC-006

---

### R6. 前端 api.ts 路径迁移影响面

**Decision**: `src/utils/api.ts` 认证路径从 `/api/bff/proxy/v1/auth/*` 迁移到 `/api/bff/auth/*`:
```typescript
// Before
login: `${restAPIv1}/auth/login`,           // /api/bff/proxy/v1/auth/login
// After
login: `/api/bff/auth/login`,
```

**影响面分析**:
- `useLogin` / `useRegister` / `useLogout` / `useLoginChannels` / `useLoginWithChannel` 接口签名不变
- `userService.login/register/logout` 调用路径自动更新(引用 api 对象)
- 前端登录页 UI 不改(表单字段差异由 BFF 吸收)

**Rationale**: 单点改动(api.ts 路径常量),所有 hook/service 自动生效。社区版 BFF 透传到 intellect-rag /api/v1/auth/*,行为不变。

---

### R7. intellect-team 侧方案文档结构

**Decision**: 在 `intellect-team/docs/agentui-integration/` 产出 4 个文档:
1. `README.md` — 对接总览(架构图 + 端点清单 + 依赖关系)
2. `member-auth-api.md` — member 认证端点规范(register/login/logout/me/token,含请求/响应示例)
3. `oauth-callback-token.md` — OAuth callback 补全 token 签发方案(流程图 + 代码示例)
4. `default-tenant-compat.md` — 缺省 TenantID=0 兼容说明(为何不传 X-Intellect-Team 头)

**Rationale**: intellect-team 侧 P4a 实现由其团队负责,agentui 侧只提供规范文档。文档放 intellect-team 仓库,便于其团队 review 和实现。

---

## Phase 0 总结

所有 NEEDS CLARIFICATION 已解决:
- ✅ Cookie 方案(R1:HttpOnly + SameSite=Lax)
- ✅ authMode 路由(R2:BffTenant.authMode 字段)
- ✅ OAuth callback token 补全(R3:BFF 主动调 /api/members/{id}/token)
- ✅ 缺省 TenantID=0 兼容(R4:不注入 X-Intellect-Team 头)
- ✅ 认证中间件(R5:auth-session.ts 独立)
- ✅ 前端路径迁移(R6:api.ts 单点改动)
- ✅ intellect-team 文档结构(R7:4 个文档)

**Gate**: 可进入 Phase 1 设计阶段。
