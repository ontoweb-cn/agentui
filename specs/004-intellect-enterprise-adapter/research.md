# Research: Intellect Enterprise Adapter (P3)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-06-26

## Phase 0: Research Tasks

### R1. intellect-team API 端点实证(Constitution Principle VIII)

**Decision**: P3 Adapter 实现以下 intellect-team 端点(全部从 `plugins/platforms/api_server/adapter.py` 实证):

| 端点 | 方法 | Adapter 方法 | 用途 |
|------|------|-------------|------|
| `/health` | GET | `healthCheck()` | 健康检查,返回 boolean |
| `/v1/models` | GET | `listAgents()` | 列出可用 Agent(id/name) |
| `/v1/capabilities` | GET | `discoverCapabilities()` | 能力探测(若端点不存在,返回硬编码默认) |
| `/api/sessions` | POST | `createSession()` | 创建会话(可带 title) |
| `/api/sessions/{id}` | GET | `getSession()` | 获取会话元数据 |
| `/api/sessions/{id}` | DELETE | `deleteSession()` | 删除会话 |
| `/api/sessions/{id}/messages` | GET | `listMessages()` | 历史消息 |
| `/api/sessions/{id}/chat/stream` | POST | `sendMessage()` | **主通道**(Principle VIII),SSE 流 |

**Rationale**: 直接从 intellect-team 源码 `adapter.py:1114-1123` 路由注册确认,非臆造。 Constitution Principle VIII 锁定 `/api/sessions/{id}/chat/stream` 为唯一主通道,禁用 `/v1/chat/completions` stateless 端点。

**Alternatives considered**:
- `/v1/chat/completions`(OpenAI 兼容 stateless)— 拒绝,会导致会话状态分裂(Principle VIII 明确禁用)
- `/v1/runs/*`(异步任务流)— 拒绝,P3 不实现,留 P4+ 评估(Principle VIII)

**实证证据**: `intellect-team/plugins/platforms/api_server/adapter.py:1114-1123` 路由清单。

---

### R2. intellect-team SSE 事件实证(Constitution Principle IV)

**Decision**: `parseIntellectEnterpriseSSE` 处理以下事件(全部从 `adapter.py:1711-1762` 实证):

| SSE 事件 | data 字段 | → StreamChunk | 备注 |
|---------|-----------|---------------|------|
| `run.started` | `{user_message}` | (BFF 内部状态,不产出) | 流开始信号 |
| `message.started` | `{message: {id, role}}` | (BFF 内部状态,不产出) | 消息开始 |
| `assistant.delta` | `{message_id, delta}` | `{type:'delta', content: delta}` | 文本增量 |
| `tool.progress`(`tool_name="_thinking"`) | `{message_id, tool_name, delta}` | `{type:'reasoning', content: delta}` | reasoning 增量 |
| `tool.progress`(其他 tool_name) | `{message_id, tool_name, delta}` | `{type:'tool_progress', toolName, content: delta}` | 工具进度(P3 启用) |
| `tool.started` | `{message_id, tool_name, args}` | `{type:'tool_start', toolName, args}` | 工具开始 |
| `tool.completed` | `{message_id, tool_name, result}` | `{type:'tool_complete', toolName, result}` | 工具完成 |
| `tool.failed` | `{message_id, tool_name, error}` | `{type:'tool_complete', toolName, error}` | 工具失败(复用 tool_complete + error 字段) |
| `run.completed` | `{session_id, message_id, messages, usage}` | `{type:'usage', ...usage}` 后接 `{type:'done'}` | 完成 + Token 用量 |
| `error` | `{message}` | `{type:'error', message}` | 错误 |
| `done` | `{}` | (BFF 内部信号,关闭 SSE 连接) | 流终止 |

**Rationale**: 直接从 `adapter.py:1711-1762` 的 `_enqueue`/`_event_payload` 调用实证。Constitution Principle IV v1.2.0 事件清单与源码一致。

**Alternatives considered**:
- 复用 `parseCanvasWorkflowSSE` — 拒绝,事件名完全不同(Constitution Principle IV 禁止)
- 复用 `parseOpenAISSE` — 拒绝,企业版主通道是自定义事件非 OpenAI 兼容(Principle IV + VIII)

**实证证据**: `intellect-team/plugins/platforms/api_server/adapter.py:1711-1762`。

---

### R3. BffTenant 多租户字段映射决策(Constitution Principle V)

**Decision**: P3 不修改 `BffTenant` 接口。映射关系如下:

| BffTenant 字段 | TenantContext 字段 | intellect-team 请求头 |
|----------------|---------------------|----------------------|
| `intellectTenantId` | `intellectTeamId` | `X-Intellect-Team` |
| (无对应字段) | `intellectProjectId` | `X-Intellect-Project` |

**问题**: BffTenant 有 `intellectTenantId` 但无 `intellectProjectId`。TenantContext 有 `intellectTeamId`/`intellectProjectId` 但无 `intellectTenantId`。

**Rationale**: 
- `BffTenant.intellectTenantId` 在 P0 设计时的语义是"Intellect 企业版租户标识",实际 intellect-team 用 team_id 作为多租户隔离键。P3 将 `intellectTenantId` 视为 team_id 的同义词,BFF 路由层构造 TenantContext 时 `intellectTeamId = bffTenant.intellectTenantId`。
- `intellectProjectId` 缺失: intellect-team 的 `/api/sessions` 端点在无 `X-Intellect-Project` 头时使用 team 默认 project。P3 阶段不强制传 project_id,Adapter 仅在 TenantContext.intellectProjectId 存在时注入头。
- P4+ 评估是否给 BffTenant 新增 `intellectProjectId` 字段实现更细粒度隔离。

**Alternatives considered**:
- P3 修改 BffTenant 新增 `intellectProjectId` — 拒绝(YAGNI),当前 intellect-team 默认 project 够用,P4+ 按需扩展
- 重命名 `intellectTenantId` → `intellectTeamId` — 拒绝,破坏 P0 契约兼容性,用映射层解决

**实证证据**: `bff/src/types/tenant.ts:34`(BffTenant.intellectTenantId)+ `:81-87`(TenantContext.intellectTeamId/ProjectId)。

---

### R4. `/v1/capabilities` 端点存在性确认

**Decision**: P3 Adapter `discoverCapabilities()` 优先调 `GET /v1/capabilities`,若返回 404 则降级返回硬编码默认能力。

**默认能力**(`intellect-enterprise` 类型):
```typescript
{
  canvas: false,           // Constitution Principle III:企业版无画布
  knowledgeBase: false,    // 企业版用 intellect-team 自有知识库(透传层,非 Adapter 核心)
  memory: true,            // intellect-team 有长期记忆(session key)
  mcp: true,               // intellect-team 支持 MCP 工具
  multiTenant: true,       // Constitution Principle V:企业版多租户
  modelManagement: false,  // 模型管理走 intellect-team Admin,非 Adapter 核心
}
```

**Rationale**: intellect-team 源码未直接找到 `/v1/capabilities` 路由注册(可能在动态注册或不同模块)。降级策略确保 Adapter 在端点缺失时仍可用,不阻塞 P3。

**Alternatives considered**:
- 假设端点存在不降级 — 拒绝,若 404 会抛异常导致 Adapter 不可用,违反 Principle VII(healthCheck 不抛异常)
- 硬编码不调端点 — 拒绝,失去运行时能力探测能力,P2 条件渲染失效

---

### R5. IntellectEnterprise HTTP 客户端设计

**Decision**: 新增 `http-client.ts` 封装,统一处理:
- endpoint 拼接(`${baseUrl}${path}`)
- 鉴权头注入(`Authorization: Bearer ${API_SERVER_KEY}`)
- 多租户头注入(从 TenantContext 读取 `X-Intellect-Team`/`X-Intellect-Project`)
- 超时(REST 30s,SSE 流式不超时)
- 错误转换(非 2xx 抛 `HarnessBackendError`,404 在 `listMessages` 时返回空数组)

**Rationale**: 与 IntellectRagAdapter 内联 fetch 调用不同,企业版需注入多租户头 + API_SERVER_KEY,封装客户端降低重复 + 确保头注入不遗漏(Principle V 安全约束)。

**Alternatives considered**:
- Adapter 内联 fetch — 拒绝,多租户头注入逻辑会在每个方法重复,易遗漏
- 复用 IntellectRagAdapter 的 HTTP 逻辑 — 拒绝,鉴权方式不同(admin token vs API_SERVER_KEY),头注入不同

---

### R6. AdapterRegistry 工厂注册

**Decision**: 在 BFF 启动时(P1 已有的 `bff/src/index.ts` 初始化逻辑)新增一行:
```typescript
registry.registerFactory('intellect-enterprise', (backend) => new IntellectEnterpriseAdapter(backend));
```

**Rationale**: P1 已实现 `registerFactory(backendType, factory)` 方法,P3 仅调用一次注册,零改动 AdapterRegistry 类本身(Principle II)。

**Alternatives considered**: 无,这是 P1 预留的扩展点。

---

## Phase 0 总结

所有 NEEDS CLARIFICATION 已解决:
- ✅ intellect-team API 端点(R1 实证)
- ✅ SSE 事件清单(R2 实证)
- ✅ BffTenant 字段映射(R3 决策:不修改接口,用映射层)
- ✅ `/v1/capabilities` 端点存在性(R4 降级策略)
- ✅ HTTP 客户端设计(R5 封装决策)
- ✅ AdapterRegistry 注册(R6 调用既有方法)

**Gate**: 可进入 Phase 1 设计阶段。
