# Data Model: Intellect Enterprise Adapter (P3)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-06-26

## 实体清单

### 1. IntellectEnterpriseAdapter(运行时类)

**实现接口**: `IHarnessAdapter`(P1 已定义,复用)

**字段**:
- `backendId: string` — 后端 ID(从 HarnessBackend.id)
- `baseUrl: string` — intellect-team endpoint(如 `http://localhost:8642`),去除尾部 `/`
- `apiServerKey: string` — intellect-team 全局 API Key(从 env `API_SERVER_KEY` 注入,Constitution Principle VIII)
- `capabilities: HarnessCapabilities` — 后端能力(从 HarnessBackend.capabilities,canvas=false)
- `httpClient: IntellectEnterpriseHttpClient` — HTTP 客户端封装(实体 2)

**方法**(全部实现 `IHarnessAdapter`):
- `listAgents(ctx: TenantContext): Promise<AgentSummary[]>` — GET `/v1/models`
- `createSession(ctx, { agentId, title? }): Promise<Session>` — POST `/api/sessions`
- `getSession(ctx, sessionId): Promise<Session>` — GET `/api/sessions/{id}`
- `deleteSession(ctx, sessionId): Promise<void>` — DELETE `/api/sessions/{id}`
- `listMessages(ctx, sessionId): Promise<Message[]>` — GET `/api/sessions/{id}/messages`
- `sendMessage(ctx, sessionId, req): StreamIterable` — POST `/api/sessions/{id}/chat/stream`,返回 `parseIntelinctEnterpriseSSE(stream)` 的 AsyncIterable
- `healthCheck(): Promise<boolean>` — GET `/health`,不抛异常
- `discoverCapabilities(): Promise<HarnessCapabilities>` — GET `/v1/capabilities`,404 降级返回硬编码默认

**状态转换**: 无状态(每次调用独立 HTTP 请求,SSE 流式方法返回 AsyncIterable)

**校验规则**:
- `baseUrl` 必须以 `http://` 或 `https://` 开头(HarnessStore 加载时校验)
- `apiServerKey` 必须非空(从 env 读取,缺失时 healthCheck 返回 false)

---

### 2. IntellectEnterpriseHttpClient(运行时类,内部封装)

**职责**: 封装 intellect-team HTTP 调用,统一注入鉴权头 + Team/Project 组织隔离头 + 错误转换

**字段**:
- `baseUrl: string`
- `apiServerKey: string`

**方法**:
- `request<T>(method, path, ctx: TenantContext, body?): Promise<T>` — REST 请求(30s 超时)
- `requestStream(path, ctx, body): Promise<ReadableStream<Uint8Array>>` — SSE 流请求(不超时)

**头注入逻辑**(Constitution Principle V):
- `Authorization: Bearer ${apiServerKey}`(必填)
- `X-Intellect-Team: ${ctx.intellectTeamId}`(当 ctx.intellectTeamId 存在)
- `X-Intellect-Project: ${ctx.intellectProjectId}`(当 ctx.intellectProjectId 存在)
- `X-Intellect-Session-Id: ${ctx.intellectSessionId}`(可选)
- `X-Intellect-Session-Key: ${ctx.intellectSessionKey}`(可选)
- `Content-Type: application/json`

**错误转换**:
- 2xx → 解析 JSON 返回 T
- 404 → 抛 `NotFoundError`(Adapter 层捕获后按方法降级:listMessages 返回空数组,getSession/listAgents 返回 undefined/[])
- 5xx / 网络错误 → 抛 `HarnessBackendError(message, status)`
- 超时 → 抛 `HarnessBackendError('Request timeout', 408)`

---

### 3. IntellectEnterpriseSSEEvent(SSE 原始事件,解析器输入)

**定义**: 见 [contracts/intellect-enterprise-sse-mapping.ts](./contracts/intellect-enterprise-sse-mapping.ts)

**类型**: `IntellectEnterpriseEvent`(10 值:run.started/message.started/assistant.delta/tool.progress/tool.started/tool.completed/tool.failed/run.completed/error/done)

**Payload 类型**: `RunStartedPayload` / `MessageStartedPayload` / `AssistantDeltaPayload` / `ToolProgressPayload` / `ToolStartedPayload` / `ToolCompletedPayload` / `ToolFailedPayload` / `RunCompletedPayload` / `ErrorPayload` / `DonePayload`

---

### 4. StreamChunk(输出类型,复用 P1)

**定义**: Constitution Principle IV v1.2.0,8 值 type 字段

**P3 启用**: `tool_progress`(P1 预留,P3 首次产出)

**P3 不修改**: 类型定义本身(P1 已定义,复用 `bff/src/types/stream.ts`)

---

### 5. AgentSummary / Session / Message(领域类型,复用 P1)

**定义**: `bff/src/types/domain.ts`(P1 已定义)

**intellect-team 响应映射**:
- `AgentSummary`: intellect-team `/v1/models` → `{id, name, description?}`
- `Session`: intellect-team `/api/sessions` → `{id, title?, createdAt, updatedAt}`
- `Message`: intellect-team `/api/sessions/{id}/messages` → `{role, content, createdAt}`

---

### 6. IntellectEnterpriseAdapterFactory(工厂函数)

**签名**: `(backend: HarnessBackend) => IHarnessAdapter`

**注册**: `registry.registerFactory('intellect-enterprise', factory)`(BFF 启动时调用一次)

**复用**: P1 已实现 `AdapterRegistry.registerFactory`,P3 仅调用,不修改类

---

## 实体关系图

```
HarnessBackend (P0, JSON+env)
    │
    ├── type: 'intellect-enterprise'
    ├── endpoint: 'http://localhost:8642'
    ├── adminTokenEnvVar: 'API_SERVER_KEY'  → env 注入 adminToken
    └── capabilities: { canvas:false, multiTenant:true, ... }
         │
         ▼
IntellectEnterpriseAdapterFactory(backend) → new IntellectEnterpriseAdapter(backend)
         │
         ├── httpClient: IntellectEnterpriseHttpClient(baseUrl, apiServerKey)
         │       └── 注入头: Authorization / X-Intellect-Team / X-Intellect-Project
         │
         ├── listAgents(ctx) → GET /v1/models → AgentSummary[]
         ├── createSession(ctx, req) → POST /api/sessions → Session
         ├── sendMessage(ctx, sessionId, req) → POST /api/sessions/{id}/chat/stream
         │       └── ReadableStream → parseIntellectEnterpriseSSE → AsyncIterable<StreamChunk>
         ├── healthCheck() → GET /health → boolean
         └── discoverCapabilities() → GET /v1/capabilities → HarnessCapabilities (404 降级)

BffTenant (P0, JSON)
    ├── intellectTenantId  →  映射到  TenantContext.intellectTeamId  →  X-Intellect-Team 头
    └── (无 intellectProjectId,P3 不传 X-Intellect-Project,P4+ 按需扩展)
```

## 校验规则汇总

| 实体 | 字段 | 规则 | 校验位置 |
|------|------|------|---------|
| HarnessBackend | type | `=== 'intellect-enterprise'` | HarnessStore 加载(P0) |
| HarnessBackend | endpoint | `http://` 或 `https://` 前缀 | HarnessStore 加载(P0) |
| HarnessBackend | adminTokenEnvVar | 环境变量名格式 `^[A-Z_][A-Z0-9_]*$` | P2 harness-admin-validation |
| IntellectEnterpriseAdapter | apiServerKey | 非空(env 注入) | 运行时 healthCheck |
| TenantContext | intellectTeamId | UUID 格式(intellect-team DB teams.id) | BFF 路由层构造时 |
| SSE event | data JSON | 可解析 | parseIntellectEnterpriseSSE 容错 |
