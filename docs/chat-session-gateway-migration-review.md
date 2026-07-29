# Chat Session 迁移至 TEAM Gateway 的可行性评审

> 评审日期：2026-07-26（初稿）/ 2026-07-27（增补 §九 Gateway 端缺口评审）
> 评审对象：上一轮"Chat Session 直接通过 Gateway（不经过 RAG Backend）"的可行性分析
> 评审范围：AgentUI BFF + intellect-team Rust Gateway + intellect-rag-app
> 关联文档：
> - [chat-session-gap-analysis.md](file:///Users/simon/project/agentui/docs/chat-session-gap-analysis.md)（会话功能整体差距分析）
> - [multi-harness-design.md](file:///Users/simon/project/agentui/docs/multi-harness-design.md)（多后端架构设计）
> - [intellect-team TODO: Rust Gateway RAG 集成](file:///Users/simon/project/intellect-team/docs/plans/2026-07-26-rust-gateway-rag-integration-todo.md)（需 RAG 能力场景的后续工作）
> - [intellect-team: 2026-07-27-chat-migration-gap-review.md](file:///Users/simon/project/intellect-team/docs/plans/2026-07-27-chat-migration-gap-review.md)（Gateway 端缺口评审报告，§九 的源头）

---

## 一、评审背景

### 1.1 原始假设

用户提出："RAG 已经是 TEAM 的一个 PlugIn，因此 Chat Session 应该可以通过 Gateway，而不需要通过 RAG Backend。"

### 1.2 原始分析结论

| 维度 | 原结论 |
|---|---|
| Gateway chat 能力 | ✅ 完整（14 条 chat/session 路由） |
| Gateway 数据流 | ✅ 模式 A（直接调 DB + LLM Gateway，不依赖 RAG） |
| "RAG 是 PlugIn" | ⚠️ 仅 Python 端成立，Rust Gateway 未集成 |
| 纯 LLM 对话迁移 | ✅ 可行 |
| 需要 RAG 能力场景 | ❌ 当前不可行 |
| 推荐方案 | 按场景分流（无 KB 走 Gateway，有 KB 走 RAG） |

### 1.3 评审目的

补充原始分析遗漏的维度，验证可行性结论，给出可执行的实施方案。

---

## 二、评审发现：原始分析的关键遗漏

### 2.1 遗漏 1：BFF 已有完整的 Gateway 集成基础设施 ⚠️ 重大遗漏

**原始分析说**："BFF 新增路由前缀，将纯 LLM 对话 chat 代理到 Gateway" —— 暗示需要新建路由。

**实际现状**：BFF 已有完整基础设施，**无需新建路由**。

| 组件 | 文件 | 状态 |
|---|---|---|
| Adapter 接口定义 | [bff/src/types/adapter.ts](file:///Users/simon/project/agentui/bff/src/types/adapter.ts) | ✅ 完整（IHarnessAdapter Layer 1） |
| IntellectEnterpriseAdapter | [bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts) | ✅ 完整实现（listAgents/getAgent/createSession/listSessions/getSession/deleteSession/sendMessage/cancelMessage/healthCheck/discoverCapabilities） |
| Adapter 工厂注册 | [bff/src/index.ts](file:///Users/simon/project/agentui/bff/src/index.ts) L56-59 | ✅ 已注册 `intellect-enterprise` factory |
| HTTP 客户端 | [bff/src/services/adapters/intellect-enterprise/http-client.ts](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-enterprise/http-client.ts) | ✅ 完整（鉴权/租户隔离/错误转换/30s TTL 缓存） |
| SSE 解析器 | [bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-sse.ts](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-sse.ts) | ✅ 完整（11 种事件 + 容错） |
| AdapterRegistry 动态路由 | [bff/src/services/adapter-registry.ts](file:///Users/simon/project/agentui/bff/src/services/adapter-registry.ts) | ✅ 按 `backend.type` 动态选择 adapter |
| /agents/* 路由动态选择 | [bff/src/routes/bff-agents.ts](file:///Users/simon/project/agentui/bff/src/routes/bff-agents.ts) L50-76 | ✅ 调用 `registry.getAdapterForBackend(ctx.backendId)` |

**影响**：实施方案从"新建 BFF 路由"修订为"配置切换 + 修复 TS 类型断言"。

### 2.2 遗漏 2：鉴权机制差异 ⚠️ 关键差异

**原始分析说**：未深入分析鉴权。

**实际差异**：

| 维度 | intellect-rag-app | intellect-team Gateway |
|---|---|---|
| 鉴权方式 | BFF 注入 API key + `X-Intellect-Tenant` header | `Authorization: Bearer <token>`（Profile/Member/Project 三模式） |
| 租户头 | `X-Intellect-Tenant` | **`X-Tenant-Id`**（32-hex 格式校验） |
| 用户头 | `X-Intellect-User` | `X-Intellect-User`（仅 Profile 模式下作 member_id 兜底，需 `mem_` 前缀） |
| 团队/项目头 | `X-Intellect-Team` / `X-Intellect-Project` | 同名，但语义为 intellect-team 实例内 team/project |

**关键事实**：
- BFF [http-client.ts](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-enterprise/http-client.ts) L284-312 的 `buildHeaders()` 已正确处理 Gateway 鉴权（注入 `Authorization: Bearer ${apiServerKey}` + `X-Intellect-*` 系列）
- BFF **不注入 `X-Tenant-Id`**，让 Gateway 使用 `instance_tenant_id` 默认值（[auth.rs:327](file:///Users/simon/project/intellect-team/intellect-gateway/src/platform/auth.rs) L327）
- Profile 模式（`apiServerKey == API_SERVER_TOKEN`）下 `bypass_member_filter=true`，BFF 服务级调用可绕过 member 级 RBAC

**影响**：无需额外鉴权适配，BFF 现有 `IntellectEnterpriseHttpClient` 已完整支持。

### 2.3 遗漏 3：数据模型差异 ⚠️ 概念错位

**原始分析说**：提到"Postgres vs MySQL"但未深入。

**实际差异**：两者**不是同一概念**，不能简单替换。

| 维度 | Gateway `sessions` 表 | intellect-rag `Dialog` 表 |
|---|---|---|
| 概念定位 | **对话运行实例**（runtime） | **对话配置模板**（config） |
| 数据库 | PostgreSQL | MySQL（peewee ORM） |
| 主键 | `id` TEXT（`api_<sha256>`） | `id` UUID |
| 名称字段 | `title` | `name` |
| 多租户字段 | 无（独立 `tenants` 表） | `tenant_id`（32-hex） |
| 模型配置 | `model` + `model_config` (JSON) | `llm_id` + `llm_setting` |
| 系统提示 | `system_prompt` TEXT | `prompt_config` JSON（结构化：system/prologue/parameters/empty_response） |
| **知识库关联** | **无** | **`kb_ids`**（关键差异） |
| Token 计费 | `input_tokens`/`output_tokens`/`cache_read_tokens`/`cache_write_tokens`/`reasoning_tokens` + `estimated_cost_usd` + `actual_cost_usd` | 无 |
| 工具调用统计 | `tool_call_count`、`api_call_count` | 无 |
| 状态字段 | `ended_at` + `end_reason` + `suspended` | `status` (VALID/INVALID) |
| 可见性 | `visibility`（private/team/project） | `owner_ids` 列表 |
| 父子链 | `parent_session_id`（压缩链） | 无 |
| Handoff | `handoff_state`/`handoff_platform`/`handoff_error` | 无 |

**关键差异**：Gateway session **没有 `kb_ids` 字段**，无法绑定知识库。这是"纯 LLM 对话可走 Gateway，RAG 增强必须留 RAG"的根本原因。

**Message 表差异**：

| 维度 | Gateway `messages` 表 | intellect-rag message 存储 |
|---|---|---|
| role 取值 | `user` / `assistant` / `tool` | `user` / `assistant` / `system` |
| 推理内容 | `reasoning_content` + `reasoning_details` JSON | 通过 think 标签包裹 |
| 工具调用 | `tool_calls` JSON + `tool_call_id` + `tool_name` | 不暴露工具调用 |
| 全文搜索 | `search_vector` tsvector + GIN 索引 + trigram | 无 |
| Streaming 中间状态 | 不入库（通过 mpsc channel 推送） | 不入库 |

**影响**：
- 纯 LLM 对话场景：Gateway session 模型完全够用
- RAG 增强场景：Gateway 缺 `kb_ids` 字段，需 intellect-team 侧扩展（见 [TODO 文档](file:///Users/simon/project/intellect-team/docs/plans/2026-07-26-rust-gateway-rag-integration-todo.md)）

### 2.4 遗漏 4：SSE 格式不兼容 ⚠️ 前端需适配

**原始分析说**：未分析 SSE 格式差异。

**实际差异**：

| 维度 | Gateway SSE | intellect-rag SSE |
|---|---|---|
| 协议层 | axum SSE（`event:` + `data:`） | 手写 `data: {json}\n\n` |
| 事件区分 | `event:` 字段 + `data.type` 字段 | 仅 `data.code` / `data.data.type` |
| 数据信封 | `{"type":"...","text":...}` | `{"code":0,"message":"","data":{...}}` |
| 工具事件 | `event: tool.progress` + `{"type":"tool.started/completed",...}` | 无 |
| 推理事件 | `{"type":"reasoning.delta","text":...}` | `{"data":{"answer":"...","start_to_think":true,"end_to_think":true}}` |
| 错误事件 | `event: error` + `{"message":...}` | `data: {"code":500,"message":"...","data":{"answer":"**ERROR**: ..."}}` |
| 终止信号 | `data: [DONE]` (纯文本 sentinel) | `data: {"code":0,"message":"","data":true}` |
| KeepAlive | `: keepalive` 注释（30s） | 无 |

**BFF 已有解析器**：[parse-intellect-enterprise-sse.ts](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-sse.ts) 完整支持 11 种 Gateway 事件，转换为统一的 `StreamChunk` 类型。

**OpenAI 兼容路径**：Gateway 同时提供 `POST /v1/chat/completions`（[api_server.rs:1646](file:///Users/simon/project/intellect-team/intellect-gateway/src/platform/api_server.rs) L1646），完全兼容 OpenAI Chat Completions 流式格式（`choices[].delta.content` + `finish_reason` + `[DONE]`）。

**影响**：
- 走 `/agents/*` BFF 路由：SSE 解析已就绪（BFF 统一转 StreamChunk）
- 走 `/proxy/v1/*` 透传路由：需新建 enterprise 透传路径或改造现有 proxy.ts
- 走 OpenAI 兼容路径：前端可直接消费，但失去 reasoning/tool 事件

### 2.5 遗漏 5：bff-agents.ts 的 TS 类型断言风险 ⚠️ 需修复

**原始分析说**：未提及。

**实际现状**：[bff-agents.ts](file:///Users/simon/project/agentui/bff/src/routes/bff-agents.ts) L50-76 的 `getAdapter(c)` 函数：
- 运行时：通过 `registry.getAdapterForBackend(ctx.backendId)` 动态返回 `IntellectRagAdapter` 或 `IntellectEnterpriseAdapter`
- 类型断言：`return adapter as IntellectRagAdapter`（注释 "P1 阶段返回的 adapter 一定是 IntellectRagAdapter"）
- 兜底：registry 失败时强制 `backends.find(b => b.type === 'intellect-rag')` 回退

**风险**：若租户绑定 `intellect-enterprise` backend，运行时返回 `IntellectEnterpriseAdapter`，但 TS 类型断言为 `IntellectRagAdapter`。当前所有 handler 只调用 `IHarnessAdapter` 接口方法，运行时不会 crash，但类型安全受损。

**影响**：实施时需将返回类型改为 `IHarnessAdapter | null`，消除断言风险。

### 2.6 遗漏 6：现有架构的实际数据流 ⚠️ 认知纠正

**原始分析说**：BFF 把 chat 分成"普通 chat 走 /proxy/v1/chats"和"Agent session 走 /agents/*"。

**实际现状**（参考 [chat-session-gap-analysis.md](file:///Users/simon/project/agentui/docs/chat-session-gap-analysis.md) L17-30）：

> **架构决策已落地**：选择方案 B（CHAT 直接通过 Gateway 对接 TEAM，复用 Intellect RAG `/v1/chats` API），未走方案 A。LLM 部署由 Gateway 端完成，BFF 仅作透明代理（`/api/bff/proxy/v1/*` → intellect-team Gateway）。

**当前真实数据流**：

| 请求类型 | BFF 路径 | 实际上游 | 说明 |
|---|---|---|---|
| 普通 chat CRUD + session | `/proxy/v1/chats/*` | **intellect-rag-app** :9380 | 透传到 intellect-rag-app `/api/v1/chats/*` |
| 普通 chat completions | `/proxy/v1/chat/completions` | **intellect-rag-app** :9380 | 透传到 intellect-rag-app `/api/v1/chat/completions` |
| Agent session | `/agents/{id}/sessions/*` | **intellect-rag-app** :9380 | IntellectRagAdapter → intellect-rag-app |
| LLM providers/models | `/proxy/v1/providers*` | **intellect-team** :8642 | LLM 模型管理 |

**认知纠正**：当前 chat 请求**全部走 intellect-rag-app**，而非 intellect-team Gateway。chat-session-gap-analysis 中提到的"透传到 intellect-team Gateway"实际上是透传到 intellect-rag-app（命名混淆）。

**影响**：迁移目标是把"普通 chat"从 intellect-rag-app 切换到 intellect-team Gateway，需要修改前端 API 路径或 BFF 路由。

---

## 三、评审结论：可行性再评估

### 3.1 修订后的可行性矩阵

| 场景 | 可行性 | 实施难度 | 说明 |
|---|---|---|---|
| 纯 LLM 对话（无 KB）走 Gateway | ✅ 可行 | **低** | BFF 基础设施完整，配置切换 + 类型修复即可。但需注意 §九 G1/G6 两项 HIGH 缺口影响"配置更新"与"文件上传"子功能 |
| RAG 增强对话走 Gateway | ❌ 不可行 | 高 | Gateway 缺 `kb_ids`/`prompt_config`/`rerank_id` 字段，需 intellect-team 侧扩展 |
| 画布 Agent chat 走 Gateway | ❌ 不可行 | 高 | Gateway 无画布执行能力 |
| OpenAI 兼容接口走 Gateway | ✅ 可行 | 低 | `/v1/chat/completions` 已就绪 |

> **2026-07-27 增补**：§八 基于 intellect-team 源码复核,识别出 9 项 Gateway 端实现缺口(G1-G9),其中 G1(配置更新)与 G6(文件上传)为 HIGH 优先级,是切断 intellect-rag 依赖的真正阻塞项。详见 §八。

### 3.2 推荐方案（修订）

**方案：按场景分流，前端根据 `kb_ids` 路由**

```
纯 LLM 对话 chat（kb_ids 为空）
  → 走 /api/bff/agents/{agentId}/sessions/* (IntellectEnterpriseAdapter)
  → Gateway /api/sessions/{id}/chat/stream

RAG 增强对话 chat（kb_ids 非空）
  → 继续走 /api/bff/proxy/v1/chats/* (intellect-rag-app)
  → intellect-rag-app /api/v1/chats/* (保留现有路径)

画布 Agent chat
  → 继续走 /api/bff/canvas/* (IntellectRagAdapter)
  → intellect-rag-app /api/v1/agents/*
```

**判断条件**：chat 创建时 `dataset_ids`（即 `kb_ids`）是否为空？
- 是 → 走 Gateway（纯 LLM 对话）
- 否 → 走 intellect-rag-app（RAG 增强）

### 3.3 实施工作量评估

| 任务 | 难度 | 工作量 |
|---|---|---|
| BFF 修复 bff-agents.ts TS 类型断言 | 低 | 改 1 行类型注解 + 兜底逻辑 |
| BFF 扩展 serializeChunk 透传企业版事件 | 低 | 改 1 个 switch 分支 |
| 前端 API 路径分流（按 kb_ids 选择路由） | 中 | 修改 chat service 层 |
| 配置切换（backend JSON） | 低 | 用户自行配置 |
| 文档与验证 | 低 | 已完成 |

---

## 四、修订后的实施计划

### 4.1 阶段 1：BFF 侧适配（本次实施）

1. **修复 bff-agents.ts TS 类型断言**
   - `getAdapter(c)` 返回类型从 `IntellectRagAdapter | null` 改为 `IHarnessAdapter | null`
   - 兜底逻辑从 `backends.find(b => b.type === 'intellect-rag')` 改为 `backends.find(b => b.type === 'intellect-rag' || b.type === 'intellect-enterprise')`

2. **扩展 serializeChunk 透传企业版事件**
   - 当前 `tool_start/tool_complete/tool_progress` 返回 `null`（注释 "P3 企业版事件,P1 不透传到前端"）
   - 改为透传到前端，支持工具调用展示

3. **不修改 proxy.ts**
   - `/proxy/v1/*` 透传路由保持硬编码 intellect-rag-app，服务 RAG 增强 chat
   - 纯 LLM 对话走 `/agents/*` 路由（动态选择 adapter）

### 4.2 阶段 2：前端侧适配（本次实施）

1. **新增 Gateway chat service**
   - 在 `src/services/` 新增 `gateway-chat-service.ts`
   - 复用 `/api/bff/agents/*` 路径调用 Gateway session API

2. **前端按 kb_ids 分流**
   - 修改 `src/pages/next-chats/hooks/use-create-chat.ts`
   - 创建 chat 时根据 `dataset_ids` 是否为空，选择走 intellect-rag-app（透传）或 Gateway（agent session）

3. **SSE 解析适配**
   - 走 Gateway 的 chat 复用现有 `use-send-agent-message.ts`（已支持 StreamChunk）
   - 走 intellect-rag-app 的 chat 保持现有 `use-send-chat-message.ts`

### 4.3 阶段 3：RAG 能力集成到 Gateway（另立 TODO）

需要 intellect-team 侧扩展 Rust Gateway：
- 新增 `kb_ids` 字段到 `sessions` 表
- 集成 RAG plugin 到 Gateway 进程
- 暴露 `/v1/rag/*` 端点

详见：[intellect-team TODO 文档](file:///Users/simon/project/intellect-team/docs/plans/2026-07-26-rust-gateway-rag-integration-todo.md)

---

## 五、风险与缓解

### 5.1 数据迁移风险

**风险**：现有 intellect-rag-app 的 Dialog 数据无法直接迁移到 Gateway sessions 表（schema 差异大）。

**缓解**：
- 阶段 1 不做数据迁移，新建 chat 走 Gateway，存量 chat 保留在 intellect-rag-app
- 前端在 chat 列表合并显示两个数据源（按 chat 来源标识分流）

### 5.2 用户体验一致性风险

**风险**：两套 chat（Gateway vs intellect-rag-app）的 UI 行为可能不一致（如 SSE 事件、消息渲染）。

**缓解**：
- BFF 统一转换为 `StreamChunk` 类型，前端无感知
- 消息渲染层共用 `next-message-item` 组件

### 5.3 配置错误风险

**风险**：用户误把 RAG 增强 chat 路由到 Gateway，导致 KB 检索失效。

**缓解**：
- BFF 在 `createSession` 时校验 `kb_ids`，非空时拒绝走 Gateway 并返回提示
- 前端创建 chat UI 强制选择"对话类型"（纯对话 / 知识库增强）

---

## 六、评审总结

### 6.1 原始分析的准确性

| 维度 | 评价 |
|---|---|
| Gateway chat 能力分析 | ✅ 准确 |
| Gateway 数据流分析 | ✅ 准确 |
| "RAG 是 PlugIn" 现状 | ⚠️ 部分准确（未区分 intellect-rag-app 与 intellect-team Python plugin） |
| 推荐按场景分流 | ✅ 方向正确 |
| 实施难度评估 | ❌ 高估（未发现 BFF 已有完整基础设施） |
| 鉴权/数据模型/SSE 差异 | ❌ 未分析 |

### 6.2 评审后的关键认知

1. **BFF 已有完整的 Gateway 集成基础设施**，无需新建路由，配置切换即可
2. **数据模型差异是根本约束**：Gateway session 无 `kb_ids` 字段，决定了"按场景分流"的必要性
3. **SSE 格式不兼容但 BFF 已解决**：通过 `StreamChunk` 统一抽象，前端无感知
4. **当前 chat 实际走 intellect-rag-app**（非 Gateway），迁移需修改前端 API 路径
5. **bff-agents.ts TS 类型断言需修复**，否则配置切换后类型安全受损

### 6.3 实施路径选择

采用 **方案 A：走 intellect-team Gateway（IntellectEnterpriseAdapter）**：
- BFF 侧：修复类型断言 + 扩展事件透传
- 前端侧：按 `kb_ids` 分流，新增 Gateway chat service
- 配置侧：用户在 `bff/data/` 添加 intellect-enterprise backend 并绑定到租户

不采用方案 B（走 intellect-llm Gateway）：
- `IntellectLlmAdapter` 未实现 `IHarnessAdapter` 接口
- 未注册到 AdapterRegistry
- 需补齐较多基础设施，作为后续独立 spec 推进

---

## 七、RAG 增强 chat 流程中 intellect-team 的参与情况

> 本节回应一个关键追问：评审 §3.2 推荐"有 KB 时走 intellect-rag-app（RAG 增强）"，那么后续是否还会调用 intellect-team？还是全部由 intellect-rag-app 返回？
>
> 结论：**intellect-team 仍会被调用**，分为"模型配置查询"与"LLM 推理"两个环节。当前两个环节均存在缺口，本节同时给出修复路径。

### 7.1 两个参与环节

| 环节 | 触发点 | intellect-team 端点 | intellect-rag 侧调用方 | 当前状态 |
|---|---|---|---|---|
| ① 模型配置查询 | 进入 chat / 发送消息前加载模型 | `GET /api/tenants/{tid}/model-config?task_type=chat` | [tenant_llm_service.py](file:///Users/simon/project/intellect-rag/api/db/services/tenant_llm_service.py) 的 `get_my_llms` / `get_model_config` | ⚠️ 缺口 1：`model_config_client` 未实现 |
| ② LLM 推理 | chat completion 流式生成 | `POST /v1/chat/completions`（OpenAI 兼容） | `tenant_llm_service` 通过 `ChatModel[factory]` 实例化后调用 `chat_stream()` | ⚠️ 缺口 2：`IntellectChatModel` 未注册 |

### 7.2 环节 ①：模型配置查询

**设计意图**（参考 [tenant_llm_service.py:117-128](file:///Users/simon/project/intellect-rag/api/db/services/tenant_llm_service.py)）：

```python
@classmethod
@DB.connection_context()
def get_my_llms(cls, tenant_id):
    # Phase 2: 优先从 TEAM API 获取模型列表
    try:
        from api.services.model_config_client import get_model_config_client
        client = get_model_config_client()
        team_models = client.list_models(tenant_id)
        if team_models:
            return team_models
    except Exception:
        pass  # TEAM API 不可用时回退本地查询
    # ...回退到 tenant_model_* 表本地查询
```

**关键事实**：
- `api/services/model_config_client` 模块在 intellect-rag 代码库中**只有 import 引用，没有实现文件**（`Glob` 搜索 `**/model_config_client*` 返回空）
- 三处调用（`get_my_llms` / `get_model_config` / `record_usage`）均被 `try/except Exception: pass` 兜底
- 实际行为：**总是回退到本地 `tenant_model_*` 表查询**，相当于 intellect-team 的 `/api/tenants/{tid}/model-config` 端点未被使用
- 本地数据来源：[migration 010](file:///Users/simon/project/intellect-rag/api/db/migrations/010_seed_intellect_team_models.py) 通过环境变量种子 `tenant_model_provider` / `tenant_model_instance` / `tenant_model` 三张表

**影响**：
- 短期可工作（migration 010 已种子必需数据）
- 长期存在单点风险：模型配置变更需通过 migration 或手动 SQL 同步，不能在 intellect-team 侧动态调整后实时反映到 RAG

### 7.3 环节 ②：LLM 推理

**调用链**：

```
chat_api.py POST /api/v1/chats/{id}/completions
  → DialogService.open_ai_chat() / 类似入口
    → tenant_llm_service.get_model_config(tenant_id, LLMType.CHAT, llm_name)
       返回 {llm_factory, llm_name, api_base, api_key}
    → ChatModel[llm_factory](api_key, llm_name, base_url=api_base)
    → model.chat_stream(messages, ...)
       → HTTP POST {api_base}/v1/chat/completions (OpenAI 兼容)
```

**关键事实**：
- `ChatModel` 字典由 [rag/llm/__init__.py:165-192](file:///Users/simon/project/intellect-rag/rag/llm/__init__.py) 通过反射构建：遍历 `chat_model` 模块中所有有 `_FACTORY_NAME` 属性的 `Base` 子类
- 已注册的 factory 名（节选）：`OpenAI-API-Compatible` / `Xinference` / `HuggingFace` / `VolcEngine` / `Mistral` / `LM-Studio` / `VLLM` ...
- [IntellectChatModel](file:///Users/simon/project/intellect-rag/rag/llm/intellect_adapters.py) 在 `intellect_adapters.py` 中**未声明 `_FACTORY_NAME`**，且该模块未被 `__init__.py` 导入
- Migration 010 种子的 `PROVIDER_NAME = "Intellect-Team"`，复合 llm_id 为 `deepseek-v4-pro@default@Intellect-Team`
- `split_model_name_and_factory()` 解析后 `factory = "Intellect-Team"`，但 `ChatModel["Intellect-Team"]` 不存在

**实际行为**（参考 [tenant_llm_service.py:259-263](file:///Users/simon/project/intellect-rag/api/db/services/tenant_llm_service.py)）：

```python
elif model_config["model_type"] == LLMType.CHAT.value:
    if model_config["llm_factory"] not in ChatModel:
        logging.error(f"Factory {model_config['llm_factory']} not in chat model. "
                      f"Supported factories: {ChatModel.keys()}")
        return None
    return ChatModel[model_config["llm_factory"]](...)
```

即：**当前 RAG 增强 chat 发起 LLM 推理时会返回 `None`，触发上游错误**（"LLM not configured" 之类的报错）。

### 7.4 修复路径

#### 方案 A：补全 `IntellectChatModel` 注册（推荐）

**改动点**：

1. [intellect_adapters.py](file:///Users/simon/project/intellect-rag/rag/llm/intellect_adapters.py) 给 `IntellectChatModel` 添加 `_FACTORY_NAME = "Intellect-Team"`，并让其继承 `Base`（或提供 `__init__(self, key, model_name, base_url, **kwargs)` 签名以兼容 `ChatModel[factory]()` 调用）
2. [rag/llm/__init__.py](file:///Users/simon/project/intellect-rag/rag/llm/__init__.py) 在反射扫描前显式 `from .intellect_adapters import IntellectChatModel`（或把 `intellect_adapters` 加入 `MODULE_MAPPING` 扫描范围）

**优点**：
- 保留 intellect-team 作为独立 factory 的语义清晰性
- `IntellectChatModel` 内部使用 `intellect_llm.LlmClient`，可走 Gateway 的鉴权 / 限流 / 计费中间件
- 后续可扩展 `IntellectEmbeddingModel` / `IntellectRerankModel` 注册（同样缺口）

**缺点**：
- 需要修改 intellect-rag 代码两处
- 需保证 `IntellectChatModel.__init__` 签名与 `Base` 一致（`key, model_name, base_url, **kwargs`），否则 `ChatModel[factory]()` 调用会失败

#### 方案 B：将 `PROVIDER_NAME` 改为已注册的 `OpenAI-API-Compatible`

**改动点**：

1. [migration 010](file:///Users/simon/project/intellect-rag/api/db/migrations/010_seed_intellect_team_models.py) 修改 `PROVIDER_NAME = "OpenAI-API-Compatible"`，复合 llm_id 变为 `deepseek-v4-pro@default@OpenAI-API-Compatible`
2. 已部署环境需补一条 migration 011 重命名 provider，或手动 `UPDATE tenant_model_provider SET provider_name='OpenAI-API-Compatible' WHERE provider_name='Intellect-Team'`

**优点**：
- 零 intellect-rag 代码改动（仅 migration 调整）
- `OpenAI_APIChat` 已实现并通过 `_FACTORY_NAME = ["VLLM", "OpenAI-API-Compatible"]` 注册，可直接复用
- Gateway 的 `/v1/chat/completions` 本就是 OpenAI 兼容协议，匹配度高

**缺点**：
- 失去 factory 名的语义区分（无法在日志中一眼看出是 intellect-team Gateway 还是其他 OpenAI 兼容服务）
- 后续若要切回 `IntellectChatModel`（例如需要 Gateway 特有的 reasoning 事件），切换成本较高

#### 推荐组合

| 阶段 | 选择 | 理由 |
|---|---|---|
| 立即修复（让 RAG 增强 chat 跑通） | **方案 B** | 零代码改动，最小风险，与 §3.2 的"按场景分流"无冲突 |
| 中期演进（统一模型调用入口） | **方案 A** | 配合 `model_config_client` 实现，让 RAG 通过 `IntellectChatModel` 走 Gateway，获得 reasoning/tool 事件、计费、限流等增强能力 |

### 7.5 与 §3.2 "按场景分流" 的关系澄清

§3.2 的"按场景分流"指**前端入口层分流**：

```
前端 use-send-chat-message.ts
  ├─ dataset_ids 为空  → /api/bff/agents/{agentId}/sessions/* (Gateway 直连)
  └─ dataset_ids 非空  → /api/bff/proxy/v1/chats/* (intellect-rag-app)
```

本节补充的是**intellect-rag-app 内部数据流**：

```
intellect-rag-app /api/v1/chats/{id}/completions
  ├─ 环节 ① 模型配置查询  → intellect-team /api/tenants/{tid}/model-config  (缺口 1)
  └─ 环节 ② LLM 推理     → intellect-team /v1/chat/completions              (缺口 2)
```

即：**RAG 增强 chat 在前端入口走 intellect-rag-app，但 intellect-rag-app 内部仍需调用 intellect-team 完成 LLM 推理**。两个环节的缺口需独立修复，与本评审 §4.1-4.2 的 BFF/前端侧改造无依赖关系。

### 7.6 待办追踪

本节两个缺口的修复需在 intellect-rag 侧推进，已纳入追踪：

- **缺口 1**（`model_config_client` 未实现）：建议作为 intellect-rag 独立 TODO，本评审不展开
- **缺口 2**（`IntellectChatModel` 未注册）：建议采用方案 B 立即修复，方案 A 作为中期演进
- 与 [intellect-team TODO 文档](file:///Users/simon/project/intellect-team/docs/plans/2026-07-26-rust-gateway-rag-integration-todo.md) 的关系：本节是"RAG 增强 chat 走 intellect-rag-app"路径的内部依赖分析，TODO 文档则是"RAG 能力直接集成到 Gateway"的演进规划，两者互补

---

## 八、Gateway 端实现缺口评审（2026-07-27 增补）

> 本节基于 [intellect-team 缺口评审报告](file:///Users/simon/project/intellect-team/docs/plans/2026-07-27-chat-migration-gap-review.md),对 Gateway 源码一手复核后识别出 9 项 chat 功能缺口。
>
> 复核范围:`intellect-gateway/src/platform/api_server.rs` 第 2245-2312 行路由表 + 第 155-170 行 `CreateSessionReq` + 第 236-239 行 `PatchSessionReq` + 第 925-984 行 `handle_delete_session` / `handle_patch_session`。

### 8.1 缺口清单(按优先级排序)

| ID | 优先级 | 功能 | Gateway 现状 | 前端处理 |
|----|--------|------|--------------|----------|
| **G1** | HIGH | 更新 session 配置(model/kb_ids/prompt_config/rerank_id/visibility) | `PatchSessionReq` 白名单仅 `title`+`end_reason`,创建后不可变 | 前端 ChatSettings 页面对 Gateway chat 不适用 |
| **G6** | HIGH | 文件上传(multipart) | Gateway 作为服务端无 `axum::extract::Multipart` 提取器,所有 body 走 `Json<T>` | `useUploadAndParseFile` 仍依赖 intellect-rag `/proxy/v1/document/upload` |
| G7 | MEDIUM | 外部/分享 chat 信息 | 无 `/chats/external` 或 public/shared 端点 | `useFetchExternalChatInfo` 仍依赖 intellect-rag,共享 chat 页不可用 |
| G2 | LOW | 批量删除 sessions | 仅单条 `DELETE /api/sessions/{id}`(owner-only),无 `DELETE /api/sessions` | 前端 `useDeleteChat` 单条 mutate,无批量 UI 入口 |
| G3 | LOW | 删除单条消息 | `/api/sessions/{id}/messages` 仅 GET | `useDeleteMessage` 已降级返回 not_supported,UI 隐藏删除按钮 |
| G4 | LOW | 消息反馈(thumbup/like/dislike) | 无任何相关端点 | `useFeedback` 已降级返回 -1,UI 隐藏反馈按钮 |
| G5 | LOW | TTS | `tts.rs` 是 agent 内部工具,非 HTTP 端点 | TTS 功能在 Gateway 路径下不可用 |
| G8 | LOW | 脑图(mindmap) | 无 `/chat/mindmap` 端点 | 搜索页脑图仍走 intellect-rag 透传 |
| G9 | LOW | 相关问题推荐(recommendation) | 无 `/chat/recommendation` 端点 | 搜索页相关问题仍走 intellect-rag 透传 |

### 8.2 切断 intellect-rag 依赖的阻塞项

仅 **2 项 HIGH** 是真正阻塞:
- **G1**:阻断已建 chat 的 RAG 配置调整
- **G6**:阻断文件上传功能

其余 7 项已有前端降级或继续走 intellect-rag 透传,不构成迁移阻塞。

### 8.3 评审发现的关键风险

#### R1 — G5/G7 的"等价迁移"陷阱

- **G5 (TTS)**:intellect-rag TTS 服务于 RAG 朗读场景,Gateway `tts_tool` 服务于 agent 语音输出,两者**语义不同**,即便补齐端点也不能等价迁移
- **G7 (外部 chat)**:intellect-rag 外部 chat 是无认证公开分享,Gateway `session.visibility`(private/team/project)是租户内访问控制,两者**维度不同**,即便补齐 visibility 也不等于实现共享 chat

#### R2 — G6 实现复杂度被低估

文件上传不只是新增 multipart 提取器,还涉及:
- 文件存储后端(本地 / S3 / DB BLOB)
- 病毒扫描 / MIME 校验 / 大小限制
- 与 chat session 的关联(attach 到哪条 message)
- 与 RAG 检索的集成(上传文档是否入知识库)

建议在 Gateway 端规划独立子项目,而非简单照搬 intellect-rag `/document/upload` 路由。

#### R3 — 前端降级掩盖了功能缺失

G3/G4 已通过前端返回 not_supported / -1 降级,UI 隐藏对应按钮,但**未在用户文档中明确告知**,可能导致用户困惑"为什么 Gateway chat 没有反馈按钮"。

建议:在 AgentUI 用户手册或 chat 设置页 tooltip 中明确标注"Gateway chat 模式下不可用"的功能清单。

### 8.4 评审中的描述修正

子代理调研报告中有两处描述不准确,已在评审中修正:

| 原描述 | 修正后 |
|--------|--------|
| G6 "全代码库无 Multipart 匹配" | Gateway 作为**服务端**无 multipart 提取器,但作为**客户端**广泛使用 `reqwest::multipart`(stt.rs/yuanbao.rs/feishu.rs) |
| G1 "前端 useUpdateChat 已对 Gateway chat 隐藏 ChatSettings 页面作为临时绕过" | Gateway session 模型本身不暴露 intellect-rag Dialog 的 LLM/dataset/prompt 等配置项,UI 不存在"绕过"行为,而是模型语义不对齐 |

### 8.5 与 §三 / §四 的关系

- §3.1 可行性矩阵中"纯 LLM 对话走 Gateway ✅ 可行"的结论**仍然成立**,但需补充注解:G1/G6 两项 HIGH 缺口影响"配置更新"与"文件上传"子功能,主对话流程不受影响
- §4 实施计划中的"BFF 侧适配"与"前端侧适配"**已完成**(Promise.allSettled 已移除,chat-channel 已迁移),但 §4.3 "RAG 能力集成到 Gateway"仍需推进 G1/G6 才能彻底切断 intellect-rag 依赖

### 9.6 后续动作建议

1. **立即**:将 G1/G6 同步给 intellect-team Gateway 维护者,确认是否已规划
2. **短期(P1)**:如需切断 intellect-rag 依赖,G1 与 G6 必须补齐
3. **中期(P2)**:G7 (共享 chat) 按产品需求评估
4. **长期(P3+)**:G2/G3/G4/G5/G8/G9 维持现状或按需补齐
5. **文档**:在 AgentUI 用户文档中增加"Gateway chat 与 RAG chat 功能差异表"

---

## 九、交叉引用

- **AgentUI 侧**：
  - [chat-session-gap-analysis.md](file:///Users/simon/project/agentui/docs/chat-session-gap-analysis.md)（会话功能整体差距分析）
  - [multi-harness-design.md](file:///Users/simon/project/agentui/docs/multi-harness-design.md)（多后端架构设计）
  - [IntellectEnterpriseAdapter](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts)（已实现）
  - [SSE 解析器](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-enterprise/parse-intellect-enterprise-sse.ts)（已实现）

- **intellect-team 侧**：
  - [2026-07-27-chat-migration-gap-review.md](file:///Users/simon/project/intellect-team/docs/plans/2026-07-27-chat-migration-gap-review.md)（**Gateway 端缺口评审报告**,§九 的源头,含 G1-G9 逐项源码复核）
  - [2026-07-26-rust-gateway-rag-integration-todo.md](file:///Users/simon/project/intellect-team/docs/plans/2026-07-26-rust-gateway-rag-integration-todo.md)（RAG 能力集成到 Gateway 的 TODO）
  - [2026-07-14-intellect-rag-plugin-integration-design.md](file:///Users/simon/project/intellect-team/docs/plans/2026-07-14-intellect-rag-plugin-integration-design.md)（RAG plugin 集成设计，§12 Q4 是本评审的源头）
  - [2026-07-19-rag-mem-dsl-multi-tenant-alignment.md](file:///Users/simon/project/intellect-team/docs/plans/2026-07-19-rag-mem-dsl-multi-tenant-alignment.md)（多租户对齐进度）
  - [rust-gateway-gap-analysis.md](file:///Users/simon/project/intellect-team/docs/plans/rust-gateway-gap-analysis.md)（Rust Gateway 差距分析，43 项中无 RAG 项）

- **intellect-rag 侧**：
  - [chat_api.py](file:///Users/simon/project/intellect-rag-app/api/apps/restful_apis/chat_api.py)（intellect-rag-app SSE 实现）
  - [tenant_utils.py](file:///Users/simon/project/intellect-rag-app/api/utils/tenant_utils.py)（tenant_id 解析公共工具）
