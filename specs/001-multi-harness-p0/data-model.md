# Phase 1 Data Model: Multi-Harness P0

**Date**: 2026-06-26
**Status**: Complete
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

## Purpose

定义 P0 范围内的核心实体模型。所有字段类型与 [contracts/](./contracts/) 中的 TypeScript 定义一一对应。

---

## Entity: HarnessBackendConfig(配置层,JSON 文件持久化)

**Purpose**: 持久化到 `bff/data/harness-backends.json`,不含 token 明文

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | 后端唯一标识,kebab-case,如 `'intellect-rag-default'` |
| `name` | string | ✅ | 人类可读名称,如 `'Intellect RAG (Default)'` |
| `type` | `'intellect-rag' \| 'intellect-enterprise'` | ✅ | 后端类型,Constitution 命名规范锁定 |
| `endpoint` | string | ✅ | 后端 HTTP 端点,如 `'http://localhost:9380'` |
| `adminTokenEnvVar` | string | ✅ | admin token 环境变量名,如 `'HARNESS_INTELLECT_RAG_ADMIN_TOKEN'`(intellect-rag)或 `'HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY'`(intellect-enterprise,Constitution Principle VIII) |
| `projectTokenEnvVar` | string | ❌ | project token 环境变量名(P4+ 预留,P0-P3 不使用,Constitution Principle VIII v1.1.0) |
| `capabilities` | `HarnessCapabilities` | ✅ | 能力声明 |
| `defaultForTenant` | boolean | ❌ | 是否作为新 Tenant 的默认主后端 |

**Validation**:
- `id` 全局唯一
- `type` 必须是 `'intellect-rag'` 或 `'intellect-enterprise'`,禁用 `'intellect-community'`
- `endpoint` 必须是合法 http(s) URL
- `adminTokenEnvVar` 必须是合法的 shell 环境变量名(`^[A-Z][A-Z0-9_]*$`)
- `intellect-enterprise` 类型 P0-P3 阶段**不要求** `projectTokenEnvVar`(Constitution Principle VIII:P0-P3 统一用 `API_SERVER_KEY` + Team/Project 组织隔离头,P4+ 评估引入 `imt_p_*` 项目级 token)

---

## Entity: HarnessBackend(运行时,内存)

**Purpose**: `HarnessStore` 启动时合并 JSON + env 后的完整对象,运行时持有

**Fields**: HarnessBackendConfig 全部字段 + `adminToken` + `projectToken`(P4+ 预留)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| (继承) | - | ✅ | 继承 HarnessBackendConfig 所有字段 |
| `adminToken` | string | ✅ | admin token 明文(从 env 读取,仅内存)。intellect-enterprise 类型此字段承载 `API_SERVER_KEY`(Constitution Principle VIII) |
| `projectToken` | string | ❌ | project token 明文(P4+ 预留,P0-P3 不使用) |

**Lifecycle**:
- 启动时 `HarnessStore.load()` 创建
- 运行时通过 `HarnessStore.get(id)` / `list()` 读取
- 不写回磁盘

**Validation**:
- 若 `adminTokenEnvVar` 指向的环境变量未设置,该 backend 被跳过并告警(不抛异常)

---

## Entity: HarnessCapabilities

**Purpose**: 声明后端能力,前端据此条件渲染,BFF 据此选择走 Adapter 还是透传

**Fields**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `canvas` | boolean | ✅ | false | 是否支持画布(Intellect RAG = true,企业版 = false) |
| `knowledgeBase` | boolean | ✅ | false | 是否支持知识库 CRUD |
| `memory` | boolean | ✅ | false | 是否支持 Memory(对话历史/总结) |
| `mcp` | boolean | ✅ | false | 是否支持 MCP 工具调用 |
| `multiTenant` | boolean | ✅ | false | 是否支持实例内 Team/Project 组织模型(企业版 = true;真正租户隔离通过多实例部署) |
| `modelManagement` | boolean | ✅ | false | 是否支持模型管理 UI |

**Validation**:
- `intellect-rag` 类型:`canvas = true`、`multiTenant = false`
- `intellect-enterprise` 类型:`canvas = false`、`multiTenant = true`
- Constitution Principle III 校验:画布 capability 仅 `intellect-rag` 可声明

---

## Entity: BffTenant

**Purpose**: BFF 维护的租户实体,只存绑定关系,不复制业务数据(Constitution Principle V)

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | BFF Tenant UUID,如 `'tenant-001'` |
| `name` | string | ✅ | 人类可读名称 |
| `intellectTenantId` | string | ❌ | 对应的 Intellect 企业版 Tenant ID(企业版用户必填) |
| `intellectBackendId` | string | ✅ | 主后端 ID(指向 HarnessBackend.id) |
| `canvasBackendId` | string | ❌ | 画布后端 ID(必须是 `intellect-rag` 类型,Constitution Principle III) |
| `createdAt` | string | ✅ | ISO 8601 时间戳 |
| `updatedAt` | string | ✅ | ISO 8601 时间戳 |

**Validation**:
- `intellectBackendId` 必须在 `HarnessStore` 中存在
- `canvasBackendId` 若设置,对应的 `HarnessBackend.type` 必须是 `'intellect-rag'`
- `intellectTenantId` 在 `intellectBackendId` 指向 `intellect-enterprise` 后端时必填

**Lifecycle**:
- 通过 `TenantStore.createTenant()` 创建
- 通过 `TenantStore.setHarnessBinding()` / `setCanvasBinding()` 更新绑定
- 通过 `TenantStore.getTenant()` / `listTenants()` 查询
- 持久化到 `bff/data/bff-tenants.json`(无 token,可入库)

---

## Entity: TenantContext

**Purpose**: 请求上下文,携带租户/用户/Intellect 侧 team/project/session 标识,Adapter 据此注入 Team/Project 组织隔离头

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tenantId` | string | ✅ | BFF Tenant ID |
| `userId` | string | ✅ | 当前用户 ID |
| `intellectTeamId` | string | ❌ | Intellect 企业版实例内 Team ID(组织隔离场景必填)。Adapter 注入 `X-Intellect-Team` 头(Constitution Principle V v1.1.0)。注:真正的租户隔离通过多实例部署实现,此字段是实例内组织隔离 |
| `intellectProjectId` | string | ❌ | Intellect 企业版实例内 Project ID(组织隔离场景可选)。Adapter 注入 `X-Intellect-Project` 头。注:实例内 Project 级数据隔离,非租户隔离 |
| `intellectSessionId` | string | ❌ | Intellect 企业版 Session ID(可选,会话续接)。Adapter 注入 `X-Intellect-Session-Id` 头 |
| `intellectSessionKey` | string | ❌ | Intellect 企业版 Session Key(可选,长期记忆范围)。Adapter 注入 `X-Intellect-Session-Key` 头 |

**Lifecycle**:
- BFF 路由层从请求中提取(JWT/Session)+ 从 `TenantStore` 查询绑定关系,构造 `TenantContext`
- 传给 `IHarnessAdapter` / `IMultiTenantAdapter` 方法

---

## Entity: AgentSummary

**Purpose**: Agent 列表/详情的统一数据模型,P1 IntellectRagAdapter 与 P3 IntellectEnterpriseAdapter 共用

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | Agent ID |
| `name` | string | ✅ | Agent 名称 |
| `description` | string | ❌ | Agent 描述 |
| `avatarUrl` | string | ❌ | Agent 头像 URL |
| `capabilities` | string[] | ❌ | Agent 能力标签,如 `['chat', 'code', 'reasoning']` |
| `modelId` | string | ❌ | 默认模型 ID |
| `createdAt` | string | ❌ | ISO 8601 |
| `updatedAt` | string | ❌ | ISO 8601 |

---

## Entity: Session

**Purpose**: 会话实体,P1/P3 共用

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | Session ID |
| `agentId` | string | ✅ | 关联 Agent ID |
| `title` | string | ❌ | 会话标题 |
| `createdAt` | string | ✅ | ISO 8601 |
| `updatedAt` | string | ✅ | ISO 8601 |
| `metadata` | Record<string, unknown> | ❌ | 后端专有元数据(透传,不纳入统一 schema) |

---

## Entity: Team(扩展层,仅 Intellect 企业版)

**Purpose**: Intellect 企业版 Team 实体,BFF 透传管理

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | Team ID |
| `name` | string | ✅ | Team 名称 |
| `slug` | string | ✅ | Team slug(URL 友好) |
| `description` | string | ❌ | Team 描述 |
| `memberCount` | number | ❌ | 成员数 |
| `createdAt` | string | ❌ | ISO 8601 |
| `updatedAt` | string | ❌ | ISO 8601 |

---

## Entity: Project(扩展层,仅 Intellect 企业版)

**Purpose**: Intellect 企业版 Project 实体,BFF 透传管理

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | Project ID |
| `teamId` | string | ✅ | 所属 Team ID |
| `name` | string | ✅ | Project 名称 |
| `slug` | string | ✅ | Project slug |
| `description` | string | ❌ | Project 描述 |
| `memberCount` | number | ❌ | 成员数 |
| `createdAt` | string | ❌ | ISO 8601 |
| `updatedAt` | string | ❌ | ISO 8601 |

---

## Entity: TeamMember / ProjectMember(扩展层)

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | ✅ | 用户 ID |
| `name` | string | ❌ | 用户名称 |
| `email` | string | ❌ | 邮箱 |
| `role` | `'owner' \| 'admin' \| 'member'` | ✅ | 角色 |
| `addedAt` | string | ❌ | ISO 8601 |

---

## Entity: StreamChunk

**Purpose**: BFF 统一流式输出格式,两后端 SSE 解析后产出(Constitution Principle IV v1.1.0)

**Discriminated Union** by `type` field:

| type | Fields | Source |
|------|--------|--------|
| `'delta'` | `content: string` | Intellect RAG `choices[0].delta.content`;企业版 `event: assistant.delta` |
| `'reasoning'` | `content: string` | 企业版 `event: tool.progress`(`tool_name="_thinking"`);Intellect RAG `choices[0].delta.reasoning_content`(可选扩展) |
| `'tool_start'` | `toolName: string`, `toolCallId: string`, `args?: unknown` | 企业版 `event: tool.started`;P3 企业版编码 Agent 启用 |
| `'tool_complete'` | `toolCallId: string`, `result?: unknown` | 企业版 `event: tool.completed`;P3 |
| `'tool_progress'` | `toolName: string`, `toolCallId?: string`, `content: string` | 企业版 `event: tool.progress`(非 `_thinking` 的其他 `tool_name`);P3 启用 |
| `'usage'` | `usage: { promptTokens: number, completionTokens: number }` | 企业版 `run.completed.data.usage`;Intellect RAG 通过 `usage` 字段 |
| `'done'` | (无额外字段) | Intellect RAG `data: [DONE]`;企业版 `event: done` |
| `'error'` | `message: string`, `code?: string`, `toolCallId?: string` | 任意后端错误;企业版 `event: error` 或 `event: tool.failed`(带 `toolCallId`) |

**Validation**:
- `type` 枚举锁定为 8 个值(Constitution Principle IV v1.1.0 NON-NEGOTIABLE)
- 每个 type 的字段必填(除标注 `?` 的)
- 事件名以 intellect-team `plugins/platforms/api_server/adapter.py` `_handle_session_chat_stream` 实际实现为准,禁止臆造

---

## Entity Relationships

```text
HarnessBackendConfig (JSON)
  └─ adminTokenEnvVar ──> env var ──> adminToken (runtime)
                                      ↓
                              HarnessBackend (memory)
                                      ↑
                                      │ intellectBackendId
                                      │
                                  BffTenant ──── canvasBackendId ──> HarnessBackend (intellect-rag)
                                      │
                                      │ tenantId
                                      ↓
                                TenantContext (request-scoped)
                                      │
                                      ↓
                          IHarnessAdapter / IMultiTenantAdapter
                                      │
                                      ↓
                          StreamChunk[] (streaming response)
```

---

## State Transitions

### HarnessBackend 状态

```text
[missing env] --load()--> [skipped + warn]  (BFF 不阻塞启动)
[env present] --load()--> [ready]            (内存可用)
```

### BffTenant 状态

```text
[created] --setHarnessBinding()--> [bound to main backend]
[bound]   --setCanvasBinding()-->  [bound to main + canvas]  (仅企业版用户)
```

### StreamChunk 流转

```text
Intellect RAG (OpenAI 兼容,parseOpenAISSE):
[delta]*           --> [usage]?  --> [done]
[reasoning]?       --> [delta]*  --> [usage]? --> [done]  (若后端返回 reasoning_content)
[error] 可在任何时刻终止流

Intellect 企业版 (/api/sessions/{id}/chat/stream,parseIntellectEnterpriseSSE):
[reasoning]*  -->  [delta | tool_start | tool_progress | tool_complete]*  -->  [usage]  -->  [done]
[error] 可在任何时刻终止流(含 tool.failed 转 StreamError)

注:run.started / message.started / assistant.completed 为 BFF 内部状态,不映射到 StreamChunk
```
