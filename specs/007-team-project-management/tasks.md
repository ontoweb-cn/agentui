# Tasks: Team/Project Management (P5)

**Input**: specs/007-team-project-management/spec.md

**Prerequisites**: P3 + P4b 完成, intellect-team P4 Team/Project CRUD API 就绪

**Organization**: 按 spec.md 的 3 个 User Story 分阶段, US1 是 MVP

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 类型定义 + intellect-team Team/Project API 客户端

- [x] T001 [P] 定义 Team/Project 类型(`bff/src/types/team.ts`): Team(id/name/description/created_at), Project(id/team_id/name/description/created_at)
- [x] T002 [P] 创建 intellect-team Team/Project API 客户端(`bff/src/services/intellect-team-admin-client.ts`),封装 Team CRUD + Project CRUD 调用,注入 API_SERVER_KEY
- [x] T003 [P] 更新 `bff/data/bff-tenants.json`,新增示例 tenant 绑定真实 team_id + TenantID=0 缺省 tenant

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 扩展 TenantContext 中间件支持真实 team_id + project_id

- [x] T004 确认 TenantContext 中间件逻辑: intellectTenantId !== "0" 时注入 X-Intellect-Team 头(验证 P4b 已有逻辑)
- [x] T005 扩展 TenantContext 中间件: intellectProjectId 存在时注入 X-Intellect-Project 头
- [x] T006 编写 TenantContext 中间件测试: 真实 team_id 注入 X-Intellect-Team + project_id 注入 X-Intellect-Project(+3 tests)

---

## Phase 3: User Story 1 - Team 管理 (P1) 🎯 MVP

**Goal**: BFF Team CRUD 路由, 运维可创建/编辑/删除 Team

### Tests

- [x] T007 [P] 编写 Team CRUD 路由单元测试, Mock intellect-team API, 覆盖: 创建/列表/获取/更新/删除 + 删除被绑定 Team 409(10 tests)

### Implementation

- [x] T008 创建 BFF Team CRUD 路由(`bff/src/routes/teams.ts`), 实现 POST/GET/PUT/DELETE `/admin/teams[/:id]`, 调 intellect-team API, 删除前检查 BffTenant 绑定(FR-011)
- [x] T009 在 `bff/src/index.ts` 注册 Team 路由, 挂载 authMiddleware 到 `/admin/teams/*`
- [~] T010 创建前端 Team 管理页面(`src/pages/admin/teams.tsx`), 展示 Team 列表 + 新增/编辑/删除表单(待前端实现)
- [~] T011 在前端路由配置注册 `/admin/teams` 路由(待前端实现)

---

## Phase 4: User Story 2 - Project 管理 (P2)

**Goal**: Team 下的 Project CRUD

### Tests

- [x] T012 [P] 编写 Project CRUD 路由单元测试, Mock intellect-team API, 覆盖创建(含 X-Intellect-Team 注入)/列表/获取/更新/删除/502(7 tests)

### Implementation

- [x] T013 创建 BFF Project CRUD 路由(`bff/src/routes/projects.ts`), 实现 POST/GET/PUT/DELETE `/admin/teams/:teamId/projects[/:id]`
- [x] T014 在 `bff/src/index.ts` 注册 Project 路由
- [~] T015 创建前端 Project 管理页面(`src/pages/admin/team-projects.tsx`)(待前端实现)
- [~] T016 在前端路由配置注册 `/admin/teams/:teamId/projects` 路由(待前端实现)

---

## Phase 5: User Story 3 - Tenant 绑定管理 (P3)

**Goal**: Admin 页面管理 BffTenant ↔ Team/Project 绑定

### Tests

- [x] T017 [P] 编写 Tenant 绑定路由单元测试, 覆盖 GET/PUT 绑定/回退缺省/解绑 project/404/400(10 tests)

### Implementation

- [x] T018 创建 BFF Tenant 绑定路由(`bff/src/routes/tenant-bindings.ts`), 实现 GET/PUT `/admin/tenants/:id/binding`
- [x] T019 在 `bff/src/index.ts` 注册绑定路由
- [~] T020 扩展前端 Tenant 管理页面, 添加 Team/Project 下拉选择绑定(待前端实现)
- [~] T021 实现 Team 下拉框: 从 BFF `/api/bff/admin/teams` 获取列表(待前端实现)
- [~] T022 实现 Project 级联下拉框: 选择 Team 后从 `/api/bff/admin/teams/:id/projects` 获取(待前端实现)

---

## Phase 6: Polish & Cross-Cutting

- [x] T023 [P] 运行 `cd bff && npm run type-check`, 确认 TypeScript 零错误
- [x] T024 [P] 运行 `cd bff && npm test`, 确认所有测试通过(248 tests, 含 P0-P4b 211 + P5 新增 37)
- [x] T025 验证 TenantID=0 模式 100% 不回归(tenant-context.test.ts 覆盖 + 全量测试通过)
- [x] T026 验证 Team 绑定后 X-Intellect-Team 头正确注入(tenant-context.test.ts P5 用例 + http-client.test.ts 已覆盖)
- [~] T027 更新 `docs/multi-harness-design.md`, 标注 P5 BFF 侧实施完成状态(前端待实现)

---

## Dependencies

### Phase Dependencies
- **Setup (Phase 1)**: 无依赖, 立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1
- **US1 (Phase 3)**: 依赖 Phase 2, MVP 优先
- **US2 (Phase 4)**: 依赖 Phase 2, 可与 US1 并行
- **US3 (Phase 5)**: 依赖 US1 + US2(绑定需要 Team/Project 已创建)
- **Polish (Phase 6)**: 依赖所有 US 完成

### Critical Path
Phase 1 → Phase 2 → US1(Team CRUD) → US3(Tenant 绑定) → Polish

### External Dependency
**⚠️ intellect-team P4 Team/Project CRUD API 必须先就绪**。若 API 未就绪, 可用 mock server 开发, 联调时切换真实 API。

---

## Implementation Notes

### BFF 侧已完成(2026-06-26,含契约对齐修正)
- Phase 1-6 BFF 侧全部完成,type-check 0 错误,**253/253 测试通过**
- 新增文件:`types/team.ts`、`services/intellect-team-admin-client.ts`、`routes/teams.ts`、`routes/projects.ts`、`routes/tenant-bindings.ts` 及对应测试
- 扩展:`BffTenant.intellectProjectId` 字段、`TenantStore.setIntellectBinding/getIntellectTeamId/getIntellectProjectId` 方法、`TenantContextMiddleware` 注入 intellectProjectId

### intellect-team 侧已就位(2026-06-26 确认)
intellect-team 侧 P4a(member 认证)+ P5(Team/Project CRUD)**已全部实现**,详见:
- `intellect-team/docs/agentui-integration/p4a-signoff.md`(P4a 收尾,22+5 测试通过)
- `intellect-team/docs/agentui-integration/teams-projects-api.md`(P5 Team/Project API,20 测试通过)

### BFF 契约对齐修正(2026-06-26)
对比 intellect-team 实际实现,修正了 BFF 侧 5 处契约偏差:

1. **OAuth 路由**:`POST /api/oauth/authorize`(拿 redirect_uri 再 302)→ `GET /api/oauth/login/{provider}`(P4a-4,直接透传 302,`redirect: manual`)
2. **Team 字段**:`{name, description}` → `{slug, display_name, enabled, created_by}`(对齐 intellect-team)
3. **Project 端点**:嵌套 `/api/teams/{id}/projects` → 独立 `/api/projects` + `team_ref` 关联(对齐 intellect-team)
4. **DELETE 语义**:硬删除 → 软删除(archive),intellect-team 返回 `{ok: true}` → BFF 返回 `{archived: true}`
5. **created_by 注入**:创建 Team/Project 需 `created_by`(member_id),BFF 从 AuthSession.memberId 自动注入(前端可不传)
6. **移除 PUT**:intellect-team 未实现 Team/Project 更新,BFF 不暴露 PUT 路由(YAGNI)
7. **list 响应提取**:intellect-team 返回 `{data: [...]}`,BFF admin client 提取数组

### 前端侧待实现(T010-T011, T015-T016, T020-T022)
- Team/Project/Admin 页面需前端 React 实现
- BFF API 已就绪并对齐 intellect-team 实际契约:
  - `/api/bff/admin/teams/*`(POST/GET/DELETE,slug/display_name/created_by)
  - `/api/bff/admin/projects/*`(POST/GET/DELETE,独立路径,team_ref 关联)
  - `/api/bff/admin/tenants/:id/binding`(GET/PUT)
- 前端调用时:`created_by` 可不传(BFF 从 session 自动注入),Team/Project 用 slug 作为标识
