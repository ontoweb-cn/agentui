# Research: Multi-Harness P1 — SSE 双协议 + 契约映射

**Feature**: [002-multi-harness-p1](./)
**Date**: 2026-06-26
**Status**: Complete

## 概述

本 research 解决 plan.md 中标记的 3 个 NEEDS CLARIFICATION 与 1 个 Constitution Principle IV VIOLATION。所有结论基于 intellect-rag 源码实证(`api/apps/restful_apis/agent_api.py`、`agent/canvas.py`)与前端实际消费代码(`src/hooks/use-send-message.ts`、`src/services/agent-service.ts`)。

---

## R1. Intellect RAG SSE 双协议实证

### Decision

Intellect RAG 存在**两套独立的 SSE 协议**,服务不同场景,Constitution Principle IV v1.1.0 描述不完整,需修订为 v1.2.0。

### 证据(Intellect RAG 源码)

**协议 A: Canvas Workflow SSE**(`POST /api/v1/agents/chat/completions`)

- 路由:`@manager.route("/agents/chat/completions")` → `agent_chat_completion`(agent_api.py:1211)
- 输出源:`agent/canvas.py` 的 `Canvas.run()` async generator
- 事件类型(从 `canvas.py:419-592` 实证):
  - `workflow_started` — 流开始,含 inputs
  - `node_started` — 节点开始,含 component_id/component_name/component_type
  - `node_finished` — 节点完成,含 inputs/outputs/elapsed_time
  - `message` — 文本增量,含 `data.content`(逐字)、可选 `audio_binary`、`start_to_think`/`end_to_think`(思考链标记)
  - `message_end` — 消息结束,含 `reference`(RAG 引用)
  - `workflow_finished` — 流结束
- 数据结构:`{event: "message", message_id: "...", session_id: "...", created_at: ..., data: {content: "..."}}`
- **前端实际消费此协议**:`src/hooks/use-send-message.ts:10-22` 定义 `MessageEventType` 枚举,与上述事件名完全对应;`use-send-message.ts:156` 用 `EventSourceParserStream` 解析

**协议 B: OpenAI 兼容 SSE**(`POST /openai/{chat_id}/chat/completions`)

- 路由:OpenAI 兼容端点(外部集成用,非前端主路径)
- 输出:标准 OpenAI 格式 `choices[].delta.content` / `choices[].finish_reason` / `usage`
- 证据:`test/testcases/restful_api/test_openai_compatible.py:128-138` 断言 `choices[0].finish_reason == "stop"`、`usage.prompt_tokens > 0`
- **前端不消费此协议**(前端 api.ts 无 `/openai/` 路径常量)

### Constitution Principle IV 修订建议(v1.1.0 → v1.2.0)

**原 v1.1.0 描述(偏差)**:
> Intellect RAG:OpenAI 兼容 `data: {"choices":[{"delta":...}]}` / `data: [DONE]`,用 `parseOpenAISSE`

**修订为 v1.2.0**:
> Intellect RAG **双协议并存**(intellect-rag `agent/canvas.py` + `api/apps/restful_apis/agent_api.py` 实际实现):
> - **Canvas Workflow SSE**(`/api/v1/agents/chat/completions`,前端主通道):自定义事件 `workflow_started`/`node_started`/`node_finished`/`message`/`message_end`/`workflow_finished`,用 `parseCanvasWorkflowSSE`。前端 `use-send-message.ts` 消费此协议
> - **OpenAI 兼容 SSE**(`/openai/{chat_id}/chat/completions`,外部集成):标准 `choices[].delta`/`[DONE]`,用 `parseOpenAISSE`
> - P1 优先实现 `parseCanvasWorkflowSSE`(前端实际用),`parseOpenAISSE` 留待 P3 企业版或外部集成场景

### Alternatives Considered

1. **仅实现 parseOpenAISSE**(遵循 constitution v1.1.0 字面):❌ 拒绝。前端实际用 canvas workflow,实现 OpenAI 解析器无法消费前端流式,US2 不可达成
2. **修订 constitution 描述为实际双协议**:✅ 采纳。Constitution Governance 规定"与 design doc 冲突时以 constitution 为准",但本冲突是 constitution 描述与源码实证的冲突,需修订 constitution 反映真实
3. **删除 OpenAI 兼容端点描述**:❌ 拒绝。OpenAI 兼容端点真实存在,外部集成场景需要,P3 企业版也可能复用

---

## R2. Canvas Workflow 流式范围(Principle III 边界)

### Decision

Canvas Workflow SSE **属于 Principle IV "SSE Dual-Protocol" 范畴,不属于 Principle III "Canvas Hard-Bound" 范畴**。P1 迁移 canvas workflow 流式到 Adapter,实现 `parseCanvasWorkflowSSE`。

### Rationale

- Principle III "Canvas Hard-Bound" 指**画布引擎能力**(canvas.py 的 DSL 执行、节点编排、RAG 引用),指 Intellect RAG 的 canvas 是差异化能力,不经 Adapter Registry 选择
- Principle IV "SSE Dual-Protocol" 指**流式协议解析**,指不同后端的 SSE 格式需独立解析器
- Canvas Workflow SSE 是**传输层协议**,不是画布引擎能力本身。Adapter 通过 `parseCanvasWorkflowSSE` 解析协议,但底层仍调用 Intellect RAG 的 canvas 端点,不改变"画布硬绑定 Intellect RAG"的事实
- `IntellectRagAdapter.sendMessage()` 调用 `/api/v1/agents/chat/completions`,内部用 `parseCanvasWorkflowSSE` 解析,输出统一 `StreamChunk`。这是 Adapter Abstraction(Principle II)的标准实践

### Principle III 边界澄清

- ✅ 属 Principle III(不迁移):Canvas DSL 编辑、节点组件库、画布渲染引擎、RAG 引用结构(`reference.chunks`/`doc_aggs`)— 这些通过透传层(Layer 3)保留原生格式
- ✅ 属 Principle IV(迁移):Canvas Workflow SSE 流式传输 — Adapter 解析协议,输出 StreamChunk,但 `message_end` 的 `reference` 字段透传到 `StreamChunk.metadata.reference`(Layer 3 透传)

### Alternatives Considered

1. **Canvas workflow 流式保留透传,P1 不迁移**:❌ 拒绝。会导致 P1 流式无法达成 US2,前端流式对话无法走 Adapter,Adapter 抽象不完整
2. **Canvas workflow 流式迁移,reference 字段纳入 StreamChunk 一等字段**:❌ 拒绝。reference 是 Intellect RAG 专有结构(Principle III),纳入统一 schema 会削足适履,违反 Principle III

---

## R3. Session 路由契约映射

### Decision

Session 路由**条件迁移**:Agent 维度的 Session 操作(`/agents/{agentId}/sessions`)迁移到 Adapter;全局 Session 操作(若有)保留透传。契约 `IHarnessAdapter` 新增 `agentId` 参数到 session 方法。

### 证据(Intellect RAG 源码)

Intellect RAG session 端点全部嵌套在 agent 下(agent_api.py:369-472):
- `GET /agents/{agent_id}/sessions` — list_agent_sessions
- `POST /agents/{agent_id}/sessions` — create_agent_session
- `GET /agents/{agent_id}/sessions/{session_id}` — get_agent_session
- `DELETE /agents/{agent_id}/sessions/{session_id}` — delete_agent_session_item
- `DELETE /agents/{agent_id}/sessions` — delete_agent_session(批量)

无全局 `/sessions` 端点,session 强绑定 agent。

### 契约调整

P0 契约 `IHarnessAdapter.listSessions(ctx: TenantContext)` 无 agentId 参数,无法映射 Intellect RAG 嵌套结构。P1 调整契约为:

```typescript
// 原 P0 契约(不兼容 Intellect RAG)
listSessions(ctx: TenantContext): Promise<SessionSummary[]>

// P1 调整后(支持 agent 维度)
listSessions(ctx: TenantContext, agentId: string): Promise<SessionSummary[]>
createSession(ctx: TenantContext, agentId: string, req: CreateSessionRequest): Promise<Session>
getSession(ctx: TenantContext, agentId: string, sessionId: string): Promise<Session>
deleteSession(ctx: TenantContext, agentId: string, sessionId: string): Promise<void>
```

**Layer 2 扩展**(IMultiTenantAdapter)不涉及 session 方法,保持 P0 定义不变。

### 前端影响

前端 `src/services/agent-service.ts` 已有 `createAgentSession(agentId)`(agent-service.ts:120-121),调用 `${restAPIv1}/agents/${agentId}/sessions`。迁移后前端路径改为 `/api/bff/agents/{agentId}/sessions`,BFF Agent 路由内部调 `adapter.createSession(ctx, agentId, req)`,行为零回归。

### Alternatives Considered

1. **Session 域整体保留透传,P1 不迁移**:❌ 拒绝。Session 是 Agent 的核心配套(前端 use-send-agent-message.ts 依赖 session_id),不迁移会导致 Adapter 抽象在 Agent+Session 域断裂
2. **契约保持无 agentId,Adapter 内部用 ctx 传递**:❌ 拒绝。agentId 是路径参数,不是 tenant 级配置,塞入 ctx 会污染 TenantContext 语义

---

## R4. P1 实施范围最终确定

### Decision

基于 R1-R3 结论,P1 实施范围明确为:

**迁移到 Adapter 原生调用**:
1. Agent CRUD:`GET/POST/PUT/DELETE /api/bff/agents/*`
2. Agent Session CRUD:`GET/POST/DELETE /api/bff/agents/{agentId}/sessions/*`
3. Agent 流式对话:`POST /api/bff/agents/chat/completions`(canvas workflow SSE)

**保留 P0 透明代理**:
1. Canvas DSL 编辑相关:`/agents/{id}/components/*`、`/agents/{id}/upload`、`/agents/{id}/versions/*`(Principle III 透传层)
2. Agent 辅助端点:`/agents/templates`、`/agents/tags`、`/agents/download`(Layer 3 透传)
3. OpenAI 兼容端点:`/openai/{chat_id}/chat/completions`(外部集成,P1 不暴露给前端)
4. 其他域:Dataset/KB/Search/Memory/MCP(P0 已保留)

**P1 实现的 SSE 解析器**:
- `parseCanvasWorkflowSSE`(前端实际用,US2 必需)
- `parseOpenAISSE`(P3 企业版预留,P1 可实现骨架但不暴露路由)

### Rationale

- 遵循 YAGNI(Principle VII):只实现前端实际消费的协议,OpenAI 兼容解析器留待 P3
- 遵循 Principle III:Canvas DSL 编辑等专有能力保留透传,不纳入 Adapter
- 遵循 Principle I:前端零回归,仅路径常量改动

---

## R5. Constitution v1.2.0 修订清单

### Decision

基于 R1-R2 发现,需将 Constitution 从 v1.1.0 修订到 v1.2.0,修订内容:

1. **Principle IV**:描述 Intellect RAG 双协议(canvas workflow + OpenAI 兼容),P1 优先实现 `parseCanvasWorkflowSSE`
2. **Principle III**:澄清边界 — Canvas DSL 编辑/节点组件/RAG 引用属 hard-bound(透传层),Canvas Workflow SSE 传输属 Principle IV(迁移到 Adapter)
3. **CONSTITUTION_VERSION**:1.1.0 → 1.2.0
4. **Last Amended**:2026-06-26 (v1.2.0: reconciled SSE dual-protocol with intellect-rag codebase)

### Rationale

Constitution Governance 规定"修改 constitution 必须更新 CONSTITUTION_VERSION"。本次修订是描述偏差修正(基于源码实证),不改变原则意图,属 minor version bump。

### Alternatives Considered

1. **不修订 constitution,在 design doc 中注明偏差**:❌ 拒绝。Constitution 优先于 design doc,描述偏差会导致后续 P3+ 实施时引用错误描述
2. **major version bump(2.0.0)**:❌ 拒绝。原则意图未变,仅描述修正,minor bump 合适

---

## 总结

所有 NEEDS CLARIFICATION 已解决,Constitution Principle IV VIOLATION 已定位修订方案。P1 实施范围明确:Agent CRUD + Agent Session CRUD + Canvas Workflow 流式迁移到 Adapter,Canvas DSL 编辑等保留透传。下一步:生成 data-model.md 定义 Adapter/Registry/Context 实体,生成 contracts/ 定义调整后的 IHarnessAdapter 接口。
