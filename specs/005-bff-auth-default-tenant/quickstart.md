# Quickstart: BFF Auth Routing + Default TenantID (P4b)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-06-26

## 前置条件

1. **P3 已完成**(BFF + IntellectEnterpriseAdapter + mock server 可用)
2. **P4a intellect-team 端点就绪**(或用扩展后的 mock server 模拟):
   - `POST /api/members/login` / `POST /api/members/register` / `POST /api/members/logout` / `GET /api/members/me`
   - `POST /api/members/{id}/token`(OAuth callback 后签发)
   - `POST /api/oauth/authorize` / `GET /api/oauth/callback`(已存在)
3. **BFF 配置**(`bff-tenants.json`):
   ```json
   {
     "tenants": [
       { "id": "tenant-rag", "intellectBackendId": "intellect-rag-default", "authMode": "intellect-rag" },
       { "id": "tenant-enterprise", "intellectTenantId": "0", "intellectBackendId": "intellect-enterprise-default", "authMode": "intellect-enterprise" }
     ]
   }
   ```
4. **启动**:BFF(9390)+ mock-intellect-team(8642,P4a 扩展 member 端点)

## 场景 1:企业版密码登录(US1)

**步骤**:
```bash
curl -i -X POST http://localhost:9390/api/bff/auth/login \
  -H "X-Tenant-Id: tenant-enterprise" -H "X-User-Id: anon" \
  -H "Content-Type: application/json" \
  -d '{"login_name":"alice","password":"secret"}'
```

**预期**:
- HTTP 200
- `Set-Cookie: imt_token=imt_xxx; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
- Body: `{ "member_id": "abc", "display_name": "Alice", "role": "member" }`

**验收**: SC-001(登录 < 3s)

---

## 场景 2:获取当前用户(US1)

**步骤**:
```bash
curl -i http://localhost:9390/api/bff/auth/me \
  -H "Cookie: imt_token=imt_xxx" \
  -H "X-Tenant-Id: tenant-enterprise" -H "X-User-Id: anon"
```

**预期**:
- HTTP 200
- Body: `{ "member_id": "abc", "display_name": "Alice", "role": "member" }`

---

## 场景 3:登出(US2)

**步骤**:
```bash
curl -i -X POST http://localhost:9390/api/bff/auth/logout \
  -H "Cookie: imt_token=imt_xxx" \
  -H "X-Tenant-Id: tenant-enterprise" -H "X-User-Id: anon"
```

**预期**:
- HTTP 200
- `Set-Cookie: imt_token=; Max-Age=0`(清除 cookie)
- 后续 /auth/me 返回 401

---

## 场景 4:注册(US2)

**步骤**:
```bash
curl -i -X POST http://localhost:9390/api/bff/auth/register \
  -H "X-Tenant-Id: tenant-enterprise" -H "Content-Type: application/json" \
  -d '{"login_name":"bob","password":"secret","display_name":"Bob"}'
```

**预期**: HTTP 201 + `{ "member_id": "def" }`

---

## 场景 5:OAuth 渠道列表(US3)

**步骤**:
```bash
curl http://localhost:9390/api/bff/auth/login/channels \
  -H "X-Tenant-Id: tenant-enterprise"
```

**预期**: `[{ "channel": "github", "display_name": "GitHub", "icon": "gh" }]`

---

## 场景 6:OAuth 登录流程(US3)

**步骤**:
```bash
# 1. 发起 GitHub 登录
curl -i http://localhost:9390/api/bff/auth/login/github -H "X-Tenant-Id: tenant-enterprise"
# 预期:302 → GitHub 授权页 URL

# 2. 模拟回调(BFF 内部调 intellect-team callback + token 签发)
curl -i "http://localhost:9390/api/bff/auth/oauth/callback?code=fakecode&state=fakestate" \
  -H "X-Tenant-Id: tenant-enterprise"
# 预期:302 → 前端首页 + Set-Cookie: imt_token=imt_xxx
```

**验收**: SC-002(OAuth < 10s)

---

## 场景 7:社区版回归(US1,SC-004)

**步骤**:
```bash
curl -i -X POST http://localhost:9390/api/bff/auth/login \
  -H "X-Tenant-Id: tenant-rag" -H "Content-Type: application/json" \
  -d '{"email":"user@x.com","password":"secret"}'
```

**预期**: BFF 透传到 intellect-rag /auth/login,行为与 P3 完全一致(不设 imt_token cookie)

---

## 场景 8:缺省 TenantID=0 验证

**步骤**: 企业版登录后,发起对话请求,检查 mock server 是否收到 X-Intellect-Team 头

```bash
curl -X POST http://localhost:9390/agents/chat/completions \
  -H "Cookie: imt_token=imt_xxx" \
  -H "X-Tenant-Id: tenant-enterprise" -H "X-User-Id: anon" \
  -H "Content-Type: application/json" -d '{"session_id":"s1","content":"hi"}'
```

**预期**: mock server 日志**不含** `X-Intellect-Team` 头(intellectTenantId="0" 不注入)

**验收**: SC-003(缺省 TenantID 可用)

---

## 场景 9:错误处理

- **错误密码**: /auth/login 返回 401 "Invalid credentials"
- **intellect-team 不可达**: /auth/login 返回 502 "Backend unavailable"
- **无 cookie 访问 /auth/me**: 返回 401
- **注册已存在 login_name**: 返回 409 "login_name already in use"

---

## 场景 10:单元测试

```bash
cd bff && npx vitest run src/routes/auth.test.ts
```

**预期**: 覆盖 ≥ 10 个场景(企业版登录/注册/登出/OAuth + 社区版回归 + 错误),全过

**验收**: SC-005(测试通过率 100%)
