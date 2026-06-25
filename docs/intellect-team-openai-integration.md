# Intellect 对接 intellect-team OpenAI 兼容方案评审

> 状态：待评审 | 日期：2026-06-25 | 关联文档：[multi-harness-design.md](./multi-harness-design.md)、[platform-admin-adapter-design.md](./platform-admin-adapter-design.md)

## 一、背景与目标

AgentUI 需支持多个 Agent Harness 后端（Intellect 社区版、Intellect Agent 企业版 intellect-team、Hermes、OpenClaw）。本方案专项探讨 **Intellect Python 后端**与 **intellect-team**（Intellect Agent 企业版，Rust+Python 混合自学习 Agent）通过 OpenAI 兼容 API 对接的可能性、代码现状与落地方案。

## 二、两个项目的 OpenAI 兼容实现现状

### 2.1 Intellect Python 后端（端口 9380）— 作为"提供方"

文件：[intellect/api/apps/restful_apis/openai_api.py](file:///Users/simon/workspace/intellect/api/apps/restful_apis/openai_api.py)

- 路由：`POST /api/v1/openai/<chat_id>/chat/completions`
  - 注意：`chat_id` 是路径参数，绑定 Intellect 内部 Dialog，调用前必须先创建 Dialog
  - 注册前缀：`restful_apis` 挂在 `/api/v1`（见 `api/apps/__init__.py:370`）
- 能力：
  - SSE 流式（`_stream_chat_completion_sse`）+ 非流式
  - `reasoning_content` 思考链字段
  - `reference` 引用块（RAG 检索结果）
  - `extra_body` 元数据过滤（metadata_condition / reference_metadata）
- 局限：
  - **chat_id 路径参数**：不符合标准 OpenAI `POST /v1/chat/completions` 无状态调用
  - **认证机制**：`@login_required`（Intellect 自有 session），非 Bearer token
  - model 字段需映射到 Intellect 的 `llm_id`，且需校验 `get_api_key`

### 2.2 intellect-team（端口 8642）— 作为"提供方"且更标准

文件：[intellect-team/plugins/platforms/api_server/adapter.py](file:///Users/simon/workspace/intellect-team/plugins/platforms/api_server/adapter.py)
计划文档：[intellect-team/.plans/openai-api-server.md](file:///Users/simon/workspace/intellect-team/.plans/openai-api-server.md)（已落地实现）

- 端点（完整 OpenAI 兼容）：
  - `POST /v1/chat/completions` — Chat Completions（无状态；opt-in 会话连续性）
  - `POST /v1/responses` — Responses API（有状态，via previous_response_id）
  - `GET /v1/responses/{response_id}` / `DELETE` — 存储响应检索/删除
  - `GET /v1/models` — 列出可用模型
  - `GET /v1/capabilities` — 机器可读 API 能力声明（供外部 UI 能力驱动渲染）
  - `GET /api/sessions` + CRUD — 会话管理
  - `POST /api/sessions/{id}/chat[/stream]` — 持久会话聊天
  - `POST /v1/runs` + `GET /v1/runs/{id}/events` — 异步 run + SSE 生命周期事件
  - `GET /health` / `GET /health/detailed` — 健康检查
- 认证：
  - Bearer token（`API_SERVER_KEY` 环境变量）
  - 项目级 token（`imt_p_*`，project-scoped）
  - 可信反向代理 header（`X-Forwarded-User` 等）
- 多租户（关键）：
  - `X-Intellect-Team` header → team_id
  - `X-Intellect-Project` header → project_id
  - 见 `adapter.py:815-821`
- 会话控制：
  - `X-Intellect-Session-Id` — 会话连续性（继续已有会话）
  - `X-Intellect-Session-Key` — 长期记忆作用域（跨会话用户画像）
- 流式：真·SSE token-by-token，支持客户端断连取消 agent（`test_sse_agent_cancel.py`）
- 无状态 + 有状态混合：默认无状态（messages 即对话），opt-in 持久会话
- 多模态：支持 inline image 输入（`test_api_server_multimodal.py`）

## 三、对接可能性分析

### 3.1 两个方向

| 方向 | 含义 | 可行性 | 与项目定位契合度 |
|------|------|--------|-----------------|
| **方向一：Intellect → intellect-team**（Intellect/BFF 作为客户端消费 intellect-team 的 Agent 能力） | BFF 把 intellect-team 当成 Agent Harness 后端，通过 `/v1/chat/completions` 调用 | ✅ 标准对接，intellect-team 侧已就绪 | ✅ 高，intellect-team 是 AgentUI 要支持的 Harness 之一 |
| **方向二：intellect-team → Intellect**（intellect-team 把 Intellect 当 OpenAI 兼容 LLM） | intellect-team 的 model provider 配置指向 Intellect 的 openai 端点 | ⚠️ 需 Intellect 侧改造 | ❌ 低，Intellect 是 Agent Harness 平台，不应降级为 LLM provider |

### 3.2 方向二的问题详述

intellect-team 的 model provider 支持任意 OpenAI 兼容端点（`intellect model` 命令切换），但 Intellect 的 `openai_api.py` 有两处不符合标准：

1. **chat_id 路径参数**：标准是 `POST /v1/chat/completions`，Intellect 是 `POST /api/v1/openai/<chat_id>/chat/completions`，intellect-team 的 OpenAI client 无法配置路径参数
2. **认证机制**：标准是 `Authorization: Bearer <key>`，Intellect 用 `@login_required`（session cookie）

改造方案（若需方向二）：Intellect 新增标准路由 `POST /v1/chat/completions`（Bearer 认证 + 无状态 + model 映射 llm_id），与现有 `<chat_id>` 版本并存。但此方向与项目定位不符，**不推荐**。

## 四、推荐方案：方向一 + 三阶段落地

### 4.1 架构

```
AgentUI (前端)
  │  SSE 流式对话（OpenAI 兼容格式）
  ▼
BFF (Hono, 3001) — IntellectTeamAdapter (IHarnessAdapter)
  │  POST http://intellect-team:8642/v1/chat/completions
  │  Headers:
  │    Authorization: Bearer <API_SERVER_KEY>
  │    X-Intellect-Team: <team_id>
  │    X-Intellect-Project: <project_id>
  │    X-Intellect-Session-Id: <session_id>
  ▼
intellect-team (8642) — OpenAI 兼容 API Server
  │  Agent 推理 + 工具调用 + 技能 + 记忆 + cron
  ▼
Intellect Python (9380) — RAG/Canvas/数据集能力（可选，作为 intellect-team 的工具源 via MCP）
```

### 4.2 BFF Adapter 实现要点

```typescript
// bff/src/services/adapters/intellect-team/adapter.ts
import type { IHarnessAdapter } from '../../types';

export class IntellectTeamAdapter implements IHarnessAdapter {
  constructor(private config: { baseUrl: string; apiKey: string }) {}

  async *chatStream(params: ChatParams): AsyncGenerator<string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (params.teamId) headers['X-Intellect-Team'] = params.teamId;
    if (params.projectId) headers['X-Intellect-Project'] = params.projectId;
    if (params.sessionId) headers['X-Intellect-Session-Id'] = params.sessionId;

    const resp = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'intellect-agent',
        messages: params.messages,
        stream: true,
      }),
    });

    for await (const chunk of parseSSE(resp.body)) {
      if (chunk.choices?.[0]?.delta?.content) {
        yield chunk.choices[0].delta.content;
      }
    }
  }

  async getCapabilities() {
    const resp = await fetch(`${this.config.baseUrl}/v1/capabilities`);
    return resp.json();
  }

  async listSessions(teamId?: string, projectId?: string) {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiKey}`,
    };
    if (teamId) headers['X-Intellect-Team'] = teamId;
    if (projectId) headers['X-Intellect-Project'] = projectId;
    const resp = await fetch(`${this.config.baseUrl}/api/sessions`, { headers });
    return resp.json();
  }
}
```

### 4.3 三阶段落地

**阶段 1：BFF Adapter 接入（P0）**
- BFF 新建 `IntellectTeamAdapter`，实现 `IHarnessAdapter` 接口
- 配置 intellect-team 实例地址（8642）+ `API_SERVER_KEY`，采用三层存储策略（环境变量 + JSON + 运行时内存），加密延后（与项目既有策略一致）
- 实现 `chatStream`（SSE 透传）+ `getCapabilities` + `listSessions`
- Team/Project 绑定：BFF Tenant → intellect-team 的 `X-Intellect-Team`，Project → `X-Intellect-Project`

**阶段 2：能力对齐（P1）**
- BFF 调用 `/v1/capabilities` 获取 intellect-team 支持的功能集（skills/memory/cron/tools）
- 前端 `useHarnessCapabilities()` 据此动态渲染——后端是 intellect-team 时显示 Skills/Memory/Cron 入口，是 Intellect 社区版时隐藏
- 会话路由：BFF `/api/sessions` 代理到 intellect-team `/api/sessions`，保持 OpenAI 兼容 SSE 格式

**阶段 3：Intellect 作为 intellect-team 的工具源（P2，可选）**
- intellect-team 通过 MCP 或自定义 tool 调用 Intellect 的 RAG 检索（`/api/v1/retrieval`）和 Canvas 引擎
- Intellect 的强项（文档解析/知识库/Canvas 编排）作为 intellect-team Agent 的工具能力，而非 LLM 替代
- 与项目记忆"Canvas 编排复用 Intellect canvas 引擎"一致

## 五、关键优势

- **intellect-team 侧已原生就绪**：OpenAI 兼容 API Server 完整实现，无需 intellect-team 侧开发
- **多租户 header 吻合 BFF 模型**：`X-Intellect-Team`/`X-Intellect-Project` 与 BFF"Team/Project 绑定唯一 backend"模型完全吻合
- **能力驱动渲染天然支持**：`/v1/capabilities` 端点供 BFF 获取功能集，配合前端 `useHarnessCapabilities()` 实现能力驱动 UI
- **会话管理外包**：intellect-team 的 `/api/sessions` CRUD 承担会话存储，BFF 无需自建 session 存储
- **SSE 格式统一**：标准 OpenAI `chat.completion.chunk`，与 AgentUI 现有 SSE 消费逻辑兼容（项目记忆已确认 OpenAI 兼容格式为基座）
- **真·流式**：intellect-team 支持 token-by-token SSE + 客户端断连取消，体验优于 Intellect 社区版

## 六、需解决的关键问题

| 问题 | 方案 |
|------|------|
| Token 安全 | `API_SERVER_KEY` 三层存储（环境变量 + JSON + 运行时内存），加密延后，与项目既有策略一致 |
| 会话 ID 映射 | BFF 侧 Team/Project 绑定 backend 后，前端 session_id 需映射到 intellect-team 的 `X-Intellect-Session-Id`，BFF 维护映射表 |
| SSE 格式统一 | intellect-team 的 SSE 是标准 OpenAI `chat.completion.chunk`，与 AgentUI 现有 SSE 消费逻辑兼容 |
| 能力降级 | 当 intellect-team 不可用时，BFF 回退到 Intellect 社区版的 `/api/v1/agents/chat/completions`，Adapter 层做 fallback |
| Skills 功能归属 | Skills 的 ES/Infinity mapping 在 Intellect 侧（`conf/skill_es_mapping.json`），但 API 实现在 intellect-team 侧，需明确检索基础设施复用方式 |
| Canvas 引擎复用 | 项目记忆要求 Canvas 编排复用 Intellect canvas 引擎，intellect-team 是否暴露 Canvas 能力需确认 `/v1/capabilities` 返回值 |

## 七、intellect-team 能力清单（从 adapter.py 与测试反推）

| 能力 | 端点 | intellect-team 支持 | Intellect 社区版 |
|------|------|---------------------|-----------------|
| Chat Completions（流式/非流式） | `/v1/chat/completions` | ✅ | ✅（需 chat_id） |
| Responses API（有状态） | `/v1/responses` | ✅ | ❌ |
| 模型列表 | `/v1/models` | ✅ | ❌ |
| 能力声明 | `/v1/capabilities` | ✅ | ❌ |
| 会话管理 | `/api/sessions/*` | ✅ CRUD + fork + 搜索 | ✅（`/api/v1/agents/{id}/sessions`） |
| 异步 Run + 事件流 | `/v1/runs/*` | ✅ | ❌ |
| 多模态（图片输入） | `/v1/chat/completions` | ✅ | ⚠️ |
| 多租户 | `X-Intellect-Team/Project` | ✅ | ❌（单租户） |
| 会话连续性 | `X-Intellect-Session-Id` | ✅ | ❌ |
| 长期记忆作用域 | `X-Intellect-Session-Key` | ✅ | ❌ |
| 客户端断连取消 | SSE cancel | ✅ | ❌ |
| Skills | `/skills` + skills hub | ✅（自学习技能） | ⚠️（ES mapping 就绪，API 在 Go 服务 9384） |
| Memory | 持久记忆 + 用户画像 | ✅ | ✅（`/api/v1/memories`） |
| Cron 调度 | 内置 cron | ✅ | ❌ |
| 工具调用 | 40+ tools + MCP | ✅ | ✅（agent tools） |

## 八、评审决策点

1. **方向确认**：采用方向一（BFF → intellect-team），放弃方向二（Intellect 降级为 LLM）？
2. **阶段 1 范围**：P0 是否只做 `chatStream` + `getCapabilities` + `listSessions` 三个方法，会话创建/删除留到 P1？
3. **Skills 归属**：intellect-team 自带 skills，Intellect 侧也有 skills ES mapping + Go 服务实现，两者关系是"intellect-team 主、Intellect 提供检索基础设施"还是"二选一"？
4. **Canvas 引擎**：intellect-team 的 `/v1/capabilities` 是否暴露 Canvas？若否，Canvas 仍走 Intellect Python 的 canvas API，BFF 需做混合路由（Canvas → Intellect，Chat → intellect-team）
5. **能力降级策略**：intellect-team 不可用时是否回退 Intellect 社区版？还是直接报错？回退会增加 Adapter 复杂度
6. **Token 加密时机**：P0 用明文三层存储，加密放到哪个阶段？（与 multi-harness-design.md 的"加密延后"一致）

## 九、与既有设计文档的关系

- [multi-harness-design.md](./multi-harness-design.md)：总体多 Harness 架构，本方案是其 intellect-team 专项的细化
- [platform-admin-adapter-design.md](./platform-admin-adapter-design.md)：平台管理（users/services/sandbox/version）抽象，intellect-team 的 `/health/detailed` 可作为 `IServiceAdmin` 数据源
- [intellect-admin-api-guide.md](./intellect-admin-api-guide.md)：Intellect Admin API 指南，intellect-team 的 member/team/project 体系与之并行
