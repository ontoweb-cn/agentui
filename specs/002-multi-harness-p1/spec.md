# Feature Specification: Multi-Harness P1 — IntellectRagAdapter 实现 + 路由原生迁移

**Feature Branch**: `002-multi-harness-p1`

**Created**: 2026-06-26

**Status**: Draft

**Input**: User description: "P1 实施:实现 IntellectRagAdapter(Layer 1)、OpenAI SSE 解析器、AdapterRegistry、TenantContext 中间件,并将 BFF Agent/流式路由从透明代理迁移到 Adapter 原生调用,前端无感知。"

**Prerequisites**:
- [P0 已完成](../001-multi-harness-p0/spec.md) — BFF 反向代理、Store 层、契约文件就位
- [Constitution v1.1.0](../../.specify/memory/constitution.md) — Principle I/II/IV/V/VII/VIII
- [research.md §4](../001-multi-harness-p0/research.md) — P1 方向:Vitest 已引入,Adapter 实现时契约已稳定

## User Scenarios & Testing *(mandatory)*

### User Story 1 - BFF Agent 路由迁移到 Adapter 原生调用 (Priority: P1) 🎯 MVP

BFF 的 Agent 相关路由(GET/POST/PUT/DELETE `/api/bff/agents/*`)从当前的"透明代理透传 Intellect RAG"改为"调用 IntellectRagAdapter 原生方法"。前端请求路径与响应格式不变,行为零回归。Adapter 作为后端差异屏蔽层,后续新增后端时路由层无需改动。

**Why this priority**: Constitution Principle II 要求"加后端不改路由",Agent 路由是第一个从透传迁移到 Adapter 的域,验证 Adapter 抽象可行性。一旦 Agent 域迁移成功,Session/Message 域可按相同模式推进。

**Independent Test**: 切换前端 `api.ts` 中 Agent 相关路径从 `/api/bff/proxy/v1/agents` 到 `/api/bff/agents`,跑冒烟用例(列表 Agent → 查看 Agent 详情 → 创建 Agent → 编辑 Agent → 删除 Agent)全部通过,响应结构与透传模式完全一致。

**Acceptance Scenarios**:

1. **Given** BFF 已加载 Intellect RAG 后端配置且 env token 就位, **When** 前端请求 `GET /api/bff/agents`, **Then** BFF 通过 `IntellectRagAdapter.listAgents(ctx)` 调用上游,返回 Agent 列表,结构与透传模式一致
2. **Given** 前端已登录并获得 Authorization token, **When** 请求 `GET /api/bff/agents/{id}`, **Then** BFF 通过 `adapter.getAgent(ctx, id)` 返回详情,404 时返回与透传一致的错误格式
3. **Given** 前端提交合法 Agent 创建 payload, **When** 请求 `POST /api/bff/agents`, **Then** BFF 通过 `adapter.createAgent`(若契约未定义则走透传层 Layer 3)创建,返回新建 Agent
4. **Given** 上游 Intellect RAG 不可达, **When** 前端请求任一 Agent 路由, **Then** BFF 返回明确的 502 错误(不吞异常),日志记录上游 URL 与错误信息
5. **Given** 未授权请求(无 Authorization header), **When** 请求任一 Agent 路由, **Then** BFF 返回 401,不进入 Adapter 调用

---

### User Story 2 - OpenAI SSE 解析器 + 流式消息 Adapter (Priority: P2)

实现 `parseOpenAISSE` 解析器,将 Intellect RAG 的 OpenAI 兼容 SSE 流(`data: {"choices":[{"delta":...}]}` / `data: [DONE]`)转换为统一的 `StreamChunk` 序列。`IntellectRagAdapter.sendMessage(ctx, req)` 返回 `AsyncIterable<StreamChunk>`,BFF 流式路由用 `for-await-of` 消费并透传给前端 SSE。前端流式对话行为零回归。

**Why this priority**: 流式对话是 AgentUI 核心体验,Constitution Principle IV 要求双协议解析。Intellect RAG 的 OpenAI SSE 是 P1 必须覆盖的协议;企业版自定义 SSE 留待 P3。此 story 为 P3 企业版流式奠定解析器架构。

**Independent Test**: 前端发起流式对话请求 `POST /api/bff/agents/chat/completions`(或等价路径),BFF 通过 Adapter.sendMessage 获取 StreamChunk 流并透传 SSE,前端收到与透传模式一致的 `data: {...}` 事件流,对话内容完整,流正常终止。

**Acceptance Scenarios**:

1. **Given** Intellect RAG 返回标准 OpenAI SSE(`delta.content` 增量), **When** BFF 消费 `adapter.sendMessage()` 迭代器, **Then** 产出 `StreamDelta` chunk 序列,前端收到逐字增量
2. **Given** Intellect RAG 返回 `delta.reasoning_content` 扩展字段, **When** 解析器处理, **Then** 产出 `StreamReasoning` chunk(思考链)
3. **Given** Intellect RAG 返回 `finish_reason: "stop"` 且 chunk 含 `usage` 字段, **When** 解析器处理, **Then** 产出 `StreamUsage` chunk(含 promptTokens/completionTokens)
4. **Given** Intellect RAG 返回 `data: [DONE]`, **When** 解析器处理, **Then** 产出 `StreamDone` chunk(终止信号),BFF 据此关闭 SSE 连接
5. **Given** Intellect RAG 返回非 200 或 SSE 解析失败, **When** Adapter 处理, **Then** 产出 `StreamError` chunk(含错误消息),BFF 透传错误事件后关闭连接
6. **Given** 前端发起取消请求, **When** BFF 调用 `adapter.cancelMessage(ctx, sessionId)`, **Then** 上游流被中断,BFF 关闭 SSE 连接

---

### User Story 3 - AdapterRegistry + TenantContext 中间件 (Priority: P3)

实现 `AdapterRegistry`,根据 `tenantId` 从 `TenantStore` 查询绑定的 `intellectBackendId`,再从 `HarnessStore` 获取后端配置,创建/复用对应的 Adapter 实例。实现 `TenantContext` 中间件,从请求中提取 `tenantId`/`userId` 构造 `TenantContext`,注入 Hono context 供路由层使用。P1 阶段 Registry 支持单后端(Intellect RAG),P3 扩展为多后端切换。

**Why this priority**: Registry 与中间件是多后端选择的基础设施。P1 先建立骨架(单后端可用),确保 Agent/Session 路由能通过 Registry 获取 Adapter 而非硬编码。P3 企业版接入时,Registry 自动支持多后端切换,路由层零改动。

**Independent Test**: BFF 启动时初始化 AdapterRegistry(依赖 HarnessStore + TenantStore)。前端请求带 `X-Tenant-Id` header(或从 JWT 提取),中间件构造 TenantContext,Agent 路由通过 `registry.getAdapterForTenant(tenantId)` 获取 Adapter 并调用,返回与 US1 一致的结果。

**Acceptance Scenarios**:

1. **Given** BFF 已加载一个 Intellect RAG 后端和一个绑定该后端的 Tenant, **When** 请求带合法 tenantId, **Then** Registry 返回 IntellectRagAdapter 实例,路由层调用成功
2. **Given** 请求未带 tenantId 或 tenantId 不存在, **When** 中间件处理, **Then** 返回 400 明确错误(不静默使用默认 tenant)
3. **Given** Tenant 绑定的 backendId 在 HarnessStore 中不存在, **When** Registry 查询, **Then** 返回 500 明确错误(配置不一致)
4. **Given** 同一 tenant 多次请求, **When** Registry 查询, **Then** 复用同一 Adapter 实例(不重复创建,避免连接泄漏)
5. **Given** BFF 启动时 Store 未加载完成, **When** 请求到达, **Then** Registry 返回 503(服务未就绪),不返回空 Adapter

---

### Edge Cases

- **Intellect RAG 返回的 Agent 字段与契约 `AgentSummary` 不完全匹配**:Adapter 做字段映射(透传层 Layer 3 保留后端专有字段到 `metadata`),不丢弃后端原生字段
- **SSE 流中途上游断连**:Adapter 产出 `StreamError` chunk 后终止迭代,BFF 关闭 SSE 连接,前端收到错误事件
- **Adapter 创建时 env token 缺失**:HarnessStore 已在 P0 跳过该后端,Registry 查询时该 backend 不存在,返回 500 配置错误
- **TenantContext 中 intellectTeamId/intellectProjectId 为空**:Intellect RAG 单租户场景不需要这些字段,Adapter 调用时不注入多租户头(Principle V)
- **前端请求的 Agent ID 在上游不存在**:Adapter 透传上游 404,BFF 返回 404(与透传模式一致)
- **并发请求同一 tenant**:Registry 必须线程安全(Adapter 实例复用,不因并发创建多个实例)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: BFF MUST 通过 `IntellectRagAdapter` 实现 `IHarnessAdapter` 接口(Layer 1),覆盖 listAgents/getAgent/createSession/listSessions/getSession/deleteSession/sendMessage/cancelMessage/healthCheck/discoverCapabilities
- **FR-002**: BFF Agent 路由(GET/POST/PUT/DELETE `/api/bff/agents/*`)MUST 调用 Adapter 方法,不再走透明代理透传
- **FR-003**: 前端请求路径与响应格式 MUST 与 P0 透传模式完全一致(行为零回归,SC-009)
- **FR-004**: BFF MUST 实现 `parseOpenAISSE` 解析器,将 Intellect RAG OpenAI 兼容 SSE 转换为 `StreamChunk` 序列
- **FR-005**: `parseOpenAISSE` MUST 处理 `delta.content` → `StreamDelta`、`delta.reasoning_content` → `StreamReasoning`、`usage` → `StreamUsage`、`[DONE]` → `StreamDone`、错误 → `StreamError`
- **FR-006**: `IntellectRagAdapter.sendMessage()` MUST 返回 `AsyncIterable<StreamChunk>`,由 `parseOpenAISSE` 产出
- **FR-007**: BFF 流式路由 MUST 用 `for-await-of` 消费 `StreamChunk` 迭代器,透传为 SSE 事件给前端
- **FR-008**: BFF MUST 实现 `AdapterRegistry.getAdapterForTenant(tenantId)` 方法,返回 `IHarnessAdapter` 实例
- **FR-009**: `AdapterRegistry` MUST 根据 TenantStore 查询绑定的 backendId,从 HarnessStore 获取后端配置,创建/复用 Adapter
- **FR-010**: BFF MUST 实现 `TenantContext` 中间件,从请求提取 tenantId/userId 构造 `TenantContext`,注入 Hono context
- **FR-011**: Adapter 实例 MUST 被复用(同一 tenant 不重复创建),避免连接泄漏
- **FR-012**: BFF MUST 保留 P0 的透明代理路由(`/api/bff/proxy/v1/*`)用于未迁移的域(Dataset/KB/Search/Memory/MCP 等),不受 P1 影响
- **FR-013**: 上游错误(不可达/非 200)MUST 产出明确的错误响应(502/404/500),不吞异常,日志记录上游 URL 与错误信息
- **FR-014**: `IntellectRagAdapter` MUST 不注入多租户头(`X-Intellect-Team` 等),因 Intellect RAG 是单租户后端(Principle V)
- **FR-015**: Session 路由迁移范围:P1 MUST 评估 Session 与 Agent/Chat 的耦合关系(Intellect RAG session 挂在 `/agents/{id}/sessions` 或 `/chats/{id}/sessions` 下),若契约 `listSessions(ctx)` 无 agentId 参数导致无法映射,则 Session 路由保留透传,留待 P2 评估

### Key Entities *(include if feature involves data)*

- **IntellectRagAdapter**: 实现 `IHarnessAdapter` 的 Adapter 类,封装 Intellect RAG OpenAI 兼容 API 调用,backendId 对应 HarnessBackend.id
- **AdapterRegistry**: 根据 tenantId 查询绑定关系并返回 Adapter 实例的注册中心,P1 支持单后端,P3 扩展多后端
- **TenantContext 中间件**: Hono 中间件,从请求构造 TenantContext(tenantId/userId/intellectTeamId 等),注入 context 供路由层使用
- **parseOpenAISSE**: 纯函数,输入 SSE 字节流,输出 `StreamChunk` 迭代器,处理 OpenAI 兼容格式
- **StreamChunk 透传层**: BFF 路由层将 `StreamChunk` 序列重新序列化为前端 SSE 事件格式,保持与透传模式一致

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 前端切换 Agent 路径常量后(从 `proxy/v1/agents` 到 `agents`),冒烟用例(列表→详情→创建→编辑→删除)全部通过,响应结构零差异
- **SC-002**: 前端流式对话通过 BFF Adapter 路由,对话内容完整,流式增量逐字到达,流正常终止(无截断/无死等)
- **SC-003**: BFF 启动时初始化 AdapterRegistry,首个请求到达后能在 100ms 内返回 Adapter 实例(不阻塞请求)
- **SC-004**: IntellectRagAdapter 单元测试覆盖率 ≥ 80%(核心方法 listAgents/getAgent/sendMessage 必有测试,Constitution Principle VII)
- **SC-005**: parseOpenAISSE 协议契约测试覆盖 5 种 chunk 类型(delta/reasoning/usage/done/error),用录制的 SSE fixture 验证
- **SC-006**: P0 透明代理路由(`/api/bff/proxy/v1/*`)100% 不回归,未迁移域(Dataset/KB/Search)继续正常工作
- **SC-007**: BFF Agent 路由与流式路由的响应格式与 P0 透传模式逐字段一致(前端零改动)
- **SC-008**: TypeScript 编译通过(`tsc --noEmit` 零错误),Vitest 全部通过

## Assumptions

- Intellect RAG API 端点结构以 P0 调研为准:`/api/v1/agents`、`/api/v1/agents/{id}`、`/api/v1/agents/{id}/sessions`、`/api/v1/agents/chat/completions`、`/api/v1/chat/completions`
- Intellect RAG SSE 为标准 OpenAI 兼容格式(`data: {"choices":[{"delta":{"content":"..."}}]}\n\n` + `data: [DONE]`),`reasoning_content` 为可选扩展字段
- P1 阶段只有一个后端(Intellect RAG),AdapterRegistry 单后端场景即可验证
- TenantContext 的 tenantId 来源:从请求 header `X-Tenant-Id` 提取(P1 简化方案),P3 扩展为从 JWT 提取
- 前端 `api.ts` 中 Agent 相关路径会从 `restAPIv1`(proxy/v1)切换到新的 BFF 原生路径(如 `/api/bff/agents`),单点改动
- Session 路由迁移范围取决于契约映射评估:若 `listSessions(ctx)` 无法映射 Intellect RAG 的嵌套 session 结构,Session 域保留透传
- Vitest 已在 P1 前置任务中引入并配置就绪(bff/vitest.config.ts + 43 个 Store 测试通过)
- Adapter 实例复用:同一 backendId 对应同一 Adapter 实例(单例),不因并发请求重复创建
