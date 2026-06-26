# Data Model: BFF Auth Routing + Default TenantID (P4b)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-06-26

## 实体清单

### 1. BffTenant.authMode(字段扩展)

**所属**: `BffTenant` 接口(`bff/src/types/tenant.ts`)

**新增字段**:
- `authMode?: 'intellect-rag' | 'intellect-enterprise'` — 认证模式,默认 'intellect-rag'(向后兼容)

**取值**:
- `'intellect-rag'`(默认):社区版,BFF 透传到 intellect-rag `/api/v1/auth/*`
- `'intellect-enterprise'`:企业版,BFF 调 intellect-team `/api/members/*` + `/api/oauth/*`

**校验**: TenantStore.load 时,若 `authMode === 'intellect-enterprise'` 则 `intellectBackendId` 必须指向 type='intellect-enterprise' 的后端

---

### 2. AuthSession(BFF 内存,不持久化)

**生命周期**: 单次请求(cookie 提取 → 注入 context → 请求结束丢弃)

**字段**:
- `memberId: string` — intellect-team member ID
- `token: string` — `imt_*` member token(从 cookie 提取)
- `tenantId: string` — 当前租户 ID(从 X-Tenant-Id header)
- `authMode: 'intellect-rag' | 'intellect-enterprise'`

**存储**: HttpOnly cookie(`imt_token` 字段),不落盘

---

### 3. MemberLoginRequest / MemberLoginResponse(BFF ↔ intellect-team 契约)

**LoginRequest**:
```typescript
{ login_name: string; password: string }
```

**LoginResponse**(intellect-team 返回):
```typescript
{
  member_id: string;
  display_name: string;
  role: string;
  token: string;        // imt_* member token
  permissions: string[];
}
```

---

### 4. MemberRegisterRequest / MemberRegisterResponse

**RegisterRequest**:
```typescript
{
  login_name: string;
  password: string;
  display_name: string;
  email?: string;
}
```

**RegisterResponse**:
```typescript
{ member_id: string; registration_pending: number }
```

---

### 5. OAuthProvider(BFF ↔ intellect-team OAuth 契约)

**intellect-team 返回**(GET /api/oauth/providers):
```typescript
{
  id: string;
  name: string;
  usage: string;
  auth_flow: string;
  enabled: boolean;
  logo_svg?: string;
  is_builtin: boolean;
  display_order: number;
  description?: string;
}
```

**BFF 转换为前端兼容格式**:
```typescript
{ channel: string; display_name: string; icon: string }
```

映射:`id → channel`, `name → display_name`, `logo_svg → icon`(或默认 'sso')

---

### 6. OAuthCallbackResult

**intellect-team 返回**(GET /api/oauth/callback):
```typescript
{
  ok: boolean;
  provider_id: string;
  member_id: string;
  claims: Record<string, unknown>;
}
```

**BFF 后续动作**: 用 member_id 调 `POST /api/members/{member_id}/token` 签发 token,存 cookie

---

### 7. MemberTokenIssueRequest / Response(BFF → intellect-team,内部调用)

**Request**(POST /api/members/{member_id}/token,Authorization: API_SERVER_KEY):
```typescript
{ name: string; permissions?: string[] }
// name: "agentui-session-" + timestamp
// permissions: ["chat", "read"]
```

**Response**:
```typescript
{ token_id: string; token: string }  // token = "imt_xxx"
```

---

## 实体关系图

```
bff-tenants.json
  tenant-enterprise:
    intellectTenantId: "0"                    ← 缺省(不注入 X-Intellect-Team)
    intellectBackendId: "intellect-enterprise-default"
    authMode: "intellect-enterprise"          ← P4b 新增
         ↓
请求 POST /api/bff/auth/login {login_name, password}
         ↓ routes/auth.ts 按 authMode 路由
  authMode=intellect-enterprise:
    BFF → intellect-team POST /api/members/login
    ← {member_id, token:"imt_xxx", ...}
    BFF setCookie("imt_token", token, {httpOnly:true, sameSite:'lax'})
    → 前端 {member_id, display_name}
         ↓
后续请求 GET /api/bff/agents (带 cookie)
         ↓ middleware/auth-session.ts
  提取 cookie imt_token → AuthSession {memberId, token}
         ↓ IntellectEnterpriseHttpClient
  注入 Authorization: Bearer imt_xxx(用户 token,非 API_SERVER_KEY)
         ↓
intellect-team 验证 imt_xxx → member_id → 返回数据
```

## 校验规则汇总

| 实体 | 字段 | 规则 | 校验位置 |
|------|------|------|---------|
| BffTenant | authMode | 'intellect-rag' \| 'intellect-enterprise',默认前者 | TenantStore.load |
| BffTenant | authMode=intellect-enterprise | intellectBackendId 必须指向 type='intellect-enterprise' | TenantStore.load |
| BffTenant | intellectTenantId | "0" 时不注入 X-Intellect-Team 头 | tenantContextMiddleware |
| AuthSession | token | 非空(从 cookie 提取),空则 401 | auth-session middleware |
| MemberLoginRequest | login_name | 非空 | BFF routes/auth.ts |
| MemberLoginRequest | password | 非空 | BFF routes/auth.ts |
| cookie | imt_token | HttpOnly + SameSite=Lax + Path=/ | BFF setCookie |
