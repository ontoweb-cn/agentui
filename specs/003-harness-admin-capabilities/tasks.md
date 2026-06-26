# Tasks: Multi-Harness P2 — Harness Admin 管理端 + 前端能力探测

**Input**: Design documents from `/specs/003-harness-admin-capabilities/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Constitution Principle VII 要求测试优先,AdapterRegistry.invalidate + HarnessStore.listConfigs + harness-admin 路由 + capabilities 路由必有单元测试,覆盖率 ≥ 80%。

**Organization**: 按 spec.md 的 3 个 User Story(US1/US2/US3)分阶段,US1 是 MVP(后端 CRUD 是 US2 能力探测的数据来源、US3 Admin 页面的 API 后端)。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行(不同文件,无依赖)
- **[Story]**: 所属 User Story(US1/US2/US3)
- 路径基于 plan.md Project Structure(bff/ 为 BFF,src/ 为前端)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: P2 前置类型定义与契约同步

- [X] T001 [P] 创建 P2 DTO 类型文件,定义 HarnessBackendWithStatus / CapabilitiesResponse / HarnessBackendForm,文件 `bff/src/types/harness-admin.ts`
- [X] T002 [P] 同步 P2 契约到 specs 目录,文件 `specs/003-harness-admin-capabilities/contracts/harness-admin-api.ts`(已存在,确认与 T001 类型一致)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 扩展 P0/P1 基础设施,所有 User Story 依赖

**⚠️ CRITICAL**: 完成前禁止开始任何 User Story

- [X] T003 [P] 扩展 HarnessStore,新增 `listConfigs(): HarnessBackendConfig[]` 方法返回所有配置(含未就绪,不含 token 明文),文件 `bff/src/services/harness-store.ts` 与 `bff/src/types/stores.ts`
- [X] T004 [P] 扩展 AdapterRegistry,新增 `invalidate(backendId?: string): void` 方法(不传参清空整个 adapterCache,传 backendId 只移除该条目),文件 `bff/src/services/adapter-registry.ts` 与 `bff/src/services/adapter-registry-types.ts`

**Checkpoint**: 基础设施扩展就绪,可开始 User Story 实现

---

## Phase 3: User Story 1 - 运维在线管理后端配置 (Priority: P2) 🎯 MVP

**Goal**: BFF harness-admin 路由实现后端配置 CRUD + 热加载 + AdapterRegistry 缓存失效,运维可通过 API 管理后端

**Independent Test**: curl 调用 CRUD API,新增后端后 GET 列表能查到,编辑后能力探测反映新 capabilities,删除被绑定的 409 未绑定的成功

### Tests for User Story 1 (Test-First, Constitution Principle VII)

- [X] T005 [P] [US1] 编写 AdapterRegistry.invalidate 单元测试,验证:invalidate() 清空整个缓存、invalidate(backendId) 移除单条目、invalidate 后 getAdapterForTenant 创建新实例(!==),文件 `bff/src/services/adapter-registry.test.ts`(扩展 P1 测试)
- [X] T006 [P] [US1] 编写 HarnessStore.listConfigs 单元测试,验证:返回所有配置(含未就绪)、不含 adminToken 明文(not contain '"adminToken":'),文件 `bff/src/services/harness-store.test.ts`(扩展 P0 测试)
- [X] T007 [P] [US1] 编写 harness-admin 路由单元测试,Mock HarnessStore + TenantStore + AdapterRegistry,覆盖:GET 列表返回 ready 状态、POST 新增(校验 id/endpoint/adminTokenEnvVar 格式 + id 重复 409)、PUT 编辑(id 只读 + 404)、DELETE(被绑定 409 + 未绑定成功)、响应不含 adminToken 明文,文件 `bff/src/routes/harness-admin.test.ts`

### Implementation for User Story 1

- [X] T008 [US1] 创建校验工具函数,实现 id kebab-case / endpoint URL / adminTokenEnvVar 格式校验,文件 `bff/src/services/harness-admin-validation.ts`
- [X] T009 [US1] 创建 BFF harness-admin 路由,实现 GET/POST/PUT/DELETE `/admin/harness-backends[/:id]`,内部调 HarnessStore.saveConfig + load 热加载 + AdapterRegistry.invalidate,删除前校验 TenantStore.listTenants 绑定,文件 `bff/src/routes/harness-admin.ts`
- [X] T010 [US1] 在 `bff/src/index.ts` 注册 harness-admin 路由,挂载到 `/api/bff/admin/harness-backends`(Vite rewrite 后 BFF 收到 `/admin/harness-backends`),仅 authMiddleware(非租户隔离)

**Checkpoint**: US1 完成,后端配置 CRUD API 可用,热加载 + 缓存失先生效

---

## Phase 4: User Story 2 - 前端能力探测与条件渲染 (Priority: P2)

**Goal**: BFF capabilities 路由 + 前端 useHarnessCapabilities hook,按 tenant 返回能力,条件渲染 UI

**Independent Test**: 前端启动查询 capabilities,canvas=true 显示画布入口 false 隐藏,切换 tenant 重新查询 UI 调整

### Tests for User Story 2 (Test-First)

- [X] T011 [P] [US2] 编写 capabilities 路由单元测试,Mock AdapterRegistry + TenantStore,覆盖:合法 tenant 返回 CapabilitiesResponse、tenant 不存在 404、缺失 X-Tenant-Id 400、Registry 未就绪 503,文件 `bff/src/routes/capabilities.test.ts`

### Implementation for User Story 2

- [X] T012 [US2] 创建 BFF capabilities 路由,实现 GET `/capabilities`,从 tenantContextMiddleware 注入的 TenantContext 取 tenantId,调 AdapterRegistry.getAdapterForTenant + discoverCapabilities 返回,文件 `bff/src/routes/capabilities.ts`
- [X] T013 [US2] 在 `bff/src/index.ts` 注册 capabilities 路由,挂载到 `/api/bff/capabilities`(Vite rewrite 后 BFF 收到 `/capabilities`),authMiddleware + tenantContextMiddleware
- [X] T014 [US2] 修改前端 `src/utils/api.ts`,新增 harnessCapabilities 路径常量 `/api/bff/capabilities`
- [X] T015 [US2] 创建前端 useHarnessCapabilities hook,用 TanStack Query 调 GET /api/bff/capabilities,queryKey 含 tenantId(切换自动重新查询),返回 {data, isLoading, error, refetch},文件 `src/hooks/use-harness-capabilities.ts`
- [X] T016 [US2] 在前端路由/菜单配置中,按 useHarnessCapabilities 返回的 capabilities 条件渲染(canvas=false 隐藏画布入口,knowledgeBase=false 隐藏知识库菜单),文件 `src/features/{datasets,memories}/manifest.ts`(接入 ModuleContext.capabilities,空集合默认启用)

**Checkpoint**: US2 完成,前端按后端能力条件渲染,切换 tenant 自动调整

---

## Phase 5: User Story 3 - Admin 页面 UI (Priority: P2)

**Goal**: 前端 Admin 页面展示后端列表 + 新增/编辑/删除表单,双层校验,就绪状态展示

**Independent Test**: 运维访问 /admin/harness-backends,CRUD 操作可视化,表单校验即时反馈,删除被绑定后端显示冲突提示

### Tests for User Story 3 (Test-First)

- [X] T017 [P] [US3] 编写 harness-admin-service 单元测试,Mock fetch,验证 CRUD API 调用路径 + 请求体 + 响应解析,文件 `src/services/harness-admin-service.test.ts`

### Implementation for User Story 3

- [X] T018 [US3] 修改前端 `src/utils/api.ts`,新增 harnessAdmin 路径常量(`/api/bff/admin/harness-backends` 及其子路径)
- [X] T019 [US3] 创建前端 harness-admin-service,封装 CRUD API 调用(list/create/update/delete),文件 `src/services/harness-admin-service.ts`
- [X] T020 [US3] 创建 Admin 页面组件,用 Ant Design Table 展示后端列表(id/name/type/endpoint/capabilities 摘要/ready 状态/操作),文件 `src/pages/admin/harness-backends.tsx`(实际用 shadcn/ui Table + TanStack Table)
- [X] T021 [US3] 实现新增/编辑表单 Modal,用 Ant Design Form,字段 id(新增必填 kebab-case,编辑只读)/name/type(select)/endpoint/adminTokenEnvVar/capabilities(checkbox 组),前端校验规则与 BFF 一致,文件同 T020(实际用 react-hook-form + zod + shadcn/ui)
- [X] T022 [US3] 实现删除确认,被绑定后端(409 响应)显示冲突提示不关闭确认框,未绑定成功后列表刷新,文件同 T020(用 shadcn/ui Dialog 二次确认)
- [X] T023 [US3] 在前端路由配置注册 `/admin/harness-backends` 路由,文件 `src/routes.tsx`

**Checkpoint**: US3 完成,运维可通过 Admin 页面可视化 CRUD 后端配置

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 跨 Story 改进与验收

- [X] T024 [P] 运行 `cd bff && npm run type-check`,确认 TypeScript 编译零错误(SC-010)
- [X] T025 [P] 运行 `cd bff && npm test`,确认所有单元测试通过(SC-007, SC-009, SC-010)
- [X] T026 [P] 运行前端 `npx tsc --noEmit -p tsconfig.json`,确认前端 TypeScript 零错误
- [ ] T027 运行 quickstart.md 场景 1-10 全部验证,确认 SC-001/002/003/004/005/006/008 达成(⏳ 待真实 Intellect RAG 运行环境)
- [X] T028 [P] 更新 `docs/multi-harness-design.md`,标注 P2 实施完成状态
- [X] T029 [P] 更新 `specs/002-multi-harness-p1/tasks.md`,标注 P1 基础设施扩展(AdapterRegistry.invalidate / HarnessStore.listConfigs)已同步
- [ ] T030 验证 P0/P1 功能 100% 不回归(91 个现有测试 + P0 透传 + P1 Agent 原生路由冒烟)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖,立即开始
- **Foundational (Phase 2)**: 依赖 Setup,阻塞所有 User Story
- **US1 (Phase 3)**: 依赖 Foundational,MVP 优先
- **US2 (Phase 4)**: 依赖 US1(capabilities 路由需 AdapterRegistry,US1 扩展 invalidate 不阻塞但 US1 的 HarnessStore.listConfigs 不影响 US2)
- **US3 (Phase 5)**: 依赖 US1(Admin 页面调 harness-admin API,US1 实现)
- **Polish (Phase 6)**: 依赖所有 User Story 完成

### User Story Dependencies

- **US1 (P2, MVP)**: Foundational 完成后即可开始,无其他 Story 依赖
- **US2 (P2)**: 依赖 Foundational 的 AdapterRegistry(P1 已有,US2 直接用),不依赖 US1
- **US3 (P2)**: 依赖 US1 的 harness-admin API(前端调后端 API)

### Within Each User Story

- 测试先行(Test-First, Constitution Principle VII)
- 类型/校验 → 路由/hook → 页面 → 注册
- 单元测试通过后再跑冒烟测试

### Parallel Opportunities

- Phase 1: T001/T002 可并行(不同文件)
- Phase 2: T003/T004 可并行(不同文件,HarnessStore vs AdapterRegistry)
- US1 测试: T005/T006/T007 可并行(不同文件)
- US2 测试: T011 独立
- US3 测试: T017 独立
- Polish: T024/T025/T026/T028/T029 可并行

---

## Parallel Example: User Story 1

```bash
# 测试先行(不同文件可并行):
Task: "T005 AdapterRegistry.invalidate 单元测试"
Task: "T006 HarnessStore.listConfigs 单元测试"
Task: "T007 harness-admin 路由单元测试"

# 实现阶段:
Task: "T008 校验工具函数"
Task: "T009 harness-admin 路由(依赖 T008 校验)"
Task: "T010 注册路由(依赖 T009)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1: Setup(类型定义)
2. 完成 Phase 2: Foundational(invalidate + listConfigs)
3. 完成 Phase 3: User Story 1(harness-admin CRUD API)
4. **STOP and VALIDATE**: 跑 quickstart.md 场景 1-3/6/7,确认 CRUD API 可用
5. 可选:部署/演示 MVP(运维可用 curl 管理后端)

### Incremental Delivery

1. Setup + Foundational → 基础就绪
2. + US1 → 后端 CRUD API 可用,MVP
3. + US2 → 前端能力探测,条件渲染
4. + US3 → Admin 页面 UI,完整运维体验
5. Polish → 验收

### Parallel Team Strategy

- US1 完成后,US2(BFF capabilities + 前端 hook)与 US3(前端 Admin 页面)可并行(US3 依赖 US1 API,US2 不依赖 US1)

---

## Notes

- Constitution Principle VII(Test-First):每个 Story 的测试任务先于实现任务
- Constitution Token Security:T007/T009 必须验证响应不含 adminToken 明文
- Constitution Principle V:capabilities 路由按 tenant,Admin 路由非租户隔离
- P0/P1 基础设施扩展(T003/T004)必须保持向后兼容(91 个现有测试不回归)
- Vite rewrite 规则:前端 `/api/bff/admin/harness-backends` → BFF 收到 `/admin/harness-backends`(挂载点 `/api/bff` + 路由 `/admin/harness-backends`,或挂载点 `/` + 路由 `/admin/harness-backends`,后者与 P1 bff-agents 一致)
- commit 节奏:每个 Task 或逻辑分组后提交,US 完成后打 tag
