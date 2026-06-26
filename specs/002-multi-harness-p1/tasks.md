# Tasks: Multi-Harness P1 — IntellectRagAdapter 实现 + 路由原生迁移

**Input**: Design documents from `/specs/002-multi-harness-p1/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Constitution Principle VII 要求测试优先(Test-First),Adapter 核心层与 SSE 解析器必有单元测试,覆盖率 ≥ 80%。

**Organization**: 按 spec.md 的 3 个 User Story(US1/US2/US3)分阶段,US1 是 MVP。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行(不同文件,无依赖)
- **[Story]**: 所属 User Story(US1/US2/US3)
- 路径基于 plan.md Project Structure(bff/ 为 BFF,src/ 为前端)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: P1 前置准备,Constitution 修订与共享类型调整

- [X] T001 修订 Constitution v1.1.0 → v1.2.0,Principle IV 描述 Intellect RAG 双协议(canvas workflow + OpenAI 兼容),Principle III 边界澄清,更新 `.specify/memory/constitution.md`
- [X] T002 [P] 同步 P0 契约文件,调整 IHarnessAdapter session 方法签名(listSessions/getSession/deleteSession 新增 agentId),更新 `specs/001-multi-harness-p0/contracts/harness-adapter.ts` 与 `bff/src/types/adapter.ts`
- [X] T003 [P] 更新 `bff/src/types/stream.ts` 注释,反映 Canvas Workflow SSE 映射(workflow_started/message/message_end/workflow_finished → StreamChunk)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 共享基础设施,所有 User Story 依赖

**⚠️ CRITICAL**: 完成前禁止开始任何 User Story

- [X] T004 [P] 定义 TenantContext 中间件类型与 Hono context 注入 key,创建 `bff/src/types/tenant-context.ts`(若 P0 未创建)或确认 P0 已定义
- [X] T005 [P] 创建 AdapterRegistry 错误类型(TenantNotFoundError/BackendNotConfiguredError/AdapterFactoryNotRegisteredError/RegistryNotReadyError),文件 `bff/src/services/adapter-registry-errors.ts`
- [X] T006 [P] 定义 HarnessAdapterFactory 类型与 BackendType 注册表,文件 `bff/src/services/adapter-registry-types.ts`
- [X] T007 创建 IntellectRagAdapter 目录结构,`bff/src/services/adapters/intellect-rag/`(空目录 + README 占位说明命名规范)

**Checkpoint**: 基础设施就绪,可开始 User Story 实现

---

## Phase 3: User Story 1 - BFF Agent 路由迁移到 Adapter 原生调用 (Priority: P1) 🎯 MVP

**Goal**: Agent CRUD 路由从透明代理迁移到 IntellectRagAdapter 原生调用,前端零回归

**Independent Test**: 切换前端 `api.ts` 中 Agent 路径从 `proxy/v1/agents` 到 `bff/agents`,跑冒烟用例(列表→详情→创建→编辑→删除)全部通过,响应结构与透传模式一致

### Tests for User Story 1 (Test-First, Constitution Principle VII)

- [X] T008 [P] [US1] 编写 IntellectRagAdapter.listAgents/getAgent 单元测试,Mock fetch 验证调用 `${baseUrl}/agents`、注入 Authorization、404 抛错,文件 `bff/src/services/adapters/intellect-rag/intellect-rag-adapter.test.ts`
- [X] T009 [P] [US1] 编写 IntellectRagAdapter.createSession/listSessions/getSession/deleteSession 单元测试,Mock fetch 验证嵌套路径 `${baseUrl}/agents/{agentId}/sessions`、body 含 title、agentId 参数透传,文件同 T008
- [X] T010 [P] [US1] 编写 IntellectRagAdapter.healthCheck/discoverCapabilities 单元测试,验证 `/health` 探测与静态 capabilities 返回,文件同 T008

### Implementation for User Story 1

- [X] T011 [US1] 实现 IntellectRagAdapter 类骨架(构造函数接收 HarnessBackend,私有 baseUrl/adminToken/capabilities),文件 `bff/src/services/adapters/intellect-rag/intellect-rag-adapter.ts`
- [X] T012 [US1] 实现 IntellectRagAdapter.listAgents/getAgent 方法,调 `GET/GET {baseUrl}/agents[/{id}]`,注入 `Authorization: Bearer ${adminToken}`,**不**注入 X-Intellect-Team/X-Intellect-Project(Principle V),文件同 T011
- [X] T013 [US1] 实现 IntellectRagAdapter.createSession/listSessions/getSession/deleteSession 方法,调嵌套路径 `${baseUrl}/agents/{agentId}/sessions[/{sessionId}]`,文件同 T011
- [X] T014 [US1] 实现 IntellectRagAdapter.healthCheck/discoverCapabilities 方法,文件同 T011
- [X] T015 [US1] 实现 IntellectRagAdapter.sendMessage/cancelMessage stub(sendMessage 返回空 StreamIterable,P1 占位,US2 实现),文件同 T011
- [X] T016 [US1] 创建 BFF Agent 路由 `bff/src/routes/agents.ts`,实现 GET/POST/PUT/DELETE `/api/bff/agents[/{id}]`,内部通过 AdapterRegistry 获取 Adapter 并调用(Registry 占位:直接 new IntellectRagAdapter,US3 实现完整 Registry)
- [X] T017 [US1] 创建 BFF Agent Session 路由 `bff/src/routes/agent-sessions.ts`,实现 GET/POST/DELETE `/api/bff/agents/{agentId}/sessions[/{sessionId}]`,调 Adapter 对应方法
- [X] T018 [US1] 在 `bff/src/index.ts` 注册 Agent 路由,挂载到 `/api/bff/agents`
- [X] T019 [US1] 修改前端 `src/utils/api.ts`,将 Agent 相关路径常量从 `${restAPIv1}/agents` 改为 `/api/bff/agents`(单点改动,Constitution Principle I)
- [X] T020 [US1] 验证 P0 透明代理路由 `/api/bff/proxy/v1/agents/*` 保留且仍可访问(SC-006 零回归)

**Checkpoint**: US1 完成,Agent CRUD 经 Adapter 调用,前端零回归

---

## Phase 4: User Story 2 - OpenAI SSE 解析器 + 流式消息 Adapter (Priority: P2)

**Goal**: 实现 parseCanvasWorkflowSSE 解析器,IntellectRagAdapter.sendMessage 返回 StreamChunk 流,BFF 流式路由透传 SSE

**Independent Test**: 前端发起流式对话 `POST /api/bff/agents/chat/completions`,BFF 通过 Adapter.sendMessage 获取 StreamChunk 流并透传 SSE,前端收到与透传模式一致的 `data: {...}` 事件流,对话内容完整,流正常终止

### Tests for User Story 2 (Test-First)

- [X] T021 [P] [US2] 编写 parseCanvasWorkflowSSE 契约测试,使用录制 SSE fixture(canvas.py 实际事件序列),验证 5 种映射(message→delta、start_to_think→reasoning、message_end→delta+reference metadata、workflow_finished→done、error→error),文件 `bff/src/services/adapters/intellect-rag/parse-canvas-workflow-sse.test.ts`
- [X] T022 [P] [US2] 创建 SSE fixture 文件,录制 Intellect RAG `/api/v1/agents/chat/completions` 实际响应(workflow_started→message×N→message_end→workflow_finished),文件 `bff/src/services/adapters/intellect-rag/__fixtures__/canvas-workflow-sse.txt`

### Implementation for User Story 2

- [X] T023 [US2] 实现 parseCanvasWorkflowSSE 纯函数,输入 ReadableStream<Uint8Array>,用 TextDecoderStream + EventSourceParserStream 解析 SSE 帧,按 contracts/canvas-workflow-sse-mapping.ts 规则映射到 StreamChunk,输出 AsyncIterable<StreamChunk>,文件 `bff/src/services/adapters/intellect-rag/parse-canvas-workflow-sse.ts`
- [X] T024 [US2] 实现 IntellectRagAdapter.sendMessage 方法,调 `POST {baseUrl}/agents/chat/completions`,返回 parseCanvasWorkflowSSE(response.body),文件 `bff/src/services/adapters/intellect-rag/intellect-rag-adapter.ts`(替换 T015 stub)
- [X] T025 [US2] 实现 IntellectRagAdapter.cancelMessage 方法,调 Intellect RAG 取消端点(若存在,否则返回 Promise.resolve),文件同 T024
- [X] T026 [US2] 创建 BFF 流式路由 `bff/src/routes/agent-chat.ts`,实现 POST `/api/bff/agents/chat/completions`,用 for-await-of 消费 adapter.sendMessage() 迭代器,逐 chunk 序列化为 SSE 事件透传前端
- [X] T027 [US2] 在 `bff/src/index.ts` 注册流式路由,挂载到 `/api/bff/agents/chat/completions`
- [X] T028 [US2] 修改前端 `src/utils/api.ts`,将 agentChatCompletion 路径从 `${restAPIv1}/agents/chat/completions` 改为 `/api/bff/agents/chat/completions`

**Checkpoint**: US2 完成,流式对话经 Adapter + parseCanvasWorkflowSSE,前端零回归

---

## Phase 5: User Story 3 - AdapterRegistry + TenantContext 中间件 (Priority: P3)

**Goal**: 实现 AdapterRegistry 按 tenantId 选择 Adapter,TenantContext 中间件注入租户上下文,替换 US1/US2 的占位 Registry

**Independent Test**: BFF 启动时初始化 AdapterRegistry,前端请求带 `X-Tenant-Id` header,中间件构造 TenantContext,Agent 路由通过 registry.getAdapterForTenant(tenantId) 获取 Adapter,返回与 US1 一致结果

### Tests for User Story 3 (Test-First)

- [X] T029 [P] [US3] 编写 AdapterRegistry 单元测试,Mock HarnessStore + TenantStore,验证:getAdapterForTenant 复用 Adapter 实例(`===`)、tenantId 不存在抛 TenantNotFoundError、backendId 不存在抛 BackendNotConfiguredError、Store 未就绪抛 RegistryNotReadyError,文件 `bff/src/services/adapter-registry.test.ts`
- [X] T030 [P] [US3] 编写 TenantContext 中间件单元测试,验证:提取 X-Tenant-Id/X-User-Id header、缺失 X-Tenant-Id 返回 400、合法时注入 c.set('tenantContext', ctx),文件 `bff/src/middlewares/tenant-context.test.ts`

### Implementation for User Story 3

- [X] T031 [US3] 实现 AdapterRegistry 类,依赖 HarnessStore + TenantStore,维护 adapterCache(Map<backendId, IHarnessAdapter>)与 factories(Map<BackendType, HarnessAdapterFactory>),文件 `bff/src/services/adapter-registry.ts`
- [X] T032 [US3] 实现 AdapterRegistry.getAdapterForTenant(tenantId) 方法,查 TenantStore → intellectBackendId → HarnessStore → backend → 创建/复用 Adapter,文件同 T031
- [X] T033 [US3] 实现 AdapterRegistry.getAdapterForBackend(backendId) 方法(用于 canvas 硬绑定场景,Principle III),文件同 T031
- [X] T034 [US3] 实现 AdapterRegistry.registerFactory(backendType, factory) 与 isReady() 方法,文件同 T031
  - **P2 扩展**(2026-06-26):新增 `invalidate(backendId?: string): void` 方法,支持热加载缓存失效。不传参清空整个 adapterCache,传 backendId 只移除该条目。详见 [specs/003-harness-admin-capabilities/tasks.md](../003-harness-admin-capabilities/tasks.md) T004/T005。
- [X] T035 [US3] 实现 TenantContext 中间件,从 X-Tenant-Id/X-User-Id header 构造 TenantContext,注入 Hono context,缺失 tenantId 返回 400,文件 `bff/src/middlewares/tenant-context.ts`
- [X] T036 [US3] 在 `bff/src/index.ts` 初始化 AdapterRegistry(load HarnessStore + TenantStore,registerFactory('intellect-rag', IntellectRagAdapterFactory)),挂载 TenantContext 中间件到 `/api/bff/agents/*` 路由
- [X] T037 [US3] 重构 US1/US2 的 Agent 路由,从占位 Registry(直接 new IntellectRagAdapter)改为通过 c.get('tenantContext') + registry.getAdapterForTenant(ctx.tenantId) 获取 Adapter,文件 `bff/src/routes/agents.ts`、`bff/src/routes/agent-sessions.ts`、`bff/src/routes/agent-chat.ts`

**Checkpoint**: US3 完成,多后端选择基础设施就绪,P3 企业版接入时路由层零改动

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 跨 Story 改进与验收

- [X] T038 [P] 运行 `cd bff && npm run type-check`,确认 TypeScript 编译零错误(SC-008)
- [X] T039 [P] 运行 `cd bff && npm test`,确认所有单元测试通过(SC-004, SC-005, SC-008)
- [X] T040 运行 quickstart.md 场景 1-8 全部验证,确认 SC-001/002/003/006/007 达成
- [X] T041 [P] 更新 `docs/multi-harness-design.md`,标注 P1 实施完成状态与 Constitution v1.2.0 修订点
- [X] T042 [P] 更新 `specs/001-multi-harness-p0/tasks.md`,标注 P0 契约调整(session 方法签名)已同步
- [X] T043 验证 P0 透明代理路由 100% 不回归,跑 P0 冒烟用例(Dataset/KB/Search/Memory/MCP + Agent DSL 编辑)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖,立即开始
- **Foundational (Phase 2)**: 依赖 Setup 完成,阻塞所有 User Story
- **US1 (Phase 3)**: 依赖 Foundational,MVP 优先
- **US2 (Phase 4)**: 依赖 US1 完成(Adapter 类骨架在 US1 创建,US2 实现 sendMessage)
- **US3 (Phase 5)**: 依赖 US1+US2 完成(Registry 替换 US1/US2 占位)
- **Polish (Phase 6)**: 依赖所有 User Story 完成

### User Story Dependencies

- **US1 (P1, MVP)**: Foundational 完成后即可开始,无其他 Story 依赖
- **US2 (P2)**: 依赖 US1 的 IntellectRagAdapter 类骨架(T011)与 sendMessage stub(T015)
- **US3 (P3)**: 依赖 US1/US2 的路由实现(T016/T017/T026),Registry 替换占位

### Within Each User Story

- 测试先行(Test-First, Constitution Principle VII):测试编写并失败后再实现
- 类型/错误定义 → Adapter 方法 → 路由 → 前端路径切换
- 单元测试通过后再跑冒烟测试

### Parallel Opportunities

- Phase 1: T002/T003 可并行(不同文件)
- Phase 2: T004/T005/T006/T007 可并行(不同文件)
- US1 测试: T008/T009/T010 可并行(同文件不同 describe,建议串行避免冲突)
- US1 实现: T012/T013/T014 串行(同文件),T016/T017 可并行(不同路由文件)
- US2 测试: T021/T022 可并行
- US3 测试: T029/T030 可并行(不同文件)
- Polish: T038/T039/T041/T042 可并行

---

## Parallel Example: User Story 1

```bash
# 测试先行(同文件建议串行,但逻辑独立):
Task: "T008 IntellectRagAdapter.listAgents/getAgent 单元测试"
Task: "T009 IntellectRagAdapter.session 方法单元测试"
Task: "T010 IntellectRagAdapter.healthCheck/discoverCapabilities 单元测试"

# 实现阶段可并行(不同路由文件):
Task: "T016 BFF Agent 路由 bff/src/routes/agents.ts"
Task: "T017 BFF Agent Session 路由 bff/src/routes/agent-sessions.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1: Setup(Constitution 修订 + 契约调整)
2. 完成 Phase 2: Foundational(共享类型)
3. 完成 Phase 3: User Story 1(Agent CRUD 经 Adapter)
4. **STOP and VALIDATE**: 跑 quickstart.md 场景 4/5/7/8,确认 Agent CRUD 零回归
5. 可选:部署/演示 MVP

### Incremental Delivery

1. Setup + Foundational → 基础就绪
2. + US1 → Agent CRUD 经 Adapter,MVP 可用
3. + US2 → 流式对话经 Adapter + SSE 解析器,完整 Agent 体验
4. + US3 → Registry + 多租户中间件,P3 企业版接入基础就绪
5. Polish → 验收,Constitution v1.2.0 同步

### Parallel Team Strategy

- 单人串行: US1 → US2 → US3(依赖链强制)
- 多人并行: US1 完成后,US2(Adapter.sendMessage)与 US3(Registry)可并行(US3 不依赖 US2 的 sendMessage,仅依赖路由文件存在)

---

## Notes

- Constitution Principle VII(Test-First):每个 Story 的测试任务先于实现任务
- Constitution Principle I(前端零回归):T019/T028 是前端唯一改动点(路径常量)
- Constitution Principle III(Canvas Hard-Bound):Agent DSL 编辑路由保留透传,T020 验证不回归
- Constitution Principle V(单租户):IntellectRagAdapter 不注入 X-Intellect-Team 头,T012 验证
- Constitution v1.2.0 修订(T001)是 P1 前置,确保后续实施不基于错误描述
- commit 节奏:每个 Task 或逻辑分组后提交,US 完成后打 tag
