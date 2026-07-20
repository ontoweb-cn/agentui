# AgentUI 多 Harness 后端支持设计方案

> 本文档描述 AgentUI 支持不同 Agent Harness 后端的架构设计与实施方案。
> 配套文档：
> - [Intellect RAG Admin API 接口指南](file:///Users/simon/workspace/agentui/docs/intellect-admin-api-guide.md)（交付 Intellect RAG 团队）
> - [Vite 架构文档第十六章](file:///Users/simon/workspace/agentui/docs/vite-architecture.md)（BFF 整体架构）

## 一、背景与目标

### 1.1 背景

AgentUI 当前与 Intellect RAG 深度耦合，需支持多种 Agent Harness 后端：

| 后端 | 协议 | 项目地址 | 说明 |
|------|------|---------|------|
| Intellect RAG | OpenAI 兼容 REST + SSE | `~/workspace/intellect-rag` | 画布编排 + 知识库，单租户 |
| Intellect 企业版 | OpenAI 兼容 REST + SSE | `~/workspace/intellect-team` | 实例内 Team/Project 组织模型 + 编码 Agent（多租户通过多实例部署实现），无画布 |

> **命名规范**：本文档中"Intellect RAG"指（intellect-rag），“Intellect 社区版”指(intellect-agent),"Intellect 企业版"指 intellect-team，三者通过不同的 Adapter 对接。

### 1.2 本期范围

对接 **Intellect RAG + Intellect 企业版**。

### 1.3 目标

1. AgentUI 前端业务代码零改动，只改 API 路径常量 + 新增 Admin 页面
2. BFF 通过 Adapter 层屏蔽后端差异
3. 画布硬绑定 Intellect RAG（复用 Intellect RAG 画布引擎）
4. 多租户通过 BFF 独立模型（BFF 维护 Tenant 实体，绑定到 intellect-team 实例；每个 intellect-team 实例 = 一个租户，多实例部署实现多租户）
5. SSE 流式以 Intellect RAG 和 Intellect 企业版 OpenAI 兼容格式为基础

## 二、方案选择：BFF 适配器层（方案 A）

### 2.1 候选方案对比

| 维度 | A. BFF适配器 | B. ACP优先 | C. 前端主导 | D. 微前端 |
|------|------------|-----------|------------|---------|
| 前端改动 | 极小 | 中（换SDK） | 大 | 大 |
| BFF 改动 | 大 | 中 | 极小 | 极小 |
| Intellect RAG 改动 | 无 | 大(建桥) | 无 | 无 |
| 画布编排保留 | ✅ | ❌ | ✅ | ✅ |
| 多租户扩展性 | ✅ | ✅ | ✅ | ✅ |
| 新后端接入成本 | 中(写Adapter) | 低(原生ACP) | 高(写前端service) | 高(写子应用) |
| 长期维护 | 中 | 低 | 高 | 高 |
| 与现有架构一致 | ✅ | 部分 | ❌ | 部分 |

### 2.2 选择方案 A 的理由

1. **保护 Intellect RAG 画布编排**——这是 AgentUI 最有价值的差异化能力，方案 B 会丢失
2. **前端零业务改动**——符合"BFF 生长"方向，前端只改 API 常量
3. **Intellect RAG 与企业版共用 OpenAI 兼容 API**——共用 SSE 解析器，边际成本低
4. **渐进式迁移**——可先做 Intellect RAG Adapter（包装现有逻辑），再加 Intellect 企业版 Adapter
5. **能力探测**——前端通过 `/api/bff/capabilities` 一次性获取后端能力，条件渲染页面

### 2.3 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│  AgentUI 前端（最小改动）                                         │
│  ├── 业务页面（Agent/Session/Canvas，不变）                       │
│  ├── Admin: Harness 后端管理（新增）                              │
│  ├── Admin: 租户/Team/Project 管理（新增）                        │
│  └── useHarnessCapabilities()（新增，条件渲染）                   │
└──────────────────────────────────────────────────────────────────┘
                              ↓ /api/bff/*
┌──────────────────────────────────────────────────────────────────┐
│  BFF (:9390)                                                     │
│  ├── routes/admin.ts（已有：whitelist/roles/resources）           │
│  ├── routes/harness-admin.ts（新增：后端配置管理）                │
│  ├── routes/tenant.ts（新增：租户管理，轻量）                     │
│  ├── routes/team.ts（新增：透传 Intellect Team CRUD）             │
│  ├── routes/project.ts（新增：透传 Intellect Project CRUD）       │
│  ├── routes/agent.ts（重构：调用 Adapter）                        │
│  ├── routes/session.ts（重构：调用 Adapter）                      │
│  ├── routes/canvas.ts（新增：硬绑定 Intellect）                     │
│  │                                                                │
│  ├── services/adapters/                                          │
│  │   ├── types.ts（IHarnessAdapter 接口）                        │
│  │   ├── registry.ts                                             │
│  │   ├── intellect-rag/（IntellectRagAdapter）                   │
│  │   └── intellect-enterprise/（IntellectEnterpriseAdapter）     │
│  │                                                                │
│  ├── services/harness-store.ts（后端配置 + token 存储）           │
│  └── services/tenant-store.ts（BFF 多租户模型）                  │
└──────────────────────────────────────────────────────────────────┘
              ↓                              ↓
┌─────────────────────────┐    ┌─────────────────────────────────┐
│  Intellect RAG (:9380)  │    │  Intellect 企业版 (:8642)       │
│  ├── Agent/Canvas/Dataset│   │  ├── /v1/chat/completions       │
│  └── 画布引擎（唯一）   │    │  ├── /v1/capabilities           │
│                         │    │  ├── /api/sessions              │
│                         │    │  └── /api/teams（需新增）       │
│                         │    │  └── /api/projects（需新增）    │
└─────────────────────────┘    └─────────────────────────────────┘
```

### 2.4 方案要点

1. **BFF 定义 `IHarnessAdapter` 接口**，每个后端实现一个 Adapter
2. **前端零业务改动**，只改 API 路径常量 + 新增 Admin 页面
3. **SSE 流式格式统一**：Intellect RAG 和 Intellect 企业版都是 OpenAI 兼容格式，共用解析器
4. **画布硬绑定 Intellect RAG**：画布是 Intellect RAG 专属能力，不经过 Adapter Registry 选择
5. **多租户通过 BFF 独立模型**：BFF 维护 Tenant 实体，绑定到 intellect-team 实例（每个实例 = 一个租户，多实例部署实现多租户；Team/Project 是实例内组织模型，非多租户）

## 三、关键决策

### 3.1 统一 Schema 范围：三层架构

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: 核心层（Core Schema）                      │
│  所有后端必须实现，取交集                             │
│  → Agent/Session/Message 流式/会话 CRUD              │
├─────────────────────────────────────────────────────┤
│  Layer 2: 扩展层（Extension Schema）                 │
│  通过 capability flags 声明，可选实现                 │
│  → 画布编排/知识库/记忆/MCP/多租户                    │
├─────────────────────────────────────────────────────┤
│  Layer 3: 透传层（Passthrough）                      │
│  后端专有功能，不纳入统一 schema                      │
│  → BFF 透传到后端原生 API，前端用后端原生格式         │
└─────────────────────────────────────────────────────┘
```

**建议理由**：
- 核心层保证"任何后端都能跑基础对话"，降低接入门槛
- 扩展层让强能力后端的功能不被削足适履
- 透传层避免 BFF 成为"全功能代理"的复杂度爆炸

### 3.2 ACP 协议不适用于 BFF 场景

ACP（stdio JSON-RPC）设计用于**本地 IDE 集成**（Zed/Claude Code 等），传输层依赖 stdio 进程通信，不适合 HTTP Server 架构的 BFF 对接。

因此，本方案**不实现 ACP Adapter**，所有后端均通过 OpenAI 兼容 REST API 对接。

### 3.3 多租户数据隔离：BFF 维护独立模型

#### 3.3.1 BFF Tenant ↔ intellect-team 实例映射

intellect-team 通过**多实例部署**实现多租户(每个 intellect-team 实例 = 一个租户),实例内数据模型为 **Member → Team → Project** 三层,**无 Tenant 实体**。本方案采用**一对一映射**:一个 BFF Tenant 唯一绑定到一个 intellect-team 实例(通过 `intellectBackendId` 指向 HarnessBackend.id)。

```
BFF Tenant（BFF 维护）
  └─ 唯一绑定到 1 个 intellect-team 实例(通过 intellectBackendId)
       ├─ 实例内含多个 Team（逻辑分组,实例内组织隔离)
       └─ 实例内含多个 Project（逻辑分组,归属某 Team)
```

**多租户实现**:无需 intellect-team 侧新增 Tenant 实体。真正的租户隔离通过不同 BffTenant 绑定不同 intellect-team 实例(不同 `intellectBackendId`)实现。`intellectTenantId`/`intellectProjectId` 仅用于实例内 Team/Project 数据隔离(注入 X-Intellect-Team/X-Intellect-Project 头),非租户隔离。

#### 3.3.2 数据模型

```typescript
// BFF 侧
interface BffTenant {
  id: string;                    // BFF 租户 ID
  name: string;                  // 租户名称（如 "Acme Corp"）
  intellectTenantId?: string;    // intellect-team 实例内 Team ID(组织隔离,非租户隔离;"0"=缺省)
  intellectBackendId: string;    // 绑定到哪个 intellect-team 实例(= 租户隔离锚点)
  createdAt: string;
  updatedAt: string;
}

// intellect-team 侧无需新增 Tenant 实体,多租户通过多实例部署实现
// 实例内已有:Member/Team/Project 表,通过 X-Intellect-Team/X-Intellect-Project 头做组织隔离
```

#### 3.3.3 核心设计

- **一对一绑定**:BFF Tenant 唯一绑定到一个 intellect-team 实例(通过 `intellectBackendId`)
- **多租户隔离**:通过不同 BffTenant 绑定不同 intellect-team 实例实现,无需 intellect-team 侧新增 Tenant 实体
- **数据隔离**:Team/Project/Member 数据不复制到 BFF,通过 intellect-team HTTP API 透传管理
- **Team/Project 组织隔离头**(v1.1.0 已与 intellect-team `_resolve_member_context` 实际实现对齐):
  - `X-Intellect-Team` — 传递 team_id(对应 intellect-team DB teams.id,不是 slug)
  - `X-Intellect-Project` — 传递 project_id(对应 intellect-team DB projects.id,不是 slug)
  - `X-Intellect-Session-Id` — 可选,会话续接
  - `X-Intellect-Session-Key` — 可选,长期记忆范围
  - BFF 调用 intellect-team 时由 Adapter 注入上述头,禁用臆造的 `X-Team-Slug` / `X-Project-Slug`
- **鉴权**:P0-P3 用 `Authorization: Bearer ${API_SERVER_KEY}` 全局 API Key,P4+ 评估切换到 `imt_p_*` 项目级 Bearer Token
- **画布功能**：若需画布功能，BFF Tenant 需额外绑定一个 Intellect RAG 后端（与 Intellect 企业版 Tenant 独立）
- **绑定流程**：
  1. BFF Admin 创建一个 BffTenant，同时在 Intellect 企业版侧创建一个 Intellect Tenant
  2. BFF Tenant.id 与 Intellect Tenant.id 建立映射（存于 BFF tenant-store）
  3. Team/Project 创建时自动归属到该 Intellect Tenant

### 3.4 画布：复用 Intellect RAG 画布引擎

**架构调整**：画布不再是"扩展层可选能力"，而是**Intellect RAG 专属能力，Intellect 企业版通过 BFF 调用 Intellect RAG 画布**。

```
┌─────────────────────────────────────────────────────┐
│  AgentUI 前端                                        │
│  └── 画布编辑器（不变，调用 /api/bff/canvas/*）      │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│  BFF                                                 │
│  └── CanvasService                                   │
│      ├── 始终路由到 Intellect RAG Adapter              │
│      └── 不经过 Intellect 企业版 Adapter             │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│  Intellect RAG（画布引擎唯一提供者）                   │
│  └── /api/v1/agents/* (canvas CRUD + 执行)           │
└─────────────────────────────────────────────────────┘
```

**实现方式**：
- BFF 的画布路由**硬绑定到 Intellect RAG Adapter**，不通过 Adapter Registry 选择
- Intellect 企业版用户若需画布功能，BFF Tenant 必须同时绑定一个 Intellect RAG 后端

**Canvas IR 不需要**：因为画布只走 Intellect RAG，直接用 Intellect RAG 原生格式，无需中间表示。

**画布与 MCP 过渡计划（远期）**：

当前设计中，画布功能通过 BFF 硬绑定 Intellect RAG Adapter 实现。长期来看，计划将 Intellect RAG 的画布编排、知识库等能力通过 **MCP（Model Context Protocol）** 协议暴露给 Intellect 企业版，使二者在前端完全独立：

| 阶段 | 画布能力归属 | 前端体验 |
|------|-------------|---------|
| 当前（P0-P3） | Intellect RAG 提供，BFF 硬绑定转发 | 企业版用户通过"绑定 Intellect RAG"获取画布 |
| 远期（P6+） | Intellect RAG 通过 MCP 暴露能力，Intellect 企业版通过 MCP 调用 | 企业版用户原生使用画布，无需绑定 Intellect RAG 后端 |

过渡期间，前端通过 capability 探测区分"原生画布"和"MCP 画布"，体验保持一致。

### 3.5 会话流式：SSE 实现机制与对比分析

#### 3.5.1 Intellect RAG SSE 流式实现

**协议**：OpenAI 兼容 SSE（Server-Sent Events）

**端点**：`POST /api/v1/chat/completions`

**请求格式**：
```json
{
  "model": "agent-001",
  "messages": [{"role": "user", "content": "hello"}],
  "stream": true
}
```

**响应格式**（SSE）：
```
data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"Hello"},"index":0}]}

data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":" world"},"index":0}]}

data: {"id":"chatcmpl-xxx","choices":[{"delta":{},"finish_reason":"stop","index":0}]}

data: [DONE]
```

**特性**：
- 标准 OpenAI compatible 格式
- `data: [DONE]` 标记结束
- `delta.content` 为增量文本
- `finish_reason` 包含 `stop` / `length` / `cancelled`

#### 3.5.2 Intellect 企业版 SSE 流式实现

**协议**：自定义事件 SSE（v1.1.0 已与 intellect-team `plugins/platforms/api_server/adapter.py` 实际实现对齐)

**端点**：`POST /api/sessions/{sessionId}/chat/stream`(Constitution Principle VIII 锁定的主通道)

**鉴权**:`Authorization: Bearer ${API_SERVER_KEY}`,Team/Project 组织隔离头 `X-Intellect-Team` / `X-Intellect-Project`

**请求格式**：
```json
{
  "message": "hello",
  "system_message": "可选系统提示"
}
```

**响应格式**(SSE,自定义事件):

```
event: run.started
data: {"session_id":"...","run_id":"run_xxx","seq":1,"ts":1719400000.0,"user_message":{"role":"user","content":"hello"}}

event: message.started
data: {"session_id":"...","run_id":"run_xxx","seq":2,"ts":...,"message":{"id":"msg_xxx","role":"assistant"}}

event: assistant.delta
data: {"session_id":"...","run_id":"run_xxx","seq":3,"ts":...,"message_id":"msg_xxx","delta":"Hello"}

event: assistant.delta
data: {"session_id":"...","run_id":"run_xxx","seq":4,"ts":...,"message_id":"msg_xxx","delta":" world"}

event: tool.progress
data: {"session_id":"...","run_id":"run_xxx","seq":5,"ts":...,"message_id":"msg_xxx","tool_name":"_thinking","delta":"正在思考..."}

event: tool.progress
data: {"session_id":"...","run_id":"run_xxx","seq":6,"ts":...,"message_id":"msg_xxx","tool_name":"web_search","delta":"搜索中..."}

event: tool.started
data: {"session_id":"...","run_id":"run_xxx","seq":7,"ts":...,"message_id":"msg_xxx","tool_name":"web_search","preview":"...","args":{...}}

event: tool.completed
data: {"session_id":"...","run_id":"run_xxx","seq":8,"ts":...,"message_id":"msg_xxx","tool_name":"web_search","preview":"...","args":{...}}

event: assistant.completed
data: {"session_id":"...","run_id":"run_xxx","seq":9,"ts":...,"message_id":"msg_xxx","content":"Hello world","completed":true,"partial":false,"interrupted":false}

event: run.completed
data: {"session_id":"...","run_id":"run_xxx","seq":10,"ts":...,"message_id":"msg_xxx","completed":true,"messages":[...],"usage":{"prompt_tokens":10,"completion_tokens":20}}

event: done
data: {"session_id":"...","run_id":"run_xxx","seq":11,"ts":...}
```

**特性**(实际实现,v1.0.0 的 `token/reasoning/final` 系臆测):
- 自定义事件类型,共 11 种:`run.started` / `message.started` / `assistant.delta` / `tool.progress` / `tool.started` / `tool.completed` / `tool.failed` / `assistant.completed` / `run.completed` / `error` / `done`
- 每个事件 `data` 包含 `session_id` / `run_id` / `seq` / `ts` 公共字段
- `assistant.delta` 传输文本增量(`data.delta` 字段)
- `tool.progress`(`tool_name="_thinking"`)传输思考链(Intellect RAG 无此能力)
- `tool.progress`(其他 `tool_name`)传输普通工具进度
- `tool.started` / `tool.completed` / `tool.failed` 标记工具生命周期
- `run.completed` 包含 `data.usage` Token 用量 + `data.messages` 完整消息列表
- `done` 是流终止信号(不是 `final`)
- 错误场景:`event: error` + `{"message":"..."}`
- **无**标准 OpenAI `choices` 结构

#### 3.5.3 关键差异对比

| 维度 | Intellect RAG | Intellect 企业版 |
|------|--------------|----------------|
| **协议** | OpenAI compatible SSE | 自定义事件 SSE |
| **端点** | `/api/v1/chat/completions` | `/api/sessions/{id}/chat/stream` |
| **请求体** | OpenAI 标准 `messages` 格式 | `{ "message": "...", "system_message": "..." }` |
| **文本增量格式** | `data: {choices:[{delta:{content}}]}` | `event: assistant.delta\ndata: {"delta": "..."}` |
| **结束标记** | `data: [DONE]` | `event: done\ndata: {...}` |
| **思考链** | ❌ 无 | ✅ `event: tool.progress`(`tool_name="_thinking"`) |
| **工具进度** | ❌ 无 | ✅ `event: tool.progress`(其他 `tool_name`) |
| **工具生命周期** | ❌ 无 | ✅ `tool.started` / `tool.completed` / `tool.failed` |
| **用量信息** | ❌ 无 | ✅ `run.completed.data.usage` |
| **finish_reason** | ✅ `finish_reason` 字段 | ❌ 无(用 `run.completed` 标记完成) |
| **多模态支持** | ✅ `input_image` 等 | ❌ 仅文本 |
| **Team/Project 组织隔离头** | ❌ 无 | ✅ `X-Intellect-Team` / `X-Intellect-Project` |
| **会话持久化** | ❌ stateless | ✅ session_id 路径参数 |
| **公共字段** | 无 | `session_id` / `run_id` / `seq` / `ts` |

#### 3.5.4 BFF 统一 SSE 流式方案

由于两个后端 SSE 格式差异较大，BFF 采用**双协议解析器 + 统一输出格式**的策略:

**统一输出格式(BFF → 前端)**,锁定 8 值枚举(Constitution Principle IV v1.1.0):

```typescript
interface StreamChunk {
  type:
    | 'delta'              // 文本增量
    | 'reasoning'          // 思考链(仅 Intellect 企业版)
    | 'tool_start'         // 工具开始
    | 'tool_complete'      // 工具完成
    | 'tool_progress'      // 工具进度增量(v1.1.0 新增)
    | 'usage'              // 用量信息
    | 'done'               // 结束
    | 'error';             // 错误
  content?: string;        // delta / reasoning / tool_progress 文本
  toolName?: string;       // tool_start/complete/progress 时
  toolCallId?: string;     // tool_start/complete 时
  toolArgs?: unknown;      // tool_start 时
  toolResult?: unknown;    // tool_complete 时
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  message?: string;        // error 时
  code?: string;           // error 时
}
```

**解析器实现**(v1.1.0 实际事件名,实现于 P1/P3):

```typescript
// bff/src/services/adapters/shared/sse-parser.ts

// Intellect RAG SSE 解析器(OpenAI 兼容)
async function* parseOpenAISSE(response: Response): AsyncIterable<StreamChunk> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        yield { type: 'done' };
        return;
      }
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) {
        yield { type: 'delta', content: delta.content };
      }
      if (delta?.reasoning_content) {
        yield { type: 'reasoning', content: delta.reasoning_content };
      }
      if (parsed.usage) {
        yield {
          type: 'usage',
          usage: {
            promptTokens: parsed.usage.prompt_tokens,
            completionTokens: parsed.usage.completion_tokens,
          },
        };
      }
    }
  }
}

// Intellect 企业版 SSE 解析器(自定义事件,/api/sessions/{id}/chat/stream)
async function* parseIntellectEnterpriseSSE(response: Response): AsyncIterable<StreamChunk> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 帧以空行分隔,每帧含 event: 与 data: 两行
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';

    for (const frame of frames) {
      const lines = frame.split('\n');
      let eventType = '';
      let dataStr = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
      }
      if (!eventType || !dataStr) continue;
      const data = JSON.parse(dataStr);

      switch (eventType) {
        case 'assistant.delta':
          yield { type: 'delta', content: data.delta };
          break;
        case 'tool.progress':
          if (data.tool_name === '_thinking') {
            yield { type: 'reasoning', content: data.delta || '' };
          } else {
            yield {
              type: 'tool_progress',
              toolName: data.tool_name,
              content: data.delta || data.preview || '',
            };
          }
          break;
        case 'tool.started':
          yield {
            type: 'tool_start',
            toolName: data.tool_name,
            toolCallId: data.message_id, // intellect-team 用 message_id 关联
            args: data.args,
          };
          break;
        case 'tool.completed':
          yield {
            type: 'tool_complete',
            toolCallId: data.message_id,
            result: data.preview,
          };
          break;
        case 'tool.failed':
          yield {
            type: 'error',
            message: data.error || 'tool failed',
            toolCallId: data.message_id,
          };
          break;
        case 'run.completed':
          if (data.usage) {
            yield {
              type: 'usage',
              usage: {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
              },
            };
          }
          yield { type: 'done' };
          return;
        case 'error':
          yield { type: 'error', message: data.message || 'unknown error' };
          return;
        case 'done':
          yield { type: 'done' };
          return;
        // run.started / message.started / assistant.completed 是状态事件,
        // BFF 内部用于跟踪,不映射到 StreamChunk
      }
    }
  }
}
```

**Adapter 中的使用**:

```typescript
// IntellectRagAdapter.sendMessage()
async function* sendMessage(ctx: TenantContext, req: SendMessageRequest) {
  const response = await this.client.post('/api/v1/chat/completions', {
    model: req.agentId,
    messages: [{ role: 'user', content: req.message }],
    stream: true,
  });
  yield* parseOpenAISSE(response);
}

// IntellectEnterpriseAdapter.sendMessage()
// Constitution Principle VIII: 主通道是 /api/sessions/{id}/chat/stream
// 两步流程:Adapter 内部先 POST /api/sessions 创建会话(若需),再订阅 chat/stream
async function* sendMessage(ctx: TenantContext, req: SendMessageRequest) {
  const response = await this.client.post(
    `/api/sessions/${req.sessionId}/chat/stream`,
    { message: req.message, system_message: req.systemMessage },
    {
      headers: {
        Authorization: `Bearer ${this.apiServerKey}`,
        'X-Intellect-Team': ctx.intellectTeamId || '',
        'X-Intellect-Project': ctx.intellectProjectId || '',
      },
    },
  );
  yield* parseIntellectEnterpriseSSE(response);
}
```

#### 3.5.5 前端 SSE 消费策略

前端统一消费 `StreamChunk` 类型，不感知后端差异：

```typescript
// 前端 service
async function* streamChat(sessionId: string, message: string) {
  const response = await fetch('/api/bff/sessions/chat', {
    method: 'POST',
    body: JSON.stringify({ sessionId, message }),
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    const chunk = JSON.parse(text); // StreamChunk
    yield chunk;
  }
}

// 前端组件消费
for await (const chunk of streamChat(sessionId, message)) {
  switch (chunk.type) {
    case 'delta':
      appendToMessage(chunk.content);
      break;
    case 'reasoning':
      showThinkingIndicator(chunk.content);
      break;
    case 'tool_progress':
      showToolProgress(chunk.toolName, chunk.content);
      break;
    case 'done':
      hideThinkingIndicator();
      break;
  }
}
```

#### 3.5.6 SSE 事件合集(v1.1.0 实际事件名)

| StreamChunk 类型 | Intellect RAG 事件 | Intellect 企业版事件 | 说明 |
|---------|--------------|----------------|------|
| `delta` | `data: {choices:[{delta:{content}}]}` | `event: assistant.delta` | 文本增量 |
| `reasoning` | `delta.reasoning_content`(扩展) | `event: tool.progress`(`tool_name="_thinking"`) | 思考链 |
| `tool_progress` | ❌ 无 | `event: tool.progress`(其他 `tool_name`) | 工具进度增量(v1.1.0 新增) |
| `tool_start` | ❌ 无 | `event: tool.started` | 工具调用开始 |
| `tool_complete` | ❌ 无 | `event: tool.completed` | 工具调用完成 |
| `usage` | `usage` 字段(OpenAI 标准) | `event: run.completed` 的 `data.usage` | 用量统计 |
| `done` | `data: [DONE]` | `event: done` 或 `run.completed` 后终止 | 流结束 |
| `error` | HTTP 错误 / 解析失败 | `event: error` 或 `event: tool.failed` | 错误 |
| (不映射) | — | `event: run.started` / `message.started` / `assistant.completed` | BFF 内部状态 |

**预留事件**(P4+ 评估):
| 预留类型 | Intellect 企业版事件 | 说明 |
|---------|----------------|------|
| `approval` | (intellect-team `/v1/runs/{id}/approval` 端点,P3+ 评估) | 审批请求 |

### 3.6 后端配置：Admin 管理端

复用 BFF Admin 模块，新增"Harness 后端管理"页面：
- **后端列表**：查看所有已注册 Harness 后端
- **新增后端**：填写类型/端点/认证，自动探测能力
- **能力探测**：调用后端健康检查 + 能力发现，回填 capabilities
- **租户绑定**：将后端绑定到 BFF 租户

### 3.7 RBAC 权限模型

#### 3.7.1 Intellect 企业版原生 RBAC

Intellect 企业版数据模型中，Member 拥有 `role` 字段，取值范围为 `owner / admin / member / viewer`，但**无独立的 Permission 实体**，权限通过角色隐式确定：

| 角色 | Team 操作 | Project 操作 | Member 操作 |
|------|---------|------------|-----------|
| owner | CRUD + archive | CRUD + archive | CRUD + 授予 admin |
| admin | CRUD | CRUD | 启用/禁用 member |
| member | Read | Read | - |
| viewer | Read | Read | - |

#### 3.7.2 BFF 侧权限模型

BFF 侧的权限控制分为**两个层次**：

**层次 1：BFF Admin 权限**（运维管理）
- 与业务租户解耦，控制谁能访问 Admin 页面（用户管理/服务监控/沙箱配置/版本）
- BFF 维护独立的 admin 角色模型（已有 whitelist/roles/resources）
- 状态：`admin token` 存 localStorage，BFF authMiddleware 校验

**层次 2：业务租户权限**（Agent/Session/Team/Project 操作）
- 通过 TenantContext 注入到 Adapter，由 Intellect 企业版按 Member role 执行
- BFF 不维护独立的租户内权限模型，只做透传

#### 3.7.3 AgentUI 前端 RBAC 策略

```
前端权限判断：
├── admin 页面：通过 BFF /api/bff/admin/roles 检查（Admin 角色）
│   ├── 可见：adminUsers=true 的用户
│   └── 可操作：取决于 BFF roles.json 中的 permission 声明
│
└── 业务页面（Agent/Session/Team/Project）：
    ├── 通过 TenantContext.userId 关联 Member
    ├── 前端不直接判断权限，依赖后端 API 返回 403
    └── 前端根据 API 错误提示用户联系 admin
```

#### 3.7.4 权限矩阵（本期范围）

| 功能 | 所需 BFF 角色 | Intellect 企业版 Member 角色 |
|------|-------------|---------------------------|
| 查看 Agent 列表 | user | member + viewer |
| 创建会话/对话 | user | member |
| 管理 Team | admin | admin |
| 管理 Project | admin | admin |
| 用户管理（Admin 页面） | superadmin | owner |
| 服务监控（Admin 页面） | operator | - |
| 沙箱配置（Admin 页面） | superadmin | - |
| 版本查询（Admin 页面） | user | - |

> **说明**：Intellect 企业版无 Admin 页面等效功能，企业版的 Member role 控制粒度为 Team/Project 级别，不覆盖运维管理功能。

## 四、Token 安全存储策略

### 4.1 设计原则

1. **P0-P3 先行**：本期不引入加密存储复杂度，使用环境变量 + JSON 文件存储
2. **环境变量优先**：敏感的 admin token 通过环境变量注入，不落盘到 JSON
3. **JSON 文件存储非敏感配置**：后端端点、类型、能力声明等存 JSON
4. **未来演进**：预留加密存储接口，P4+ 可平滑升级

### 4.2 存储分层

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: 环境变量（.env，不入库）                       │
│  ├── HARNESS_INTELLECT_RAG_ADMIN_TOKEN=intellect-xxx    │
│  ├── HARNESS_INTELLECT_ENTERPRISE_ADMIN_TOKEN=imt_xxx  │
│  └── HARNESS_TOKEN_ENCRYPTION_KEY=（P4+ 启用）          │
├─────────────────────────────────────────────────────────┤
│  Layer 2: JSON 文件（bff/data/harness-backends.json）    │
│  ├── 后端 ID、名称、类型、端点                           │
│  ├── 能力声明（capabilities）                            │
│  ├── 状态（active/disabled）                             │
│  └── token 引用（envVarName，不存明文）                  │
├─────────────────────────────────────────────────────────┤
│  Layer 3: 运行时内存（启动时加载）                       │
│  ├── 从环境变量读取 token 明文                           │
│  ├── 与 JSON 配置合并为完整 HarnessBackend 对象          │
│  └── 仅存在于进程内存，不写回磁盘                        │
└─────────────────────────────────────────────────────────┘
```

### 4.3 数据模型

```typescript
// bff/src/services/harness-store.ts

// JSON 文件中存储的配置（不含 token 明文）
interface HarnessBackendConfig {
  id: string;
  name: string;
  type: 'intellect-rag' | 'intellect-enterprise';
  endpoint: string;
  capabilities: HarnessCapabilities;
  status: 'active' | 'disabled';
  // token 通过环境变量引用，不存明文
  adminTokenEnvVar: string;        // 如 'HARNESS_INTELLECT_RAG_ADMIN_TOKEN'
  projectTokenEnvVar?: string;     // 可选，项目级 token 环境变量名
  createdAt: string;
  updatedAt: string;
}

// 运行时内存中的完整对象（含 token 明文，不落盘）
interface HarnessBackend extends HarnessBackendConfig {
  adminToken: string;              // 从环境变量读取的明文
  projectToken?: string;
}
```

### 4.4 加载流程

```typescript
// bff/src/services/harness-store.ts

class HarnessStore {
  private backends: Map<string, HarnessBackend> = new Map();

  load(): void {
    const configs = this.loadConfigs();  // 读 JSON 文件
    for (const config of configs) {
      const adminToken = process.env[config.adminTokenEnvVar];
      if (!adminToken) {
        console.warn(`[harness-store] 环境变量 ${config.adminTokenEnvVar} 未设置，跳过后端 ${config.name}`);
        continue;
      }
      const projectToken = config.projectTokenEnvVar
        ? process.env[config.projectTokenEnvVar]
        : undefined;
      this.backends.set(config.id, {
        ...config,
        adminToken,
        projectToken,
      });
    }
  }

  get(id: string): HarnessBackend | undefined {
    return this.backends.get(id);
  }

  list(): HarnessBackend[] {
    return Array.from(this.backends.values());
  }

  private loadConfigs(): HarnessBackendConfig[] {
    // 读 bff/data/harness-backends.json
    if (!existsSync(CONFIG_FILE)) return [];
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  }

  // Admin 页面通过此方法增删后端配置（不含 token 明文）
  saveConfig(config: HarnessBackendConfig): void {
    const configs = this.loadConfigs().filter(c => c.id !== config.id);
    configs.push(config);
    writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
    // 重新加载到内存
    this.load();
  }
}
```

### 4.5 环境变量示例

```bash
# .env（已加入 .gitignore）
HARNESS_INTELLECT_RAG_ADMIN_TOKEN=intellect-xxxxxxxxxxxxxxxx
HARNESS_INTELLECT_ENTERPRISE_ADMIN_TOKEN=imt_xxxxxxxxxxxxxxxxxx
HARNESS_INTELLECT_ENTERPRISE_PROJECT_TOKEN=imt_p_xxxxxxxxxxxxxxx
```

### 4.6 Admin 页面交互

Admin 页面新增后端时：
1. 用户填写名称、类型、端点
2. 系统生成环境变量名（如 `HARNESS_INTELLECT_ADMIN_TOKEN`）
3. JSON 文件存储配置（含 `adminTokenEnvVar` 字段，不含 token 明文）
4. 页面提示用户将 token 添加到 `.env` 文件
5. 重启 BFF 后生效

### 4.7 未来演进（P4+）

```typescript
// 预留接口，未来切换到加密存储
interface TokenVault {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

// 实现 1：环境变量（P0-P3）
class EnvTokenVault implements TokenVault {
  get(key: string) { return process.env[key]; }
  set(key: string, value: string) { throw new Error('Env vault is read-only'); }
}

// 实现 2：加密文件（P4+，使用 AES-256-GCM）
class EncryptedFileTokenVault implements TokenVault {
  constructor(private encryptionKey: string) {}
  get(key: string) { /* 解密读取 */ }
  set(key: string, value: string) { /* 加密写入 */ }
}
```

## 五、Adapter 接口定义

### 5.1 核心层接口（Layer 1，所有后端必选）

```typescript
// bff/src/services/adapters/types.ts

export interface IHarnessAdapter {
  readonly backendId: string;
  readonly backendType: 'intellect-rag' | 'intellect-enterprise';
  readonly capabilities: HarnessCapabilities;

  // Agent
  listAgents(ctx: TenantContext): Promise<AgentSummary[]>;
  getAgent(ctx: TenantContext, agentId: string): Promise<AgentDetail>;

  // Session
  createSession(ctx: TenantContext, agentId: string, opts?: SessionOptions): Promise<Session>;
  listSessions(ctx: TenantContext, agentId?: string): Promise<Session[]>;
  getSession(ctx: TenantContext, sessionId: string): Promise<Session>;
  deleteSession(ctx: TenantContext, sessionId: string): Promise<void>;

  // Message streaming（OpenAI 兼容 SSE，Intellect 和 Intellect 共用）
  sendMessage(ctx: TenantContext, sessionId: string, message: string, opts?: SendOptions): AsyncIterable<StreamChunk>;
  cancelMessage(ctx: TenantContext, sessionId: string): Promise<void>;

  // Health & capability
  healthCheck(): Promise<boolean>;
  discoverCapabilities(): Promise<HarnessCapabilities>;
}
```

### 5.2 扩展层接口（Layer 2，Intellect 企业版独有）

```typescript
export interface IMultiTenantAdapter {
  // Team CRUD（透传 Intellect）
  listTeams(ctx: TenantContext): Promise<Team[]>;
  createTeam(ctx: TenantContext, slug: string, displayName: string): Promise<Team>;
  getTeam(ctx: TenantContext, teamSlug: string): Promise<Team>;
  updateTeam(ctx: TenantContext, teamSlug: string, updates: Partial<Team>): Promise<Team>;
  archiveTeam(ctx: TenantContext, teamSlug: string): Promise<void>;

  // Team 成员管理
  listTeamMembers(ctx: TenantContext, teamSlug: string): Promise<TeamMember[]>;
  addTeamMember(ctx: TenantContext, teamSlug: string, memberId: string, role: string): Promise<TeamMember>;
  removeTeamMember(ctx: TenantContext, teamSlug: string, memberId: string): Promise<void>;
  setTeamMemberRole(ctx: TenantContext, teamSlug: string, memberId: string, role: string): Promise<void>;

  // Project CRUD（透传 Intellect，Project 属于 Team）
  listProjects(ctx: TenantContext, teamSlug: string): Promise<Project[]>;
  createProject(ctx: TenantContext, teamSlug: string, data: CreateProjectInput): Promise<Project>;
  getProject(ctx: TenantContext, teamSlug: string, projectSlug: string): Promise<Project>;
  updateProject(ctx: TenantContext, projectSlug: string, updates: Partial<Project>): Promise<Project>;
  archiveProject(ctx: TenantContext, projectSlug: string): Promise<void>;

  // Project 成员管理
  listProjectMembers(ctx: TenantContext, projectSlug: string): Promise<ProjectMember[]>;
  addProjectMember(ctx: TenantContext, projectSlug: string, memberId: string, role: string): Promise<void>;
  removeProjectMember(ctx: TenantContext, projectSlug: string, memberId: string): Promise<void>;
}
```

### 5.3 租户上下文与能力声明

```typescript
// ── 租户上下文 ──
export interface TenantContext {
  tenantId: string;                    // BFF 租户 ID
  userId: string;                      // BFF 用户 ID
  // Intellect 侧的上下文（BFF 根据 tenant 绑定关系填充）
  intellectTeamSlug?: string;          // X-Intellect-Team 头
  intellectProjectSlug?: string;       // X-Intellect-Project 头
}

// ── 能力声明 ──
export interface HarnessCapabilities {
  canvas: boolean;        // Intellect only（画布永远走 Intellect）
  knowledgeBase: boolean; // Intellect only
  memory: boolean;
  mcp: boolean;
  multiTenant: boolean;   // Intellect 企业版（实例内 Team/Project 组织模型）
  modelManagement: boolean;
}

// ── 流式 chunk（BFF 统一输出，两个后端解析后产出）──
// 与 §3.5.4 / §6.2 / §6.3 保持一致
export interface StreamChunk {
  type:
    | 'delta'              // 文本增量（两后端都支持）
    | 'reasoning'          // 思考链（仅 Intellect 企业版）
    | 'tool_start'         // 工具开始（预留）
    | 'tool_complete'      // 工具完成（预留）
    | 'usage'              // 用量信息（仅 Intellect 企业版）
    | 'done'               // 结束
    | 'error';             // 错误
  content?: string;        // delta / reasoning 文本
  role?: 'assistant';
  finishReason?: 'stop' | 'length' | 'cancelled';
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  error?: { code: string; message: string };
}
```

## 六、Adapter 实现要点

### 6.1 Adapter 注册与选择

```typescript
// bff/src/services/adapters/registry.ts

class AdapterRegistry {
  private adapters = new Map<string, IHarnessAdapter>();  // backendId → adapter

  async register(backend: HarnessBackend): Promise<void> {
    const adapter = await this.createAdapter(backend);
    await adapter.healthCheck();
    this.adapters.set(backend.id, adapter);
  }

  getAdapter(backendId: string): IHarnessAdapter {
    const adapter = this.adapters.get(backendId);
    if (!adapter) throw new Error(`Backend ${backendId} not registered`);
    return adapter;
  }

  // 根据租户绑定选择 adapter
  getAdapterForTenant(tenantId: string): IHarnessAdapter {
    const binding = tenantStore.getHarnessBinding(tenantId);
    return this.getAdapter(binding.backendId);
  }

  private async createAdapter(backend: HarnessBackend): Promise<IHarnessAdapter> {
    switch (backend.type) {
      case 'intellect-rag':
        return new IntellectRagAdapter(backend);
      case 'intellect-enterprise':
        return new IntellectEnterpriseAdapter(backend);
      default:
        throw new Error(`Unknown backend type: ${backend.type}`);
    }
  }
}
```

### 6.2 SSE 解析器（双协议）

Intellect RAG 与 Intellect 企业版 SSE 协议**不同**（详见 §3.5.3 对比表），需要两个独立解析器。共用部分仅是 SSE 帧分割逻辑。

```typescript
// bff/src/services/adapters/shared/openai-sse.ts

// Intellect RAG 专用：OpenAI 兼容 SSE
// 端点：POST /api/v1/chat/completions
// 格式：data: {"choices":[{"delta":{"content":"..."}}]} / data: [DONE]
async function* parseOpenAISSE(response: Response): AsyncIterable<StreamChunk> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        yield { type: 'done' };
        return;
      }
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) {
        yield { type: 'delta', content: delta.content };
      }
      if (parsed.choices?.[0]?.finish_reason) {
        yield { type: 'done', finishReason: parsed.choices[0].finish_reason };
      }
    }
  }
}
```

```typescript
// bff/src/services/adapters/shared/intellect-enterprise-sse.ts

// Intellect 企业版专用：自定义事件 SSE
// 端点：POST /api/sessions/{sessionId}/chat/stream
// 格式：event: token|reasoning|final / data: {"text":"...","usage":{...}}
// 详见 §3.5.2 / §3.5.3
async function* parseIntellectEnterpriseSSE(response: Response): AsyncIterable<StreamChunk> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('event: ')) continue;
      const eventType = line.slice(7).trim();
      const dataLine = lines.shift(); // 下一行是 data:
      if (!dataLine?.startsWith('data: ')) continue;
      const data = JSON.parse(dataLine.slice(6).trim());

      switch (eventType) {
        case 'token':
          yield { type: 'delta', content: data.text };
          break;
        case 'reasoning':
          yield { type: 'reasoning', content: data.text };
          break;
        case 'final':
          if (data.usage) {
            yield {
              type: 'usage',
              usage: {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
              },
            };
          }
          yield { type: 'done' };
          return;
      }
    }
  }
}
```

> **注意**：Intellect 企业版另有一个 OpenAI 兼容端点 `POST /v1/chat/completions`（§12.1），如 Adapter 选择走该端点则可复用 `parseOpenAISSE`，但会丢失 `reasoning` / `usage` 能力。本期 P3 采用 `/api/sessions/{id}/chat/stream` + `parseIntellectEnterpriseSSE` 以保留完整能力。

### 6.3 Intellect 企业版 Adapter（Team/Project 组织隔离头注入）

```typescript
// bff/src/services/adapters/intellect-enterprise/adapter.ts

export class IntellectEnterpriseAdapter implements IHarnessAdapter, IMultiTenantAdapter {
  readonly backendType = 'intellect-enterprise' as const;

  constructor(
    private backend: HarnessBackend,
    private client: IntellectEnterpriseClient,
  ) {}

  async listAgents(ctx: TenantContext): Promise<AgentSummary[]> {
    // Intellect 企业版用 /v1/models 暴露可用 agent
    const models = await this.client.get('/v1/models', this.buildHeaders(ctx));
    return models.data.map((m: any) => ({
      id: m.id,
      name: m.id,
      description: m.description || '',
    }));
  }

  async *sendMessage(ctx: TenantContext, sessionId: string, message: string): AsyncIterable<StreamChunk> {
    // Intellect 企业版 SSE 用自定义事件（token/reasoning/final），详见 §3.5.2
    // 必须用 parseIntellectEnterpriseSSE，不能复用 parseOpenAISSE
    const response = await this.client.postStream(
      `/api/sessions/${sessionId}/chat/stream`,
      { message },
      this.buildHeaders(ctx),
    );
    yield* parseIntellectEnterpriseSSE(response);  // 企业版专用解析器

  }

  // ── 私有方法：构建请求头 ──

  private buildHeaders(ctx: TenantContext): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.backend.adminToken}`,
    };
    if (ctx.intellectTeamSlug) {
      headers['X-Intellect-Team'] = ctx.intellectTeamSlug;
    }
    if (ctx.intellectProjectSlug) {
      headers['X-Intellect-Project'] = ctx.intellectProjectSlug;
    }
    return headers;
  }

  // ── 能力发现 ──

  async discoverCapabilities(): Promise<HarnessCapabilities> {
    return {
      canvas: false,              // 画布走 Intellect
      knowledgeBase: false,
      memory: true,
      mcp: true,
      multiTenant: true,          // Intellect 企业版核心能力
      modelManagement: true,
    };
  }
}
```

### 6.4 画布服务（硬绑定 Intellect）

```typescript
// bff/src/services/canvas-service.ts

export class CanvasService {
  constructor(private intellectAdapter: IntellectRagAdapter) {}

  // 画布操作永远走 Intellect，不经过 Adapter Registry
  async listCanvas(ctx: TenantContext): Promise<Canvas[]> {
    return this.intellectAdapter.listCanvas(ctx);
  }

  async saveCanvas(ctx: TenantContext, agentId: string, canvas: Canvas): Promise<void> {
    return this.intellectAdapter.saveCanvas(ctx, agentId, canvas);
  }

  async *executeCanvas(ctx: TenantContext, canvasId: string, input: unknown): AsyncIterable<StreamChunk> {
    yield* this.intellectAdapter.executeCanvas(ctx, canvasId, input);
  }
}
```

## 七、BFF 多租户绑定模型

```typescript
// bff/src/services/harness-store.ts

// BFF 租户（轻量，只存绑定关系）
interface BffTenant {
  id: string;
  name: string;                    // "Acme Corp"
  createdAt: string;
  updatedAt: string;
}

// 租户与后端的绑定（一个租户可绑定多个后端）
interface TenantBackendBinding {
  tenantId: string;
  backendId: string;
  backendType: 'intellect-rag' | 'intellect-enterprise';
  // Intellect 侧
  intellectTenantId?: string;
  // Intellect 侧（admin token 用于管理操作）
  intellectAdminToken?: string;    // imt_* admin/owner token
  // 用途标记
  roles: ('canvas' | 'knowledge' | 'chat' | 'coding')[];
  isDefault: boolean;
}

// Harness 后端配置（Admin 管理端配置）
interface HarnessBackend {
  id: string;
  name: string;
  type: 'intellect-rag' | 'intellect-enterprise';
  endpoint: string;                // http://localhost:9380 / http://localhost:8642
  adminToken?: string;             // Intellect admin member token
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}
```

## 八、BFF 目录结构

```
bff/src/
├── index.ts
├── middleware/
│   └── auth.ts
├── routes/
│   ├── admin.ts              # 已有：whitelist/roles/resources
│   ├── harness-admin.ts      # 新增：Harness 后端管理
│   ├── tenant.ts             # 新增：租户管理（轻量）
│   ├── team.ts               # 新增：透传 Intellect Team CRUD
│   ├── project.ts            # 新增：透传 Intellect Project CRUD
│   ├── agent.ts              # 重构：调用 Adapter
│   ├── session.ts            # 重构：调用 Adapter
│   └── canvas.ts             # 新增：硬绑定 Intellect
├── services/
│   ├── admin-store.ts        # 已有
│   ├── harness-store.ts      # 新增：后端配置 + token 存储
│   ├── tenant-store.ts       # 新增：BFF 多租户模型
│   ├── canvas-service.ts     # 新增：画布路由到 Intellect
│   └── adapters/             # 新增：适配器层
│       ├── types.ts          # IHarnessAdapter 接口定义
│       ├── registry.ts       # Adapter 注册与选择
│       ├── shared/
│       │   ├── openai-sse.ts           # Intellect RAG SSE 解析器
│       │   └── intellect-enterprise-sse.ts  # Intellect 企业版 SSE 解析器
│       ├── intellect-rag/              # Intellect RAG Adapter
│       │   ├── adapter.ts    # IntellectRagAdapter
│       │   ├── client.ts     # Intellect RAG HTTP 客户端
│       │   └── stream.ts     # SSE 流式转换
│       └── intellect-enterprise/       # Intellect 企业版 Adapter
│           ├── adapter.ts    # IntellectEnterpriseAdapter
│           ├── client.ts     # Intellect 企业版 HTTP 客户端
│           ├── stream.ts     # SSE 流式转换
│           └── admin.ts      # Team/Project 透传
└── utils/
    └── sse.ts                # SSE 流式工具
```

## 九、前端改动清单

### 9.1 API 路径迁移（`src/utils/api.ts`）

```typescript
// 新增 harness 相关路径
const bffHarness = '/api/bff/harness';

export const api = {
  // ... 现有路径

  // Harness 后端管理（Admin）
  harnessListBackends: `${bffHarnessAdmin}/backends`,
  harnessCreateBackend: `${bffHarnessAdmin}/backends`,
  harnessGetBackend: (id: string) => `${bffHarnessAdmin}/backends/${id}`,
  harnessUpdateBackend: (id: string) => `${bffHarnessAdmin}/backends/${id}`,
  harnessDeleteBackend: (id: string) => `${bffHarnessAdmin}/backends/${id}`,
  harnessProbeBackend: `${bffHarnessAdmin}/backends/probe`,  // 能力探测

  // 能力查询（前端条件渲染用）
  harnessGetCapabilities: `${bff}/capabilities`,

  // 多租户（BFF 独立模型）
  tenantList: `${bff}/tenants`,
  tenantCreate: `${bff}/tenants`,
  teamList: (tenantId: string) => `${bff}/tenants/${tenantId}/teams`,
  projectList: (tenantId: string, teamId: string) =>
    `${bff}/tenants/${tenantId}/teams/${teamId}/projects`,
};
```

### 9.2 能力探测 Hook

```typescript
// src/hooks/useHarnessCapabilities.ts

// 启动时查询一次，前端按能力条件渲染
function useHarnessCapabilities(): HarnessCapabilities | null {
  const [caps, setCaps] = useState<HarnessCapabilities | null>(null);
  useEffect(() => {
    fetch('/api/bff/capabilities').then(r => r.json()).then(setCaps);
  }, []);
  return caps;
}

// 使用示例
function AgentPage() {
  const caps = useHarnessCapabilities();
  return (
    <>
      {caps?.canvas && <CanvasEditor />}        {/* Intellect + Intellect 企业版 */}
      {caps?.knowledgeBase && <DatasetPage />}  {/* Intellect only */}
      {caps?.multiTeam && <TeamSwitcher />}     {/* Intellect 企业版 */}
    </>
  );
}
```

### 9.3 新增 Admin 页面

- `src/pages/admin/harness-backends.tsx`：Harness 后端管理
- `src/pages/admin/tenants.tsx`：租户/团队/项目管理

## 十、实施路线

### 10.1 P0-P3 细化（本期范围）

> **P0-前置 + P0 已完成**(2026-06-26,详见 [specs/001-multi-harness-p0/tasks.md](../specs/001-multi-harness-p0/tasks.md))。Constitution v1.1.0 Principle I/II/IV/V/VII/VIII 全部通过。

#### P0-前置：前端 API 迁移到 BFF 反向代理 ✅ 已完成

**目标**：前端所有 `/api/v1/*` 请求改为经 BFF 反向代理透传，为 P0/P1 提供"BFF 可观测、可拦截"的接入点。详见 §十二。

| 任务 | 文件 | 状态 |
|------|------|------|
| 实现 Intellect RAG 透明代理方法 | `bff/src/services/intellect-rag-client.ts`（重命名自 `intellect-client.ts`） | ✅ `proxy(path, req)` 透传 method/headers/body/query/SSE 流 |
| 新建 proxy 路由 | `bff/src/routes/proxy.ts` | ✅ catch-all `/proxy/v1/*` → intellect-rag `/api/v1/*` |
| 挂载 proxy 路由 | `bff/src/index.ts` | ✅ `app.route('/', proxyRoutes)` + `app.use('/proxy/*', authMiddleware)` |
| 配置 Vite proxy | `vite.config.ts` | ✅ 已有 `/api/bff` 规则(rewrite 去前缀),保留 `/api/v1` 旧规则用于回滚 |
| 切换前端 API 常量 | `src/utils/api.ts` | ✅ `restAPIv1` 改为 `/api/bff/proxy/v1` |
| 更新环境变量样例 | `.env.example` | ✅ 新增 `VITE_BFF_BASE=/api/bff` + `HARNESS_INTELLECT_RAG_ADMIN_TOKEN` + `HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY` |

**验收标准**（冒烟用例全部通过）：✅ type-check 零错误;运行时冒烟需本地 `npm run dev:all` 验证
- 登录/登出、用户信息
- Agent 列表、创建、编辑、删除
- 会话创建、流式对话（SSE 透传正常）
- 画布编辑、保存、执行
- 知识库 CRUD、文档上传
- Admin：whitelist、roles、users
- BFF 日志能看到所有 API 流量
- `src/utils/api.ts` 改回 `/api/v1` 可瞬时回滚

#### P0：接口定义 + 存储层 ✅ 已完成

**目标**：建立 Adapter 抽象层骨架，不改变现有功能。

| 任务 | 文件 | 状态 |
|------|------|------|
| 定义 Adapter 接口 + 数据模型 | `bff/src/types/adapter.ts` (合并 harness-adapter + multi-tenant-adapter 契约) | ✅ `IHarnessAdapter`、`IMultiTenantAdapter`、`HarnessAdapterFactory`、`isMultiTenantAdapter` |
| 定义 Harness 后端类型 | `bff/src/types/harness.ts` | ✅ `BackendType`、`HarnessCapabilities`、`HarnessBackendConfig`、`HarnessBackend` |
| 定义 StreamChunk | `bff/src/types/stream.ts` | ✅ 8 个 type 枚举(Constitution Principle IV v1.1.0) |
| 定义 Tenant 上下文 | `bff/src/types/tenant.ts` | ✅ `BffTenant`、`TenantContext`(含 X-Intellect-Team/X-Intellect-Project 字段) |
| 定义 Domain 模型 | `bff/src/types/domain.ts` | ✅ `AgentSummary`、`Session`、`Team`、`Project`、`TeamMember`、`ProjectMember`、`SendMessageRequest` |
| 定义 Store 契约 | `bff/src/types/stores.ts` | ✅ `HarnessStore`、`TenantStore`、`StoreFactory` |
| Barrel export | `bff/src/types/index.ts` | ✅ re-export 所有契约 + 保留 legacy BffContext/AgentSession |
| 实现 HarnessStore | `bff/src/services/harness-store.ts` | ✅ `JSONFileHarnessStore`(JSON + env 合并,Zod 校验,env 缺失跳过告警) |
| 实现 TenantStore | `bff/src/services/tenant-store.ts` | ✅ `JSONFileTenantStore`(画布类型校验 Constitution Principle III) |
| 创建默认配置 | `bff/data/harness-backends.json` | ✅ 默认 Intellect RAG 后端(无 token 明文) |
| 创建空租户配置 | `bff/data/bff-tenants.json` | ✅ `{"tenants":[]}` |
| 启动初始化 Store | `bff/src/index.ts` | ✅ `harnessStore.load()` + `tenantStore.load()`,存 Hono context,不挂新路由 |
| 更新 .env.example | `.env.example` | ✅ `HARNESS_INTELLECT_RAG_ADMIN_TOKEN` + `HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY`(Principle VIII) |
| 更新 .gitignore | `.gitignore` | ✅ 允许 JSON 配置入库 + ignore `.env` |

**验收标准**：✅ 全部通过
- BFF 启动时能从 JSON + 环境变量加载后端配置 ✅
- TypeScript 编译通过 ✅(`cd bff && npm run type-check` + 根目录 `npm run type-check` 零错误)
- 不影响现有功能（现有路由行为不变）✅(SC-009,未改动 agent/session/admin/health 路由)
- env 缺失不崩溃,跳过告警 ✅(T033 验证)
- 画布后端类型校验生效 ✅(T034 验证)
- JSON 文件零 token 明文 ✅(T042 grep 扫描)
- 契约可被实现(mock adapter 通过类型检查)✅(SC-004)
- StreamChunk 8 个 type 全部可构造 ✅(SC-005)

#### P1：Intellect Adapter + 重构现有 BFF

**状态**:✅ 已完成(2026-06-26,Constitution v1.2.0)

**目标**:将现有 BFF 对 Intellect 的直连逻辑重构为通过 IntellectRagAdapter,前端无感知。

> **实施偏差说明**(Constitution v1.2.0 修订):
> - SSE 协议:原 design doc 描述 Intellect RAG 为 OpenAI 兼容格式,实际有双协议(Canvas Workflow + OpenAI 兼容)。P1 实现 `parseCanvasWorkflowSSE`(前端主通道),`parseOpenAISSE` 留待 P3。详见 [research.md](../specs/002-multi-harness-p1/research.md) R1
> - 目录路径:原 design doc 用 `intellect/`,实际遵循 constitution 命名规范用 `intellect-rag/`
> - Session 契约:`listSessions`/`getSession`/`deleteSession` 新增 `agentId` 参数,适配 Intellect RAG 嵌套结构 `/agents/{agentId}/sessions`

| 任务 | 文件 | 说明 | 状态 |
|------|------|------|------|
| 实现 Canvas Workflow SSE 解析器 | `bff/src/services/adapters/intellect-rag/parse-canvas-workflow-sse.ts` | Intellect RAG 主通道 SSE 解析(非 OpenAI 兼容) | ✅ |
| 实现 IntellectRagAdapter | `bff/src/services/adapters/intellect-rag/intellect-rag-adapter.ts` | 实现 `IHarnessAdapter` 接口(Layer 1) | ✅ |
| 实现 AdapterRegistry | `bff/src/services/adapter-registry.ts` | Adapter 注册与按租户选择 | ✅ |
| 实现 TenantContext 中间件 | `bff/src/middleware/tenant-context.ts` | 从 X-Tenant-Id/X-User-Id 提取租户上下文 | ✅ |
| 新增 BFF Agent 原生路由 | `bff/src/routes/bff-agents.ts` | `/api/bff/agents/*` 调 Adapter | ✅ |
| 前端路径迁移 | `src/utils/api.ts` | Agent CRUD/Session/chat 路径从 `proxy/v1/agents` 改为 `bff/agents` | ✅ |

**验收标准**:
- ✅ 现有 Agent/Session CRUD 行为不变(60 个 P0 测试 + 31 个 P1 测试通过)
- ✅ SSE 流式行为不变(parseCanvasWorkflowSSE 11 个契约测试通过)
- ✅ 前端仅 `api.ts` 路径常量改动,业务逻辑零改动
- ✅ BFF TypeScript 编译通过,91 个单元测试全部通过
- ⏳ 冒烟测试(需真实 Intellect RAG 运行):见 [quickstart.md](../specs/002-multi-harness-p1/quickstart.md)

#### P2：Harness Admin + 前端能力探测 ✅ 已完成

**状态**:✅ 已完成(2026-06-26,详见 [specs/003-harness-admin-capabilities/tasks.md](../specs/003-harness-admin-capabilities/tasks.md))

**目标**：Admin 管理端可配置后端，前端可探测能力条件渲染。

| 任务 | 文件 | 说明 | 状态 |
|------|------|------|------|
| P2 DTO 类型 | `bff/src/types/harness-admin.ts` | HarnessBackendWithStatus/CapabilitiesResponse/HarnessBackendForm | ✅ |
| HarnessStore.listConfigs 扩展 | `bff/src/services/harness-store.ts` | 返回所有配置(含未就绪,不含 token 明文) | ✅ |
| AdapterRegistry.invalidate 扩展 | `bff/src/services/adapter-registry.ts` | 热加载缓存失效(可选 backendId 精确失效) | ✅ |
| 校验工具函数 | `bff/src/services/harness-admin-validation.ts` | id kebab-case/endpoint URL/adminTokenEnvVar 格式校验 | ✅ |
| 实现 harness-admin 路由 | `bff/src/routes/harness-admin.ts` | 后端配置 CRUD（不含 token 明文）+ 删除前校验 tenant 绑定 | ✅ |
| 实现能力探测端点 | `bff/src/routes/capabilities.ts` | `GET /api/bff/capabilities` 返回当前后端能力 | ✅ |
| 注册新路由 | `bff/src/index.ts` | 挂载 harness-admin(authMiddleware) + capabilities(+ tenantContextMiddleware) | ✅ |
| 新增前端 API 路径 | `src/utils/api.ts` | harnessAdmin CRUD + capabilities 路径常量 | ✅ |
| 实现 useHarnessCapabilities | `src/hooks/use-harness-capabilities.ts` | TanStack Query,queryKey 含 tenantId 自动重新查询,降级返回 undefined | ✅ |
| 新增 Admin 页面 | `src/pages/admin/harness-backends.tsx` | 列表 + 搜索 + 新增/编辑 Modal(react-hook-form + zod)+ 删除二次确认 | ✅ |
| 注册 Admin 路由 | `src/routes.tsx` | `Routes.AdminHarnessBackends` 枚举 + 路由(非企业版独占) | ✅ |
| 前端条件渲染 | `src/features/{datasets,memories}/manifest.ts` | `enabled(ctx)` 接入 `ctx.capabilities`,空集合默认启用(渐进增强) | ✅ |
| 前端 harness-admin-service | `src/services/harness-admin-service.ts` | CRUD + capabilities 查询封装,类型与 BFF DTO 同步 | ✅ |

**验收标准**：
- ✅ Admin 页面可 CRUD 后端配置(react-hook-form + zod 校验 + 删除二次确认)
- ✅ 新增后端时表单字段为 `adminTokenEnvVar`(env var 引用,不含明文 token)
- ✅ 前端可通过 `useHarnessCapabilities` 获取能力(TanStack Query + 5min 缓存 + 1 次重试)
- ✅ 页面按能力条件渲染(datasets↔knowledgeBase,memories↔memory,capabilities 空集合默认启用)
- ✅ TypeScript 编译零错误(前端 + BFF)
- ✅ 单元测试全过:BFF 8 套件 125 测试(harness-admin 17 + capabilities 6),前端 service 8 测试
- ⏳ 冒烟测试(需真实 Intellect RAG 运行):见 [quickstart.md](../specs/003-harness-admin-capabilities/quickstart.md)

#### P3：Intellect 企业版 Adapter（核心层）✅ 已完成

**状态**:✅ 已完成(2026-06-26,详见 [specs/004-intellect-enterprise-adapter/tasks.md](../specs/004-intellect-enterprise-adapter/tasks.md))

**目标**：BFF 可对接 Intellect 企业版，基础对话功能可用。

| 任务 | 文件 | 说明 | 状态 |
|------|------|------|------|
| Intellect HTTP 客户端 | `bff/src/services/adapters/intellect-enterprise/http-client.ts` | 封装 REST 调用 + Team/Project 组织隔离头注入 + 错误转换(404/5xx/超时) | ✅ |
| IntellectEnterpriseAdapter | `bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts` | 实现核心层 `IHarnessAdapter`(8 方法) | ✅ |
| 对接 `/v1/models` | adapter.ts | `listAgents()` 调用 `/v1/models`,后端不可达降级空数组 | ✅ |
| 对接 `/api/sessions` | adapter.ts | 会话 CRUD(create/get/list/delete) | ✅ |
| 对接 `/api/sessions/{id}/chat/stream` | adapter.ts + parse-intellect-enterprise-sse.ts | SSE 流式对话(主通道,Principle VIII),不复用 `/v1/chat/completions` | ✅ |
| parseIntellectEnterpriseSSE | `bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-sse.ts` | 企业版自定义事件解析器(10 事件类型,Principle IV) | ✅ |
| 对接 `/v1/capabilities` | adapter.ts | `discoverCapabilities()`,404 降级默认能力 | ✅ |
| 注册 Adapter 工厂 | `bff/src/index.ts` | `registerFactory('intellect-enterprise', ...)`,路由层零改动 | ✅ |
| 单元测试 | `*.test.ts` + fixtures/ | http-client 12 + adapter 17 + sse 9 = 38 测试,Mock fetch | ✅ |

**外部依赖**：无（核心层只用到 Intellect 已有的 `/v1/*` 和 `/api/sessions/*`）

**验收标准**：
- ✅ BFF 可连接 Intellect 企业版 :8642(healthCheck 调 `/health`)
- ✅ `listAgents()` 返回 Intellect 模型列表(调 `/v1/models`,不可达降级空数组)
- ✅ `createSession()` 创建会话成功(调 `POST /api/sessions`)
- ✅ `sendMessage()` 流式返回正常(调 `/api/sessions/{id}/chat/stream`,parseIntellectEnterpriseSSE 解析)
- ✅ `healthCheck()` 和 `discoverCapabilities()` 正常(`/v1/capabilities` 404 降级默认)
- ✅ Team/Project 组织隔离头 `X-Intellect-Team`/`X-Intellect-Project` 正确注入(httpClient 统一注入)
- ✅ TypeScript 编译零错误(BFF + 前端)
- ✅ 单元测试全过:BFF 11 套件 164 测试(P0/P1/P2 125 + P3 39),无回归
- ✅ 冒烟测试通过:用 Node mock server 模拟 intellect-team,验证 Admin/能力探测/Agent 列表/会话 CRUD/流式对话(reasoning+delta+usage)/Team/Project 组织隔离头注入(X-Intellect-Team)/错误处理(400/401/404),见 [quickstart.md](../specs/004-intellect-enterprise-adapter/quickstart.md)
- ✅ P0/P1/P2 运行时回归 6 项全过(透传路由/Admin CRUD/capabilities/health)

#### P4b：BFF 统一认证路由 + 缺省 TenantID=0 ✅ 已完成

**状态**:✅ 已完成(2026-06-26,详见 [specs/005-bff-auth-default-tenant/tasks.md](../specs/005-bff-auth-default-tenant/tasks.md))

**目标**:企业版认证经 BFF 路由,cookie 存储 member token,缺省 TenantID=0 简化对接。

| 任务 | 文件 | 说明 | 状态 |
|------|------|------|------|
| BffTenant.authMode 字段 | `bff/src/types/tenant.ts` + `bff/src/services/tenant-store.ts` | intellect-rag \| intellect-enterprise | ✅ |
| 缺省 TenantID=0 兼容 | `bff/src/middleware/tenant-context.ts` | intellectTenantId==="0" 不注入 X-Intellect-Team | ✅ |
| auth-session 中间件 | `bff/src/middleware/auth-session.ts` | cookie 提取 imt_token 注入 AuthSession | ✅ |
| 认证路由 | `bff/src/routes/auth.ts` | login/register/logout/me/channels/oauth callback | ✅ |
| Mock server 扩展 | `bff/scripts/mock-intellect-team.mjs` | /api/members/* + /api/oauth/* | ✅ |
| 前端路径迁移 | `src/utils/api.ts` | 认证路径从 proxy/v1/auth 到 /api/bff/auth | ✅ |
| intellect-team 对接文档 | `docs/intellect-team-integration/README.md` | 架构图 + 端点清单 + P4a 优先级 | ✅ |

**验收标准**:
- ✅ 企业版密码登录:POST /api/bff/auth/login → 200 + Set-Cookie(imt_token)
- ✅ /auth/me:cookie 鉴权 → 返回 member 信息
- ✅ 注册/登出闭环:register → login → logout → /auth/me → 401
- ✅ OAuth 渠道列表 + login/{provider} 302 + callback state 校验 + token 签发完整流程
- ✅ 社区版 authMode=intellect-rag 透传,100% 不回归
- ✅ TypeScript 编译零错误(BFF + 前端)
- ✅ 单元测试全过:BFF 253 测试(P0-P3 164 + P4b 47 + P5 42),无回归
- ✅ intellect-team 对接文档完成(README + member-auth-api + oauth-callback-token + default-tenant-compat)

**安全加固**(2026-07-13 评审修复):
- ✅ 多租户隔离:企业版 baseUrl 从 HarnessStore 按 `tenant.intellectBackendId` 读取对应 intellect-team 实例 endpoint,不直接读单一环境变量(多实例多租户隔离,FR-014)
- ✅ X-Tenant-Id 统一策略:公开端点(login/register/channels/login/{channel}/oauth/callback/config)缺失时用 '0' 兜底;需认证端点(me/logout)缺失即 400(FR-015)
- ✅ OAuth state CSRF 防护:/auth/login/:channel 时从 302 Location 提取 state 存入短期 HttpOnly cookie(10min),/auth/oauth/callback 时校验 query.state 与 cookie 一致后清除(FR-008/FR-009)
- ✅ 错误信息脱敏:5xx 错误不透传后端原始 text 给前端,只记 console.error 日志(FR-016)

#### P4d：前端登录页字段适配 ✅ 已完成

**状态**:✅ 已完成(2026-06-26,详见 [specs/006-frontend-login-adaptation/tasks.md](../specs/006-frontend-login-adaptation/tasks.md))

**目标**:登录/注册页根据 BffTenant.authMode 动态切换字段(企业版 `login_name`/`display_name`,社区版 `email`/`nickname`)。

| 任务 | 文件 | 说明 | 状态 |
|------|------|------|------|
| BFF auth config 端点 | `bff/src/routes/auth.ts` | 公开 GET `/api/bff/auth/config` 返回 `{ authMode }`(无需认证) | ✅ |
| auth config 测试 | `bff/src/routes/auth.test.ts` | 3 场景:企业版/社区版/无 tenantId | ✅ |
| useAuthMode hook | `src/hooks/use-login-request.ts` | TanStack Query 5min 缓存,从 BFF 拉 authMode | ✅ |
| 登录页表单适配 | `src/pages/login-next/index.tsx` | authMode=intellect-enterprise 显示 login_name;authMode=intellect-rag 显示 email | ✅ |
| zod schema 切换 | `src/pages/login-next/index.tsx` | email 格式校验 vs login_name 长度校验 | ✅ |
| 注册页表单适配 | `src/pages/login-next/index.tsx` | intellect-enterprise 显示 login_name + display_name;intellect-rag 显示 email + nickname | ✅ |
| i18n 键新增 | `src/locales/{en,zh}.ts` | loginNameLabel/Placeholder + displayNameLabel/Placeholder | ✅ |
| useLogin/useRegister 类型扩展 | `src/hooks/use-login-request.ts` | 支持 login_name + display_name 字段 | ✅ |

**验收标准**:
- ✅ 企业版登录页显示 `login_name` 字段,社区版显示 `email` 字段(根据 BFF authMode 动态切换)
- ✅ 注册页对应显示 `login_name + display_name` 或 `email + nickname`
- ✅ zod 校验按 authMode 切换(email 正则 vs login_name 长度)
- ✅ BFF auth config 端点无需认证,3 场景测试通过
- ✅ TypeScript 编译零错误(BFF + 前端)
- ✅ 单元测试全过:BFF 214 测试(P0-P4b 211 + P4d 3),无回归

#### P5：Team/Project 管理 + Tenant 绑定 ✅ 已完成

**状态**:✅ 已完成(2026-06-26,详见 [specs/007-team-project-management/tasks.md](../specs/007-team-project-management/tasks.md))

**目标**:BFF Team/Project 管理层透传 Team/Project CRUD 到 intellect-team,前端 Admin 页面管理 Team/Project + BffTenant 绑定,替换缺省 TenantID=0 实现实例内 Team/Project 数据隔离（真正租户隔离通过多实例：不同 intellectBackendId）。

**BFF 侧任务**:

| 任务 | 文件 | 说明 | 状态 |
|------|------|------|------|
| Team/Project 类型 | `bff/src/types/team.ts` | Team(slug/display_name/enabled/created_by/created_at) + Project(team_ref/slug/display_name/enabled/created_by/created_at) | ✅ |
| intellect-team admin client | `bff/src/services/intellect-team-admin-client.ts` | Team/Project CRUD 调用,注入 API_SERVER_KEY + X-Intellect-Team/Project 头 | ✅ |
| BffTenant 配置扩展 | `bff/data/bff-tenants.json` | 新增示例 tenant + 缺省 TenantID=0 tenant | ✅ |
| TenantContext 注入 project_id | `bff/src/middleware/tenant-context.ts` | intellectProjectId 存在时注入 X-Intellect-Project 头 | ✅ |
| 中间件测试扩展 | `bff/src/middleware/tenant-context.test.ts` | 真实 team_id + project_id 注入头(+3 tests) | ✅ |
| Team CRUD 路由 | `bff/src/routes/teams.ts` | POST/GET/DELETE `/admin/teams[/:ref]`,删除前检查 BffTenant 绑定(409) | ✅ |
| Project CRUD 路由 | `bff/src/routes/projects.ts` | POST/GET/DELETE `/admin/projects[/:ref]`,独立路径 + team_ref 关联 | ✅ |
| Tenant 绑定路由 | `bff/src/routes/tenant-bindings.ts` | GET/PUT `/admin/tenants/:id/binding` | ✅ |
| 路由注册 | `bff/src/index.ts` | 挂载 teams/projects/tenant-bindings 到 authMiddleware | ✅ |
| BFF 契约对齐修正 | (多处) | 5 处偏差修正:OAuth 路由/Team 字段/Project 端点/DELETE 软删除/created_by 自动注入 | ✅ |
| Team CRUD 测试 | `bff/src/routes/teams.test.ts` | 10 tests:CRUD + 删除被绑定 Team 409 | ✅ |
| Project CRUD 测试 | `bff/src/routes/projects.test.ts` | 7 tests:CRUD + X-Intellect-Team 注入 + 502 | ✅ |
| Tenant 绑定测试 | `bff/src/routes/tenant-bindings.test.ts` | 10 tests:GET/PUT 绑定/回退缺省/解绑 project/404/400 | ✅ |

**前端侧任务**:

| 任务 | 文件 | 说明 | 状态 |
|------|------|------|------|
| API 路径常量 | `src/utils/api.ts` | adminTeams/adminProjects/adminTenantBinding 路径 | ✅ |
| 数据访问层 | `src/services/team-admin-service.ts` | Team/Project/Tenant-binding CRUD 封装 | ✅ |
| Team 管理页面 | `src/pages/admin/teams.tsx` | 列表 + 新增(slug/display_name) + 归档(软删除) | ✅ |
| Project 管理页面 | `src/pages/admin/projects.tsx` | 列表 + 新增(team_ref 关联 + slug/display_name) + 归档 | ✅ |
| Tenant 绑定页面 | `src/pages/admin/tenant-bindings.tsx` | Team/Project 级联下拉,Project 按 team_id 前端过滤 | ✅ |
| 路由注册 | `src/routes.tsx` | AdminTeams/AdminProjects/AdminTenantBindings 路由 | ✅ |
| 导航菜单 | `src/pages/admin/layouts/navigation-layout.tsx` | Teams(Users icon)/Projects(FolderKanban)/Tenant Bindings(Link icon) | ✅ |
| i18n 翻译 | `src/locales/en.ts` | teams/projects/tenantBinding 命名空间 | ✅ |

**验收标准**:
- ✅ Team/Project CRUD 路由调 intellect-team API,slug 作为标识(对齐 intellect-team 实际契约)
- ✅ Team 删除前检查 BffTenant 绑定,绑定则返回 409(FR-011)
- ✅ TenantContext 在 intellectTenantId !== "0" 时注入 X-Intellect-Team,intellectProjectId 存在时注入 X-Intellect-Project
- ✅ TenantID=0 模式 100% 不回归(向后兼容 P4b)
- ✅ 前端 Admin 页面可管理 Team/Project + Tenant 绑定(级联下拉)
- ✅ created_by 由 BFF 从 AuthSession.memberId 自动注入,前端可不传
- ✅ DELETE 语义为软删除(archive),intellect-team 返回 `{ok:true}` → BFF 返回 `{archived:true}`
- ✅ TypeScript 编译零错误(BFF + 前端)
- ✅ 单元测试全过:BFF 253 测试(P0-P4b 211 + P5 BFF 42),无回归

**契约对齐修正**(2026-06-26,对比 intellect-team 实际实现):

1. OAuth 路由:`POST /api/oauth/authorize` → `GET /api/oauth/login/{provider}`(直接透传 302,`redirect: manual`)
2. Team 字段:`{name, description}` → `{slug, display_name, enabled, created_by}`
3. Project 端点:嵌套 `/api/teams/{id}/projects` → 独立 `/api/projects` + `team_ref` 关联
4. DELETE 语义:硬删除 → 软删除(archive),`{ok: true}` → `{archived: true}`
5. created_by 注入:BFF 从 AuthSession.memberId 自动注入,前端可不传
6. 移除 PUT:intellect-team 未实现 Team/Project 更新,BFF 不暴露 PUT 路由(YAGNI)
7. list 响应提取:intellect-team 返回 `{data: [...]}`,BFF admin client 提取数组

#### spec-008：显式 CanvasService — 画布脱离 Proxy 路由 ✅ 已完成

**状态**:✅ 已完成(2026-07-20)

**目标**:BFF 新增显式 `CanvasService` 服务层 + 单一 `/api/bff/canvas/*` 路由前缀，将画布操作从 `bff-agents.ts` 的 `passthrough()` 与 `proxy.ts` catch-all 迁出，落实 Constitution Principle III（Canvas Hard-Bound to Intellect RAG）。

**BFF 侧任务**:

| 任务 | 文件 | 说明 | 状态 |
|------|------|------|------|
| Canvas DTO 类型 | `bff/src/types/canvas.ts` | CanvasAgent/CanvasTemplate/CanvasVersion/CreateCanvasBody 等 | ✅ |
| CanvasService | `bff/src/services/canvas-service.ts` | 24 方法:21 JSON + 3 流式透传 + 1 private helper | ✅ |
| Canvas 路由 | `bff/src/routes/canvas.ts` | 24 条显式路由 + 错误码映射(R6) | ✅ |
| AdapterRegistry 扩展 | `bff/src/services/adapter-registry.ts` | getCanvasBackendForTenant 方法,按 BffTenant.canvasBackendId 路由 | ✅ |
| 错误类型 | `bff/src/services/adapter-registry-errors.ts` | CanvasBackendNotBoundError / InvalidCanvasBackendError | ✅ |
| IntellectRagAdapter 扩展 | `bff/src/services/adapters/intellect-rag/` | request() 改为 public + 新增 proxy() 流式透传 | ✅ |
| 路由注册 | `bff/src/index.ts` | /canvas/* 挂载 authMiddleware + tenantContextMiddleware | ✅ |
| bff-agents 清理 | `bff/src/routes/bff-agents.ts` | 移除 passthrough + POST/PUT/DELETE /agents | ✅ |
| 共享工具 | `bff/src/utils/response.ts` | streamResponse() — proxy.ts + canvas.ts 复用 | ✅ |
| 共享中间件 | `bff/src/middleware/tenant-context.ts` | resolveTenantContext() — bff-agents + canvas 复用 | ✅ |

**前端侧任务**:

| 任务 | 文件 | 说明 | 状态 |
|------|------|------|------|
| API 路径常量 | `src/utils/api.ts` | 新增 bffCanvas 常量,22 条 endpoint 迁移 | ✅ |

**测试**:BFF 309 tests passed(18 files),`tsc --noEmit` 零错误

---

#### spec-009：Canvas Plugin Extraction — 画布插件化 ✅ 已完成

**状态**:✅ Phase 0-2 完成(2026-07-20),Phase 3 文档完成

**目标**:将画布代码从 `src/pages/agent/` 物理迁入独立包 `packages/canvas-plugin/`，复用 `ModuleDefinition` 接口实现画布代码内聚与可插拔。

**Phase 0 — 解耦**(2026-07-13):

| 任务 | 说明 | 状态 |
|------|------|------|
| T001-T005 | 消除 src/components/ 下 6 个文件对画布内部细节的依赖 | ✅ |
| T007 | 代码评审修复(7 项) | ✅ |

**Phase 1 — 包结构**(2026-07-20):

| 任务 | 说明 | 状态 |
|------|------|------|
| T010-T017 | monorepo workspace + tsconfig paths + vite alias + manifest 薄封装 | ✅ |

**Phase 2 — 代码迁移**(2026-07-20):

| 任务 | 说明 | 状态 |
|------|------|------|
| T022 | git mv src/pages/agent/ → packages/canvas-plugin/src/editor/ (323 files) | ✅ |
| T023-T024 | 类型 barrel + 请求接口 re-export | ✅ |
| T025 | i18n flow.* 提取 → packages/canvas-plugin/src/i18n/ | ✅ |
| T026-T027 | canvas-service + canvas-hooks barrels | ✅ |
| T028 | Manifest 拆分 — agents 仅保留列表路由,canvas 路由迁入 plugin | ✅ |
| T029-T031 | canvas/background + xyflow + canvas-util 组件/工具迁移 | ✅ |
| T032 | constants barrel + 19 consumer imports updated | ✅ |

**新建文件**:`packages/canvas-plugin/` 下 10 个文件(含 source tree)

**验收标准**:
- ✅ `tsc --noEmit` 零错误(主应用 + BFF)
- ✅ `src/pages/agent/` 目录已删除(git mv)
- ✅ `grep -rn "from '@/pages/agent/" src/` 返回空(0 stale imports)
- ✅ agents manifest 仅保留 agent 列表路由
- ✅ canvas plugin ModuleDefinition:能力门控 `capabilities.has('canvas')`
- ✅ 53 处 import 路径从 `@/pages/agent/` 更新为 `@agentui/canvas-plugin/editor/`

### 10.2 后续阶段（P6-P7，依赖外部条件）

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **P4** | Intellect 侧新增 Team/Project CRUD HTTP API | Intellect 团队（参考 [Intellect Admin API 接口指南](file:///Users/simon/workspace/agentui/docs/intellect-admin-api-guide.md)） |
| **P6** | 画布服务（硬绑定 Intellect） | P1 |
| **P7** | SSE 事件扩展（runs/skills，可选） | P3 |

> **已完成阶段**:P0-前置 / P0 / P1 / P2 / P3 / P4b / P4d / P5 全部 ✅,详见 §10.1 各阶段章节。

## 十一、涉及文件清单

| 文件 | 阶段 | 操作 |
|------|------|------|
| `bff/src/routes/proxy.ts` | P0-前置 | 新建（透明反向代理） |
| `bff/src/services/intellect-rag-client.ts` | P0-前置 | 修改（新增 `proxy` 方法；文件重命名自 `intellect-client.ts`） |
| `bff/src/index.ts` | P0-前置 | 修改（挂载 proxy 路由） |
| `vite.config.ts` | P0-前置 | 修改（新增 `/api/bff` proxy） |
| `src/utils/api.ts` | P0-前置 | 修改（`restAPIv1` 切到 `/api/bff/proxy/v1`） |
| `.env.example` | P0-前置 | 修改（新增 `VITE_BFF_BASE`） |
| `bff/src/services/adapters/types.ts` | P0 | 新建 |
| `bff/src/services/harness-store.ts` | P0 | 新建 |
| `bff/src/services/tenant-store.ts` | P0 | 新建 |
| `bff/data/harness-backends.json` | P0 | 新建（默认配置） |
| `.env.example` | P0 | 修改 |
| `bff/src/services/adapters/shared/openai-sse.ts` | P1 | 新建（Intellect RAG SSE） |
| `bff/src/services/adapters/intellect-rag/client.ts` | P1 | 新建 |
| `bff/src/services/adapters/intellect-rag/adapter.ts` | P1 | 新建（IntellectRagAdapter） |
| `bff/src/services/adapters/registry.ts` | P1 | 新建 |
| `bff/src/routes/agent.ts` | P1 | 重构 |
| `bff/src/routes/session.ts` | P1 | 重构 |
| `bff/src/routes/harness-admin.ts` | P2 | 新建 |
| `bff/src/routes/capabilities.ts` | P2 | 新建 |
| `bff/src/index.ts` | P2 | 修改（注册路由） |
| `src/utils/api.ts` | P2 | 修改（新增路径） |
| `src/hooks/useHarnessCapabilities.ts` | P2 | 新建 |
| `src/pages/admin/harness-backends.tsx` | P2 | 新建 |
| `bff/src/services/adapters/shared/intellect-enterprise-sse.ts` | P3 | 新建（企业版 SSE） |
| `bff/src/services/adapters/intellect-enterprise/client.ts` | P3 | 新建 |
| `bff/src/services/adapters/intellect-enterprise/adapter.ts` | P3 | 新建（IntellectEnterpriseAdapter） |
| `docs/intellect-admin-api-guide.md` | 已完成 | 新建（Intellect 侧 API 指南） |
| `docs/multi-harness-design.md` | 已完成 | 新建（本文档） |

## 十二、前端 API 迁移到 BFF 策略（P0 前置）

### 12.1 现状与差距

设计文档 §九"前端改动清单"假设前端已通过 BFF 调用后端，但代码现状并非如此：

- [src/utils/api.ts](file:///Users/simon/project/agentui/src/utils/api.ts) 中 **400+ 个 API 端点**全部直连 Intellect RAG `/api/v1/*`（端口 9380）
- BFF（端口 9390）目前只承接 `agent`、`session`（stub）、`admin`（whitelist/roles/resources）四类路由
- 前端通过 Vite proxy 把 `/api/v1/*` 直接转发到 intellect-rag，完全不经过 BFF

**影响**：P1"前端无感知重构"的前提不成立。Adapter 重构 BFF 路由后，前端如果不切到 BFF，根本无法消费 Adapter。因此前端 API 迁移是 P0 的硬前置。

### 12.2 迁移策略：BFF 反向代理 + 渐进式接管

采用**两阶段迁移**，避免一次性改 400+ 端点的高风险：

#### 阶段 A（P0 前置）：BFF 透明反向代理

在 BFF 新增一个 catch-all 反向代理路由，把 `/api/bff/proxy/v1/*` 透传到 Intellect RAG `/api/v1/*`，**不改业务逻辑**。

```typescript
// bff/src/routes/proxy.ts
// 透明代理：/api/bff/proxy/v1/* → intellect-rag /api/v1/*
proxyRoutes.all('/proxy/v1/*', async (c) => {
  const path = c.req.path.replace('/proxy/v1', '/api/v1');
  return intellectRagClient.proxy(path, c.req);
});
```

前端只需改一个常量：
```typescript
// src/utils/api.ts
const restAPIv1 = `/api/bff/proxy/v1`;  // 原: `/api/v1`
```

**验收**：
- 前端所有现有功能行为不变（登录、Agent、知识库、画布、搜索、记忆等）
- BFF 日志能看到所有 API 流量（为 P1 重构提供观察面）
- BFF authMiddleware 对所有请求生效（统一鉴权入口）

#### 阶段 B（P1+）：按域逐步原生实现

P1 起，按业务域把代理路由逐个替换为 BFF 原生路由（调 Adapter）：

| 顺序 | 域 | 替换路径 | 阶段 |
|------|---|---------|------|
| 1 | Agent | `/api/bff/proxy/v1/agents/*` → `/api/bff/agents/*`（Adapter） | P1 |
| 2 | Session | `/api/bff/proxy/v1/agents/{id}/sessions/*` → `/api/bff/sessions/*`（Adapter） | P1 |
| 3 | Canvas | `/api/bff/proxy/v1/canvas/*` → `/api/bff/canvas/*`（CanvasService 硬绑定） | P6 |
| 4 | Dataset/KB | 保留 proxy（Intellect RAG 专属，无需 Adapter） | 不迁移 |
| 5 | Admin | 已迁移（`/api/bff/admin/*`） | 已完成 |

**原则**：
- Intellect RAG 专属能力（Dataset/KB/Search/Memory/MCP）**保留代理**，不纳入 Adapter
- 只有需要"多后端切换"的域（Agent/Session/Canvas）才升级为原生 Adapter 路由
- 每替换一个域，前端 `api.ts` 对应路径从 `proxy/v1/...` 改为 `bff/...`，单点改动

### 12.3 配套改动

| 文件 | 改动 | 阶段 |
|------|------|------|
| `bff/src/routes/proxy.ts` | 新建：透明反向代理 | P0 前置 |
| `bff/src/index.ts` | 挂载 proxy 路由（在 authMiddleware 之后） | P0 前置 |
| `bff/src/services/intellect-rag-client.ts` | 新增 `proxy(path, req)` 方法（透传 method/headers/body/query） | P0 前置 |
| `vite.config.ts` | 把 `/api/bff` proxy 指向 BFF 9390（保留 `/api/v1` 旧 proxy 用于回滚） | P0 前置 |
| `src/utils/api.ts` | `restAPIv1` 改为 `/api/bff/proxy/v1`（单行改动） | P0 前置 |
| `.env.example` | 新增 `VITE_BFF_BASE=/api/bff` | P0 前置 |

### 12.4 风险与回滚

- **风险**：代理引入一跳延迟（本地 ~1ms，可忽略）；SSE 流式需要 BFF 正确透传（`proxy` 方法不能用 `response.json()`，必须 pipe response body）
- **回滚**：`src/utils/api.ts` 改回 `/api/v1` 即可瞬时回滚，BFF proxy 路由保留不影响
- **验收清单**：迁移后跑一遍冒烟用例（登录→创建 Agent→创建会话→流式对话→画布编辑→知识库 CRUD），全部通过才算 P0 前置完成

## 十三、Intellect 企业版关键发现

### 13.1 已实现能力

通过分析 `~/workspace/intellect-team`，确认企业版已实现：

| 能力 | 端点 | 说明 |
|------|------|------|
| Chat Completions（SSE 流式） | `POST /v1/chat/completions` | OpenAI 兼容格式 |
| Responses API | `POST /v1/responses` | OpenAI Responses API |
| 模型列表 | `GET /v1/models` | OpenAI 兼容 |
| 能力发现 | `GET /v1/capabilities` | 内置能力声明 |
| 会话 CRUD | `GET/POST/PATCH/DELETE /api/sessions` | 会话管理 |
| 会话消息 | `GET /api/sessions/{id}/messages` | 消息历史 |
| 会话流式聊天 | `POST /api/sessions/{id}/chat/stream` | SSE 流式 |
| 会话 Fork | `POST /api/sessions/{id}/fork` | 会话分叉 |
| Runs（异步任务） | `POST /v1/runs` + `GET /v1/runs/{id}/events` | 异步执行 |
| Skills | `GET /v1/skills` | 技能列表 |
| Team/Project 组织隔离头 | `X-Intellect-Team` / `X-Intellect-Project` | HTTP Header 传递 |

### 13.2 数据模型

Intellect 企业版数据模型为 **Member → Team → Project** 三层（无 Tenant 实体）：

| 表 | 主键 | 关键字段 | 说明 |
|----|------|---------|------|
| `members` | id (TEXT) | display_name, login_name, email, role(owner/admin/member/viewer), enabled | 成员 |
| `teams` | id (TEXT) | slug (UNIQUE), display_name, created_by, enabled | 团队 |
| `team_memberships` | id | team_id, member_id, role — UNIQUE(team_id, member_id) | 成员↔团队多对多 |
| `projects` | id (TEXT) | slug, display_name, team_id, owner_member_id, repo_url, default_branch — UNIQUE(team_id, slug) | 项目（属于一个 Team） |
| `project_memberships` | id | project_id, member_id, role — UNIQUE(project_id, member_id) | 成员↔项目多对多 |
| `project_teams` | id | project_id, team_id, role — UNIQUE(project_id, team_id) | 项目↔团队多对多（可选） |
| `member_api_tokens` | id | member_id, token_hash, scope_type(member/project), scope_id | API token（imt_* / imt_p_*） |

### 13.3 缺失能力

Team/Project/Member 的 **HTTP API 路由层**未实现（DB 方法已存在于 `MembershipStore`，需新增 HTTP 路由）。

详细接口规范见 [Intellect Admin API 接口指南](file:///Users/simon/workspace/agentui/docs/intellect-admin-api-guide.md)。

## 附录：相关文档

- [Intellect Admin API 接口指南](file:///Users/simon/workspace/agentui/docs/intellect-admin-api-guide.md) — Intellect 侧 Team/Project/Member HTTP API 规范
- [Vite 架构文档第十六章](file:///Users/simon/workspace/agentui/docs/vite-architecture.md) — BFF 整体架构（含本章内容的集成位置）
- [Canvas 机制文档](file:///Users/simon/workspace/agentui/docs/canvas-mechanism.md) — Intellect 画布引擎说明
