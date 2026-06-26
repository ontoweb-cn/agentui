# Data Model: Multi-Harness P1 — IntellectRagAdapter 实现 + 路由原生迁移

**Feature**: [002-multi-harness-p1](./)
**Date**: 2026-06-26
**Status**: Draft

## 概述

P1 在 P0 已有的类型体系(`IHarnessAdapter`、`StreamChunk`、`TenantContext`、`HarnessBackend`)基础上,新增 `IntellectRagAdapter` 实现、`AdapterRegistry`、`TenantContext` 中间件、`parseCanvasWorkflowSSE` 解析器,并调整 Session 方法签名以适配 Intellect RAG 嵌套结构。

P0 已定义的类型(`HarnessBackend`、`BffTenant`、`AgentSummary`、`Session`、`StreamChunk` 等)不在 P1 重复定义,仅记录 P1 新增或调整的部分。

---

## 实体 1: IntellectRagAdapter (新增)

**角色**: Adapter 实现类,封装 Intellect RAG REST API 调用,实现 `IHarnessAdapter` 接口(Layer 1)。

**Constitution 引用**: Principle II(Adapter Abstraction)、Principle IV(SSE Dual-Protocol,canvas workflow 解析)、Principle V(单租户,不注入多租户头)。

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `backendId` | `string` (readonly) | 是 | 对应 `HarnessBackend.id`,如 `'intellect-rag-default'` |
| `baseUrl` | `string` (private) | 是 | Intellect RAG API 根 URL,如 `'http://localhost:9380/api/v1'` |
| `adminToken` | `string` (private) | 是 | 从 env 注入的 `HARNESS_INTELLECT_RAG_ADMIN_TOKEN`,不落盘 |
| `capabilities` | `HarnessCapabilities` (private) | 是 | 静态能力声明,从 `HarnessBackend.capabilities` 传入 |

### 方法(实现 IHarnessAdapter)

| 方法 | 签名 | 说明 |
|------|------|------|
| `listAgents` | `(ctx: TenantContext) => Promise<AgentSummary[]>` | 调 `GET {baseUrl}/agents`,透传 Authorization header |
| `getAgent` | `(ctx, agentId) => Promise<AgentSummary>` | 调 `GET {baseUrl}/agents/{agentId}` |
| `createSession` | `(ctx, agentId, title?) => Promise<Session>` | 调 `POST {baseUrl}/agents/{agentId}/sessions`,body `{name: title}` |
| `listSessions` | `(ctx, agentId) => Promise<Session[]>` | 调 `GET {baseUrl}/agents/{agentId}/sessions`(**契约调整,新增 agentId**) |
| `getSession` | `(ctx, agentId, sessionId) => Promise<Session>` | 调 `GET {baseUrl}/agents/{agentId}/sessions/{sessionId}`(**契约调整**) |
| `deleteSession` | `(ctx, agentId, sessionId) => Promise<void>` | 调 `DELETE {baseUrl}/agents/{agentId}/sessions/{sessionId}`(**契约调整**) |
| `sendMessage` | `(ctx, req) => Promise<StreamIterable>` | 调 `POST {baseUrl}/agents/chat/completions`,返回 `parseCanvasWorkflowSSE` 产出的 StreamChunk 迭代器 |
| `cancelMessage` | `(ctx, sessionId) => Promise<void>` | 调 Intellect RAG 取消端点(若存在,否则 stub) |
| `healthCheck` | `() => Promise<boolean>` | 调 `GET {baseUrl}/health` 或 `/v1/agents` 探测 |
| `discoverCapabilities` | `() => Promise<HarnessCapabilities>` | 返回静态 `capabilities`(P1 不动态探测) |

### 行为约束

- **不注入多租户头**:Intellect RAG 是单租户后端(Principle V),`X-Intellect-Team`/`X-Intellect-Project` 不注入
- **Authorization 透传**:从 `ctx` 或 BFF 启动配置注入 `Bearer ${adminToken}`,前端 token 不直接转发(P0 鉴权模式)
- **错误处理**:上游非 200 抛出明确错误(含 URL + status),不吞异常
- **实例复用**:同一 `backendId` 对应同一 Adapter 实例(由 AdapterRegistry 保证)

### 依赖

- `IHarnessAdapter`(P0 契约,需调整 session 方法签名)
- `HarnessBackend`(P0 类型,提供 baseUrl/adminToken/capabilities)
- `TenantContext`(P0 类型,提供 tenantId/userId)
- `parseCanvasWorkflowSSE`(P1 新增,见实体 4)
- `node-fetch` 或 Hono 内置 fetch(已用)

---

## 实体 2: AdapterRegistry (新增)

**角色**: Adapter 注册中心,根据 `tenantId` 查询 `TenantStore` 绑定关系,从 `HarnessStore` 获取后端配置,创建/复用 Adapter 实例。

**Constitution 引用**: Principle II(Adapter 通过 Registry 选择,路由层不感知具体后端)。

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `harnessStore` | `HarnessStore` (private) | 是 | P0 实现,提供 `getBackend(id)` |
| `tenantStore` | `TenantStore` (private) | 是 | P0 实现,提供 `getTenant(id)` |
| `adapterCache` | `Map<string, IHarnessAdapter>` (private) | 是 | backendId → Adapter 实例缓存,避免重复创建 |
| `factories` | `Map<BackendType, HarnessAdapterFactory>` (private) | 是 | 后端类型 → 工厂函数注册表 |

### 方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `getAdapterForTenant` | `(tenantId: string) => IHarnessAdapter` | 查 TenantStore 获取 tenant → 查 intellectBackendId → 查 HarnessStore 获取 backend → 创建/复用 Adapter |
| `getAdapterForBackend` | `(backendId: string) => IHarnessAdapter` | 直接按 backendId 获取 Adapter(用于 canvas 硬绑定场景,Principle III) |
| `registerFactory` | `(backendType, factory) => void` | 注册后端类型对应的 Adapter 工厂(P1 注册 `'intellect-rag'` → IntellectRagAdapterFactory) |
| `isReady` | `() => boolean` | Store 是否已加载完成,未就绪时路由层返回 503 |

### 行为约束

- **线程安全**:并发请求同一 tenant 不创建多个 Adapter 实例(用 cache 保证)
- **未就绪处理**:Store 未 load 完成时,`getAdapterForTenant` 抛错或返回 null,路由层返回 503
- **配置不一致**:tenant 绑定的 backendId 在 HarnessStore 不存在时,返回明确错误(不静默)
- **P1 范围**:仅支持单后端(intellect-rag),P3 扩展多后端切换

### 边界场景

- tenantId 不存在 → 抛 `TenantNotFoundError`
- tenant 绑定的 backendId 不存在 → 抛 `BackendNotConfiguredError`
- backendType 无对应 factory → 抛 `AdapterFactoryNotRegisteredError`
- Store 未就绪 → 抛 `RegistryNotReadyError`

---

## 实体 3: TenantContext 中间件 (新增)

**角色**: Hono 中间件,从请求提取 tenantId/userId 构造 `TenantContext`,注入 Hono context 供路由层使用。

**Constitution 引用**: Principle V(BFF 维护 TenantContext,Adapter 据此注入多租户头或跳过)。

### 提取规则

| 来源 | 字段 | P1 实现 | P3+ 扩展 |
|------|------|---------|-----------|
| HTTP Header | `X-Tenant-Id` | ✅ 提取 tenantId | 保留作为 fallback |
| HTTP Header | `X-User-Id` | ✅ 提取 userId | 保留 |
| JWT | `payload.tenant_id` | ❌ P1 不实现 | ✅ P3 优先解析 JWT |
| JWT | `payload.user_id` | ❌ P1 不实现 | ✅ P3 优先解析 JWT |
| HTTP Header | `X-Intellect-Team` | ❌ P1 不提取(单租户) | ✅ P3 企业版透传 |
| HTTP Header | `X-Intellect-Project` | ❌ P1 不提取 | ✅ P3 企业版透传 |

### 行为

1. 从 `X-Tenant-Id` / `X-User-Id` header 提取字段
2. 构造 `TenantContext { tenantId, userId, intellectTeamId?, intellectProjectId? }`
3. 注入 `c.set('tenantContext', ctx)`
4. 调用 `next()` 继续路由链
5. 若 `tenantId` 缺失,返回 400 明确错误(不静默使用默认 tenant)

### 依赖

- `TenantContext` 类型(P0 已定义,位于 `bff/src/types/tenant.ts`)
- Hono 中间件签名 `(c: Context, next: () => Promise<void>) => Promise<void | Response>`

---

## 实体 4: parseCanvasWorkflowSSE (新增)

**角色**: 纯函数,将 Intellect RAG Canvas Workflow SSE 字节流转换为 `StreamChunk` 迭代器。

**Constitution 引用**: Principle IV(SSE Dual-Protocol,canvas workflow 解析器)、research.md R1-R2(实证 canvas workflow 协议)。

### 签名

```typescript
function parseCanvasWorkflowSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<StreamChunk>;
```

### 事件映射(Intellect RAG canvas.py 实证)

| Intellect RAG 事件 | StreamChunk | 字段映射 |
|-------------------|-------------|---------|
| `workflow_started` | (内部状态,不产出) | — |
| `node_started` | (内部状态,不产出) | — |
| `node_finished` | (内部状态,不产出,可选 metadata 透传) | — |
| `message` + `data.content` | `StreamDelta { type: 'delta', content }` | content 直传 |
| `message` + `data.start_to_think: true` | `StreamReasoning { type: 'reasoning', content }` | 思考链开始标记(与 content 同 chunk 或独立) |
| `message` + `data.end_to_think: true` | `StreamReasoning` 或标记 | 思考链结束 |
| `message_end` + `data.reference` | `StreamDelta { type: 'delta', content: '' }` + metadata.reference | reference 透传到 Layer 3 metadata(Principle III) |
| `workflow_finished` | `StreamDone { type: 'done' }` | 流终止 |
| 非 200 / 解析失败 | `StreamError { type: 'error', message }` | 错误 |
| (无 `[DONE]` 哨兵) | — | canvas workflow 用 `workflow_finished` 终止,不用 `[DONE]` |

### 关键差异(与 OpenAI SSE 对比)

- **无 `choices[]` 结构**:canvas workflow 事件直接含 `data.content`
- **无 `[DONE]` 哨兵**:用 `workflow_finished` 事件终止
- **`reference` 字段**:RAG 引用透传,不纳入 StreamChunk 一等字段(Principle III Layer 3)
- **思考链标记**:`start_to_think`/`end_to_think` 布尔标记,非独立 reasoning 字段

### 行为约束

- **纯函数**:无副作用,输入流 → 输出迭代器
- **错误隔离**:单个事件解析失败产出 `StreamError` 但不中断流(除非是不可恢复错误)
- **背压**:用 async generator 自然背压,`for-await-of` 消费速度控制上游读取

---

## 实体 5: IHarnessAdapter 契约调整 (P0 → P1)

**角色**: 调整 Session 方法签名,新增 `agentId` 参数以适配 Intellect RAG 嵌套结构。

**依据**: research.md R3(Intellect RAG session 嵌套在 `/agents/{agentId}/sessions` 下)。

### 调整清单

| 方法 | P0 签名 | P1 调整后签名 | 理由 |
|------|---------|--------------|------|
| `createSession` | `(ctx, agentId, title?)` | ✅ 不变(P0 已有 agentId) | — |
| `listSessions` | `(ctx) => Session[]` | `(ctx, agentId) => Session[]` | Intellect RAG 嵌套在 agent 下 |
| `getSession` | `(ctx, sessionId)` | `(ctx, agentId, sessionId)` | 同上 |
| `deleteSession` | `(ctx, sessionId)` | `(ctx, agentId, sessionId)` | 同上 |

### 影响

- `bff/src/types/adapter.ts`:调整接口签名
- `specs/001-multi-harness-p0/contracts/harness-adapter.ts`:同步更新权威源
- P3 `IntellectEnterpriseAdapter`:intellect-team session 不嵌套在 agent 下(`/api/sessions` 全局),`agentId` 参数可忽略或 stub

### Alternatives Considered

1. **保持 P0 签名,Adapter 内部用 ctx 传 agentId**:❌ 拒绝。agentId 是路径参数,不是 tenant 级配置,污染 TenantContext 语义
2. **Session 域保留透传,P1 不迁移**:❌ 拒绝。Session 是 Agent 核心配套,不迁移导致 Adapter 抽象断裂

---

## 实体 6: BFF Agent 路由调整 (现有路由改造)

**角色**: 将 P0 透明代理路由(`/api/bff/proxy/v1/agents/*`)迁移到 BFF 原生路由(`/api/bff/agents/*`),内部调 Adapter。

### 路由清单

| 方法 | P0 路径(透传) | P1 路径(原生) | Adapter 调用 |
|------|---------------|---------------|-------------|
| GET | `/api/bff/proxy/v1/agents` | `/api/bff/agents` | `adapter.listAgents(ctx)` |
| POST | `/api/bff/proxy/v1/agents` | `/api/bff/agents` | 透传(Layer 3,canvas DSL 创建) |
| GET | `/api/bff/proxy/v1/agents/{id}` | `/api/bff/agents/{id}` | `adapter.getAgent(ctx, id)` |
| PUT | `/api/bff/proxy/v1/agents/{id}` | `/api/bff/agents/{id}` | 透传(Layer 3,canvas DSL 编辑) |
| DELETE | `/api/bff/proxy/v1/agents/{id}` | `/api/bff/agents/{id}` | 透传(Layer 3)或 Adapter 扩展 |
| GET | `/api/bff/proxy/v1/agents/{id}/sessions` | `/api/bff/agents/{id}/sessions` | `adapter.listSessions(ctx, id)` |
| POST | `/api/bff/proxy/v1/agents/{id}/sessions` | `/api/bff/agents/{id}/sessions` | `adapter.createSession(ctx, id, title)` |
| GET | `/api/bff/proxy/v1/agents/{id}/sessions/{sid}` | `/api/bff/agents/{id}/sessions/{sid}` | `adapter.getSession(ctx, id, sid)` |
| DELETE | `/api/bff/proxy/v1/agents/{id}/sessions/{sid}` | `/api/bff/agents/{id}/sessions/{sid}` | `adapter.deleteSession(ctx, id, sid)` |
| POST | `/api/bff/proxy/v1/agents/chat/completions` | `/api/bff/agents/chat/completions` | `adapter.sendMessage(ctx, req)` → SSE 透传 |

### 行为约束

- **P0 透传路由保留**:未迁移域(Dataset/KB/Search/Memory/MCP + Agent DSL 编辑)继续走 `/api/bff/proxy/v1/*`
- **前端零回归**:响应格式与 P0 透传逐字段一致
- **错误格式**:Adapter 错误转换为与透传一致的错误响应(404/500/502)

---

## 状态转换

### AdapterRegistry 启动状态机

```
[Init] --loadStores()--> [Loading] --success--> [Ready] --请求--> [Serving]
                            |
                            +--failure--> [Error] (BFF 启动失败)
```

### IntellectRagAdapter.sendMessage 流状态机

```
[Idle] --sendMessage()--> [Connecting] --200--> [Streaming] --workflow_finished--> [Done]
                                |
                                +--non-200--> [Error]
                                |
                                +--parse-fail--> [Error]
```

---

## 验证规则

1. **IntellectRagAdapter**:必须实现 IHarnessAdapter 所有方法,缺一即编译失败(TypeScript 接口约束)
2. **AdapterRegistry**:同一 tenantId 多次调用返回同一 Adapter 实例(`===` 相等)
3. **parseCanvasWorkflowSSE**:输入录制 fixture,产出 StreamChunk 序列必须与预期一致(契约测试)
4. **TenantContext 中间件**:缺失 `X-Tenant-Id` 返回 400,不进入路由处理
5. **路由迁移**:P0 透传路径 `/api/bff/proxy/v1/agents/*` 与 P1 原生路径 `/api/bff/agents/*` 响应逐字段一致

---

## 与 P0 类型的关系

| P0 类型 | P1 操作 | 说明 |
|---------|---------|------|
| `IHarnessAdapter` | 调整(实体 5) | Session 方法新增 agentId |
| `StreamChunk` | 不变 | P0 8 值枚举满足 P1 canvas workflow 映射 |
| `TenantContext` | 不变 | P1 中间件构造此类型 |
| `HarnessBackend` | 不变 | P1 Adapter 从此类型获取配置 |
| `BffTenant` | 不变 | P1 Registry 查询此类型 |
| `HarnessStore` | 不变 | P1 Registry 依赖此类型 |
| `TenantStore` | 不变 | P1 Registry 依赖此类型 |
| `AgentSummary` / `Session` | 不变 | P1 Adapter 返回此类型 |
