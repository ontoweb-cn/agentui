# AgentUI ↔ Intellect-Team Integration Overview

> **Version**: P4a+P4b Complete (2026-07-13)
> **Status**: ✅ 两端均已完成 — 全部 13 个 P4a 端点已在 intellect-team gateway 中实现并通过验证

## 1. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (SPA)                       │
│  React + TanStack Query + api.ts (path constants)       │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / SSE
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   BFF (Hono, :9390)                     │
│                                                         │
│  /api/bff/auth/* ──┬── authMode=intellect-rag ──────────┼──▶ intellect-rag (:9380)
│                    │                                    │     /api/v1/auth/*
│                    └── authMode=intellect-enterprise ───┼──▶ intellect-team (:8642)
│                                                         │     /api/members/*
│  /api/bff/agents/* ── IntellectRagAdapter ──────────────┼──▶ intellect-rag
│  /api/bff/agents/* ── IntellectEnterpriseAdapter ───────┼──▶ intellect-team
│  /api/bff/capabilities ── AdapterRegistry ──────────────┤
│  /api/bff/admin/* ── HarnessStore CRUD ─────────────────┤
│                                                         │
│  Stores: HarnessStore, TenantStore, AdapterRegistry     │
│  Middleware: authMiddleware, tenantContextMiddleware,     │
│             authSessionMiddleware                        │
└─────────────────────────────────────────────────────────┘
```

### Key Design Decisions

- **Single entry point**: Frontend calls `/api/bff/auth/*` uniformly; BFF routes by `BffTenant.authMode`
- **Cookie-based auth**: Enterprise member token (`imt_*`) stored in HttpOnly cookie, not localStorage
- **Default TenantID=0**: When `intellectTenantId === "0"`, BFF does NOT inject `X-Intellect-Team` header; intellect-team uses global default space

---

## 2. Endpoint Inventory

### 2.1 Auth Endpoints (BFF → intellect-team)

| BFF Endpoint | HTTP | intellect-team Endpoint | Auth | Notes |
|---|---|---|---|---|
| `/api/bff/auth/login` | POST | `POST /api/members/login` | Public | body: `{login_name, password}` → `{token, member_id, display_name}` |
| `/api/bff/auth/register` | POST | `POST /api/members/register` | Public | body: `{login_name, password, display_name}` → `{member_id}` |
| `/api/bff/auth/logout` | POST | `POST /api/members/logout` | Member token | Revokes token, clears cookie |
| `/api/bff/auth/me` | GET | `GET /api/members/me` | Member token | Returns member info |
| `/api/bff/auth/login/channels` | GET | `GET /api/oauth/providers` | Public | Returns OAuth provider list |
| `/api/bff/auth/login/{channel}` | GET | `POST /api/oauth/authorize` | Public | Returns `{redirect_uri}`, BFF 302s |
| `/api/bff/auth/oauth/callback` | GET | `GET /api/oauth/callback` + `POST /api/members/{id}/token` | Public + API_SERVER_KEY | Two-step: callback → token sign → Set-Cookie → 302 |

### 2.2 Data Endpoints (BFF → intellect-team, via Adapter)

| BFF Endpoint | HTTP | intellect-team Endpoint | Auth | Notes |
|---|---|---|---|---|
| `/api/bff/agents` | GET | `GET /v1/models` | API_SERVER_KEY | List agents/models |
| `/api/bff/agents/{id}` | GET | `GET /v1/models/{id}` | API_SERVER_KEY | Agent detail |
| `/api/bff/agents/{id}/sessions` | POST | `POST /api/sessions` | API_SERVER_KEY | Create session |
| `/api/bff/agents/{id}/sessions` | GET | `GET /api/sessions` | API_SERVER_KEY | List sessions |
| `/api/bff/agents/{id}/sessions/{sid}` | GET | `GET /api/sessions/{sid}` | API_SERVER_KEY | Session detail |
| `/api/bff/agents/{id}/sessions/{sid}` | DELETE | `DELETE /api/sessions/{sid}` | API_SERVER_KEY | Delete session |
| `/api/bff/agents/{id}/sessions/{sid}/chat/stream` | POST | `POST /api/sessions/{sid}/chat/stream` | Member token + Team/Project headers | SSE streaming |
| `/api/bff/agents/{id}/sessions/{sid}/messages` | GET | `GET /api/sessions/{sid}/messages` | API_SERVER_KEY | Message history |
| `/api/bff/capabilities` | GET | `GET /v1/capabilities` | API_SERVER_KEY | Capability probe |

### 2.3 Auth Tokens

| Token Type | Format | Source | Usage | Storage |
|---|---|---|---|---|
| **Member token** | `imt_*` | intellect-team `/api/members/login` or `/api/members/{id}/token` | User-level auth for session/chat endpoints | HttpOnly cookie (`imt_token`) |
| **API_SERVER_KEY** | env var | Deployment config | BFF internal calls (agent list, session CRUD, capability probe) | BFF env only, never exposed |

---

## 3. Dependencies

### 3.1 intellect-team Endpoints Required by BFF

BFF P4b depends on the following intellect-team endpoints. All endpoints verified as of 2026-07-13.

#### Member Auth (✅ COMPLETE)

| Endpoint | Method | Description | Request | Response |
|---|---|---|---|---|
| `/api/members/register` | POST | Create member account | `{login_name, password, display_name}` | `{member_id}` |
| `/api/members/login` | POST | Authenticate member | `{login_name, password}` | `{token:"imt_*", member_id, display_name}` |
| `/api/members/logout` | POST | Revoke member token | (empty, Authorization: Bearer imt_*) | `{}` |
| `/api/members/me` | GET | Get current member info | (Authorization: Bearer imt_*) | `{member_id, display_name, role, ...}` |
| `/api/members/{id}/token` | POST | Sign token for member (internal) | (Authorization: Bearer API_SERVER_KEY) | `{token:"imt_*"}` |

#### OAuth (✅ COMPLETE — token signing endpoint verified)

| Endpoint | Method | Description | Request | Response |
|---|---|---|---|---|
| `/api/oauth/providers` | GET | List OAuth providers | (Public) | `[{id, name, logo_svg, ...}]` |
| `/api/oauth/authorize` | POST | Start OAuth flow | `{provider_id, usage:"login"}` | `{state, redirect_uri}` |
| `/api/oauth/callback` | GET | Handle OAuth callback | `?code=x&state=y` | `{member_id, claims}` |

**✅ Verified**: After `/api/oauth/callback` returns `member_id`, BFF calls `POST /api/members/{member_id}/token` to sign a token. **Requires `Authorization: Bearer {API_SERVER_KEY}`** — BFF must have API_SERVER_KEY configured.

#### Data API (✅ EXISTS)

| Endpoint | Method | Description |
|---|---|---|
| `/v1/models` | GET | List available models/agents |
| `/v1/capabilities` | GET | Report capabilities (optional, fallback to defaults) |
| `/health` | GET | Health check |
| `/api/sessions` | POST | Create session |
| `/api/sessions/{id}` | GET/DELETE | Get/delete session |
| `/api/sessions/{id}/messages` | GET | List messages |
| `/api/sessions/{id}/chat/stream` | POST | SSE streaming chat |

### 3.2 Environment Variables

| Variable | Required By | Description |
|---|---|---|
| `API_SERVER_KEY` | BFF (IntellectEnterpriseAdapter) | Global admin key for intellect-team API calls |
| `HARNESS_INTELLECT_RAG_ADMIN_TOKEN` | BFF (HarnessStore) | Token for intellect-rag backend |
| `VITE_BFF_BASE` | Frontend | BFF base path (default: `/api/bff`) |

---

## 4. P4a Implementation Priority

Recommended implementation order for the intellect-team team:

### Priority 1 — Member Auth Core (BLOCKS BFF login)

1. **`POST /api/members/login`** — Password authentication, returns `imt_*` token
2. **`POST /api/members/register`** — Account creation
3. **`POST /api/members/logout`** — Token revocation
4. **`GET /api/members/me`** — Token validation + member info

> These 4 endpoints unblock BFF US1 (password login) and US2 (register/logout).

### Priority 2 — Token Signing (BLOCKS OAuth)

5. **`POST /api/members/{id}/token`** — Sign token for a member (called by BFF with `API_SERVER_KEY`)

> This endpoint unblocks BFF US3 (OAuth callback flow). Without it, OAuth callback cannot obtain a token after getting `member_id`.

### Priority 3 — OAuth Flow (Nice to have for P4b)

6. **`GET /api/oauth/providers`** — List configured OAuth providers
7. **`POST /api/oauth/authorize`** — Generate OAuth redirect URL
8. **`GET /api/oauth/callback`** — Handle OAuth callback, return `member_id`

> OAuth can be deferred to P4c if needed; password login works without it.

### Implementation Notes

- **Reuse `MembershipDB`**: All member auth endpoints should reuse existing `MembershipDB` methods (register, login, validate_token, etc.)
- **Token format**: Use `imt_` prefix + random bytes (or existing token generation logic)
- **Token storage**: Store in `MembershipDB` token table, support revocation via `logout`
- **`/api/members/{id}/token`**: This is an **internal** endpoint, protected by `API_SERVER_KEY` (not member token). BFF calls it after OAuth callback to sign a token for the authenticated member. See [oauth-callback-token.md](./oauth-callback-token.md) for the detailed flow.
- **Default TenantID**: When no `X-Intellect-Team` header is present, `_resolve_member_context` should use the global default space. See [default-tenant-compat.md](./default-tenant-compat.md) for details.

---

## 5. Testing Strategy

### BFF Side (✅ Complete)

- 211 unit tests passing (Vitest)
- Mock intellect-team server (`bff/scripts/mock-intellect-team.mjs`) covers all endpoints
- Smoke test scenarios 1-10 passing with mock server

### Integration Testing (Requires P4a)

Once intellect-team P4a endpoints are ready:

1. Start intellect-team on `:8642` with `API_SERVER_KEY` configured
2. Start BFF with `HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY` set
3. Run smoke tests from `specs/005-bff-auth-default-tenant/quickstart.md`
4. Verify: login → cookie → /auth/me → session create → SSE chat

---

## 6. Related Documents

- [member-auth-api.md](./member-auth-api.md) — Member auth endpoint specification (request/response examples)
- [oauth-callback-token.md](./oauth-callback-token.md) — OAuth callback token补全 flow diagram
- [default-tenant-compat.md](./default-tenant-compat.md) — Default TenantID=0 compatibility explanation
- [intellect-team-openai-integration.md](../intellect-team-openai-integration.md) — Intellect-team OpenAI-compatible integration review
