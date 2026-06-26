# Implementation Plan: BFF Auth Routing + Default TenantID

**Branch**: `005-bff-auth-default-tenant` | **Date**: 2026-06-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-bff-auth-default-tenant/spec.md`

## Summary

BFF 新增统一认证路由 `/api/bff/auth/*`(login/register/logout/me/channels/oauth),按 `BffTenant.authMode` 路由到 intellect-rag(社区版,透传)或 intellect-team(企业版,member token + cookie)。企业版模式用缺省 `TenantID=0`(不注入 X-Intellect-Team 头,intellect-team 侧零多租户改动)。同时产出 intellect-team 侧 member 认证 + OAuth callback 补全方案文档(放 intellect-team 仓库)。

## Technical Context

**Language/Version**: TypeScript 5.x(BFF Hono),Python(intellect-team 文档,无代码)

**Primary Dependencies**:
- Hono(BFF HTTP 框架,已用)
- `cookie` 处理(Hono 内置 `setCookie`/`getCookie`)
- intellect-team `/api/members/*` + `/api/oauth/*`(P4a 新增,BFF 调用方)
- intellect-rag `/api/v1/auth/*`(已用,社区版透传)

**Storage**: 无新增持久化。AuthSession 内存(cookie token ↔ member_id),不落盘;BffTenant.authMode 字段加到现有 `bff-tenants.json`

**Testing**: Vitest(BFF 既有),Mock intellect-team/intellect-rag 响应

**Target Platform**: BFF Node.js server(localhost:9390)

**Project Type**: BFF 路由 + 中间件模块(扩展现有 `bff/src/routes/` + `bff/src/middleware/`)

**Performance Goals**: 登录响应 < 500ms(不含 intellect-team 验证时间);OAuth callback 处理 < 1s

**Constraints**:
- 社区版 authMode=intellect-rag 100% 不回归(SC-004)
- 前端 useLogin/useRegister/useLogout 接口签名零改动(SC-006)
- member token 存 HttpOnly cookie(非 localStorage,防 XSS)
- 缺省 TenantID=0 时不注入 X-Intellect-Team 头(FR-006)

**Scale/Scope**: 1 个认证路由文件 + 1 个认证中间件 + BffTenant 扩展 + 前端 api.ts 路径迁移 + intellect-team 方案文档。预估 ~500 LOC(含测试)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I. BFF-Mediated Frontend | 认证经 BFF /api/bff/auth/*,前端不直连 intellect-team/intellect-rag | ✅ Pass |
| II. Adapter Abstraction | 认证路由属 BFF 层(非 Adapter 核心),不影响 IHarnessAdapter 接口 | ✅ Pass |
| III. Canvas Hard-Bound to RAG | 认证与画布无关,不影响 Principle III | ✅ Pass |
| IV. SSE Dual-Protocol | 认证不涉及 SSE,不影响 Principle IV | ✅ Pass |
| V. Tenant Isolation | 缺省 TenantID=0 时不注入 X-Intellect-Team 头(intellect-team 全局默认);authMode 字段加到 BffTenant | ✅ Pass |
| VI. No ACP in BFF | 用 HTTP REST + cookie,不实现 ACP | ✅ Pass |
| VII. YAGNI + Test-First | BFF 认证路由必有单元测试;不实现 token 刷新/P5 Team 管理(留后续) | ✅ Pass |
| VIII. BFF ↔ Intellect Enterprise Access Contract | 企业版认证用 intellect-team member token(imt_*),BFF 管理操作仍用 API_SERVER_KEY;OAuth callback 补全 token 签发 | ✅ Pass |

**GATE RESULT**: All principles pass. 无 Complexity Tracking 违规需记录。

## Project Structure

### Documentation (this feature)

```text
specs/005-bff-auth-default-tenant/
├── plan.md              # This file
├── research.md          # Phase 0 output(cookie 方案 + authMode 路由 + OAuth 流程)
├── data-model.md        # Phase 1 output(AuthSession + BffTenant.authMode)
├── quickstart.md        # Phase 1 output(认证冒烟场景)
├── contracts/           # Phase 1 output(BFF auth API 契约)
│   └── auth-api.ts
└── tasks.md             # Phase 2 output(/speckit-tasks,本命令不创建)
```

### Source Code (agentui repository)

```text
bff/src/
├── routes/
│   └── auth.ts                          # P4b 新增:统一认证路由
├── middleware/
│   ├── auth-session.ts                  # P4b 新增:cookie → member token 提取
│   └── tenant-context.ts                # P4b 修改:缺省 TenantID=0 不注入头
├── types/
│   └── tenant.ts                        # P4b 修改:BffTenant 加 authMode 字段
├── services/
│   └── adapters/intellect-enterprise/
│       └── http-client.ts               # P4b 不改(P3 已支持 Authorization 注入)
└── index.ts                             # P4b 修改:挂载 /api/bff/auth/* 路由

src/utils/api.ts                         # P4b 修改:认证路径迁移到 /api/bff/auth/*
```

### Documentation (intellect-team repository)

```text
intellect-team/docs/agentui-integration/
├── README.md                            # P4b 交付物:intellect-team 侧对接总览
├── member-auth-api.md                   # member 认证端点规范(register/login/logout/me/token)
├── oauth-callback-token.md              # OAuth callback 补全 token 签发方案
└── default-tenant-compat.md             # 缺省 TenantID=0 兼容说明
```

**Structure Decision**: BFF 认证逻辑独立文件(routes/auth.ts + middleware/auth-session.ts),与现有 P1/P3 Adapter 解耦。intellect-team 侧仅文档(无代码改动),放其仓库 `docs/agentui-integration/`。

## Complexity Tracking

> 无 Constitution Check 违规,本节为空。
