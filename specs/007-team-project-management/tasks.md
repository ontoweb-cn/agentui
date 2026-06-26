# Tasks: Team/Project Management (P5)

**Input**: specs/007-team-project-management/spec.md

**Prerequisites**: P3 + P4b 完成, intellect-team P4 Team/Project CRUD API 就绪

**Organization**: 按 spec.md 的 3 个 User Story 分阶段, US1 是 MVP

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 类型定义 + intellect-team Team/Project API 客户端

- [ ] T001 [P] 定义 Team/Project 类型(`bff/src/types/team.ts`): Team(id/name/description/created_at), Project(id/team_id/name/description/created_at)
- [ ] T002 [P] 创建 intellect-team Team/Project API 客户端(`bff/src/services/intellect-team-admin-client.ts`),封装 Team CRUD + Project CRUD 调用,注入 API_SERVER_KEY
- [ ] T003 [P] 更新 `bff/data/bff-tenants.json`,新增示例 tenant 绑定真实 team_id

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 扩展 TenantContext 中间件支持真实 team_id + project_id

- [ ] T004 确认 TenantContext 中间件逻辑: intellectTenantId !== "0" 时注入 X-Intellect-Team 头(验证 P4b 已有逻辑)
- [ ] T005 扩展 TenantContext 中间件: intellectProjectId 存在时注入 X-Intellect-Project 头
- [ ] T006 编写 TenantContext 中间件测试: 真实 team_id 注入 X-Intellect-Team + project_id 注入 X-Intellect-Project

---

## Phase 3: User Story 1 - Team 管理 (P1) 🎯 MVP

**Goal**: BFF Team CRUD 路由 + Admin 页面, 运维可创建/编辑/删除 Team

### Tests

- [ ] T007 [P] 编写 Team CRUD 路由单元测试, Mock intellect-team API, 覆盖: 创建/列表/编辑/删除 + 删除被绑定 Team 409

### Implementation

- [ ] T008 创建 BFF Team CRUD 路由(`bff/src/routes/teams.ts`), 实现 POST/GET/PUT/DELETE `/api/bff/admin/teams[/:id]`, 调 intellect-team API
- [ ] T009 在 `bff/src/index.ts` 注册 Team 路由, 挂载到 `/api/bff/admin/teams`
- [ ] T010 创建前端 Team 管理页面(`src/pages/admin/teams.tsx`), 展示 Team 列表 + 新增/编辑/删除表单
- [ ] T011 在前端路由配置注册 `/admin/teams` 路由

---

## Phase 4: User Story 2 - Project 管理 (P2)

**Goal**: Team 下的 Project CRUD

### Tests

- [ ] T012 [P] 编写 Project CRUD 路由单元测试, Mock intellect-team API

### Implementation

- [ ] T013 创建 BFF Project CRUD 路由(`bff/src/routes/projects.ts`), 实现 POST/GET/PUT/DELETE `/api/bff/admin/teams/:teamId/projects[/:id]`
- [ ] T014 在 `bff/src/index.ts` 注册 Project 路由
- [ ] T015 创建前端 Project 管理页面(`src/pages/admin/team-projects.tsx`), 在 Team 下管理 Project
- [ ] T016 在前端路由配置注册 `/admin/teams/:teamId/projects` 路由

---

## Phase 5: User Story 3 - Tenant 绑定管理 (P3)

**Goal**: Admin 页面管理 BffTenant ↔ Team/Project 绑定

### Tests

- [ ] T017 [P] 编写 Tenant 绑定路由单元测试

### Implementation

- [ ] T018 创建 BFF Tenant 绑定路由(`bff/src/routes/tenant-bindings.ts`), 实现 PUT `/api/bff/admin/tenants/:id/binding`
- [ ] T019 在 `bff/src/index.ts` 注册绑定路由
- [ ] T020 扩展前端 Tenant 管理页面(或新建), 添加 Team/Project 下拉选择绑定
- [ ] T021 实现 Team 下拉框: 从 BFF `/api/bff/admin/teams` 获取列表
- [ ] T022 实现 Project 级联下拉框: 选择 Team 后从 `/api/bff/admin/teams/:id/projects` 获取

---

## Phase 6: Polish & Cross-Cutting

- [ ] T023 [P] 运行 `cd bff && npm run type-check`, 确认 TypeScript 零错误
- [ ] T024 [P] 运行 `cd bff && npm test`, 确认所有测试通过(含 P0-P4b 211 测试)
- [ ] T025 验证 TenantID=0 模式 100% 不回归
- [ ] T026 验证 Team 绑定后 X-Intellect-Team 头正确注入
- [ ] T027 更新 `docs/multi-harness-design.md`, 标注 P5 实施完成状态

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
