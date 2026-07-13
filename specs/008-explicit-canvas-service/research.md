# Research: 显式 CanvasService — 画布脱离 Proxy 路由

**Feature**: 008-explicit-canvas-service
**Date**: 2026-06-27
**Status**: Complete

本文档解决 [plan.md](./plan.md) Technical Context 中 4 个 NEEDS CLARIFICATION,并记录关键设计决策的依据。

---

## R1. 画布路由迁移边界 — POST/PUT/DELETE `/agents` 是否一并迁到 `/canvas/*`

### Decision

**全部迁出**。`bff-agents.ts` 的 POST/PUT/DELETE `/agents` passthrough(画布 DSL create/edit/delete)一并迁到 `/canvas/*`,`bff-agents.ts` 仅保留 GET `/agents`(listAgents)、GET `/agents/:id`(getAgent)、`/agents/:agentId/sessions/*`(Session CRUD)、POST `/agents/chat/completions`(sendMessage,US2 已迁移)。

### Rationale

1. **语义一致性**: `POST /agents` 在 `bff-agents.ts` 注释明确写"canvas DSL 创建,P1 不经 Adapter",`PUT /agents/:id` 注释"canvas DSL 编辑,Principle III 透传层"。这些操作本质是画布引擎能力,不是 Agent 概览能力。本 spec 显式化后,`/agents/*` 仅保留"Agent 概览 + Sessions + chat"语义,`/canvas/*` 承载"画布引擎"语义,职责清晰
2. **前端 `api.ts` 现状佐证**: 前端 `createAgent`/`updateAgent`/`deleteAgent` 已用 `bffAgents` 常量(指向 `/api/bff/agents`),而 `listAgentTemplate`/`resetAgent`/`testDbConnect`/`debug`/`trace`/`cancelCanvas`/`inputForm`/`fetchVersionList`/`fetchVersion`/`uploadAgentFile`/`fetchAgentLogs`/`fetchExternalAgentInputs`/`prompt`/`cancelDataflow`/`getAttachmentFileDownload`/`downloadFile`/`testWebhook`/`fetchWebhookTrace` 仍用 `restAPIv1`。迁移后所有画布相关 endpoint 统一到 `bffCanvas`,前端单点改动
3. **SC-007 零回归约束**: `bff-agents.ts` 保留的 GET `/agents`、GET `/agents/:id`、`/agents/:id/sessions/*`、POST `/agents/chat/completions` 是 P1 已迁移到 Adapter 的路径,响应格式由 `IntellectRagAdapter` 决定,不依赖 passthrough,移除 POST/PUT/DELETE passthrough 不影响这些路径
4. **`/agents/chat/completions` 保留**: P1 已将 chat/completions 经 Adapter + `parseCanvasWorkflowSSE` 迁移,前端 `agentChatCompletion` 常量已指向 `bffAgents`。本 spec 不动此路径,避免与 P1 冲突;若需画布执行显式入口,见 R4

### Alternatives Considered

- **A. 仅迁子域,保留 POST/PUT/DELETE `/agents` passthrough**: 拒绝。`POST /agents` 与 `GET /canvas` 都创建画布,两路径语义重叠,违反"单一职责";且 `bff-agents.ts` 的 passthrough 函数(`intellect-client.proxy()`)与 `CanvasService` 调 Adapter 并存,维护成本高
- **B. 全部迁出,`bff-agents.ts` 删除 passthrough 函数**: 接受(本 Decision)。`passthrough` 函数在 `bff-agents.ts` 内部定义,迁出 POST/PUT/DELETE 后无调用方,可一并删除,代码更清爽

### Impact

- `bff-agents.ts` 删除 `passthrough` 函数 + POST/PUT/DELETE `/agents` 三个路由
- 前端 `createAgent`/`updateAgent`/`deleteAgent` 从 `bffAgents` 迁到 `bffCanvas`
- `bff-agents.test.ts` 中相关测试(若有 passthrough 测试)需迁移到 `canvas.test.ts`

---

## R2. CanvasService 是否新增 IR / DTO 层

### Decision

**不引入 Canvas IR**。`CanvasService` 方法直接用 Intellect RAG 原生 JSON 透传,不定义 Canvas DSL 中间表示、不引入 Canvas DTO 转换层。仅定义路由层入参/出参的最小 DTO(如 `CreateCanvasBody`、`SaveCanvasBody`),用于 TypeScript 类型校验,DTO 字段与 Intellect RAG 原生字段 1:1 对齐(如 `agent_id`/`dsl`/`components` 等),不做语义转换。

### Rationale

1. **Constitution Principle VII (YAGNI)**: 当前没有第二个画布后端(Principle III 硬绑定 Intellect RAG),引入 IR 是为 hypothetical 后端预留抽象,违反 YAGNI
2. **Constitution Principle III**: 画布永远走 Intellect RAG,不存在跨后端 IR 转换需求
3. **SC-002 约束**: 响应与原透传模式逐字段一致,引入 IR 转换层会增加字段映射错误风险,且无业务价值
4. **P1 先例**: `IntellectRagAdapter.listAgents()` 返回 `AgentSummary[]`,字段与上游 `/api/v1/agents` 响应 1:1,无 IR 转换;本 spec 沿用此模式
5. **测试成本**: IR 层需要额外测试覆盖映射逻辑,违反 Test-First 的"测核心逻辑,不测胶水代码"原则

### Alternatives Considered

- **A. 引入 Canvas DSL IR + 转换层**: 拒绝。无第二个画布后端,IR 无消费者;且 DSL schema 与 Intellect RAG canvas.py 强耦合,IR 化需镜像上游 schema,维护成本高
- **B. 仅定义最小 DTO(本 Decision)**: 接受。DTO 仅用于 TypeScript 类型校验 + 契约文档,不做语义转换,字段与上游 1:1,测试只需覆盖 `CanvasService` 方法调 Adapter 的路径,不需覆盖字段映射

### Impact

- `types/canvas.ts` 仅定义路由 DTO + 上游响应透传类型(如 `CanvasAgent` = `Record<string, unknown>` 或具体字段),不定义 IR
- `CanvasService` 方法签名形如 `listCanvas(ctx): Promise<CanvasAgent[]>`,内部调 `adapter.request('GET', '/api/v1/agents')`,直接返回上游 JSON
- 测试 Mock `IntellectRagAdapter.request()`,验证路径与方法调用,不验证字段映射

---

## R3. `getCanvasBackendForTenant` 与现有 `getAdapterForTenant` 的关系

### Decision

**新增独立方法 `getCanvasBackendForTenant(tenantId): IntellectRagAdapter`**,内部按以下顺序解析:

1. `tenant = tenantStore.getTenant(tenantId)`
2. 若 `tenant.canvasBackendId` 存在:调 `getAdapterForBackend(tenant.canvasBackendId)`,并断言返回的 Adapter 是 `IntellectRagAdapter` 实例(Principle III),否则抛 `InvalidCanvasBackendError`
3. 若 `tenant.canvasBackendId` 不存在:
   - 若 `tenantId === 'default'` 或 tenant 不存在(社区版无 `X-Tenant-Id`):回退首个 `type=intellect-rag` backend,保持社区版零回归
   - 否则(企业版租户未绑定画布):抛 `CanvasBackendNotBoundError`,路由层返回 503
4. 复用 `adapterCache`(同 backendId 同实例,对齐 P1 FR-011 实例复用)

### Rationale

1. **显式表达 canvas hard-bound 语义**: `getAdapterForTenant` 返回 `IHarnessAdapter`(可能是 enterprise),无法在类型层表达"canvas 必须是 IntellectRagAdapter"。新增 `getCanvasBackendForTenant` 返回 `IntellectRagAdapter`,类型签名直接落实 Principle III
2. **集中处理 503 错误逻辑**: 企业版租户未绑定画布的 503 判断在 Registry 层而非路由层,路由层只需 try/catch 翻译错误码,职责清晰
3. **复用 `getAdapterForBackend` 缓存机制**: 不重新实现缓存,直接调 `getAdapterForBackend(canvasBackendId)`,保证实例复用
4. **default 租户回退集中化**: 社区版回退逻辑(首个 `intellect-rag` backend)在 Registry 层实现,路由层不感知,避免每个画布路由都写回退逻辑

### Alternatives Considered

- **A. 路由层调 `getAdapterForBackend(tenant.canvasBackendId)`**: 拒绝。503 错误判断、default 回退、类型断言逻辑散落在每个画布路由,重复代码多,且无法在类型层表达 hard-bound
- **B. 复用 `getAdapterForTenant`,路由层断言返回值是 IntellectRagAdapter**: 拒绝。`getAdapterForTenant` 用 `intellectBackendId`(主后端),企业版租户主后端是 `intellect-enterprise`,断言会失败;且 `canvasBackendId` 与 `intellectBackendId` 是双绑定模型,语义不同
- **C. 新增独立方法(本 Decision)**: 接受。集中表达 canvas 语义,类型签名落实 Principle III,错误处理集中

### Impact

- `adapter-registry-types.ts` 的 `IAdapterRegistry` 接口加 `getCanvasBackendForTenant(tenantId: string): IntellectRagAdapter`
- `adapter-registry.ts` 实现该方法,新增 `CanvasBackendNotBoundError` + `InvalidCanvasBackendError` 错误类型(放 `adapter-registry-errors.ts`)
- `adapter-registry.test.ts` 补 3 个场景测试:已绑定 / 未绑定企业版 / default 回退
- `CanvasService` 构造函数注入 `IAdapterRegistry`,调 `registry.getCanvasBackendForTenant(ctx.tenantId)` 获取 Adapter

---

## R4. `/agents/chat/completions` vs `/canvas/:id/execute` — 画布执行入口

### Decision

**不新增 `/canvas/:id/execute`**。画布执行继续走 P1 已迁移的 `POST /api/bff/agents/chat/completions`(经 `IntellectRagAdapter.sendMessage` + `parseCanvasWorkflowSSE`)。本 spec 不动 chat/completions 路径,spec.md FR-004 中的 `POST /canvas/:id/execute` 条目**取消**(在 tasks.md 实施时跳过)。

### Rationale

1. **P1 已迁移且稳定**: P1 US2 已将 `agentChatCompletion` 从 `${restAPIv1}/agents/chat/completions` 迁到 `${bffAgents}/chat/completions`,经 Adapter + `parseCanvasWorkflowSSE` 解析 Canvas Workflow SSE,前端 `use-send-message.ts` 已消费此格式。本 spec 重迁会破坏 P1 已验收的 SC-007
2. **画布执行与 Agent 对话语义重叠**: Intellect RAG 的"画布执行"就是"对画布 agent 发消息",`/agents/chat/completions` 已表达此语义。新增 `/canvas/:id/execute` 会导致两路径并存,前端需选择,增加维护成本
3. **Constitution Principle VII (YAGNI)**: 不为"未来可能的画布执行独立化"预留路径,当前 chat/completions 满足需求
4. **spec.md FR-004 修正**: spec.md 列出 `POST /canvas/:id/execute` 是基于"画布执行应显式化"的直觉,但 research 发现 P1 已显式化(经 Adapter),本 spec 不重复迁移。tasks.md 实施时跳过此条目,spec.md 不修改(保留原始 spec 作为决策记录)

### Alternatives Considered

- **A. 新增 `/canvas/:id/execute`,前端 `agentChatCompletion` 迁到 `bffCanvas/execute`**: 拒绝。破坏 P1 SC-007 零回归,且 chat/completions 已稳定
- **B. 两路径并存(`chat/completions` + `/canvas/:id/execute` 都可执行画布)**: 拒绝。违反单一职责,前端选择困难
- **C. 不新增,保留 `/agents/chat/completions`(本 Decision)**: 接受。P1 已迁移,本 spec 仅迁非执行的画布操作(CRUD/components/versions/upload/debug/trace/webhook 等)

### Impact

- `canvas.ts` 路由不实现 `POST /canvas/:id/execute`
- 前端 `api.ts` 的 `agentChatCompletion` 保留 `${bffAgents}/chat/completions`,不迁到 `bffCanvas`
- `CanvasService` 不实现 `executeCanvas` 方法
- spec.md FR-004 中 `POST /canvas/:id/execute` 条目在 tasks.md 实施时跳过,spec.md 不修改(决策记录)

---

## R5. multipart 上传与 SSE 透传的实现策略

### Decision

**`CanvasService` 提供两类方法**:

1. **JSON 方法**(listCanvas/getCanvas/saveCanvas/deleteCanvas/listTemplates/debugComponent/trace/listVersions/getVersion/listTags/updateTags/listPrompts/testDbConnection/testWebhook/fetchWebhookLogs/rerun/cancelTask):调 `IntellectRagAdapter.request()`,返回上游 JSON
2. **流式透传方法**(uploadAttachment/downloadAttachment/downloadFile):调 `IntellectRagAdapter.proxy()`,返回上游 `Response`(body 是 ReadableStream),路由层用 `new Response(upstream.body, ...)` 透传

`IntellectRagAdapter` 新增 `proxy(method, path, req)` 方法,封装 `intellect-rag-client.proxy()`（文件重命名自 `intellect-client.ts`）的调用,但用 Adapter 自己的 `baseUrl` + `adminToken`(而非全局 `intellect-rag-client.ts` 的 `BASE_URL`)。这样 Adapter 实例化时绑定的 backend 配置生效,支持多后端场景(Principle II)。

### Rationale

1. **multipart 不能用 `request()`**: `request()` 用 `JSON.stringify(body)`,multipart body 是 `FormData`/`ReadableStream`,需流式透传
2. **Adapter 自带 `proxy()` 落实 Principle II**: 当前 `bff-agents.ts` 的 `passthrough` 调全局 `intellect-client.proxy()`,用全局 `BASE_URL`,无法支持多后端。Adapter 自带 `proxy()` 用实例的 `baseUrl`,支持按租户路由到不同 Intellect RAG 实例
3. **下载也是流式**: `getAttachmentFileDownload`/`downloadFile` 返回二进制流,需流式透传,与上传对称
4. **SSE 执行不在此列**: 画布执行(chat/completions)已由 P1 的 `sendMessage` + `parseCanvasWorkflowSSE` 处理,本 spec 不涉及(R4)

### Alternatives Considered

- **A. `CanvasService` 直接调 `intellect-client.proxy()`**: 拒绝。全局 `BASE_URL` 不支持多后端,违反 Principle II;且 Adapter 已封装 backend 配置,应通过 Adapter 调用
- **B. `CanvasService` 解析 multipart body 后重组**: 拒绝。multipart 解析复杂且无业务价值,流式透传即可
- **C. Adapter 新增 `proxy()` 方法(本 Decision)**: 接受。落实 Principle II,支持多后端,流式透传无解析开销

### Impact

- `IntellectRagAdapter` 新增 `proxy(method, path, headers, body, query): Promise<Response>` 方法
- `CanvasService` 的 `uploadAttachment`/`downloadAttachment`/`downloadFile` 调 `adapter.proxy()`,其余方法调 `adapter.request()`
- `canvas.ts` 路由对流式方法用 `new Response(upstream.body, ...)` 透传,保留上游 `Content-Type`(`multipart/form-data` 响应 / `application/octet-stream` 下载)
- `canvas-service.test.ts` Mock `IntellectRagAdapter.proxy()` 与 `request()`,分别覆盖两类方法

---

## R6. 错误码映射约定

### Decision

`CanvasService` 与 `canvas.ts` 路由层的错误码映射:

| 上游/Registry 错误 | BFF 响应 | Body |
|---------------------|----------|------|
| `RegistryNotReadyError` | 503 | `{code: 503, message: "Adapter registry not ready"}` |
| `TenantNotFoundError` | 404 | `{code: 404, message: "Tenant ${tenantId} not found"}` |
| `CanvasBackendNotBoundError` | 503 | `{code: 503, message: "Tenant ${tenantId} has no canvas backend bound"}` |
| `InvalidCanvasBackendError`(canvasBackendId 指向非 intellect-rag) | 503 | `{code: 503, message: "Tenant ${tenantId} canvas backend ${canvasBackendId} not found or invalid"}` |
| `BackendNotConfiguredError`(canvasBackendId 在 HarnessStore 不存在) | 503 | `{code: 503, message: "Tenant ${tenantId} canvas backend ${canvasBackendId} not found or invalid"}` |
| Intellect RAG 返回 404 | 404 | 透传上游 body |
| Intellect RAG 返回 4xx | 400 | 透传上游 body(保留上游错误信息) |
| Intellect RAG 不可达/5xx | 502 | `{code: 502, message: "Canvas upstream error: ${err.message}"}` |
| 鉴权失败(authMiddleware) | 401 | 由 `authMiddleware` 返回,不进入 `CanvasService` |

### Rationale

1. **与 P1/P4b 错误码约定一致**: `bff-agents.ts` 的 503(无 backend)/502(Adapter error)/404(上游 404)模式沿用
2. **503 vs 502 区分**: 503 = BFF 层配置问题(租户未绑定画布、backend 不存在),502 = 上游不可达。前端可据此区分"配置错误"与"上游故障"
3. **4xx 透传**: 上游 4xx(如 400 Bad Request、422 Validation Error)透传 body,保留上游错误详情,便于前端展示
4. **`InvalidCanvasBackendError` 与 `BackendNotConfiguredError` 合并响应**: 两种错误对用户语义相同("canvas 后端无效"),合并 503 + 相同 message,简化前端处理

### Impact

- `canvas.ts` 路由层统一 try/catch,按错误类型映射状态码
- `canvas-service.test.ts` 覆盖每种错误场景
- 前端 `agent-service.ts` 不需特殊处理,沿用现有错误处理(透传 body + 状态码)

---

## R7. 前端 `api.ts` 迁移清单(实施依据)

### Decision

前端 `api.ts` 中以下 endpoint 从 `${restAPIv1}/agents/...` 迁到 `${bffCanvas}/...`:

| api.ts 字段 | 现路径 | 迁移后路径 |
|-------------|--------|------------|
| `listAgentTemplate` | `${restAPIv1}/agents/templates` | `${bffCanvas}/templates` |
| `listAgentTags` | `${restAPIv1}/agents/tags` | `${bffCanvas}/tags` |
| `updateAgentTags(agentId)` | `${restAPIv1}/agents/${agentId}/tags` | `${bffCanvas}/${agentId}/tags` |
| `createAgent` | `${bffAgents}` | `${bffCanvas}` |
| `updateAgent(agentId)` | `${bffAgents}/${agentId}` | `${bffCanvas}/${agentId}` |
| `deleteAgent(agentId)` | `${bffAgents}/${agentId}` | `${bffCanvas}/${agentId}` |
| `resetAgent(agentId)` | `${restAPIv1}/agents/${agentId}/reset` | `${bffCanvas}/${agentId}/reset` |
| `testDbConnect` | `${restAPIv1}/agents/test_db_connection` | `${bffCanvas}/test_db_connection` |
| `debug(agentId, componentId)` | `${restAPIv1}/agents/${agentId}/components/${componentId}/debug` | `${bffCanvas}/${agentId}/components/${componentId}/debug` |
| `trace(agentId, messageId)` | `${restAPIv1}/agents/${agentId}/logs/${messageId}` | `${bffCanvas}/${agentId}/logs/${messageId}` |
| `cancelCanvas(taskId)` | `${restAPIv1}/tasks/${taskId}/cancel` | `${bffCanvas}/tasks/${taskId}/cancel` |
| `inputForm(agentId, componentId)` | `${restAPIv1}/agents/${agentId}/components/${componentId}/input-form` | `${bffCanvas}/${agentId}/components/${componentId}/input-form` |
| `fetchVersionList(id)` | `${restAPIv1}/agents/${id}/versions` | `${bffCanvas}/${id}/versions` |
| `fetchVersion(agentId, versionId)` | `${restAPIv1}/agents/${agentId}/versions/${versionId}` | `${bffCanvas}/${agentId}/versions/${versionId}` |
| `uploadAgentFile(id)` | `${restAPIv1}/agents/${id}/upload` | `${bffCanvas}/${id}/upload` |
| `fetchExternalAgentInputs(canvasId)` | `${restAPIv1}/agentbots/${canvasId}/inputs` | `${bffCanvas}/${canvasId}/external-inputs` |
| `prompt` | `${restAPIv1}/agents/prompts` | `${bffCanvas}/prompts` |
| `cancelDataflow(id)` | `${restAPIv1}/tasks/${id}/cancel` | `${bffCanvas}/tasks/${id}/cancel`(合并到 cancelCanvas) |
| `getAttachmentFileDownload(docId)` | `${restAPIv1}/agents/attachments/${docId}/download` | `${bffCanvas}/attachments/${docId}/download` |
| `downloadFile` | `${restAPIv1}/agents/download` | `${bffCanvas}/download` |
| `testWebhook(id)` | `${restAPIv1}/agents/${id}/webhook/test` | `${bffCanvas}/${id}/webhook/test` |
| `fetchWebhookTrace(id)` | `${restAPIv1}/agents/${id}/webhook/logs` | `${bffCanvas}/${id}/webhook/logs` |

**不迁移**(保留 `bffAgents` 或 `restAPIv1`):

| api.ts 字段 | 路径 | 原因 |
|-------------|------|------|
| `listAgents` | `${bffAgents}` | P1 已迁移,Agent 概览,非画布 |
| `getAgent(id)` | `${bffAgents}/${id}` | P1 已迁移,Agent 详情,非画布 |
| `agentChatCompletion` | `${bffAgents}/chat/completions` | P1 已迁移,画布执行入口(R4 保留) |
| `createAgentSession(agentId)` | `${bffAgents}/${agentId}/sessions` | P1 已迁移,Session 创建 |
| `fetchAgentSessions(agentId)` | `${bffAgents}/${agentId}/sessions` | P1 已迁移,Session 列表 |
| `fetchAgentSessionById(agentId, sessionId)` | `${bffAgents}/${agentId}/sessions/${sessionId}` | P1 已迁移,Session 详情 |
| `fetchAgentLogs(canvasId)` | `${webAPI}/canvas/${canvasId}/sessions` | 用 `webAPI=/v1`,非 `restAPIv1`,本 spec 不涉及(独立 webAPI 路径) |
| `getInputElements` | `${webAPI}/canvas/input_elements` | 同上,webAPI 路径 |

### Rationale

1. **完整覆盖画布相关 endpoint**: 上表 22 条是 `api.ts` 中所有用 `${restAPIv1}/agents/...` 或 `${bffAgents}` 形式的画布操作,迁到 `bffCanvas` 后,`api.ts` 中画布路径单一化
2. **`webAPI` 路径不迁移**: `fetchAgentLogs`/`getInputElements` 用 `${webAPI}/canvas/...`(即 `/v1/canvas/...`),这是 Intellect RAG 的另一组 API 前缀,本 spec 不涉及(避免范围蔓延)
3. **`cancelCanvas` 与 `cancelDataflow` 合并**: 两者都调 `${restAPIv1}/tasks/${id}/cancel`,迁移后都用 `${bffCanvas}/tasks/${id}/cancel`,BFF 路由层一个 handler 处理

### Impact

- `api.ts` 新增 `const bffCanvas = '/api/bff/canvas';` 并 export
- 上表 22 条 endpoint 改路径
- `agent-service.ts` 中引用这些字段的地方自动跟随(api.ts 是 single source of truth)
- BFF `canvas.ts` 路由按上表路径注册

---

## Constitution Check (Post-Design Re-evaluation)

*Phase 1 设计完成后复评,基于 research.md R1-R7 结论*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. BFF-Mediated Frontend | ✅ PASS | 画布操作 100% 经 `/api/bff/canvas/*`,前端不直连 Intellect RAG |
| II. Adapter Abstraction | ✅ PASS | `CanvasService` 经 `AdapterRegistry.getCanvasBackendForTenant` 获取 `IntellectRagAdapter`,路由层不感知后端;`IntellectRagAdapter.proxy()` 落实多后端支持(R5) |
| III. Canvas Hard-Bound to Intellect RAG | ✅ PASS | `getCanvasBackendForTenant` 返回类型 `IntellectRagAdapter`(非 `IHarnessAdapter`),类型签名落实 hard-bound;`InvalidCanvasBackendError` 防止 canvasBackendId 指向 enterprise(R3) |
| IV. SSE Dual-Protocol | ✅ PASS | 本 spec 不涉及 SSE(画布执行 chat/completions 保留 P1 路径,R4) |
| V. Tenant Isolation | ✅ PASS | `getCanvasBackendForTenant` 按 `canvasBackendId` 路由,企业版未绑定返回 503,default 回退首个 intellect-rag backend(R3) |
| VI. No ACP in BFF | ✅ PASS | 用 HTTP REST + 流式透传,不实现 ACP |
| VII. YAGNI + Test-First | ✅ PASS | 不引入 Canvas IR(R2);不新增 `/canvas/:id/execute`(R4);`CanvasService` + `canvas.ts` 必有测试,覆盖率 ≥ 80% |
| VIII. BFF ↔ Intellect Enterprise Access Contract | ✅ PASS | 画布仅用 Intellect RAG admin token(Bearer),不触发企业版 API_SERVER_KEY |

**Post-Design Gate Status**: ✅ 所有原则 PASS,无 Constitution 违规,无待修订项。

---

## Summary of Resolved NEEDS CLARIFICATION

| # | Question | Decision |
|---|----------|----------|
| 1 | POST/PUT/DELETE `/agents` 是否迁到 `/canvas/*` | 全部迁出(R1) |
| 2 | CanvasService 是否引入 IR/DTO 层 | 不引入 IR,仅最小 DTO(R2) |
| 3 | `getCanvasBackendForTenant` 与 `getAdapterForTenant` 关系 | 新增独立方法,返回 `IntellectRagAdapter`(R3) |
| 4 | `/agents/chat/completions` vs `/canvas/:id/execute` | 不新增 execute,保留 P1 chat/completions(R4) |

## Additional Decisions

| # | Topic | Decision |
|---|-------|----------|
| 5 | multipart/SSE 透传策略 | Adapter 新增 `proxy()` 方法,CanvasService 两类方法分流(R5) |
| 6 | 错误码映射 | 503(配置)/502(上游)/404(资源)/4xx 透传(R6) |
| 7 | 前端 api.ts 迁移清单 | 22 条 endpoint 迁到 `bffCanvas`,8 条保留(R7) |
