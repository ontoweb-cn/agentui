# Tasks: BFF Auth Routing + Default TenantID (P4b)

**Input**: Design documents from `/specs/005-bff-auth-default-tenant/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Constitution Principle VII 要求 BFF 认证路由必有单元测试,本 tasks.md 包含测试任务。

**Organization**: Tasks grouped by user story(US1=密码登录/US2=注册登出/US3=OAuth),依赖顺序 US1 → US2 → US3。intellect-team 侧文档为独立交付物(P4b-Doc)。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1/US2/US3),或 [DOC] 表示 intellect-team 文档
- Include exact file paths

---

## Phase 1: Setup

**Purpose**: BffTenant 扩展 + 类型定义

- [x] T001 [P] 修改 `bff/src/types/tenant.ts`,BffTenant 接口新增 `authMode?: 'intellect-rag' | 'intellect-enterprise'` 字段(默认 intellect-rag,向后兼容)
- [x] T002 [P] 修改 `bff/src/services/tenant-store.ts`,Zod schema 新增 authMode 可选字段校验,load 时校验 authMode=intellect-enterprise 则 intellectBackendId 必须指向 type='intellect-enterprise' 后端
- [x] T003 [P] 更新 `bff/data/bff-tenants.json`,tenant-enterprise 加 `authMode: "intellect-enterprise"`,tenant-rag 加 `authMode: "intellect-rag"`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 缺省 TenantID=0 处理 + 认证中间件

**⚠️ CRITICAL**: US1/US2/US3 都依赖认证中间件,必须先完成

- [x] T004 修改 `bff/src/middleware/tenant-context.ts`,intellectTenantId === "0" 时不注入 intellectTeamId 到 TenantContext(FR-006,缺省 TenantID 兼容)
- [x] T005 [P] 创建 BFF 认证会话中间件 `bff/src/middleware/auth-session.ts`,从 cookie 提取 `imt_token`(AUTH_COOKIE_NAME),注入 AuthSession {memberId, token, tenantId, authMode} 到 Hono context,无 cookie 时不阻塞(仅 /auth/me 等需认证端点检查)
- [x] T006 [P] 编写 auth-session 中间件单元测试,Mock cookie,验证:有 cookie 提取 token、无 cookie 不阻塞、cookie 格式错误忽略,文件 `bff/src/middleware/auth-session.test.ts`
- [x] T007 [P] 更新 `bff/src/middleware/tenant-context.test.ts`,新增测试:intellectTenantId="0" 时不注入 intellectTeamId(缺省 TenantID 场景)

**Checkpoint**: 中间件就绪,US1/US2/US3 可开始

---

## Phase 3: User Story 1 - 企业版密码登录 (Priority: P1) 🎯 MVP

**Goal**: 企业版用户用 login_name+password 登录,BFF 调 intellect-team,token 存 cookie

**Independent Test**: `curl POST /api/bff/auth/login` → 200 + Set-Cookie → `curl GET /api/bff/auth/me` → 200

### Tests for User Story 1

- [x] T008 [P] [US1] 编写 BFF 认证路由单元测试,Mock intellect-team/intellect-rag,覆盖:企业版登录成功(200+cookie)、登录失败(401)、intellect-team 不可达(502)、社区版登录回归(透传),文件 `bff/src/routes/auth.test.ts`

### Implementation for User Story 1

- [x] T009 [US1] 创建 `bff/src/routes/auth.ts`,实现 POST /api/bff/auth/login:按 X-Tenant-Id 查 BffTenant.authMode 路由;企业版模式调 intellect-team POST /api/members/login,body 映射(email→login_name),成功后 setCookie(imt_token),返回 {member_id, display_name};社区版模式透传 intellect-rag
- [x] T010 [US1] 实现 GET /api/bff/auth/me:企业版模式从 AuthSession 取 token,调 intellect-team GET /api/members/me(注入 Authorization: Bearer imt_xxx),返回 member 信息;社区版透传
- [x] T011 [US1] 在 `bff/src/index.ts` 挂载 /api/bff/auth/* 路由(authMiddleware 不拦截 /auth/login /auth/register /auth/login/channels /auth/login/{channel} /auth/oauth/callback,其余 /auth/* 需 auth-session 中间件)

**Checkpoint**: US1 完成,企业版密码登录可用

---

## Phase 4: User Story 2 - 注册与登出 (Priority: P2)

**Goal**: 用户注册创建账号,登出撤销 token 清 cookie

**Independent Test**: /auth/register → 201 → /auth/login(新账号)→ 200 → /auth/logout → 200 → /auth/me → 401

### Tests for User Story 2

- [x] T012 [P] [US2] 扩展 `bff/src/routes/auth.test.ts`,新增测试:注册成功(201)、注册冲突(409)、登出(200+清 cookie)、登出后 /auth/me(401)

### Implementation for User Story 2

- [x] T013 [US2] 实现 POST /api/bff/auth/register:企业版模式调 intellect-team POST /api/members/register(body: login_name/password/display_name),返回 {member_id};社区版透传 intellect-rag /users
- [x] T014 [US2] 实现 POST /api/bff/auth/logout:企业版模式从 AuthSession 取 token,调 intellect-team POST /api/members/logout(撤销 token),清 cookie(Set-Cookie Max-Age=0);社区版透传

**Checkpoint**: US2 完成,注册/登出可用

---

## Phase 5: User Story 3 - OAuth 渠道登录 (Priority: P3)

**Goal**: OAuth 登录完整流程(渠道列表→授权→回调→签发 token→重定向首页)

**Independent Test**: /auth/login/channels → 列表 → /auth/login/github → 302 → /auth/oauth/callback → 302+cookie

### Tests for User Story 3

- [x] T015 [P] [US3] 扩展 `bff/src/routes/auth.test.ts`,新增测试:OAuth 渠道列表(转换格式)、OAuth authorize(302)、OAuth callback(调 callback+token 签发+Set-Cookie+302)

### Implementation for User Story 3

- [x] T016 [US3] 实现 GET /api/bff/auth/login/channels:企业版模式调 intellect-team GET /api/oauth/providers,转换格式为 [{channel, display_name, icon}](id→channel, name→display_name, logo_svg→icon);社区版透传
- [x] T017 [US3] 实现 GET /api/bff/auth/login/{channel}:企业版模式调 intellect-team POST /api/oauth/authorize {provider_id, usage:"login"},获取 {redirect_uri},302 重定向;社区版透传
- [x] T018 [US3] 实现 GET /api/bff/auth/oauth/callback:企业版模式调 intellect-team GET /api/oauth/callback?code=&state=,获取 {member_id},再调 POST /api/members/{member_id}/token(Authorization: API_SERVER_KEY)签发 token,Set-Cookie,302 重定向前端首页;社区版透传

**Checkpoint**: US3 完成,OAuth 登录可用

---

## Phase 6: Intellect-Team 侧方案文档(独立交付物)

**Purpose**: 为 intellect-team 团队提供 P4a 实现规范

- [x] T019 [P] [DOC] 创建 `docs/intellect-team-integration/README.md`,对接总览:架构图(BFF↔intellect-team)、端点清单、依赖关系、P4a 实现优先级
- [x] T020 [P] [DOC] 创建 `intellect-team/docs/agentui-integration/member-auth-api.md`,member 认证端点规范:POST /api/members/register|login|logout、GET /api/members/me、POST /api/members/{id}/token,含请求/响应示例 + 复用 MembershipDB 方法说明
- [x] T021 [P] [DOC] 创建 `intellect-team/docs/agentui-integration/oauth-callback-token.md`,OAuth callback 补全方案:现有 /api/oauth/callback 返回 {member_id} 无 token 的问题,BFF 通过 POST /api/members/{id}/token 补全的流程图 + 代码示例
- [x] T022 [P] [DOC] 创建 `intellect-team/docs/agentui-integration/default-tenant-compat.md`,缺省 TenantID=0 兼容说明:BFF 不传 X-Intellect-Team 头时 intellect-team 用全局默认的机制,_resolve_member_context 源码引用,P5 升级路径

**Checkpoint**: intellect-team 侧文档完成,可提交给其团队实现 P4a

---

## Phase 7: Polish & Cross-Cutting

- [x] T023 [P] 修改 `src/utils/api.ts`,认证路径从 `${restAPIv1}/auth/*` 迁移到 `/api/bff/auth/*`(login/logout/register/userInfo/loginChannels/loginChannel)
- [x] T024 [P] 运行 `cd bff && npm run type-check`,确认 TypeScript 零错误
- [x] T025 [P] 运行 `cd bff && npm test`,确认所有单元测试通过(含 P0-P3 164 测试 + P4b 新增)
- [x] T026 [P] 运行前端 `npx tsc --noEmit -p tsconfig.json`,确认前端零错误(SC-006 接口零改动)
- [x] T027 扩展 `bff/scripts/mock-intellect-team.mjs`,新增 /api/members/* + /api/oauth/authorize + /api/oauth/callback 补全 token 签发,支持 P4b 端到端冒烟
- [x] T028 运行 quickstart.md 场景 1-10 冒烟验证(用扩展后的 mock server)
- [x] T029 [P] 验证 P0-P3 功能 100% 不回归(BFF 全量测试 + 社区版认证回归)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖,立即开始(T001/T002/T003 可并行)
- **Foundational (Phase 2)**: 依赖 Phase 1 — **BLOCKS** 所有 US
- **US1 (Phase 3)**: 依赖 Phase 2
- **US2 (Phase 4)**: 依赖 Phase 2 + US1(复用 auth 路由文件)
- **US3 (Phase 5)**: 依赖 Phase 2 + US1
- **DOC (Phase 6)**: 无代码依赖,可与 Phase 2-5 并行(纯文档)
- **Polish (Phase 7)**: 依赖所有 US + DOC

### Parallel Opportunities

- T001/T002/T003(Setup)可并行
- T004/T005/T006/T007(Foundational)可并行(不同文件)
- T008(US1 测试)∥ T019-T022(DOC)可并行
- T023/T024/T025/T026(Polish)可并行

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1: Setup(BffTenant.authMode)
2. 完成 Phase 2: Foundational(缺省 TenantID + auth-session 中间件)
3. 完成 Phase 3: User Story 1(密码登录 + /auth/me)
4. **STOP and VALIDATE**: 企业版登录 → cookie → /auth/me
5. 可选:提交 MVP(P4b-US1)

### Incremental Delivery

1. Setup + Foundational → 中间件就绪
2. + US1 → 密码登录可用 → Demo
3. + US2 → 注册/登出闭环 → Demo
4. + US3 → OAuth 登录 → Demo(完整认证)
5. DOC → intellect-team 团队并行实现 P4a
6. Polish → 冒烟 + 回归 + commit

---

## Notes

- BFF 认证路由独立文件,与 P1/P3 Adapter 解耦
- member token 存 HttpOnly cookie,前端 localStorage 不存(防 XSS)
- 缺省 TenantID=0 是关键简化:intellect-team 侧零 Team/Project 改动(多租户通过多实例部署天然支持)
- intellect-team 侧仅文档(P4a 代码由其团队实现)
- 社区版 authMode=intellect-rag 透传,100% 不回归(SC-004)
