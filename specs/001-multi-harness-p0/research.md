# Phase 0 Research: Multi-Harness P0

**Date**: 2026-06-26
**Status**: Complete
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Purpose

记录 P0 关键技术决策的依据,所有决策需可追溯到 Constitution v1.1.0 或 multi-harness-design.md。spec 中无 [NEEDS CLARIFICATION] 标记,本文件补全 Phase 1 设计所需的技术依据。

---

## §1 BFF 反向代理实现方式

### Decision

在 `bff/src/routes/proxy.ts` 用 Hono catch-all 路由 `/api/bff/proxy/v1/*` 实现,通过 `intellect-client.ts` 新增的 `proxy(path, req)` 方法透传。SSE 响应采用 `Response.body` ReadableStream 直接转发,不缓冲。

### Rationale

- Hono 原生支持 catch-all(`app.all('/api/bff/proxy/v1/*', handler)`),无需新依赖
- Node.js 18+ fetch 内置,`intellect-client.ts` 已用 fetch 调 Intellect RAG,proxy 方法复用 fetch 但透传 body/stream
- SSE 透传关键:用 `response.body` 的 `ReadableStream` 直接构造 BFF Response,Content-Type 设为 `text/event-stream`,不调用 `response.json()` / `response.text()`
- 现有 `intellect-client.ts` 已封装 admin token 注入,proxy 方法在透传 Authorization 时不重复注入(避免双重鉴权)

### Alternatives Considered

| 方案 | 拒绝原因 |
|------|---------|
| 用 `http-proxy` 库 | 引入新依赖,Hono + fetch 原生足够 |
| BFF 解析 SSE 后重新序列化 | 违反 P0-前置"透明"目标,且 P0 不实现 SSE 解析器(留待 P1) |
| 在 BFF 现有路由里混入代理逻辑 | 污染现有路由层,违反"现有功能 100% 不回归"约束 |

### References

- Constitution Principle I(BFF-Mediated Frontend)
- multi-harness-design.md §十二 前端 API 迁移策略

---

## §2 代理前缀选择 `/api/bff/proxy/v1/*`

### Decision

代理前缀用 `/api/bff/proxy/v1/*`,上游路径 `/api/v1/*`。

### Rationale

- `/api/bff/*` 是 BFF 所有路由的命名空间(现有 `/api/agent` 等是历史遗留,P1+ 逐步迁移到 `/api/bff/*`)
- `proxy/v1/*` 子前缀明确标识"透明代理层",P1+ 按域替换为 Adapter 原生路由时,前端把 `proxy/v1/agents` 改为 `agents` 即可(单点改动)
- 保留 `/api/v1` 旧 Vite proxy 规则用于回滚,不冲突
- 前端 `src/utils/api.ts` 中 `restAPIv1` 常量从 `/api/v1` 改为 `/api/bff/proxy/v1`,单点改动

### Alternatives Considered

| 方案 | 拒绝原因 |
|------|---------|
| `/api/v1/*` 直接经 BFF | 前端零改动,但 Vite proxy 与 BFF 路由路径冲突,无法区分;且无法回滚 |
| `/proxy/*`(无 `/api/bff` 前缀) | 与现有 `/api/*` 命名空间不一致,前端 axios baseURL 需特判 |
| `/api/bff/v1/*`(无 `proxy` 子前缀) | P1+ 按域替换为 Adapter 路由时,前缀不变会导致语义混淆(同一前缀既有透传又有原生) |

### References

- multi-harness-design.md §十二 阶段 A 与阶段 B 迁移策略

---

## §3 HarnessStore 持久化方式

### Decision

JSON 文件 + 环境变量合并,运行时只持有内存对象,写回 JSON 不含 token。

### Rationale

- Constitution Token 安全约束:"敏感 admin token 通过环境变量注入,不落盘到 JSON"
- JSON 文件可入库(版本化配置),env 通过 `.env`/部署平台管理
- P0-P3 不引入数据库,YAGNI;P4+ 若需多实例部署再引入 SQLite/Postgres
- 内存对象 `HarnessBackend` 含 `adminToken`(明文),JSON 文件 `HarnessBackendConfig` 含 `adminTokenEnvVar`(引用)
- 启动时 `load()`:读 JSON → 对每条 config 读 env → 合并为 `HarnessBackend`,env 缺失则跳过并告警

### Alternatives Considered

| 方案 | 拒绝原因 |
|------|---------|
| SQLite | P0 单实例,JSON 足够;引入 SQLite 需新增依赖与迁移脚本,违反 YAGNI |
| JSON 含加密 token | Constitution 明确 P0-P3 不引入加密存储,P4+ 预留 `TokenVault` |
| 仅内存(不落盘) | 重启丢失配置,无法版本化 |

### References

- Constitution Token 安全约束
- multi-harness-design.md §10.1 P0-前置任务表

---

## §4 P0 不引入 BFF 测试框架(Constitution Principle VII 例外)

### Decision

P0 不引入 Vitest,BFF 测试策略为 `tsc --noEmit` + 手工冒烟。Vitest 引入留待 P1。

### Rationale

- Constitution Principle VII:"Adapter 核心层(listAgents/createSession/sendMessage)必有单元测试"、"SSE 解析器必有协议契约测试"
- P0 不实现 Adapter、不实现 SSE 解析器,只交付:
  - 契约文件(纯类型定义,`tsc --noEmit` 即可验证)
  - 两个 Store(CRUD 模板,逻辑简单,手工冒烟覆盖)
  - 一个反向代理路由(透传,手工冒烟覆盖)
- 引入 Vitest 需要:配置文件 + 示例测试 + tsconfig 调整 + CI 集成,P0 引入会被 P1 重构(此时契约可能微调)推翻
- P1 第一份 Adapter(IntellectRagAdapter)实现时,契约已稳定,此时引入 Vitest + 写 Adapter 单元测试 + SSE 协议契约测试,一次到位

### Alternatives Considered

| 方案 | 拒绝原因 |
|------|---------|
| P0 引入 Vitest + 为 Store 写单元测试 | Store 是 CRUD 模板,测试投入产出比低;且 P0 Store 接口可能在 P1 Registry 实现时微调 |
| P0 引入 Vitest 但不写测试 | 引入框架不写测试无意义,违反 Test-First |

### Risk Mitigation

- P0 验收 checklist 强制跑手工冒烟(登录→Agent→Session→流式对话→画布→知识库→Admin)
- `tsc --noEmit` 在 bff/ 与根目录各自跑,零错误才能合并
- P1 第一个 task 即"引入 Vitest + 配置 + 为 P0 Store 补单元测试",作为 P1 的硬前置

### References

- Constitution Principle VII(YAGNI + Test-First)
- Constitution Governance:"复杂度必须有设计文档依据,拒绝'我觉得以后会用到'的抽象"

---

## §5 StreamChunk type 枚举锁定

### Decision

`StreamChunk.type` 枚举为 `'delta' | 'reasoning' | 'tool_start' | 'tool_complete' | 'tool_progress' | 'usage' | 'done' | 'error'`,共 8 个值。

### Rationale

- Constitution Principle IV (v1.1.0) 明确锁定此枚举(NON-NEGOTIABLE)
- v1.0.0 原 7 值的 `token|reasoning|final` 事件名是臆测,v1.1.0 根据 intellect-team `plugins/platforms/api_server/adapter.py` `_handle_session_chat_stream` 实际事件清单重写
- 覆盖两后端所有事件:
  - Intellect RAG(OpenAI 兼容):`delta` / `done` / `error`(可选 `reasoning` via `delta.reasoning_content`)
  - Intellect 企业版 `/api/sessions/{id}/chat/stream`(自定义事件):
    - `assistant.delta` → `delta`
    - `tool.progress`(`tool_name="_thinking"`)→ `reasoning`
    - `tool.progress`(其他 `tool_name`)→ `tool_progress`
    - `tool.started` → `tool_start`
    - `tool.completed` → `tool_complete`
    - `tool.failed` → `error`(带 `toolCallId`)
    - `run.completed`(`data.usage`)→ `usage` 后接 `done`
    - `error` → `error`
    - `done` → `done`
    - `run.started` / `message.started` → BFF 内部状态,不映射到 StreamChunk
- `tool_progress` 是 v1.1.0 新增的枚举值,用于区分 reasoning(`tool_name="_thinking"`)与普通工具进度
- `tool_start` / `tool_complete` / `tool_progress`:P3 企业版编码 Agent 启用时实际产出,P0 仅声明枚举
- 此决策与 Constitution 一致,无需多方案对比

### Intellect 企业版 SSE 协议(实际实现,do NOT invent)

来源:`intellect-team/plugins/platforms/api_server/adapter.py` `_handle_session_chat_stream`

```http
POST /api/sessions/{session_id}/chat/stream HTTP/1.1
Host: localhost:8642
Authorization: Bearer ${API_SERVER_KEY}
X-Intellect-Team: <team_id>
X-Intellect-Project: <project_id>
Content-Type: application/json

{"message": "用户消息", "system_message": "可选系统提示"}
```

响应(SSE,`text/event-stream`):

```
event: run.started
data: {"session_id":"...","run_id":"run_xxx","seq":1,"ts":1719400000.0,"user_message":{"role":"user","content":"用户消息"}}

event: message.started
data: {"session_id":"...","run_id":"run_xxx","seq":2,"ts":...,"message":{"id":"msg_xxx","role":"assistant"}}

event: assistant.delta
data: {"session_id":"...","run_id":"run_xxx","seq":3,"ts":...,"message_id":"msg_xxx","delta":"Hello "}

event: tool.progress
data: {"session_id":"...","run_id":"run_xxx","seq":4,"ts":...,"message_id":"msg_xxx","tool_name":"_thinking","delta":"正在思考..."}

event: tool.progress
data: {"session_id":"...","run_id":"run_xxx","seq":5,"ts":...,"message_id":"msg_xxx","tool_name":"web_search","delta":"搜索中..."}

event: tool.started
data: {"session_id":"...","run_id":"run_xxx","seq":6,"ts":...,"message_id":"msg_xxx","tool_name":"web_search","preview":"...","args":{...}}

event: tool.completed
data: {"session_id":"...","run_id":"run_xxx","seq":7,"ts":...,"message_id":"msg_xxx","tool_name":"web_search","preview":"...","args":{...}}

event: assistant.completed
data: {"session_id":"...","run_id":"run_xxx","seq":8,"ts":...,"message_id":"msg_xxx","content":"完整回复","completed":true,"partial":false,"interrupted":false}

event: run.completed
data: {"session_id":"...","run_id":"run_xxx","seq":9,"ts":...,"message_id":"msg_xxx","completed":true,"messages":[...],"usage":{"prompt_tokens":50,"completion_tokens":200}}

event: done
data: {"session_id":"...","run_id":"run_xxx","seq":10,"ts":...}
```

错误场景:

```
event: error
data: {"session_id":"...","run_id":"run_xxx","seq":N,"ts":...,"message":"错误描述"}
```

### References

- Constitution Principle IV (v1.1.0, SSE Dual-Protocol Parsing)
- Constitution Principle VIII (v1.1.0, BFF ↔ Intellect Enterprise Access Contract)
- multi-harness-design.md §3.5.3 SSE 协议对比表
- intellect-team 源码:`plugins/platforms/api_server/adapter.py` `_handle_session_chat_stream`

---

## §6 BffTenant 与 Canvas Backend 绑定模型

### Decision

`BffTenant` 含 `intellectBackendId`(主后端,任意类型)+ 可选 `canvasBackendId`(画布后端,必须是 `intellect-rag` 类型)。

### Rationale

- Constitution Principle III:画布永远走 Intellect RAG Adapter
- Constitution Principle V:企业版用户需画布时,BFF Tenant 额外绑定 Intellect RAG 后端
- 两个绑定独立:`getHarnessBinding(tenantId)` 返回主后端,`getCanvasBinding(tenantId)` 返回画布后端
- `canvasBackendId` 必须是 `intellect-rag` 类型,由 `TenantStore.setCanvasBinding` 在写入时校验
- Intellect RAG 单租户场景:`intellectBackendId` 本身就是 `intellect-rag` 类型,`canvasBackendId` 可空(画布走主后端即可)

### Alternatives Considered

| 方案 | 拒绝原因 |
|------|---------|
| 单字段 `backendId`,画布与主后端共用 | 违反 Constitution Principle III(企业版用户画布必须走 RAG,不能走企业版) |
| `canvasBackendId` 不校验类型 | 运行时 `AdapterRegistry` 才发现类型错误,延迟反馈 |
| 用 `bindings: BackendBinding[]` 数组 | P0 只有两种角色(主/画布),数组过度抽象,违反 YAGNI |

### References

- Constitution Principle III(Canvas Hard-Bound)
- Constitution Principle V(Tenant Isolation)

---

## §7 契约文件存放位置:specs/ vs bff/src/types/

### Decision

权威契约源在 `specs/001-multi-harness-p0/contracts/*.ts`(版本化、可审查、与 spec/plan 共生命周期),P0 实施时复制到 `bff/src/types/*.ts`(运行时消费)。

### Rationale

- `specs/` 下的契约文件是设计产物,与 spec/plan/research 一起审查,变更需走 constitution governance
- `bff/src/types/` 是运行时 import 路径,直接被 P1 Adapter / P0 Store import
- 复制而非 symlink:
  - symlink 在 Windows 上不可靠
  - 复制后 `bff/src/types/` 可加 `// @see specs/001-multi-harness-p0/contracts/xxx.ts` 注释指回源
  - P0 tasks 会包含"复制契约文件"步骤,确保两处同步
- 后续若契约变更,先改 `specs/` 权威源,再同步到 `bff/src/types/`,PR 描述引用 constitution 原则

### Alternatives Considered

| 方案 | 拒绝原因 |
|------|---------|
| 只放 `bff/src/types/`,不复制到 specs | 契约与设计文档脱节,审查时无法在 spec 目录看到完整设计 |
| symlink | Windows 兼容性问题 |
| 只放 `specs/`,bff 通过相对路径 import | 跨目录 import 脆弱,build 配置复杂 |

### References

- Constitution Governance:"复杂度必须有设计文档依据"

---

## §8 BFF ↔ Intellect Enterprise 接入端点与鉴权(v1.1.0 新增)

### Decision

BFF 接入 Intellect 企业版(intellect-team)的主通道锁定为 `POST /api/sessions/{session_id}/chat/stream`,鉴权用 `API_SERVER_KEY` 全局 API Key。

### Rationale

- Constitution Principle VIII (v1.1.0) NON-NEGOTIABLE 锁定
- intellect-team 同时提供两类 SSE 端点(源码确认):
  - `/v1/chat/completions`(OpenAI 兼容,stateless,通过 `X-Intellect-Session-Id` 续接)
  - `/api/sessions/{id}/chat/stream`(持久化会话,自定义事件 SSE)
  - `/v1/runs/{id}/events`(异步任务 SSE,需先 `POST /v1/runs` 获取 run_id)
- 选 `/api/sessions/{id}/chat/stream` 的理由:
  - 原生支持 `X-Intellect-Team` / `X-Intellect-Project` Team/Project 组织隔离头
  - 原生输出 `assistant.delta` / `tool.progress` / `run.completed` 事件,匹配 Principle IV
  - 自带 session 持久化,满足 spec FR3.4 "intellect Team 需要新建独立 Session"
  - `/v1/chat/completions` 是 stateless,会话续接需手动管理 `X-Intellect-Session-Id`,与 spec FR3.4 冲突
  - `/v1/runs/{id}/events` 是异步模式,前端协议适配复杂度上升,P3+ 再评估
- 鉴权选 `API_SERVER_KEY` 而非 `imt_p_*` 项目级 token:
  - intellect-team 同时支持 `Authorization: Bearer ${API_SERVER_KEY}`(全局)与 `Authorization: Bearer imt_p_*`(项目级)
  - P0-P3 阶段简化运维,所有 BFF 请求统一用 `API_SERVER_KEY`,Team/Project 数据隔离靠 `X-Intellect-Team` / `X-Intellect-Project` 头(真正租户隔离通过多实例部署)
  - P4+ 评估是否切换到 `imt_p_*` 项目级 token 实现更细粒度权限

### Adapter 两步流程(内部实现,BFF 路由层不感知)

1. `POST /api/sessions` 创建 intellect-team session:
   ```http
   POST /api/sessions HTTP/1.1
   Authorization: Bearer ${API_SERVER_KEY}
   X-Intellect-Team: <team_id>
   X-Intellect-Project: <project_id>
   Content-Type: application/json

   {"title": "可选会话标题"}
   ```
   响应:`201 Created` + `{"object":"intellect.session","session":{...}}`

2. `POST /api/sessions/{id}/chat/stream` 订阅 SSE 流(见 §5 协议示例)

### intellect-team 完整端点清单(BFF 可用,BFF 路由层按需暴露)

| 端点 | 用途 | BFF 暴露策略 |
|---|---|---|
| `POST /api/sessions/{id}/chat/stream` | 持久化会话 SSE | **主通道**(Principle VIII) |
| `POST /api/sessions/{id}/chat` | 同步会话(非流) | 可选,P3+ 评估 |
| `GET /api/sessions` | 列会话 | 暴露(P3) |
| `POST /api/sessions` | 创建会话 | 暴露(P3,主通道前置) |
| `GET\|PATCH\|DELETE /api/sessions/{id}` | 会话 CRUD | 暴露(P3) |
| `GET /api/sessions/{id}/messages` | 历史消息 | 暴露(P3) |
| `POST /api/sessions/{id}/fork` | 会话分叉 | 可选,P4+ |
| `GET /api/sessions/search` | 全文检索 | 可选,P4+ |
| `GET /v1/models` | 列出 agent | 暴露(P3,`listAgents` 实现) |
| `GET /v1/capabilities` | 能力探测 | 内部(`discoverCapabilities`) |
| `GET /health` | 健康检查 | 内部(`healthCheck`) |
| `POST /v1/chat/completions` | OpenAI 兼容(stateless) | **禁用**(Principle VIII) |
| `POST /v1/responses` | OpenAI Responses API | **禁用**(P4+ 评估) |
| `POST /v1/runs` + `GET /v1/runs/{id}/events` | 异步任务流 | **禁用**(P3+ 评估) |

### References

- Constitution Principle VIII (v1.1.0, BFF ↔ Intellect Enterprise Access Contract)
- Constitution Principle IV (v1.1.0, SSE Dual-Protocol Parsing)
- intellect-team 源码:`plugins/platforms/api_server/adapter.py` `_handle_session_chat_stream` / `_resolve_member_context` / `_parse_session_key_header`

---

## Summary

8 个决策全部可追溯到 Constitution v1.1.0 或 multi-harness-design.md。无 [NEEDS CLARIFICATION] 遗留。Phase 1 设计可启动。

**Phase 1 输入**:
- data-model.md(基于 §5 §6 §8 决策的实体模型)
- contracts/*.ts(基于 §5 §6 §7 §8 决策的 TypeScript 契约)
- quickstart.md(基于 §1 §2 §4 §8 决策的验证场景)
