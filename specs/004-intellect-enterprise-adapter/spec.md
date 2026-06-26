# Feature Specification: Intellect Enterprise Adapter

**Feature Branch**: `004-intellect-enterprise-adapter`

**Created**: 2026-06-26

**Status**: Draft

**Input**: User description: "P3:实现 Intellect 企业版 Adapter(BFF 核心层),对接 intellect-team 的 `/api/sessions/{id}/chat/stream` 主通道,实现 IHarnessAdapter 接口,解析企业版自定义 SSE 协议,注册到 AdapterRegistry 支持 `intellect-enterprise` 后端类型。基础对话功能可用。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 企业版 Agent 列表与能力探测 (Priority: P1)

运维在 P2 Admin 页面新增一个 `intellect-enterprise` 类型后端(指向 intellect-team :8642),BFF 启动时通过 Adapter 调用 `GET /v1/models` 与 `GET /v1/capabilities` 完成对接验证。租户绑定该后端后,前端通过 `useHarnessCapabilities` 拿到企业版能力(canvas=false,编码 Agent 能力),前端据此隐藏画布入口、显示编码 Agent 入口。

**Why this priority**:Adapter 能对接企业版、能力探测正确是后续所有功能(会话/流式对话)的前置。无此能力探测,前端无法区分 RAG 与企业版,条件渲染失效。

**Independent Test**:在 Admin 页面新增企业版后端 → 用 curl 调 `GET /api/bff/capabilities`(带 X-Tenant-Id)→ 返回 `backendType: 'intellect-enterprise'` + capabilities(canvas=false, memory=true, multiTenant=true)。

**Acceptance Scenarios**:

1. **Given** Admin 已新增 intellect-enterprise 后端且 env 配置了 `API_SERVER_KEY`, **When** BFF 启动, **Then** Adapter `healthCheck()` 调 `GET /health` 返回 true,`discoverCapabilities()` 调 `GET /v1/capabilities` 返回企业版能力
2. **Given** 租户已绑定 intellect-enterprise 后端, **When** 前端调 `GET /api/bff/capabilities`, **Then** 返回 `backendType: 'intellect-enterprise'`,capabilities.canvas === false
3. **Given** 企业版后端不可达, **When** BFF 启动, **Then** `healthCheck()` 返回 false,`listAgents()` 返回空数组并 console.warn 告警(不抛异常,与 P0 HarnessStore 行为一致)
4. **Given** 企业版后端已就绪, **When** 调 `listAgents()`, **Then** 返回 intellect-team `/v1/models` 解析后的 Agent 列表(id/name/description)

---

### User Story 2 - 企业版会话创建与历史 (Priority: P2)

用户在企业版后端下创建会话、查询历史消息。BFF Adapter 调用 intellect-team `POST /api/sessions` 创建会话、`GET /api/sessions/{id}/messages` 拉取历史。会话归属 intellect-team 管理,BFF 不持久化会话内容(Principle V)。

**Why this priority**:会话是流式对话的前置;无 session_id 无法调 `/api/sessions/{id}/chat/stream` 主通道。

**Independent Test**:curl 调 `POST /api/bff/agents/{agentId}/sessions`(带 X-Tenant-Id)→ 返回 sessionId → curl 调 `GET /api/bff/agents/{agentId}/sessions/{sessionId}/messages` → 返回历史(初始为空数组)。

**Acceptance Scenarios**:

1. **Given** 租户绑定企业版后端, **When** 调 `createSession({ agentId, title? })`, **Then** Adapter 调 `POST /api/sessions` 创建 intellect-team session,返回 sessionId + title
2. **Given** 会话已创建, **When** 调 `getSession(sessionId)`, **Then** 返回会话元数据(id/title/createdAt/updatedAt)
3. **Given** 会话已有多轮对话, **When** 调 `listMessages(sessionId)`, **Then** 返回按时间排序的消息列表(role/content/createdAt)
4. **Given** 会话已存在, **When** 调 `deleteSession(sessionId)`, **Then** intellect-team session 被删除,BFF 后续调用该 sessionId 返回 404

---

### User Story 3 - 企业版流式对话(SSE 双协议解析) (Priority: P3)

用户在企业版会话中发送消息,Adapter 通过 `POST /api/sessions/{id}/chat/stream` 主通道订阅 SSE 流,用 `parseIntellectEnterpriseSSE` 解析企业版自定义事件(`assistant.delta`/`tool.progress`/`run.completed`/`done`),输出统一 `StreamChunk`。前端 `use-send-message.ts` 消费 StreamChunk 渲染对话,与 Intellect RAG 体验一致。

**Why this priority**:流式对话是核心价值,但依赖 US1(能力探测)+ US2(会话创建)完成。放 P3 优先级,确保前置就绪。

**Independent Test**:curl 调 `POST /api/bff/agents/{agentId}/sessions/{sessionId}/chat/stream`(带 X-Tenant-Id + body `{message}`)→ 收到 SSE 流 → 解析出 `StreamDelta`/`StreamReasoning`/`StreamDone` 事件 → 流正常关闭。

**Acceptance Scenarios**:

1. **Given** 会话已创建, **When** 调 `sendMessage(sessionId, { message })`, **Then** Adapter 调 `POST /api/sessions/{id}/chat/stream`,返回 AsyncIterable<StreamChunk>
2. **Given** SSE 流中收到 `assistant.delta` 事件, **When** 解析, **Then** 产出 `StreamChunk { type: 'delta', content: <text> }`
3. **Given** SSE 流中收到 `tool.progress` 事件且 `tool_name === '_thinking'`, **When** 解析, **Then** 产出 `StreamChunk { type: 'reasoning', content: <text> }`
4. **Given** SSE 流中收到 `run.completed` 事件, **When** 解析, **Then** 产出 `StreamChunk { type: 'usage', ... }` 后接 `{ type: 'done' }`
5. **Given** SSE 流中收到 `error` 事件或连接断开, **When** 解析, **Then** 产出 `StreamChunk { type: 'error', message }` 并终止迭代
6. **Given** 多租户头已通过 TenantContext 注入, **When** Adapter 调用 intellect-team, **Then** 请求携带 `X-Intellect-Team` / `X-Intellect-Project` / `Authorization: Bearer ${API_SERVER_KEY}`(Principle V + VIII)

---

### Edge Cases

- **企业版后端首次启动未配置 Team/Project**:Adapter `discoverCapabilities()` 仍返回 multiTenant=true,但 `createSession` 调用时若 BFF Tenant 未绑定 intellectTenantId,返回 400 "Tenant not bound to intellect team"
- **SSE 流中途断开**(网络抖动):Adapter 产出 `StreamError` 后正常关闭迭代,不抛异常到 BFF 路由层;前端收到 error chunk 显示重试按钮
- **intellect-team session 已被外部删除**:BFF `listMessages` 调用返回 404,Adapter 转换为空数组 + console.warn(不抛异常,前端显示"会话不存在")
- **`API_SERVER_KEY` 环境变量缺失**:Adapter `healthCheck()` 返回 false,`listAgents()` 返回空数组,与 P0 env 缺失处理一致
- **企业版后端响应非 200**(5xx):Adapter 抛 `HarnessBackendError`,BFF 路由层捕获返回 502
- **SSE 事件 `data` 字段 JSON 解析失败**:`parseIntellectEnterpriseSSE` 跳过该事件 + console.warn,不中断流(与 P1 parseCanvasWorkflowSSE 容错策略一致)
- **租户同时绑定 RAG + 企业版后端**:RAG 用于画布(Principle III hard-bound),企业版用于编码 Agent;AdapterRegistry 按 tenantId 选企业版,画布路由直接用 RAG Adapter,两者独立
- **会话标题含特殊字符**:`createSession` 透传 title 到 intellect-team,不做转义(intellect-team 自行处理)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST 实现 `IntellectEnterpriseAdapter` 类,实现 `IHarnessAdapter` 核心层接口(listAgents/createSession/getSession/deleteSession/listMessages/sendMessage/healthCheck/discoverCapabilities)
- **FR-002**: System MUST 通过 `POST /api/sessions/{id}/chat/stream` 主通道实现 `sendMessage`(Principle VIII),禁用 `/v1/chat/completions` stateless 端点
- **FR-003**: System MUST 实现 `parseIntellectEnterpriseSSE` 解析器,处理 intellect-team 自定义 SSE 事件(assistant.delta/tool.progress/run.completed/done/error),输出统一 `StreamChunk`
- **FR-004**: System MUST 在调用 intellect-team 时注入 `Authorization: Bearer ${API_SERVER_KEY}` + `X-Intellect-Team` + `X-Intellect-Project` 头(Principle V + VIII)
- **FR-005**: System MUST 实现 IntellectEnterprise HTTP 客户端封装,统一处理 endpoint 拼接、超时(30s REST / 流式不超时)、错误转换
- **FR-006**: System MUST 将 `IntellectEnterpriseAdapterFactory` 注册到 AdapterRegistry,支持 `backendType === 'intellect-enterprise'` 的后端选择
- **FR-007**: System MUST 在 `listAgents()` 中调用 `GET /v1/models` 并解析为 `Agent[]`(id/name/description),后端不可达时返回空数组 + console.warn
- **FR-008**: System MUST 在 `discoverCapabilities()` 中调用 `GET /v1/capabilities` 并映射为 `HarnessCapabilities`(canvas=false, multiTenant=true, memory=true)
- **FR-009**: System MUST 在 `healthCheck()` 中调用 `GET /health`,返回 boolean,不抛异常
- **FR-010**: System MUST 在 `createSession()` 中调用 `POST /api/sessions`(可带 title),返回 `{ sessionId, title? }`
- **FR-011**: System MUST 在 `listMessages()` 中调用 `GET /api/sessions/{id}/messages`,返回 `Message[]`(role/content/createdAt),404 时返回空数组 + console.warn
- **FR-012**: System MUST 复用 P1 `StreamChunk` 类型(8 值:delta/reasoning/tool_start/tool_complete/tool_progress/usage/done/error),P3 启用 `tool_progress`
- **FR-013**: System MUST 为 `parseIntellectEnterpriseSSE` 提供契约测试 fixture(录制真实 SSE 流),覆盖所有事件类型
- **FR-014**: System MUST 为 `IntellectEnterpriseAdapter` 提供单元测试,Mock fetch,覆盖所有核心层方法 + 错误场景
- **FR-015**: System MUST 复用 P1 BFF Agent 路由层(`bff/src/routes/agents.ts` 等),路由层零改动(Principle II),仅通过 AdapterRegistry 选择新 Adapter

### Key Entities *(include if feature involves data)*

- **IntellectEnterpriseAdapter**: 实现 `IHarnessAdapter` 的企业版 Adapter,持有 HTTP 客户端 + backend 配置(endpoint/adminToken/multiTenantContext)
- **IntellectEnterpriseSSEEvent**: intellect-team SSE 原始事件结构(event/data 字段),由 `parseIntellectEnterpriseSSE` 消费
- **StreamChunk**: 统一流式输出类型(复用 P1),8 值 type 字段
- **Agent**: intellect-team `/v1/models` 返回的 Agent 元数据(id/name/description)
- **Session**: intellect-team `/api/sessions` 返回的会话元数据(id/title/createdAt/updatedAt)
- **Message**: intellect-team `/api/sessions/{id}/messages` 返回的消息(role/content/createdAt)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 运维在 Admin 页面新增 intellect-enterprise 后端后,BFF 启动 5 秒内完成 healthCheck + capabilities 探测
- **SC-002**: 前端通过 `useHarnessCapabilities` 拿到企业版能力,UI 在 1 秒内完成条件渲染调整(隐藏画布入口)
- **SC-003**: 用户在企业版会话发送消息后,首字节(assistant.delta)到达前端时延 < 2 秒(intellect-team 正常负载下)
- **SC-004**: SSE 流式对话过程中,reasoning(tool.progress _thinking)与 delta(assistant.delta)正确区分渲染,无串流
- **SC-005**: `parseIntellectEnterpriseSSE` 契约测试覆盖全部 6 种事件类型(assistant.delta/tool.progress/run.completed/done/error + 边界事件),测试通过率 100%
- **SC-006**: IntellectEnterpriseAdapter 单元测试覆盖核心层 8 个方法 + 至少 4 个错误场景,测试通过率 100%
- **SC-007**: P0/P1/P2 现有 125 个 BFF 测试 + 8 个前端 service 测试 100% 不回归
- **SC-008**: BFF 路由层代码零改动(Principle II),仅 AdapterRegistry 注册新工厂,TypeScript 编译零错误

## Assumptions

- **intellect-team 实例可达**:P3 冒烟测试需要 intellect-team 运行在 localhost:8642,配置了 `API_SERVER_KEY` 和至少一个 Team/Project;若环境不可用,仅跑 Mock 单元测试
- **API_SERVER_KEY 鉴权生效**:intellect-team `/api/sessions/*` 端点接受 `Authorization: Bearer ${API_SERVER_KEY}`(Principle VIII),P3 不实现 `imt_p_*` 项目级 token
- **BffTenant 已扩展多租户字段**:P3 假设 `BffTenant` 已含 `intellectTeamId` / `intellectProjectId` 字段(若 P0/P1 未加,P3 spec-plan 阶段补齐 data-model)
- **复用 P1 StreamChunk 类型**:P3 不修改 `StreamChunk` 类型定义,仅启用 `tool_progress` 字段(P1 已预留)
- **复用 P1 BFF Agent 路由**:P3 不新增 BFF 路由,仅注册 Adapter 工厂到 AdapterRegistry
- **复用 P2 Admin CRUD**:P3 不新增 Admin 页面,P2 已支持的 `intellect-enterprise` backendType 直接可用
- **intellect-team `/v1/capabilities` 端点存在**:若实际不存在,`discoverCapabilities()` 返回硬编码默认能力(canvas=false, multiTenant=true)
- **P3 不实现 `/v1/runs/*` 异步任务流**(Principle VIII 禁用端点),留待 P4+ 评估
- **P3 不实现会话 fork**:intellect-team `POST /api/sessions/{id}/fork` 端点存在但 P3 不接入,留待 P4+
