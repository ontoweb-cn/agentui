---

description: "Task list for Multi-Harness P0 implementation"
---

# Tasks: Multi-Harness P0 — BFF 接入点 + Adapter 骨架

> **P1 同步说明**(2026-06-26,Constitution v1.2.0):P1 实施时调整了 P0 契约 `IHarnessAdapter` 的 session 方法签名(`listSessions`/`getSession`/`deleteSession` 新增 `agentId` 参数,适配 Intellect RAG 嵌套结构)。权威源 `specs/001-multi-harness-p0/contracts/harness-adapter.ts` 与运行时 `bff/src/types/adapter.ts` 已同步更新。详见 [P1 research.md R3](../002-multi-harness-p1/research.md)。

**Input**: Design documents from `/specs/001-multi-harness-p0/`

**Prerequisites**:
- [plan.md](./plan.md) (required) — tech stack, structure, constitution check
- [spec.md](./spec.md) (required) — 3 user stories (P1/P2/P3)
- [research.md](./research.md) — 7 technical decisions
- [data-model.md](./data-model.md) — 9 entities
- [contracts/](./contracts/) — 7 TypeScript contract files
- [quickstart.md](./quickstart.md) — 7 validation scenarios
- [.specify/memory/constitution.md](../../.specify/memory/constitution.md) v1.1.0 — NON-NEGOTIABLE principles (含 Principle VIII BFF ↔ Intellect Enterprise Access Contract)

**Tests**: P0 不引入 BFF 测试框架(Constitution Principle VII YAGNI 例外,见 [research.md](./research.md) §4)。验证手段为 `tsc --noEmit` + 手工冒烟(见 [quickstart.md](./quickstart.md))。Vitest 引入留待 P1。

**Organization**: Tasks grouped by user story. US1 (P1) = BFF 反向代理(MVP);US2 (P2) = Adapter 契约验证;US3 (P3) = 存储层。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3(map to spec.md user stories)
- All paths relative to repo root `/Users/simon/project/agentui/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 创建运行时目录、复制契约文件到 bff/src/types/、初始化默认 JSON 配置、更新环境变量样例

- [X] T001 [P] 创建 BFF 数据目录 `bff/data/`(若不存在)
- [X] T002 [P] 复制契约文件从 `specs/001-multi-harness-p0/contracts/` 到 `bff/src/types/`:
  - `contracts/harness-backend.ts` → `bff/src/types/harness.ts`
  - `contracts/stream-chunk.ts` → `bff/src/types/stream.ts`
  - `contracts/tenant-context.ts` → `bff/src/types/tenant.ts`
  - `contracts/domain-models.ts` → `bff/src/types/domain.ts`
  - `contracts/harness-adapter.ts` → `bff/src/types/adapter.ts`(覆盖,与 multi-tenant-adapter 合并)
  - `contracts/multi-tenant-adapter.ts` → 追加到 `bff/src/types/adapter.ts`
  - `contracts/stores.ts` → `bff/src/types/stores.ts`
  - 每个文件顶部加注释 `// @see specs/001-multi-harness-p0/contracts/<original>.ts (authority source)`
- [X] T003 [P] 创建 BFF 类型 barrel export `bff/src/types/index.ts`,re-export 所有类型
- [X] T004 [P] 更新 `.env.example`:新增三个环境变量样例(参考 [research.md](./research.md) §8 与 spec FR-028,Constitution Principle VIII v1.1.0):
  ```
  HARNESS_INTELLECT_RAG_ADMIN_TOKEN=
  HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY=
  VITE_BFF_BASE=/api/bff
  ```
- [X] T005 创建默认后端配置文件 `bff/data/harness-backends.json`(参考 [quickstart.md](./quickstart.md) Scenario 5 的 JSON 样例):
  - 含一个默认 Intellect RAG 后端条目(id=`intellect-rag-default`,endpoint=`http://localhost:9380`,adminTokenEnvVar=`HARNESS_INTELLECT_RAG_ADMIN_TOKEN`,capabilities: canvas=true/knowledgeBase=true/memory=true/multiTenant=false/defaultForTenant=true)
  - **不含 token 明文**(Constitution Token 安全约束)
- [X] T006 [P] 创建空租户配置文件 `bff/data/bff-tenants.json`:`{"tenants":[]}`(P0 不预置 Tenant,留待 P2 Admin 页面或手工编辑)

**Checkpoint**: 目录与契约文件就位。运行 `cd bff && npm run type-check` 应零错误(契约文件独立编译通过,SC-004)。

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 无额外 foundational 任务。Phase 1 的契约文件复制即为 foundational(所有 US 都依赖契约类型)。

**⚠️ CRITICAL**: Phase 1 必须完成且 `tsc --noEmit` 通过,才能启动 Phase 3+。

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel。

---

## Phase 3: User Story 1 - BFF 反向代理接入点 (Priority: P1) 🎯 MVP

**Goal**: 新增 `/api/bff/proxy/v1/*` catch-all 路由,透传到 Intellect RAG `/api/v1/*`,前端只改一个常量即可全部流量经 BFF;支持瞬时回滚。

**Independent Test** (对应 [quickstart.md](./quickstart.md) Scenario 1 & 2):
- 切换 `src/utils/api.ts` 中 `restAPIv1` 常量后,跑冒烟用例(登录→Agent→Session→流式对话→画布→知识库→Admin)全部通过
- 未授权请求返回 401,不透传到后端
- 改回常量瞬时回滚

### Implementation for User Story 1

- [X] T010 [US1] 在 `bff/src/services/intellect-client.ts` 新增 `proxy(path, req)` 透明代理方法(参考 [research.md](./research.md) §1):
  - 接收 `path: string`(已剥离 `/api/bff/proxy/v1` 前缀的相对路径,如 `agents`)与 Hono `Request` 或 `{ method, headers, body, query }`
  - 用 fetch 转发到 `${INTELLECT_RAG_ENDPOINT}/api/v1/${path}?${query}`,透传 method/headers(含 Authorization)/body
  - 返回 fetch `Response` 原样(不调用 `.json()` / `.text()`,保留 `body` ReadableStream 用于 SSE 透传)
  - 不重复注入 admin token(透传前端 Authorization 即可,避免双重鉴权)
  - 错误时返回明确错误(不吞异常)
- [X] T011 [US1] 创建 `bff/src/routes/proxy.ts`(参考 [research.md](./research.md) §1 §2):
  - 用 Hono catch-all `app.all('/api/bff/proxy/v1/*', handler)`
  - handler 内:校验 authMiddleware 已通过(未授权返回 401,不进入 proxy 逻辑)
  - 提取相对路径(剥离 `/api/bff/proxy/v1/` 前缀)
  - 调用 `intellectClient.proxy(relativePath, c.req)` 获取上游 Response
  - 构造 BFF Response:status/headers 透传,Content-Type 保持上游值(尤其 `text/event-stream` 不改),body 直接用上游 `Response.body` ReadableStream(不缓冲)
  - 每条请求记录日志(method/path/status/耗时,SC-003)
- [X] T012 [US1] 在 `bff/src/index.ts` 挂载 proxy 路由:
  - 在 `authMiddleware` 之后注册 `app.route('/api/bff', proxyRoutes)`
  - **不删除/不改动**现有 `agentRoutes` / `sessionRoutes` / `adminRoutes` / `healthRoutes` 挂载(SC-009 回归约束)
- [X] T013 [US1] 修改 `vite.config.ts`:新增 `/api/bff` proxy 规则指向 `http://localhost:9390`(BFF 端口):
  - **保留**现有 `/api/v1` 旧 proxy 规则(指向 Intellect RAG 9380)用于回滚(FR-006)
  - 新规则 `'/api/bff': { target: 'http://localhost:9390', changeOrigin: true, ws: true }`(ws: true 支持 SSE/WebSocket)
- [X] T014 [US1] 修改 `src/utils/api.ts`:将 `restAPIv1` 常量从 `/api/v1` 改为 `/api/bff/proxy/v1`(单行改动,FR-005):
  - 不改动任何其他业务代码
  - 改回 `/api/v1` 即可瞬时回滚(FR-006)

**Checkpoint** (对应 [quickstart.md](./quickstart.md) Scenario 1, 2, 7):
- `cd bff && npm run type-check` 零错误
- `npm run type-check`(根目录)零错误
- 启动 `npm run dev:all`,跑冒烟用例全部通过
- curl 未授权请求返回 401
- 改回 `restAPIv1 = '/api/v1'`,功能瞬时恢复

---

## Phase 4: User Story 2 - Adapter 契约验证 (Priority: P2)

**Goal**: 验证 `IHarnessAdapter` / `IMultiTenantAdapter` 契约可被实现,`StreamChunk` 覆盖两后端所有事件。

**Independent Test** (对应 [quickstart.md](./quickstart.md) Scenario 3 & 4):
- 契约文件独立编译通过(已在 Phase 1 验证)
- 用契约写一个 mock adapter 能通过类型检查(无需修改契约)
- `StreamChunk` 8 个 type 值覆盖两后端所有事件(Constitution Principle IV v1.1.0)

### Implementation for User Story 2

- [X] T020 [P] [US2] 创建临时 mock adapter 验证契约可实现(参考 [quickstart.md](./quickstart.md) Scenario 3 Step 3):
  - 创建 `bff/src/services/adapters/mock-adapter.ts`(仅用于类型验证,P0 完成后删除)
  - 实现 `IHarnessAdapter` 接口所有必选方法(方法体可抛 `throw new Error('not impl')`)
  - 验证 `cd bff && npm run type-check` 零错误(证明契约可被实现,无需修改契约,SC-004)
- [X] T021 [P] [US2] 创建临时 mock 多租户 adapter 验证 `IMultiTenantAdapter` 契约:
  - 在 `bff/src/services/adapters/mock-multi-tenant-adapter.ts` 实现 `IMultiTenantAdapter`(继承 mock-adapter + 实现 Team/Project 方法)
  - 验证 `cd bff && npm run type-check` 零错误
- [X] T022 [US2] 验证 `StreamChunk` 8 个 type 覆盖两后端所有事件(参考 [quickstart.md](./quickstart.md) Scenario 4,Constitution Principle IV v1.1.0):
  - 在 mock-adapter 的 `sendMessage` 中,临时构造并 yield 各类型 chunk:
    - `{ type: 'delta', content: 'x' }`(Intellect RAG `choices[0].delta.content` + 企业版 `assistant.delta`)
    - `{ type: 'reasoning', content: 'x' }`(企业版 `tool.progress`(`tool_name="_thinking"`);
      Intellect RAG `reasoning_content` 可选扩展)
    - `{ type: 'tool_start', toolName: 'x', toolCallId: 'x' }`(企业版 `tool.started`,P3 启用)
    - `{ type: 'tool_complete', toolCallId: 'x' }`(企业版 `tool.completed`,P3 启用)
    - `{ type: 'tool_progress', toolName: 'x', content: 'x' }`(企业版 `tool.progress` 非 `_thinking`,P3 启用)
    - `{ type: 'usage', usage: { promptTokens: 1, completionTokens: 1 } }`(企业版 `run.completed.data.usage` + Intellect RAG `usage` 字段)
    - `{ type: 'done' }`(Intellect RAG `data: [DONE]` + 企业版 `event: done`)
    - `{ type: 'error', message: 'x' }`(任意后端错误;企业版 `event: error` 或 `tool.failed`)
  - 验证 TypeScript 编译零错误(证明 8 个 type 全部可构造,SC-005)
- [X] T023 [US2] 删除 mock adapter 文件(`mock-adapter.ts` / `mock-multi-tenant-adapter.ts`):
  - 验证删除后 `cd bff && npm run type-check` 仍零错误(契约文件本身独立可编译)

**Checkpoint** (对应 [quickstart.md](./quickstart.md) Scenario 3, 4):
- 契约可被实现,无需修改契约
- `StreamChunk` 8 个 type 全部可构造
- mock adapter 删除后,契约文件独立编译通过

---

## Phase 5: User Story 3 - 后端配置与租户绑定存储 (Priority: P3)

**Goal**: 实现 `HarnessStore`(从 JSON + env 加载后端) + `TenantStore`(维护 BffTenant ↔ Backend 绑定),为 P1 `AdapterRegistry.getAdapterForTenant()` 提供数据基础。

**Independent Test** (对应 [quickstart.md](./quickstart.md) Scenario 5 & 6):
- BFF 启动时 `HarnessStore.load()` 加载默认 Intellect RAG 后端,token 从 env 读取
- JSON 文件零 token 明文
- env 缺失时 BFF 不崩溃,只告警并跳过该后端
- 一个 BFF Tenant 能同时绑定主后端 + 画布后端,分别查询
- 画布后端类型校验生效(必须是 `intellect-rag`)
- 现有 BFF 路由行为 100% 不回归(存储层不挂载路由)

### Implementation for User Story 3

- [X] T030 [P] [US3] 实现 `bff/src/services/harness-store.ts`(参考 [contracts/stores.ts](./contracts/stores.ts) `HarnessStore` 接口 + [research.md](./research.md) §3 + [data-model.md](./data-model.md) HarnessBackend/HarnessBackendConfig):
  - 类 `JSONFileHarnessStore implements HarnessStore`
  - `load()`:读 `bff/data/harness-backends.json` → 对每条 `HarnessBackendConfig` 读 `process.env[adminTokenEnvVar]` → 合并为 `HarnessBackend`(含 adminToken)→ 存内存数组
    - env 缺失:跳过该后端,console.warn 输出告警(FR-023),不抛异常
    - 重复 ID:后写入覆盖先写入,console.warn 告警
    - JSON 文件不存在:返回空数组,不报错([spec.md](./spec.md) Edge Cases)
  - `list()`:返回内存 `HarnessBackend[]`
  - `get(id)`:返回 `HarnessBackend | undefined`
  - `saveConfig(config)`:写回 `bff/data/harness-backends.json`(只写 `HarnessBackendConfig[]`,**不含 token**)
  - 用 Zod 校验 JSON 结构(`bff/package.json` 已有 zod ^3.23.8)
  - **P2 扩展**(2026-06-26):新增 `listConfigs(): HarnessBackendConfig[]` 方法,返回所有配置(含未就绪的,不带 token 明文),供 Admin CRUD 接口使用。新增 `deleteConfig(id)`、`getConfig(id)` 辅助方法。详见 [specs/003-harness-admin-capabilities/tasks.md](../003-harness-admin-capabilities/tasks.md) T006/T007。
- [X] T031 [P] [US3] 实现 `bff/src/services/tenant-store.ts`(参考 [contracts/stores.ts](./contracts/stores.ts) `TenantStore` 接口 + [research.md](./research.md) §6 + [data-model.md](./data-model.md) BffTenant):
  - 类 `JSONFileTenantStore implements TenantStore`
  - 构造函数接收 `HarnessStore` 引用(用于校验 backendId 存在性 + 类型)
  - `load()`:读 `bff/data/bff-tenants.json` → 校验每个 `BffTenant.intellectBackendId` 在 HarnessStore 中存在 → 校验 `canvasBackendId`(若设置)对应 backend.type === 'intellect-rag'(Constitution Principle III)→ 存内存数组
    - 校验失败:抛出明确错误(不静默,[spec.md](./spec.md) Edge Cases)
    - JSON 不存在:返回空数组
  - `createTenant(name, intellectBackendId, intellectTenantId?)`:校验 backendId 存在 → 创建 BffTenant(id 用 uuid,createdAt/updatedAt 用 ISO 8601)→ 写回 JSON → 返回
  - `getTenant(tenantId)` / `listTenants()`:返回内存对象
  - `setHarnessBinding(tenantId, backendId)`:校验 tenantId 存在 + backendId 在 HarnessStore 存在 → 更新 tenant.intellectBackendId + updatedAt → 写回 JSON
  - `getHarnessBinding(tenantId)`:返回 `tenant.intellectBackendId`
  - `setCanvasBinding(tenantId, backendId)`:校验 tenantId 存在 + backendId 在 HarnessStore 存在 + **对应 backend.type === 'intellect-rag'**(Constitution Principle III)→ 更新 tenant.canvasBackendId + updatedAt → 写回 JSON。类型不符抛错
  - `getCanvasBinding(tenantId)`:返回 `tenant.canvasBackendId`
  - 用 Zod 校验 JSON 结构
- [X] T032 [US3] 在 `bff/src/index.ts` 启动时初始化 Store 并调用 load():
  - 在现有路由挂载之前(启动早期)实例化 `JSONFileHarnessStore` 与 `JSONFileTenantStore`
  - 调用 `harnessStore.load()` 与 `tenantStore.load()`(await)
  - 将 store 实例存到 Hono context(`app.use('*', async (c, next) => { c.set('harnessStore', harnessStore); c.set('tenantStore', tenantStore); await next(); })`)
  - **不挂载任何新路由**(存储层是基础设施,P1 Registry 才消费)
  - **不影响现有路由行为**(SC-009)
- [X] T033 [US3] 验证 env 缺失场景(对应 [quickstart.md](./quickstart.md) Scenario 5 "Env Missing Behavior"):
  - 临时删除 `.env` 中 `HARNESS_INTELLECT_RAG_ADMIN_TOKEN`
  - 重启 BFF,应输出告警"Backend intellect-rag-default skipped: env var HARNESS_INTELLECT_RAG_ADMIN_TOKEN not set"
  - BFF 应正常启动(不崩溃),`HarnessStore.list()` 返回空数组
  - 恢复 `.env`,重启 BFF,应正常加载
- [X] T034 [US3] 验证 TenantStore 绑定与画布类型校验(对应 [quickstart.md](./quickstart.md) Scenario 6):
  - 手工编辑 `bff/data/bff-tenants.json` 加入一个 demo tenant(intellectBackendId=intellect-rag-default,canvasBackendId=intellect-rag-default)
  - 重启 BFF,`tenantStore.getHarnessBinding('tenant-demo')` 应返回 `'intellect-rag-default'`,`getCanvasBinding('tenant-demo')` 应返回 `'intellect-rag-default'`
  - 临时把 canvasBackendId 改为一个不存在的 backendId 或 intellect-enterprise 类型 → 重启 BFF 应抛错
  - 恢复正确配置

**Checkpoint** (对应 [quickstart.md](./quickstart.md) Scenario 5, 6, 7):
- `cd bff && npm run type-check` 零错误
- BFF 启动加载默认后端,JSON 无明文 token(grep 扫描验证)
- env 缺失不崩溃
- Tenant 绑定主/画布独立查询,画布类型校验生效
- 现有路由行为 100% 不回归

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 端到端验证,确保 P0 全部 Success Criteria 达成

- [X] T040 [P] 运行 [quickstart.md](./quickstart.md) 全部 7 个 Scenario,记录结果
- [X] T041 [P] 运行 `cd bff && npm run type-check` 与根目录 `npm run type-check`,确认零错误(SC-010)
- [X] T042 扫描 `bff/data/harness-backends.json` 与 `bff/data/bff-tenants.json` 无 token 明文:
  - `grep -iE 'token|secret|password|key' bff/data/*.json` 只应输出字段名 `adminTokenEnvVar`,无明文值(SC-007)
- [X] T043 [P] 验证现有 BFF 路由无回归(对应 [quickstart.md](./quickstart.md) Scenario 7):
  - 直接访问 `/api/agent/list`、`/api/session/list`、`/api/health` 等现有路由
  - 行为应与 P0 实施前完全一致(SC-009)
- [X] T044 检查 `.gitignore` 含 `.env` 条目(Constitution Token 安全约束)
- [X] T045 [P] 更新 `docs/multi-harness-design.md` §10.1 P0 任务表,标记 P0-前置与 P0 任务为"已完成",引用本 tasks.md
- [X] T046 提交 PR,描述引用 Constitution v1.1.0 Principle I/II/IV/V/VII/VIII,附 quickstart.md 7 个 Scenario 验证结果

**Checkpoint**: P0 验收完成,可进入 P1(IntellectRagAdapter 实现 + Vitest 引入)。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖,立即开始
- **Phase 2 (Foundational)**: Phase 1 完成即就绪(无额外任务)
- **Phase 3 (US1, P1, MVP)**: 依赖 Phase 1(契约类型已就位)
- **Phase 4 (US2, P2)**: 依赖 Phase 1(契约类型已就位)。可与 US1 并行
- **Phase 5 (US3, P3)**: 依赖 Phase 1(契约类型)+ T005(默认 harness-backends.json)。可与 US1/US2 并行
- **Phase 6 (Polish)**: 依赖 Phase 3 + 4 + 5 全部完成

### User Story Dependencies

- **US1 (BFF 反向代理)**: 仅依赖契约类型(Phase 1)。独立可测
- **US2 (Adapter 契约验证)**: 仅依赖契约类型(Phase 1)。独立可测,与 US1 并行
- **US3 (存储层)**: 依赖契约类型(Phase 1)+ T005 默认 JSON。独立可测,与 US1/US2 并行

### Within Each User Story

- 契约文件先复制(Phase 1),再实现消费方(Phase 3/4/5)
- US1: intellect-client.ts 方法 → proxy.ts 路由 → index.ts 挂载 → vite.config.ts → api.ts(顺序依赖)
- US2: mock adapter 创建 → 类型检查 → 删除(顺序依赖)
- US3: harness-store.ts → tenant-store.ts(依赖 harness-store 校验)→ index.ts 初始化 → 验证(顺序依赖)

### Parallel Opportunities

- Phase 1: T001/T002/T003/T004/T006 可并行(T005 串行,因 T033 依赖它)
- Phase 3 (US1) + Phase 4 (US2) + Phase 5 (US3): 三个 user story 可并行(不同文件,无跨 story 依赖)
- Phase 5 内部: T030 (harness-store) 与 T031 (tenant-store) 可并行启动,但 T031 需 T030 接口定义完成才能实现校验逻辑
- Phase 6: T040/T041/T043/T045 可并行

---

## Parallel Example: Three User Stories

```bash
# Once Phase 1 (Setup) completes, launch three user stories in parallel:

# Developer A — US1 (BFF 反向代理, MVP):
Task: T010 "在 bff/src/services/intellect-client.ts 新增 proxy(path, req) 透明代理方法"
Task: T011 "创建 bff/src/routes/proxy.ts catch-all 路由"
Task: T012 "在 bff/src/index.ts 挂载 proxy 路由"
Task: T013 "修改 vite.config.ts 新增 /api/bff proxy 规则"
Task: T014 "修改 src/utils/api.ts restAPIv1 常量"

# Developer B — US2 (Adapter 契约验证):
Task: T020 "创建临时 mock adapter 验证契约可实现"
Task: T021 "创建临时 mock 多租户 adapter 验证 IMultiTenantAdapter 契约"
Task: T022 "验证 StreamChunk 8 个 type 覆盖两后端所有事件"
Task: T023 "删除 mock adapter 文件"

# Developer C — US3 (存储层):
Task: T030 "实现 bff/src/services/harness-store.ts"
Task: T031 "实现 bff/src/services/tenant-store.ts"
Task: T032 "在 bff/src/index.ts 启动时初始化 Store 并调用 load()"
Task: T033 "验证 env 缺失场景"
Task: T034 "验证 TenantStore 绑定与画布类型校验"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup(契约文件复制 + 默认 JSON + .env.example)
2. Complete Phase 3: User Story 1(BFF 反向代理)
3. **STOP and VALIDATE**: 跑 [quickstart.md](./quickstart.md) Scenario 1, 2, 7
4. 此时前端所有流量已经 BFF,Constitution Principle I 达成,可演示/部署

### Incremental Delivery

1. Phase 1 Setup → 契约就位,tsc 通过
2. Phase 3 US1 → 前端流量经 BFF,可演示(MVP!)
3. Phase 4 US2 → 契约可被实现,P1/P3 实现者有明确契约
4. Phase 5 US3 → 存储层就绪,P1 Registry 有数据基础
5. Phase 6 Polish → 端到端验证,SC-001~010 全部达成
6. 进入 P1(IntellectRagAdapter 实现 + Vitest 引入)

### Single Developer Strategy(推荐)

按 Phase 顺序串行执行:
1. Phase 1(约 30 分钟,目录 + 复制 + JSON + .env)
2. Phase 3 US1(核心,跑冒烟验证)
3. Phase 4 US2(快速,类型检查 + 删除 mock)
4. Phase 5 US3(存储层,验证 env 缺失 + 绑定校验)
5. Phase 6 Polish(端到端验证 + PR)

---

## Notes

- P0 不引入 Vitest(Constitution Principle VII YAGNI 例外,见 [research.md](./research.md) §4)
- 所有验证通过 `tsc --noEmit` + 手工冒烟([quickstart.md](./quickstart.md))
- 现有 BFF 路由(agent/session/admin/health)100% 不回归是硬约束(SC-009)
- 契约文件权威源在 `specs/001-multi-harness-p0/contracts/`,运行时复制到 `bff/src/types/`(见 [research.md](./research.md) §7)
- 任何修改契约的 PR 必须先改 `specs/` 权威源,再同步 `bff/src/types/`,PR 描述引用 Constitution 原则
- P0 完成后,P1 第一任务是"引入 Vitest + 为 P0 Store 补单元测试"([research.md](./research.md) §4 Risk Mitigation)
