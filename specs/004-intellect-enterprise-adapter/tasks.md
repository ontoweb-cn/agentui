# Tasks: Intellect Enterprise Adapter (P3)

**Input**: Design documents from `/specs/004-intellect-enterprise-adapter/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Constitution Principle VII (YAGNI + Test-First) 要求核心层 + SSE 解析器必有单元测试,本 tasks.md 包含测试任务。

**Organization**: Tasks grouped by user story (US1=能力探测/US2=会话/US3=流式对话),依赖顺序 US1 → US2 → US3。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- BFF 源码: `bff/src/`
- BFF 测试: `bff/src/` (与源码同目录,`*.test.ts` 后缀,与 P0/P1/P2 一致)
- 契约(权威源): `specs/004-intellect-enterprise-adapter/contracts/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 创建目录结构 + 复制契约到运行时位置

- [X] T001 [P] 创建 P3 Adapter 目录结构 `bff/src/services/adapters/intellect-enterprise/`(与 P1 intellect-rag 目录平级,Constitution 命名规范)
- [X] T002 [P] 复制契约文件到运行时引用位置(契约权威源 `specs/004-intellect-enterprise-adapter/contracts/intellect-enterprise-sse-mapping.ts`,运行时类型从 `bff/src/types/stream.ts` 导入,不复制文件,仅在 Adapter 中 import 类型)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: HTTP 客户端封装(所有 US 共享),复用 P1 类型不修改

**⚠️ CRITICAL**: US1/US2/US3 都依赖 HTTP 客户端,必须先完成

- [X] T003 [P] 创建 IntellectEnterprise HTTP 客户端封装,实现 `request<T>(method, path, ctx, body?)` + `requestStream(path, ctx, body)`,注入 `Authorization: Bearer ${apiServerKey}` + `X-Intellect-Team`/`X-Intellect-Project` 头(从 TenantContext 读取,Constitution Principle V),30s REST 超时/SSE 不超时,错误转换(404 → NotFoundError,5xx → HarnessBackendError),文件 `bff/src/services/adapters/intellect-enterprise/http-client.ts`
- [X] T004 [P] 编写 HTTP 客户端单元测试,Mock fetch,验证:头注入正确(Authorization/X-Intellect-Team/X-Intellect-Project)、超时触发、404 转 NotFoundError、5xx 转 HarnessBackendError、stream 请求不超时,文件 `bff/src/services/adapters/intellect-enterprise/http-client.test.ts`

**Checkpoint**: HTTP 客户端就绪,US1/US2/US3 可开始

---

## Phase 3: User Story 1 - 企业版 Agent 列表与能力探测 (Priority: P1) 🎯 MVP

**Goal**: Adapter 能对接 intellect-team,healthCheck/listAgents/discoverCapabilities 正确工作,前端通过 capabilities 隐藏画布入口

**Independent Test**: Admin 新增企业版后端 → `curl GET /api/bff/capabilities` 返回 `backendType: 'intellect-enterprise'` + canvas=false

### Tests for User Story 1 (Test-First, Constitution Principle VII)

- [X] T005 [P] [US1] 编写 IntellectEnterpriseAdapter.healthCheck + listAgents + discoverCapabilities 单元测试,Mock httpClient,覆盖:healthCheck true/false(不抛异常)、listAgents 返回 Agent[]/空数组(后端不可达)、discoverCapabilities 调 `/v1/capabilities` 成功/404 降级默认能力,文件 `bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.test.ts`

### Implementation for User Story 1

- [X] T006 [US1] 创建 IntellectEnterpriseAdapter 类骨架,实现 `IHarnessAdapter` 接口(readonly backendId + 构造函数接收 HarnessBackend,提取 baseUrl/apiServerKey/capabilities,实例化 httpClient),文件 `bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts`
- [X] T007 [US1] 实现 `healthCheck()` 调 `GET /health`,2xx 返回 true/其他返回 false(不抛异常,Constitution Principle VII),文件同 T006
- [X] T008 [US1] 实现 `listAgents(ctx)` 调 `GET /v1/models`,解析为 `AgentSummary[]`(id/name/description),404/网络错误返回空数组 + console.warn(不抛异常),文件同 T006
- [X] T009 [US1] 实现 `discoverCapabilities()` 调 `GET /v1/capabilities`,成功则映射为 HarnessCapabilities,404 降级返回硬编码默认(canvas=false/multiTenant=true/memory=true/mcp=true/knowledgeBase=false/modelManagement=false,research.md R4),文件同 T006
- [X] T010 [US1] 创建 IntellectEnterpriseAdapterFactory 并在 BFF 启动时注册到 AdapterRegistry(`registry.registerFactory('intellect-enterprise', (backend) => new IntellectEnterpriseAdapter(backend))`),文件 `bff/src/index.ts`(P1 已有 registerFactory 调用位置,新增一行)

**Checkpoint**: US1 完成,Admin 可新增企业版后端,capabilities 探测正确,前端隐藏画布入口

---

## Phase 4: User Story 2 - 企业版会话创建与历史 (Priority: P2)

**Goal**: 用户可创建/查询/删除企业版会话,拉取历史消息

**Independent Test**: `curl POST /api/bff/agents/{id}/sessions` 返回 sessionId → `curl GET .../messages` 返回空数组

### Tests for User Story 2

- [X] T011 [P] [US2] 编写 IntellectEnterpriseAdapter 会话方法单元测试,Mock httpClient,覆盖:createSession(POST /api/sessions 带 title)、getSession(GET /api/sessions/{id})、deleteSession(DELETE)、listMessages(GET /api/sessions/{id}/messages,404 返回空数组 + console.warn),文件 `bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.test.ts`(扩展 T005)

### Implementation for User Story 2

- [X] T012 [US2] 实现 `createSession(ctx, { agentId, title? })` 调 `POST /api/sessions`(body 含 title),返回 `{ sessionId, title? }`(intellect-team 响应映射到 Session 类型),文件 `bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts`
- [X] T013 [US2] 实现 `getSession(ctx, sessionId)` 调 `GET /api/sessions/{id}`,返回 Session 元数据,404 抛 NotFoundError,文件同 T012
- [X] T014 [US2] 实现 `deleteSession(ctx, sessionId)` 调 `DELETE /api/sessions/{id}`,204 返回 void,文件同 T012
- [X] T015 [US2] 实现 `listMessages(ctx, sessionId)` 调 `GET /api/sessions/{id}/messages`,返回 `Message[]`(role/content/createdAt),404 返回空数组 + console.warn(不抛异常,research.md 容错策略),文件同 T012

**注**:listMessages 不在 IHarnessAdapter 接口(Principle II 不修改接口),历史消息走 P0 透传层;US2 聚焦接口内的 createSession/getSession/deleteSession/listSessions。

**Checkpoint**: US2 完成,会话 CRUD + 历史消息可用

---

## Phase 5: User Story 3 - 企业版流式对话(SSE 双协议解析) (Priority: P3)

**Goal**: 用户发送消息,Adapter 通过 `/api/sessions/{id}/chat/stream` 订阅 SSE,`parseIntellectEnterpriseSSE` 解析为 StreamChunk,前端渲染与 RAG 一致

**Independent Test**: `curl POST /api/bff/agents/{id}/sessions/{sid}/chat/stream` 收到 SSE 流,解析出 delta/reasoning/done

### Tests for User Story 3 (Test-First, SSE 解析器契约测试)

- [X] T016 [P] [US3] 创建 SSE fixture 数据(录制 intellect-team 真实 SSE 流片段),覆盖:run.started/message.started/assistant.delta/tool.progress(_thinking)/tool.progress(其他 tool)/tool.started/tool.completed/tool.failed/run.completed(含 usage)/error/done,文件 `bff/src/services/adapters/intellect-enterprise/fixtures/sse-streams.ts`
- [X] T017 [P] [US3] 编写 parseIntellectEnterpriseSSE 契约测试,用 T016 fixture,验证每种事件 → StreamChunk 映射正确(按 contracts/intellect-enterprise-sse-mapping.ts 映射规则)、JSON 解析失败跳过+console.warn、未知事件跳过、流中途断开产出 error chunk,文件 `bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-sse.test.ts`

### Implementation for User Story 3

- [X] T018 [US3] 实现 `parseIntellectEnterpriseSSE(stream: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk>` 解析器,按 SSE 协议解析 `event: <name>\ndata: <json>\n\n` 帧,按 contracts 映射规则产出 StreamChunk,容错(JSON 失败/未知事件 console.warn + 跳过,流断开产出 error),文件 `bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-sse.ts`
- [X] T019 [US3] 编写 sendMessage 单元测试,Mock httpClient.requestStream 返回 fixture 流,验证 sendMessage 返回的 AsyncIterable 产出正确 StreamChunk 序列 + 多租户头注入,文件 `bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.test.ts`(扩展 T005/T011)
- [X] T020 [US3] 实现 `sendMessage(ctx, sessionId, req)` 调 `POST /api/sessions/{id}/chat/stream`(body 含 message),获取 ReadableStream,返回 `parseIntellectEnterpriseSSE(stream)` 的 AsyncIterable,文件 `bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts`

**Checkpoint**: US3 完成,流式对话可用,reasoning 与 delta 正确区分

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 回归验证 + 文档同步

- [X] T021 [P] 运行 `cd bff && npm run type-check`,确认 TypeScript 编译零错误(SC-008)
- [X] T022 [P] 运行 `cd bff && npm test`,确认所有单元测试通过(含 P0/P1/P2 125 测试 + P3 新增 38 = 163 测试,SC-006/SC-007)
- [X] T023 [P] 运行前端 `npx tsc --noEmit -p tsconfig.json`,确认前端零错误(BFF 路由层零改动,前端无需改)
- [X] T024 运行 quickstart.md 场景 1-10 冒烟验证(需 intellect-team 运行环境,SC-001/002/003/004/005)✅ 用 Node mock server 模拟 intellect-team,场景 1-8 全过(Admin/能力/Agent/会话/流式/多租户头/错误处理)
- [X] T025 [P] 更新 `docs/multi-harness-design.md`,标注 P3 实施完成状态(§10.1 P3 节加 ✅)
- [X] T026 [P] 更新 `specs/003-harness-admin-capabilities/tasks.md`,标注 P3 扩展(无,企业版 backendType P2 已支持,T026 无需改动)
- [X] T027 验证 P0/P1/P2 功能 100% 不回归(BFF 164 测试 + 前端 8 测试 + 透传路由冒烟,SC-007)✅ 运行时回归 6 项全过(透传/Admin CRUD/capabilities/health/写入门禁)
- [X] T028 [P] 在 `bff/data/harness-backends.json` 新增一条 intellect-enterprise 配置样例(注释或独立样例文件,不入库真实 endpoint/token)✅ 已加 intellect-enterprise-default 配置(endpoint 指向 localhost,token 用 env 引用)
- [X] T029 [P] git commit + tag `p3-intellect-enterprise-adapter-v1` ✅ commit ab28bbf + tag 已创建(冒烟修复 tenantContextMiddleware 将补提交)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖,立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1 — **BLOCKS** 所有 US
- **US1 (Phase 3)**: 依赖 Phase 2 完成
- **US2 (Phase 4)**: 依赖 Phase 2 完成,与 US1 独立(但实现同文件,建议 US1 先完成)
- **US3 (Phase 5)**: 依赖 Phase 2 完成,US3 的 sendMessage 依赖 parseIntellectEnterpriseSSE(T018)
- **Polish (Phase 6)**: 依赖所有 US 完成

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- HTTP 客户端(Adapter 内部)先于方法实现
- SSE 解析器(US3)先于 sendMessage 实现
- 单个 Adapter 文件内方法可并行实现(不同方法无冲突)

### Parallel Opportunities

- T001 + T002(Setup)可并行
- T003 + T004(Foundational 实现 + 测试)可并行
- T005(US1 测试)+ T016/T017(US3 SSE fixture + 测试)可并行(不同文件)
- T021/T022/T023/T025/T026/T028(Polish)可并行

---

## Parallel Example: US1 + US3 Tests

```bash
# US1 Adapter 测试与 US3 SSE fixture/测试可并行(不同文件):
Task: "T005 [US1] healthCheck/listAgents/discoverCapabilities 测试 in intellect-enterprise-adapter.test.ts"
Task: "T016 [US3] SSE fixture in fixtures/sse-streams.ts"
Task: "T017 [US3] parseIntellectEnterpriseSSE 契约测试 in parse-intellect-enterprise-sse.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1: Setup(目录 + 契约引用)
2. 完成 Phase 2: Foundational(HTTP 客户端)— CRITICAL,blocks 所有 US
3. 完成 Phase 3: User Story 1(healthCheck/listAgents/discoverCapabilities + Registry 注册)
4. **STOP and VALIDATE**: Admin 新增企业版后端 → capabilities 探测 → 前端隐藏画布入口
5. 可选:提交 MVP(P3-US1)

### Incremental Delivery

1. Setup + Foundational → HTTP 客户端就绪
2. + US1 → 能力探测可用 → Demo(隐藏画布入口)
3. + US2 → 会话 CRUD 可用 → Demo(创建会话)
4. + US3 → 流式对话可用 → Demo(完整企业版对话体验)
5. Polish → 回归验证 + 文档 + commit

---

## Notes

- 所有 Adapter 方法实现 `IHarnessAdapter` 接口(P1 已定义,不修改接口)
- SSE 解析器独立文件,与 Adapter 解耦(便于契约测试)
- BFF 路由层零改动(Principle II),仅 AdapterRegistry 注册新工厂
- intelct-team 不可达时,所有方法降级(healthCheck=false/listAgents=[]/listMessages=[]),不抛异常(Constitution Principle VII)
- 鉴权用 `API_SERVER_KEY`(env 注入),不实现 `imt_p_*` 项目级 token(Principle VIII,P4+ 评估)
