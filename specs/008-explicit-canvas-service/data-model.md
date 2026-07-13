# Data Model: 显式 CanvasService — 画布脱离 Proxy 路由

**Feature**: 008-explicit-canvas-service
**Date**: 2026-06-27
**Status**: Complete

本文档定义本 spec 涉及的实体、字段、关系与校验规则。权威源是 [contracts/canvas-api.ts](./contracts/canvas-api.ts),运行时拷贝到 `bff/src/types/canvas.ts`。

---

## 实体 1: CanvasService

**Location**: `bff/src/services/canvas-service.ts`

**Description**: BFF 服务层实体,封装画布操作对 `IntellectRagAdapter` 的调用。硬绑定 `IntellectRagAdapter`(Constitution Principle III),不实现 `IHarnessAdapter` 接口(画布是 Intellect RAG 专属能力,不纳入统一 Adapter schema)。

**Constitution References**:
- Principle III (Canvas Hard-Bound): 硬绑定 IntellectRagAdapter
- Principle V (Tenant Isolation): 经 `AdapterRegistry.getCanvasBackendForTenant` 按租户路由
- Principle VII (YAGNI): 不引入 Canvas IR

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `registry` | `IAdapterRegistry` | 注入的 Registry 实例,用于按租户解析画布后端 |

### Methods

#### JSON 方法(调 `adapter.request()`)

| Method | Signature | Upstream | Notes |
|--------|-----------|----------|-------|
| `listCanvas` | `(ctx: TenantContext) => Promise<CanvasAgent[]>` | `GET /api/v1/agents` | 画布列表 |
| `getCanvas` | `(ctx, id: string) => Promise<CanvasAgent>` | `GET /api/v1/agents/:id` | 画布详情 |
| `createCanvas` | `(ctx, body: CreateCanvasBody) => Promise<CanvasAgent>` | `POST /api/v1/agents` | 画布 DSL 创建 |
| `saveCanvas` | `(ctx, id: string, body: SaveCanvasBody) => Promise<CanvasAgent>` | `PUT /api/v1/agents/:id` | 画布 DSL 编辑 |
| `deleteCanvas` | `(ctx, id: string) => Promise<void>` | `DELETE /api/v1/agents/:id` | 画布删除 |
| `resetCanvas` | `(ctx, id: string) => Promise<void>` | `POST /api/v1/agents/:id/reset` | 画布重置 |
| `listTemplates` | `(ctx) => Promise<CanvasTemplate[]>` | `GET /api/v1/agents/templates` | 画布模板 |
| `listTags` | `(ctx) => Promise<CanvasTag[]>` | `GET /api/v1/agents/tags` | 画布 tags 列表 |
| `updateTags` | `(ctx, id: string, body: UpdateTagsBody) => Promise<void>` | `PUT /api/v1/agents/:id/tags` | 更新画布 tags |
| `listVersions` | `(ctx, id: string) => Promise<CanvasVersion[]>` | `GET /api/v1/agents/:id/versions` | 版本列表 |
| `getVersion` | `(ctx, id: string, vid: string) => Promise<CanvasVersion>` | `GET /api/v1/agents/:id/versions/:vid` | 版本详情 |
| `getInputForm` | `(ctx, id: string, cid: string) => Promise<unknown>` | `GET /api/v1/agents/:id/components/:cid/input-form` | 组件 input-form |
| `debugComponent` | `(ctx, id: string, cid: string, body: unknown) => Promise<unknown>` | `POST /api/v1/agents/:id/components/:cid/debug` | 组件调试 |
| `trace` | `(ctx, id: string, messageId: string) => Promise<unknown>` | `GET /api/v1/agents/:id/logs/:messageId` | trace 日志 |
| `listPrompts` | `(ctx) => Promise<unknown>` | `GET /api/v1/agents/prompts` | prompt 列表 |
| `testDbConnection` | `(ctx, body: unknown) => Promise<unknown>` | `POST /api/v1/agents/test_db_connection` | 数据库连接测试 |
| `testWebhook` | `(ctx, id: string, body: unknown) => Promise<unknown>` | `POST /api/v1/agents/:id/webhook/test` | webhook 测试 |
| `fetchWebhookLogs` | `(ctx, id: string) => Promise<unknown>` | `GET /api/v1/agents/:id/webhook/logs` | webhook trace |
| `rerun` | `(ctx, body: unknown) => Promise<unknown>` | `POST /api/v1/agents/rerun` | pipeline 重跑 |
| `cancelTask` | `(ctx, taskId: string) => Promise<void>` | `POST /api/v1/tasks/:id/cancel` | 任务取消 |
| `fetchExternalInputs` | `(ctx, canvasId: string) => Promise<unknown>` | `GET /api/v1/agentbots/:id/inputs` | 外部 agent inputs |

#### 流式透传方法(调 `adapter.proxy()`)

| Method | Signature | Upstream | Notes |
|--------|-----------|----------|-------|
| `uploadAttachment` | `(ctx, id: string, req: ProxyRequest) => Promise<Response>` | `POST /api/v1/agents/:id/upload` | multipart 流式透传 |
| `downloadAttachment` | `(ctx, docId: string) => Promise<Response>` | `GET /api/v1/agents/attachments/:docId/download` | 附件下载流式透传 |
| `downloadFile` | `(ctx, req: ProxyRequest) => Promise<Response>` | `GET /api/v1/agents/download` | 文件下载流式透传 |

### Error Handling

`CanvasService` 方法抛出的错误由路由层捕获并映射(见 research.md R6):

- `RegistryNotReadyError` / `TenantNotFoundError` / `CanvasBackendNotBoundError` / `InvalidCanvasBackendError` / `BackendNotConfiguredError`:Registry 层抛出
- `Error`(含上游状态码信息):Adapter 层抛出,路由层按 message 中的状态码映射

---

## 实体 2: AdapterRegistry 扩展

**Location**: `bff/src/services/adapter-registry.ts`(已有文件,本 spec 新增方法)

**Description**: 在现有 `AdapterRegistry` 上新增 `getCanvasBackendForTenant` 方法,按租户解析画布后端,返回 `IntellectRagAdapter` 实例。

### New Method

```typescript
getCanvasBackendForTenant(tenantId: string): IntellectRagAdapter
```

**Resolution Flow**(research.md R3):

1. `tenant = tenantStore.getTenant(tenantId)`
2. 若 `tenant.canvasBackendId` 存在:
   - `adapter = getAdapterForBackend(tenant.canvasBackendId)`(复用缓存)
   - 若 `adapter instanceof IntellectRagAdapter` 为 false:抛 `InvalidCanvasBackendError`
   - 返回 `adapter as IntellectRagAdapter`
3. 若 `tenant.canvasBackendId` 不存在:
   - 若 `tenantId === 'default'` 或 `tenant` 不存在:回退首个 `type=intellect-rag` backend,调 `getAdapterForBackend` 返回
   - 否则:抛 `CanvasBackendNotBoundError`

### New Error Types

**Location**: `bff/src/services/adapter-registry-errors.ts`(已有文件,本 spec 新增)

| Error Class | Constructor Args | HTTP Status | Message Format |
|-------------|------------------|-------------|----------------|
| `CanvasBackendNotBoundError` | `tenantId: string` | 503 | `Tenant ${tenantId} has no canvas backend bound` |
| `InvalidCanvasBackendError` | `tenantId: string, backendId: string, actualType: string` | 503 | `Tenant ${tenantId} canvas backend ${backendId} has invalid type ${actualType}, expected intellect-rag` |

### Interface Update

**Location**: `bff/src/services/adapter-registry-types.ts`

`IAdapterRegistry` 接口新增:

```typescript
getCanvasBackendForTenant(tenantId: string): IntellectRagAdapter;
```

---

## 实体 3: IntellectRagAdapter 扩展

**Location**: `bff/src/services/adapters/intellect-rag/intellect-rag-adapter.ts`(已有文件,本 spec 新增方法)

**Description**: 在现有 `IntellectRagAdapter` 上新增 `proxy()` 方法,封装流式透传,用 Adapter 实例的 `baseUrl` + `adminToken`(而非全局 `intellect-client.proxy()` 的 `BASE_URL`),落实 Principle II 多后端支持。

### New Method

```typescript
async proxy(
  method: string,
  path: string,
  req: { headers: Headers; body?: ReadableStream<Uint8Array> | null; query: string }
): Promise<Response>
```

**Implementation**:

- URL: `${this.baseUrl}${path}${req.query}`(注意:`baseUrl` 已含 `/api/v1` 前缀的根,`path` 形如 `/api/v1/agents/:id/upload`)
- Headers: 复制 `req.headers`,删除 `host`,强制设置 `Authorization: Bearer ${this.adminToken}`(覆盖前端透传的 Authorization,用 Adapter 配置的 admin token)
- Body: 流式透传 `req.body`
- `duplex: 'half'`(Node fetch stream body)
- 返回上游 `Response` 原样(不调 `.json()/.text()`,保留 body ReadableStream)

### Rationale

- 当前 `intellect-rag-client.ts`（重命名自 `intellect-client.ts`）的 `proxy()` 用全局 `BASE_URL`(env `INTELLECT_RAG_HOST` + `PYTHON_API_PORT`),不支持多后端
- Adapter 自带 `proxy()` 用实例 `baseUrl`,支持按租户路由到不同 Intellect RAG 实例(Principle II)
- `adminToken` 覆盖前端 Authorization:画布操作需 admin 权限(创建/编辑/删除画布),前端 user token 权限不足

---

## 实体 4: Canvas Route Registry

**Location**: `bff/src/routes/canvas.ts`

**Description**: Hono 路由实体,显式声明所有 `/api/bff/canvas/*` 子路径,无 catch-all。每个子路径对应 `CanvasService` 的一个方法调用。

### Routes

| Method | Path | Handler | Service Method |
|--------|------|---------|----------------|
| GET | `/canvas` | `listCanvas` | `canvasService.listCanvas(ctx)` |
| POST | `/canvas` | `createCanvas` | `canvasService.createCanvas(ctx, body)` |
| GET | `/canvas/:id` | `getCanvas` | `canvasService.getCanvas(ctx, id)` |
| PUT | `/canvas/:id` | `saveCanvas` | `canvasService.saveCanvas(ctx, id, body)` |
| DELETE | `/canvas/:id` | `deleteCanvas` | `canvasService.deleteCanvas(ctx, id)` |
| POST | `/canvas/:id/reset` | `resetCanvas` | `canvasService.resetCanvas(ctx, id)` |
| GET | `/canvas/templates` | `listTemplates` | `canvasService.listTemplates(ctx)` |
| GET | `/canvas/tags` | `listTags` | `canvasService.listTags(ctx)` |
| PUT | `/canvas/:id/tags` | `updateTags` | `canvasService.updateTags(ctx, id, body)` |
| GET | `/canvas/:id/versions` | `listVersions` | `canvasService.listVersions(ctx, id)` |
| GET | `/canvas/:id/versions/:vid` | `getVersion` | `canvasService.getVersion(ctx, id, vid)` |
| GET | `/canvas/:id/components/:cid/input-form` | `getInputForm` | `canvasService.getInputForm(ctx, id, cid)` |
| POST | `/canvas/:id/components/:cid/debug` | `debugComponent` | `canvasService.debugComponent(ctx, id, cid, body)` |
| GET | `/canvas/:id/logs/:messageId` | `trace` | `canvasService.trace(ctx, id, messageId)` |
| GET | `/canvas/prompts` | `listPrompts` | `canvasService.listPrompts(ctx)` |
| POST | `/canvas/test_db_connection` | `testDbConnection` | `canvasService.testDbConnection(ctx, body)` |
| POST | `/canvas/:id/webhook/test` | `testWebhook` | `canvasService.testWebhook(ctx, id, body)` |
| GET | `/canvas/:id/webhook/logs` | `fetchWebhookLogs` | `canvasService.fetchWebhookLogs(ctx, id)` |
| POST | `/canvas/rerun` | `rerun` | `canvasService.rerun(ctx, body)` |
| POST | `/canvas/tasks/:taskId/cancel` | `cancelTask` | `canvasService.cancelTask(ctx, taskId)` |
| GET | `/canvas/:id/external-inputs` | `fetchExternalInputs` | `canvasService.fetchExternalInputs(ctx, id)` |
| POST | `/canvas/:id/upload` | `uploadAttachment` | `canvasService.uploadAttachment(ctx, id, req)`(流式) |
| GET | `/canvas/attachments/:docId/download` | `downloadAttachment` | `canvasService.downloadAttachment(ctx, docId)`(流式) |
| GET | `/canvas/download` | `downloadFile` | `canvasService.downloadFile(ctx, req)`(流式) |

### Middleware

- `authMiddleware`(鉴权,401 未授权拦截)
- `tenantContextMiddleware`(注入 `TenantContext`,缺失回退 `default`)

### Route Registration

`bff/src/index.ts` 新增:

```typescript
app.use('/canvas/*', authMiddleware);
app.use('/canvas/*', tenantContextMiddleware);
app.route('/', canvasRoutes);
```

挂载点 `/` 与 `bffAgentRoutes`/`proxyRoutes`/`authRoutes` 并列,路径前缀 `/canvas/*` 与 `/agents/*`、`/admin/*`、`/capabilities/*`、`/auth/*`、`/proxy/v1/*`、`/health` 不冲突。

---

## 实体 5: Canvas DTO Types

**Location**: `bff/src/types/canvas.ts`(运行时拷贝自 `contracts/canvas-api.ts`)

**Description**: 路由层入参/出参的最小 DTO,字段与 Intellect RAG 原生字段 1:1 对齐,不做语义转换(research.md R2)。

### DTOs

```typescript
// 画布实体(透传上游 /api/v1/agents 响应,字段 1:1)
export interface CanvasAgent {
  id: string;
  // Intellect RAG 上游字段透传,不强制类型(因 DSL schema 上游可控,本 spec 不镜像)
  [key: string]: unknown;
}

export interface CanvasTemplate {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface CanvasTag {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface CanvasVersion {
  id: string;
  agent_id: string;
  [key: string]: unknown;
}

// 请求 body DTO(字段与上游 1:1)
export interface CreateCanvasBody {
  name: string;
  dsl?: unknown;
  [key: string]: unknown;
}

export interface SaveCanvasBody {
  name?: string;
  dsl?: unknown;
  [key: string]: unknown;
}

export interface UpdateTagsBody {
  tags?: string[];
  [key: string]: unknown;
}
```

### Validation Rules

- DTO 仅做 TypeScript 类型校验,不做 runtime schema 校验(因上游 Intellect RAG 已校验,BFF 不重复校验,避免双源真相)
- `CanvasAgent` 等响应类型用 `[key: string]: unknown` 透传,不强制字段(因上游 DSL schema 可变,BFF 不镜像)

---

## 实体 6: BffTenant.canvasBackendId(复用,无 schema 变更)

**Location**: `bff/src/types/tenant.ts`(已有字段,本 spec 仅复用)

**Description**: BFF 租户绑定画布后端的引用,指向 `HarnessBackend.id`(`type=intellect-rag`)。本 spec 不修改字段定义,仅在 `AdapterRegistry.getCanvasBackendForTenant` 中使用。

### Existing Field

```typescript
canvasBackendId?: string;  // 已在 P0/P1 定义
```

### Validation(research.md R3)

- `getCanvasBackendForTenant` 解析时,若 `canvasBackendId` 指向的 backend `type !== 'intellect-rag'`,抛 `InvalidCanvasBackendError`(Principle III)
- 若 `canvasBackendId` 在 `HarnessStore` 中不存在,`getAdapterForBackend` 抛 `BackendNotConfiguredError`,路由层映射为 503
- 未设置 `canvasBackendId` 时:default 租户回退首个 `intellect-rag` backend,企业版租户抛 `CanvasBackendNotBoundError`

---

## 实体关系图

```
┌─────────────────────────────────────────────────────────────────┐
│  routes/canvas.ts (Hono Router)                                 │
│  ─────────────────────────────────                               │
│  GET/POST/PUT/DELETE /canvas/*  ──┐                             │
│  authMiddleware + tenantContextMiddleware                        │
└────────────────────────────────────│────────────────────────────┘
                                     │ ctx.tenantId
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  services/canvas-service.ts (CanvasService)                      │
│  ─────────────────────────────────────                           │
│  listCanvas(ctx)  saveCanvas(ctx,id,body)  uploadAttachment(...) │
│  debugComponent(...)  trace(...)  cancelTask(...)  ...           │
│  constructor(registry: IAdapterRegistry)                         │
└────────────────────────────────────│────────────────────────────┘
                                     │ registry.getCanvasBackendForTenant(ctx.tenantId)
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  services/adapter-registry.ts (AdapterRegistry)                  │
│  ─────────────────────────────────────────                       │
│  getCanvasBackendForTenant(tenantId): IntellectRagAdapter        │
│   1. tenant = tenantStore.getTenant(tenantId)                    │
│   2. if tenant.canvasBackendId:                                  │
│        adapter = getAdapterForBackend(canvasBackendId)           │
│        assert adapter instanceof IntellectRagAdapter             │
│        return adapter                                            │
│   3. if !canvasBackendId:                                        │
│        if tenantId === 'default': return 首个 intellect-rag      │
│        else: throw CanvasBackendNotBoundError                    │
└────────────────────────────────────│────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  adapters/intellect-rag/intellect-rag-adapter.ts                 │
│  (IntellectRagAdapter, 硬绑定,Principle III)                    │
│  ─────────────────────────────────────────                       │
│  request<T>(method, path, body?): Promise<T>     (JSON 方法)     │
│  proxy(method, path, req): Promise<Response>     (流式方法,新增) │
└────────────────────────────────────│────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Intellect RAG (:9380)                                           │
│  ─────────────────────────                                       │
│  /api/v1/agents/*  (canvas CRUD + 子域)                          │
│  /api/v1/tasks/:id/cancel                                        │
│  /api/v1/agentbots/:id/inputs                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## State Transitions

本 spec 无状态机(画布操作是无状态 HTTP 透传,不维护会话状态)。`CanvasService` 是无状态服务,每次请求独立处理。

---

## Summary

| Entity | Location | New/Modified | Constitution |
|--------|----------|--------------|--------------|
| CanvasService | `services/canvas-service.ts` | New | III, V, VII |
| AdapterRegistry.getCanvasBackendForTenant | `services/adapter-registry.ts` | Modified | II, III, V |
| CanvasBackendNotBoundError / InvalidCanvasBackendError | `services/adapter-registry-errors.ts` | New | V |
| IAdapterRegistry.getCanvasBackendForTenant | `services/adapter-registry-types.ts` | Modified | II |
| IntellectRagAdapter.proxy | `adapters/intellect-rag/intellect-rag-adapter.ts` | Modified | II |
| Canvas Route Registry | `routes/canvas.ts` | New | I |
| Canvas DTO Types | `types/canvas.ts` | New | VII |
| BffTenant.canvasBackendId | `types/tenant.ts` | Reused (no change) | III, V |
