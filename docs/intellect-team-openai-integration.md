# Intellect RAG 对接 intellect-team OpenAI 兼容方案评审

> 状态：待评审 | 日期：2026-06-25 | 关联文档：[multi-harness-design.md](./multi-harness-design.md)、[platform-admin-adapter-design.md](./platform-admin-adapter-design.md)

## 一、背景与目标

AgentUI 需支持多个 Agent Harness 后端（Intellect RAG、Intellect Agent 企业版 intellect-team、Hermes、OpenClaw）。本方案专项探讨 **Intellect RAG (intellect-rag)** 与 **intellect-team**（Intellect Agent 企业版，Rust+Python 混合自学习 Agent）通过 OpenAI 兼容 API 对接的可能性、代码现状与落地方案。

## 二、两个项目的 OpenAI 兼容实现现状

### 2.1 Intellect RAG (intellect-rag，端口 9380）— 作为"提供方"

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
  - model 字段需映射到 Intellect RAG 的 `llm_id`，且需校验 `get_api_key`

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
- 实例内 Team/Project 组织隔离（关键）：
  - `X-Intellect-Team` header → team_id
  - `X-Intellect-Project` header → project_id
  - 见 `adapter.py:815-821`
  - 注:真正的多租户隔离通过多实例部署实现(每个 intellect-team 实例 = 一个租户),Team/Project 是实例内组织模型
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
| **方向一：Intellect RAG → intellect-team**（Intellect RAG/BFF 作为客户端消费 intellect-team 的 Agent 能力） | BFF 把 intellect-team 当成 Agent Harness 后端，通过 `/v1/chat/completions` 调用 | ✅ 标准对接，intellect-team 侧已就绪 | ✅ 高，intellect-team 是 AgentUI 要支持的 Harness 之一 |
| **方向二：intellect-team → Intellect RAG**（intellect-team 把 Intellect RAG 当 OpenAI 兼容 LLM） | intellect-team 的 model provider 配置指向 Intellect RAG 的 openai 端点 | ⚠️ 需 Intellect RAG 侧改造 | ❌ 低，Intellect RAG 是 Agent Harness 平台，不应降级为 LLM provider |

### 3.2 方向二的问题详述

intellect-team 的 model provider 支持任意 OpenAI 兼容端点（`intellect model` 命令切换），但 Intellect RAG 的 `openai_api.py` 有两处不符合标准：

1. **chat_id 路径参数**：标准是 `POST /v1/chat/completions`，Intellect RAG 是 `POST /api/v1/openai/<chat_id>/chat/completions`，intellect-team 的 OpenAI client 无法配置路径参数
2. **认证机制**：标准是 `Authorization: Bearer <key>`，Intellect RAG 用 `@login_required`（session cookie）

改造方案（若需方向二）：Intellect RAG 新增标准路由 `POST /v1/chat/completions`（Bearer 认证 + 无状态 + model 映射 llm_id），与现有 `<chat_id>` 版本并存。但此方向与项目定位不符，**不推荐**。

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
Intellect RAG (9380) — RAG/Canvas/数据集能力（可选，作为 intellect-team 的工具源 via MCP）
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
- 前端 `useHarnessCapabilities()` 据此动态渲染——后端是 intellect-team 时显示 Skills/Memory/Cron 入口，是 Intellect RAG 时隐藏
- 会话路由：BFF `/api/sessions` 代理到 intellect-team `/api/sessions`，保持 OpenAI 兼容 SSE 格式

**阶段 3：Intellect RAG 作为 intellect-team 的工具源（P2，可选）**
- intellect-team 通过 MCP 或自定义 tool 调用 Intellect RAG 的 RAG 检索（`/api/v1/retrieval`）和 Canvas 引擎
- Intellect RAG 的强项（文档解析/知识库/Canvas 编排）作为 intellect-team Agent 的工具能力，而非 LLM 替代
- 与项目记忆"Canvas 编排复用 Intellect RAG canvas 引擎"一致

## 五、关键优势

- **intellect-team 侧已原生就绪**：OpenAI 兼容 API Server 完整实现，无需 intellect-team 侧开发
- **Team/Project 组织隔离 header 吻合 BFF 模型**：`X-Intellect-Team`/`X-Intellect-Project` 与 BFF"Team/Project 绑定唯一 backend"模型完全吻合
- **能力驱动渲染天然支持**：`/v1/capabilities` 端点供 BFF 获取功能集，配合前端 `useHarnessCapabilities()` 实现能力驱动 UI
- **会话管理外包**：intellect-team 的 `/api/sessions` CRUD 承担会话存储，BFF 无需自建 session 存储
- **SSE 格式统一**：标准 OpenAI `chat.completion.chunk`，与 AgentUI 现有 SSE 消费逻辑兼容（项目记忆已确认 OpenAI 兼容格式为基座）
- **真·流式**：intellect-team 支持 token-by-token SSE + 客户端断连取消，体验优于 Intellect RAG

## 六、需解决的关键问题

| 问题 | 方案 |
|------|------|
| Token 安全 | `API_SERVER_KEY` 三层存储（环境变量 + JSON + 运行时内存），加密延后，与项目既有策略一致 |
| 会话 ID 映射 | BFF 侧 Team/Project 绑定 backend 后，前端 session_id 需映射到 intellect-team 的 `X-Intellect-Session-Id`，BFF 维护映射表 |
| SSE 格式统一 | intellect-team 的 SSE 是标准 OpenAI `chat.completion.chunk`，与 AgentUI 现有 SSE 消费逻辑兼容 |
| 能力降级 | 当 intellect-team 不可用时，BFF 回退到 Intellect RAG 的 `/api/v1/agents/chat/completions`，Adapter 层做 fallback |
| Skills 功能归属 | Skills 的 ES/Infinity mapping 在 Intellect RAG 侧（`conf/skill_es_mapping.json`），但 API 实现在 intellect-team 侧，需明确检索基础设施复用方式 |
| Canvas 引擎复用 | 项目记忆要求 Canvas 编排复用 Intellect RAG canvas 引擎，intellect-team 是否暴露 Canvas 能力需确认 `/v1/capabilities` 返回值 |

## 七、intellect-team 能力清单（从 adapter.py 与测试反推）

| 能力 | 端点 | intellect-team 支持 | Intellect RAG |
|------|------|---------------------|-----------------|
| Chat Completions（流式/非流式） | `/v1/chat/completions` | ✅ | ✅（需 chat_id） |
| Responses API（有状态） | `/v1/responses` | ✅ | ❌ |
| 模型列表 | `/v1/models` | ✅ | ❌ |
| 能力声明 | `/v1/capabilities` | ✅ | ❌ |
| 会话管理 | `/api/sessions/*` | ✅ CRUD + fork + 搜索 | ✅（`/api/v1/agents/{id}/sessions`） |
| 异步 Run + 事件流 | `/v1/runs/*` | ✅ | ❌ |
| 多模态（图片输入） | `/v1/chat/completions` | ✅ | ⚠️ |
| Team/Project 组织隔离 | `X-Intellect-Team/Project` | ✅ | ❌（单租户） |
| 会话连续性 | `X-Intellect-Session-Id` | ✅ | ❌ |
| 长期记忆作用域 | `X-Intellect-Session-Key` | ✅ | ❌ |
| 客户端断连取消 | SSE cancel | ✅ | ❌ |
| Skills | `/skills` + skills hub | ✅（自学习技能） | ⚠️（ES mapping 就绪，API 在 Go 服务 9384） |
| Memory | 持久记忆 + 用户画像 | ✅ | ✅（`/api/v1/memories`） |
| Cron 调度 | 内置 cron | ✅ | ❌ |
| 工具调用 | 40+ tools + MCP | ✅ | ✅（agent tools） |

## 八、评审决策点

1. **方向确认**：采用方向一（BFF → intellect-team），放弃方向二（Intellect RAG 降级为 LLM）？
2. **阶段 1 范围**：P0 是否只做 `chatStream` + `getCapabilities` + `listSessions` 三个方法，会话创建/删除留到 P1？
3. **Skills 归属**：intellect-team 自带 skills，Intellect RAG 侧也有 skills ES mapping + Go 服务实现，两者关系是"intellect-team 主、Intellect RAG 提供检索基础设施"还是"二选一"？
4. **Canvas 引擎**：intellect-team 的 `/v1/capabilities` 是否暴露 Canvas？若否，Canvas 仍走 Intellect RAG 的 canvas API，BFF 需做混合路由（Canvas → Intellect RAG，Chat → intellect-team）
5. **能力降级策略**：intellect-team 不可用时是否回退 Intellect RAG？还是直接报错？回退会增加 Adapter 复杂度
6. **Token 加密时机**：P0 用明文三层存储，加密放到哪个阶段？（与 multi-harness-design.md 的"加密延后"一致）

## 十、错误处理与重试策略

### 10.1 HTTP 错误映射

intellect-team 返回的 4xx/5xx 错误需映射为前端可读的错误类型：

| HTTP 状态码 | 错误类型 | 前端处理建议 |
|-------------|----------|-------------|
| 400 Bad Request | `INVALID_REQUEST` | 参数校验失败，提示用户检查输入 |
| 401 Unauthorized | `AUTH_FAILED` | API_KEY 无效或过期，提示重新配置 |
| 403 Forbidden | `ACCESS_DENIED` | 无权限访问指定 Team/Project |
| 404 Not Found | `NOT_FOUND` | 会话/资源不存在，引导创建新会话 |
| 422 Unprocessable Entity | `VALIDATION_ERROR` | 请求格式正确但语义错误，显示具体错误信息 |
| 429 Too Many Requests | `RATE_LIMITED` | 限流，提示稍后重试，显示 retry_after（若有） |
| 500 Internal Server Error | `INTERNAL_ERROR` | 服务端错误，提示稍后重试 |
| 502 Bad Gateway | `SERVICE_UNAVAILABLE` | intellect-team 实例不可用，触发降级或重试 |
| 503 Service Unavailable | `SERVICE_UNAVAILABLE` | 实例过载或维护，提示稍后重试 |

**错误响应格式**（intellect-team 已实现）：
```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Human readable message",
    "details": { ... }
  }
}
```

### 10.2 SSE 流式中断与重连策略

**断连场景分类**：
1. **客户端主动断开**：用户取消请求、前端路由切换、页面关闭
2. **服务端主动断开**：agent 完成推理、达到 max_tokens、触发内容安全策略
3. **非预期断开**：网络抖动、服务端重启、实例被驱逐

**重连策略**：
```
                    ┌─────────────────────────────┐
                    │      SSE Stream Start       │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │    流式传输中（yield chunk） │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
    │ [完成] 正常结束│      │ [断开] 客户端取消│      │ [断开] 非预期中断│
    └──────────────┘      └──────────────┘      └───────┬──────┘
                                                          │
                                              ┌───────────▼───────────┐
                                              │ 检查 retry_count < 3  │
                                              └───────────┬───────────┘
                                                          │
                                    ┌─────────────────────┼─────────────────────┐
                                    ▼                                         ▼
                          ┌──────────────┐                          ┌──────────────┐
                          │ retry_count++│                          │  通知前端失败  │
                          │ wait 1s * 2^n│                          │  展示错误状态  │
                          │ 重新请求      │                          └──────────────┘
                          └──────────────┘
```

**关键实现要点**：
- BFF 维护每个 stream 的 `event_id`，用于去重和断点续传
- 若 intellect-team 支持 `X-Intellect-Session-Id` + `stream_offset`，可从断点继续
- 前端收到 `[DONE]` 消息或 `data: [DONE]` 即为正常结束，无需重试
- 重试时前端展示 "正在重新连接..." 状态，避免用户困惑

### 10.3 幂等性保障

- Chat Completions 本身**非幂等**（每次调用产生不同响应）
- 若断连重试后收到新的 `response_id`，前端应替换当前会话
- 若返回 `422 DUPLICATE_REQUEST`（若 intellect-team 实现），说明请求已处理，读取既有响应

---

## 十一、健康检查与监控

### 11.1 BFF 感知 intellect-team 实例不可用

**主动探测**：
```typescript
// BFF 定期探测 intellect-team 实例健康状态
class IntellectTeamHealthChecker {
  async check(instanceUrl: string): Promise<HealthStatus> {
    try {
      const resp = await fetch(`${instanceUrl}/health`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const detail = await fetch(`${instanceUrl}/health/detailed`);
        return { status: 'healthy', detail: await detail.json() };
      }
      return { status: 'unhealthy', code: resp.status };
    } catch (e) {
      return { status: 'unreachable', error: e.message };
    }
  }
}
```

**探测频率**：
- 正常：每 30 秒探测一次所有注册实例
- 异常：连续失败 3 次后，将实例标记为 `degraded`，探测频率降至 10 秒一次
- 恢复：连续成功 2 次后，恢复为正常频率

**故障切换触发条件**：
- `/health` 返回非 200
- `/health/detailed` 中 `status !== 'ready'`（如 `initializing`、`shutting_down`）
- 连续 3 次流式请求超时或收到 502/503

### 11.2 `/health/detailed` 作为 IServiceAdmin 数据源

intellect-team 的 `/health/detailed` 返回结构（反推）：
```json
{
  "status": "ready",           // ready | initializing | shutting_down | error
  "version": "1.2.3",
  "uptime_seconds": 86400,
  "active_sessions": 42,
  "memory_usage": {
    "rss_mb": 512,
    "heap_used_mb": 128
  },
  "llm_providers": [
    { "name": "openai", "status": "healthy", "latency_ms_p50": 150 }
  ],
  "tools": [
    { "name": "rag", "status": "healthy" },
    { "name": "canvas", "status": "disabled" }
  ]
}
```

**集成方式**：
- BFF 定时拉取 `/health/detailed`，解析后格式化注入 `IServiceAdmin`
- 暴露给运维平台的指标：
  - `intellect_team_instances_total` — 实例总数 + 状态分布
  - `intellect_team_sessions_active` — 各实例活跃会话数
  - `intellect_team_llm_latency_p50` — LLM 提供商延迟分布
  - `intellect_team_tool_status` — 各工具可用性

### 11.3 告警规则建议

| 告警条件 | 严重级别 | 处理建议 |
|----------|---------|---------|
| 任意实例 `/health` 连续 3 次失败 | Warning | 自动切换至其他实例，触发实例重启 |
| 活跃会话数 > 阈值（单实例 1000） | Warning | 阻止新会话创建，触发扩容 |
| LLM latency p50 > 5s | Warning | 检查 LLM 提供商状态 |
| 连续 5 分钟所有实例不可用 | Critical | 触发全局降级 + 告警值班人员 |

---

## 十二、多实例路由与负载均衡

### 12.1 多团队场景的实例部署模型

**模型假设**：
- 每个 Team 绑定一个 intellect-team 实例（物理隔离，企业版常见需求）
- 或多个 Team 共享一组 intellect-team 实例池（成本优化场景）

**BFF 路由决策**：
```typescript
interface InstanceRegistry {
  // teamId → instanceUrl 映射
  getInstance(teamId: string): string;
  // 负载均衡选择
  selectInstance(teamId: string): string;
}

// 方式一：固定绑定（每个 Team 独享实例）
class FixedTeamRegistry implements InstanceRegistry {
  constructor(private bindings: Map<string, string>) {}
  getInstance(teamId: string): string {
    return this.bindings.get(teamId) ?? this.defaultInstance;
  }
  selectInstance(teamId: string): string {
    return this.getInstance(teamId); // 绑定实例，无负载均衡
  }
}

// 方式二：共享池（多 Team 共享实例组）
class PooledRegistry implements InstanceRegistry {
  constructor(private pool: string[]) {}
  selectInstance(teamId: string): string {
    // 哈希分发：同一 teamId 始终路由到同一实例（会话亲和性）
    const idx = hash(teamId) % this.pool.length;
    return this.pool[idx];
  }
}
```

### 12.2 会话亲和性

intellect-team 的 `/api/sessions` 存储在实例本地磁盘或附连存储（尚未确认分布式存储方案），因此：
- **强会话亲和性**：`X-Intellect-Session-Id` 必须在首次创建该会话的实例上处理
- BFF 路由层必须维护 `sessionId → instanceUrl` 映射表
- 映射表存储在 BFF 内存中，以 `teamId` 为命名空间（前端路由切换实例时需查表）

### 12.3 负载均衡策略

当多个实例组成共享池时，可选的负载均衡策略：

| 策略 | 适用场景 | 实现方式 |
|------|---------|---------|
| **哈希分发**（推荐） | 需要会话亲和性 | `hash(teamId) % poolSize`，同一 team 永远路由到同一实例 |
| **Least Connections** | 无状态请求、会话存储外置 | 选择当前活跃连接数最少的实例 |
| **Round Robin** | 无状态请求 | 轮询分发 |
| **Latency Weighted** | 追求低延迟 | 根据 `/health/detailed` 中的 `llm_latency_p50` 加权分发 |

**推荐配置**：
```typescript
const adapter = new IntellectTeamAdapter({
  registry: new PooledRegistry({
    instances: [
      'http://intellect-team-1:8642',
      'http://intellect-team-2:8642',
      'http://intellect-team-3:8642',
    ],
    // 哈希分发保证会话亲和性，同时实现负载均衡
    strategy: 'hash',
    // 哈希 key：teamId，确保同团队请求打到同一实例
    hashKey: 'teamId',
  }),
});
```

### 12.4 实例扩缩容

**扩容时**：
1. 运维向池中添加新实例 URL
2. BFF 热加载配置（无需重启）
3. 新实例通过既有会话亲和性哈希，新增 team 的请求会打到新实例
4. **注意**：旧 team 的请求不会自动迁移，需等会话自然过期

**缩容时**：
1. 运维将实例标记为 `draining`
2. BFF 停止向该实例分发新请求
3. 等待现有会话自然结束（或等待 `uptime_seconds` 下降至阈值）
4. 下线实例

---

## 十三、Intellect RAG 作为 intellect-team 的 MCP 工具源

### 13.1 MCP 对接概述

intellect-team 支持 MCP（Model Context Protocol）作为 tool calling 的扩展机制。Intellect RAG 的核心能力（RAG 检索、知识库管理、Canvas 编排）可作为 MCP Server 注册到 intellect-team，供 Agent 在推理过程中动态调用。

**架构**：
```
intellect-team Agent 推理
  │  tool calling → rag_retrieval / canvas_run / kb_list
  ▼
MCP Tool Router (intellect-team 内置)
  │  根据 tool name 路由到对应 MCP Server
  ▼
Intellect RAG MCP Server (端口 9380)
  │  HTTP-based MCP Protocol
  │  认证：Bearer Token (Intellect RAG API Key)
  ▼
Intellect RAG 核心服务
  - /api/v1/dify/retrieval → rag_retrieval tool
  - /api/v1/canvas/run → canvas_run tool
  - /api/v1/kb/list → kb_list tool
```

### 13.2 Intellect RAG 可提供的 MCP Tools

基于 Intellect RAG API 能力，可定义以下 MCP Tools：

| Tool Name | 描述 | 输入参数 | 输出 | 对应 API |
|-----------|------|---------|------|---------|
| `rag_retrieval` | 知识库检索 | `knowledge_id`, `query`, `top_k`, `score_threshold`, `metadata_condition` | `chunks[]` (content, score, title, metadata) | `/api/v1/dify/retrieval` |
| `kb_list` | 列出知识库 | `tenant_id` (可选) | `knowledgebases[]` (id, name, doc_count) | `/api/v1/kb/list` |
| `kb_create` | 创建知识库 | `name`, `description`, `embd_id` | `kb_id` | `/api/v1/kb/create` |
| `doc_upload` | 上传文档 | `kb_id`, `file_url` or `file_base64` | `doc_id` | `/api/v1/document/upload` |
| `canvas_run` | 执行 Canvas 编排 | `dsl`, `inputs` | `outputs` | `/api/v1/canvas/run` |
| `canvas_create` | 创建 Canvas | `dsl` | `canvas_id` | `/api/v1/canvas/create` |

**Tool Schema 示例**（`rag_retrieval`）：
```json
{
  "name": "rag_retrieval",
  "description": "Search knowledge base for relevant documents. Returns chunks with similarity scores.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "knowledge_id": {
        "type": "string",
        "description": "Knowledge base ID to search"
      },
      "query": {
        "type": "string",
        "description": "Search query text"
      },
      "top_k": {
        "type": "integer",
        "description": "Number of results to return",
        "default": 6
      },
      "score_threshold": {
        "type": "number",
        "description": "Minimum similarity score",
        "default": 0.1
      },
      "metadata_condition": {
        "type": "object",
        "description": "Optional metadata filter conditions"
      }
    },
    "required": ["knowledge_id", "query"]
  }
}
```

### 13.3 MCP Server 注册方式

intellect-team 支持两种 MCP Server 注册方式：

**方式一：配置文件注册**（推荐，适用于生产环境）
```yaml
# intellect-team config.yaml
mcp_servers:
  intellect_rag:
    type: http
    url: http://intellect-rag:9380/api/v1/mcp
    authorization_token: ${INTELLECT_RAG_API_KEY}
    tools:
      - rag_retrieval
      - kb_list
      - canvas_run
```

**方式二：动态注册**（适用于开发/测试）
```bash
# intellect-team CLI
intellect mcp add \
  --name intellect_rag \
  --type http \
  --url http://intellect-rag:9380/api/v1/mcp \
  --token ${INTELLECT_RAG_API_KEY}
```

**Intellect RAG 需新增的 MCP 端点**：
当前 Intellect RAG 的 `mcp_api.py` 主要用于**管理 MCP Server 元数据**，而非**作为 MCP Server 提供工具调用**。需新增以下端点：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/v1/mcp/tools` | GET | 返回 tool schema 列表（MCP Server 发现） |
| `/api/v1/mcp/call/{tool_name}` | POST | 执行指定 tool（MCP Tool Calling） |

### 13.4 MCP Tool Calling 流程

```
┌──────────────────────────────────────────────────────────────┐
│  intellect-team Agent 推理                                    │
│  用户: "帮我从产品知识库搜索关于电池的信息"                    │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│  LLM 识别需要调用 tool                                        │
│  tool_calls: [{name: "rag_retrieval", args: {...}}]          │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│  MCP Tool Router                                              │
│  根据 tool name 查询注册表 → intellect_rag                    │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│  HTTP POST → Intellect RAG MCP Server                        │
│  URL: /api/v1/mcp/call/rag_retrieval                          │
│  Headers: Authorization: Bearer ${API_KEY}                    │
│  Body: {knowledge_id: "kb_001", query: "电池", top_k: 6}      │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│  Intellect RAG 执行检索                                       │
│  → 调用 Dify Retrieval API                                    │
│  → 返回 chunks: [{content, score, title, metadata}]          │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│  MCP Tool Result 返回 intellect-team                          │
│  Agent 整合检索结果生成回复                                   │
│  "根据产品知识库，电池规格为..."                              │
└──────────────────────────────────────────────────────────────┘
```

### 13.5 Intellect RAG MCP Server 实现方案

**新增 API 文件**：`api/apps/restful_apis/mcp_tool_api.py`

```python
from quart import Response, request
from api.apps import login_required
from api.utils.api_utils import get_json_result, get_request_json

# MCP Tool Registry
MCP_TOOLS = {
    "rag_retrieval": {
        "handler": "_handle_rag_retrieval",
        "schema": {...}  # 同 13.2 节定义
    },
    "kb_list": {
        "handler": "_handle_kb_list",
        "schema": {...}
    },
    "canvas_run": {
        "handler": "_handle_canvas_run",
        "schema": {...}
    }
}

@manager.route("/mcp/tools", methods=["GET"])
@login_required
def list_tools() -> Response:
    """返回 MCP Tool Schema 列表"""
    tools = [t["schema"] for t in MCP_TOOLS.values()]
    return get_json_result(data={"tools": tools})

@manager.route("/mcp/call/<tool_name>", methods=["POST"])
@login_required
async def call_tool(tool_name: str) -> Response:
    """执行 MCP Tool"""
    if tool_name not in MCP_TOOLS:
        return get_json_result(code=404, message=f"Tool '{tool_name}' not found")
    
    req = await get_request_json()
    handler = MCP_TOOLS[tool_name]["handler"]
    result = await handler(req)
    return get_json_result(data=result)

async def _handle_rag_retrieval(req: dict) -> dict:
    """调用 Dify Retrieval API"""
    # 复用 dify_retrieval_api.py 的逻辑
    from api.apps.restful_apis.dify_retrieval_api import retrieval
    # ... 实现检索逻辑
    return {"chunks": chunks}
```

**认证机制**：
- MCP Tool Calling 端点使用 Intellect RAG 的 `@login_required`（session 或 Bearer token）
- intellect-team 需持有有效的 Intellect RAG API Key（Tenant 级别）
- 可新增专用 MCP Token（`INTELLECT_RAG_MCP_KEY`），与现有 API Key 分离

### 13.6 安全与权限控制

**权限隔离策略**：

| 层级 | 控制方式 | 说明 |
|------|---------|------|
| **MCP Server 注册** | Tenant 级别 API Key | intellect-team 注册时需提供 Intellect RAG Tenant 的 API Key |
| **Tool 调用** | Tenant + Knowledgebase 双重校验 | `rag_retrieval` 需校验 `knowledge_id` 是否属于调用者 Tenant |
| **数据隔离** | Tenant ID 传递 | intellect-team 通过 `X-Intellect-Tenant` header 传递租户标识 |

**Intellect RAG 侧校验逻辑**：
```python
async def _handle_rag_retrieval(req: dict) -> dict:
    kb_id = req.get("knowledge_id")
    tenant_id = request.headers.get("X-Intellect-Tenant")  # 从 intellect-team 传递
    
    # 校验 knowledgebase 是否属于该 tenant
    e, kb = KnowledgebaseService.get_by_id(kb_id)
    if not e or kb.tenant_id != tenant_id:
        return {"error": "ACCESS_DENIED", "message": "Knowledgebase not accessible"}
    
    # 执行检索...
```

### 13.7 Canvas 编排集成

intellect-team Agent 可通过 `canvas_run` tool 调用 Intellect RAG 的 Canvas 引擎：

**Canvas DSL 示例**：
```json
{
  "dsl": {
    "components": {
      "begin": {"downstream": ["retrieval_0"]},
      "retrieval_0": {
        "obj": {"component_name": "Retrieval", "params": {"kb_id": "kb_001"}},
        "downstream": ["generate_0"]
      },
      "generate_0": {
        "obj": {"component_name": "Generate", "params": {"prompt": "基于检索结果回答"}},
        "downstream": ["answer_0"]
      },
      "answer_0": {"downstream": []}
    }
  },
  "inputs": {"query": "用户问题"}
}
```

**Canvas_run Tool 输入参数**：
```json
{
  "dsl": "<上述 DSL>",
  "inputs": {"query": "..."},
  "tenant_id": "tenant_001"
}
```

**Canvas_run Tool 输出**：
```json
{
  "outputs": {"answer": "生成结果"},
  "chunks": [...],  // 检索中间结果
  "path": ["begin", "retrieval_0", "generate_0", "answer_0"]
}
```

### 13.8 部署与配置

**环境变量**：
```bash
# intellect-team 配置
INTELLECT_RAG_MCP_URL=http://intellect-rag:9380/api/v1/mcp
INTELLECT_RAG_MCP_KEY=<Intellect RAG Tenant API Key>

# Intellect RAG 配置
MCP_ENABLED=true
MCP_TOOLS=rag_retrieval,kb_list,canvas_run
```

**Docker Compose 集成**：
```yaml
services:
  intellect-team:
    environment:
      - INTELLECT_RAG_MCP_URL=http://intellect-rag:9380/api/v1/mcp
      - INTELLECT_RAG_MCP_KEY=${INTELLECT_RAG_API_KEY}
    depends_on:
      - intellect-rag

  intellect-rag:
    environment:
      - MCP_ENABLED=true
    ports:
      - "9380:9380"
```

### 13.9 落地阶段建议

| 阶段 | 任务 | 优先级 |
|------|------|--------|
| **P2-1** | Intellect RAG 新增 `/mcp/tools` + `/mcp/call/{tool}` 端点 | 高 |
| **P2-2** | 实现 `rag_retrieval` tool（复用 Dify Retrieval API） | 高 |
| **P2-3** | intellect-team 配置 MCP Server 注册 | 中 |
| **P2-4** | 实现 `kb_list` + `canvas_run` tool | 中 |
| **P2-5** | 安全校验 + Tenant 权限隔离 | 高 |
| **P2-6** | 文档 + 测试用例 | 低 |

---

## 九、与既有设计文档的关系

- [multi-harness-design.md](./multi-harness-design.md)：总体多 Harness 架构，本方案是其 intellect-team 专项的细化
- [platform-admin-adapter-design.md](./platform-admin-adapter-design.md)：平台管理（users/services/sandbox/version）抽象，intellect-team 的 `/health/detailed` 可作为 `IServiceAdmin` 数据源
- [intellect-admin-api-guide.md](./intellect-admin-api-guide.md)：Intellect Admin API 指南，intellect-team 的 member/team/project 体系与之并行
