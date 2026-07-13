# Feature Specification: 显式 CanvasService — 画布脱离 Proxy 路由

**Feature Branch**: `008-explicit-canvas-service`

**Created**: 2026-06-27

**Status**: Draft

**Input**: User description: "解除画布对 proxy 路由的依赖，显式 CanvasService 更清晰。"

## Constitution References

- **Principle I (BFF-Mediated Frontend, NON-NEGOTIABLE)**: 前端所有后端调用必经 BFF
- **Principle III (Canvas Hard-Bound to Intellect RAG, NON-NEGOTIABLE)**: 画布功能永远走 Intellect RAG Adapter,不经过 Adapter Registry 选择;BFF 画布路由硬绑定 `IntellectRagAdapter`
- **Principle V (Tenant Isolation via BFF)**: 企业版用户若需画布,BFF Tenant 额外绑定 Intellect RAG 后端
- **Principle VII (YAGNI + Test-First)**: 不为 hypothetical 后端预留抽象,核心层必有测试

## 背景与问题陈述

当前画布(Canvas)操作的请求路径分散在 BFF 三个入口,缺乏显式语义边界:

1. **`bff-agents.ts` 内 `passthrough()`**:POST/PUT/DELETE `/api/bff/agents/*` 实为画布 DSL 创建/编辑/删除,伪装成 Agent CRUD
2. **`bff-agents.ts` 内 `passthrough()`**:画布子域(components/versions/tags/upload/debug/trace/input-form/webhook/test_db_connection/rerun)全部挂在 `/agents/*` 下,实际是画布引擎能力
3. **`proxy.ts` catch-all `/proxy/v1/*`**:`/api/bff/proxy/v1/agents/*` 仍可命中画布路径,与 RAG 专属域(datasets/kb/memory/mcp/search)混用

由此产生的问题:

- **职责不清**:画布入口两处(bff-agents.ts 内 passthrough + proxy.ts catch-all),同一操作可经两条路径到达上游,排查困难
- **语义混淆**:画布引擎能力伪装成 `/agents/*`,与已迁移到 Adapter 的 Agent 概览/Sessions 路径混在同一前缀,违反"单一职责"
- **缺乏租户隔离**:透明代理仅透传 header,无法在 BFF 层按 `BffTenant.canvasBackendId` 选择后端或对未绑定画布的租户返回明确错误
- **可观测性弱**:catch-all 吞掉 body/headers,无法对画布操作注入审计、能力探测、按租户路由

本 spec 通过显式 `CanvasService` 与单一 `/api/bff/canvas/*` 入口解决上述问题,与 [docs/multi-harness-design.md](../../docs/multi-harness-design.md) §3.4 / §6.4 设计意图对齐,落实 Constitution Principle III。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 单一画布 API 入口 (Priority: P1)

作为前端开发者,我希望所有画布相关操作(列表/创建/编辑/删除/DSL 执行/组件调试/版本/上传/trace/webhook 等)都通过单一 `/api/bff/canvas/*` 路径前缀访问,以便清晰区分画布能力与 Agent 概览/Session 能力,降低维护与排查成本。

**Why this priority**: Constitution Principle III 要求画布硬绑定 Intellect RAG;当前画布寄生在 `/agents/*` 与 `/proxy/v1/agents/*` 双路径上,语义混淆是阻碍后续画布能力演进(如按租户路由、能力探测、审计)的最大障碍。统一入口是后续 US2/US3 的前置条件。

**Independent Test**: 切换前端 `api.ts` 中画布相关 endpoint 从 `${restAPIv1}/agents/...` 与 `bffAgents` 内的 passthrough 路径到 `bffCanvas/...`,跑冒烟用例(列表画布 → 编辑 DSL → 保存 → 执行调试 → 上传文件 → 查看 trace → 列出版本 → 重置画布)全部通过,响应与原透传模式逐字段一致。

**Acceptance Scenarios**:

1. **Given** 前端已迁移到 `/api/bff/canvas/*`, **When** 用户在画布编辑器创建一个新节点并保存 DSL, **Then** BFF 收到 `POST /api/bff/canvas` 请求,经 `CanvasService` 调 Intellect RAG 创建画布,返回结构与原 `/api/bff/agents` 透传完全一致
2. **Given** 前端已迁移, **When** 用户在画布编辑器对某组件点击"调试", **Then** BFF 收到 `POST /api/bff/canvas/:id/components/:cid/debug`,经 `CanvasService` 转发到 Intellect RAG `/api/v1/agents/:id/components/:cid/debug`,响应透传
3. **Given** 前端已迁移, **When** 用户上传画布附件, **Then** BFF 收到 multipart `POST /api/bff/canvas/:id/upload`,流式透传到 Intellect RAG,响应结构与原透传一致
4. **Given** 前端已迁移, **When** 用户执行画布并发起对话, **Then** BFF 收到 `POST /api/bff/canvas/:id/execute`,经 `CanvasService.executeCanvas()` 返回 Canvas Workflow SSE 流,事件序列与原 `/api/bff/agents/chat/completions` 透传一致(workflow_started/message/message_end/workflow_finished)
5. **Given** 前端已迁移, **When** 用户查看画布版本列表、tags、prompt、webhook trace 等子资源, **Then** 所有请求经 `/api/bff/canvas/*` 路径访问,响应与原透传逐字段一致

---

### User Story 2 - 画布按租户隔离与显式绑定 (Priority: P2)

作为 BFF 管理员/企业版租户用户,我希望画布操作按 `BffTenant.canvasBackendId` 绑定路由到正确的 Intellect RAG 后端,未绑定画布后端的租户收到明确 503 错误而非默认回退,以便企业版(多实例多租户)场景下画布能力可被正确治理。

**Why this priority**: Constitution Principle V 要求企业版用户需画布时 BFF Tenant 额外绑定 Intellect RAG 后端;当前透传模式无法在 BFF 层校验绑定,导致未绑定画布的租户可能误命中默认 Intellect RAG,违反租户隔离。但此 US 依赖 US1 的显式入口,优先级次之。

**Independent Test**: 配置一个 BffTenant `canvasBackendId` 指向 Intellect RAG 后端 A,另一个 BffTenant 不设置 `canvasBackendId`;前端带不同 `X-Tenant-Id` 调 `/api/bff/canvas/*`,前者请求被路由到后端 A,后者返回 503 + 明确错误信息。

**Acceptance Scenarios**:

1. **Given** BffTenant T1 已绑定 `canvasBackendId` 指向 Intellect RAG 后端 B, **When** T1 的用户调 `GET /api/bff/canvas`, **Then** BFF 通过 `CanvasService` 调后端 B 的 `/api/v1/agents`,返回画布列表
2. **Given** BffTenant T2 未设置 `canvasBackendId`, **When** T2 的用户调任意 `/api/bff/canvas/*` 路径, **Then** BFF 返回 503 + `{code: 503, message: "Tenant T2 has no canvas backend bound"}`,不调用任何上游
3. **Given** 默认/社区版租户(无 `X-Tenant-Id` 或 `tenantId=default`), **When** 用户调 `/api/bff/canvas/*`, **Then** BFF 回退到默认 Intellect RAG 后端(首个 `type=intellect-rag` 的 backend),保持社区版零回归
4. **Given** BffTenant T1 绑定的 `canvasBackendId` 指向的后端在 HarnessStore 中不存在或已被删除, **When** T1 的用户调 `/api/bff/canvas/*`, **Then** BFF 返回 503 + 明确错误信息,不静默回退到其他后端

---

### User Story 3 - Proxy 路由收口 (Priority: P3)

作为 BFF 维护者,我希望 `/api/bff/proxy/v1/*` catch-all 路由不再服务画布路径,仅保留 Intellect RAG 专属域(datasets/kb/search/memory/mcp 等),以便降低 proxy 路由的职责范围,明确其作为"未迁移域过渡机制"的定位。

**Why this priority**: proxy catch-all 是 P0-前置的过渡机制,画布迁出后 proxy 仅服务 RAG 专属能力;此 US 是 US1 完成后的自然收尾,优先级最低但必要,避免 proxy 与 canvas 路由长期并存造成新的歧义。

**Independent Test**: 前端迁移完成后,直接 `curl http://localhost:9390/api/bff/proxy/v1/agents` 应仍可访问(回归保护,不删除路径,因 Constitution Principle I 验收 Gate 要求"改回 `/api/v1` 可瞬时回滚"),但前端不再发起该路径请求;`curl /api/bff/proxy/v1/datasets` 继续正常工作。

**Acceptance Scenarios**:

1. **Given** 前端已迁移画布路径到 `/api/bff/canvas/*`, **When** 检查前端 `api.ts` 中所有画布相关 endpoint, **Then** 无任何路径使用 `${restAPIv1}/agents/...` 或 `${bffAgents}/...` 形式(画布相关常量已迁到 `bffCanvas`)
2. **Given** US1+US2 已完成, **When** 前端调任意画布操作, **Then** 不再经过 `/api/bff/proxy/v1/*` catch-all 路由
3. **Given** proxy catch-all 路由保留(不删除), **When** 直接调用 `/api/bff/proxy/v1/datasets` 等 RAG 专属域, **Then** 继续正常透传(零回归,SC-006 约束)
4. **Given** BFF 路由表已更新, **When** 检查 `bff/src/index.ts` 路由注册, **Then** 存在 `/canvas/*` 显式路由挂载,且 `bff-agents.ts` 不再包含画布相关 passthrough 路径(仅保留 Agent 概览/Sessions CRUD + chat/completions)

---

### Edge Cases

- **画布执行流的中途取消**: 用户在画布对话 SSE 流过程中点击"停止",前端通过 AbortController 取消 fetch,BFF 关闭 SSE 连接并通知上游;`CanvasService` 不强制实现取消端点(对齐 P1 stub 行为),但需保证连接关闭不泄漏
- **multipart 上传的流式透传**: 画布附件上传是 multipart/form-data,`CanvasService` 必须流式透传 body,不缓冲到内存(避免大文件 OOM)
- **SSE 执行流的 header 保留**: Canvas Workflow SSE 响应的 `Content-Type: text/event-stream` 等头必须原样透传,不重写
- **未鉴权访问**: 未携带有效 Authorization 的请求在 `authMiddleware` 阶段返回 401,不进入 `CanvasService`(对齐 P0-前置 Scenario 2)
- **回滚路径**: 前端 `api.ts` 改回 `${restAPIv1}/agents/...` 应能瞬时回滚到 US1 之前的透传行为,无需 BFF 配合(对齐 Constitution "前端 API 迁移两阶段" FR-006 约束)
- **画布后端不可达**: `CanvasService` 调 Intellect RAG 失败时返回 502 + 明确错误信息(包含上游 URL 与错误),不吞异常
- **企业版 Tenant 误调画布**: 企业版租户未绑定 `canvasBackendId` 但前端误发画布请求,返回 503 + 明确错误信息,不静默回退到默认 Intellect RAG(对齐 US2)
- **租户上下文缺失**: `/api/bff/canvas/*` 路径必经 `tenantContextMiddleware`,缺失 `X-Tenant-Id` 时回退到 `default` 租户(社区版兼容),不返回 400(P1 阶段弱化校验,对齐 bff-agents.ts 现状)

## Requirements *(mandatory)*

### Functional Requirements

#### US1 — 单一画布 API 入口

- **FR-001**: BFF MUST 提供显式路由前缀 `/api/bff/canvas/*`,承载所有画布相关操作,不再与 `/api/bff/agents/*` 或 `/api/bff/proxy/v1/agents/*` 混用
- **FR-002**: BFF MUST 提供显式服务层 `CanvasService`,封装画布操作对 Intellect RAG Adapter 的调用;`CanvasService` 硬绑定 `IntellectRagAdapter`,不经过 Adapter Registry 选择(Constitution Principle III)
- **FR-003**: BFF MUST 在 `/api/bff/canvas/*` 路由前挂载 `authMiddleware` 与 `tenantContextMiddleware`,与 `/api/bff/agents/*` 中间件策略一致
- **FR-004**: BFF MUST 在 `/api/bff/canvas/*` 下提供至少以下子路径(语义对齐前端 `api.ts` 现有画布相关 endpoint,响应结构与原透传逐字段一致):
  - `GET /canvas` — 列表(对齐原 `GET /api/v1/agents`,但仅画布语义)
  - `POST /canvas` — 创建画布(对齐原 `POST /api/v1/agents`,canvas DSL 创建)
  - `GET /canvas/:id` — 获取画布详情(对齐原 `GET /api/v1/agents/:id`)
  - `PUT /canvas/:id` — 保存画布 DSL(对齐原 `PUT /api/v1/agents/:id`)
  - `DELETE /canvas/:id` — 删除画布(对齐原 `DELETE /api/v1/agents/:id`)
  - `POST /canvas/:id/execute` — 执行画布并返回 Canvas Workflow SSE 流(对齐原 `POST /api/v1/agents/chat/completions`)
  - `POST /canvas/:id/reset` — 重置画布(对齐原 `POST /api/v1/agents/:id/reset`)
  - `GET /canvas/templates` — 画布模板列表(对齐原 `GET /api/v1/agents/templates`)
  - `GET|PUT /canvas/:id/tags` — 画布 tags(对齐原 `GET|PUT /api/v1/agents/:id/tags`)
  - `GET /canvas/:id/versions` 与 `GET /canvas/:id/versions/:vid` — 版本列表与详情
  - `GET /canvas/:id/components/:cid/input-form` 与 `POST /canvas/:id/components/:cid/debug` — 组件 input-form 与调试
  - `POST /canvas/:id/upload` — 画布附件上传(multipart,流式透传)
  - `GET /canvas/:id/logs/:messageId` — trace 日志(对齐原 `GET /api/v1/agents/:id/logs/:messageId`)
  - `POST /canvas/test_db_connection` — 数据库连接测试
  - `POST /canvas/:id/webhook/test` 与 `GET /canvas/:id/webhook/logs` — webhook 测试与 trace
  - `GET /canvas/prompts` — prompt 列表
  - `POST /canvas/rerun` — pipeline 重跑
  - `POST /canvas/:id/tasks/:taskId/cancel` 与 `POST /canvas/tasks/:taskId/cancel` — 任务取消(对齐原 `/api/v1/tasks/:id/cancel`)
  - `GET /canvas/attachments/:docId/download` 与 `GET /canvas/download` — 附件与文件下载
  - `GET /canvas/:id/external-inputs` — 外部 agent inputs(对齐原 `/api/v1/agentbots/:id/inputs`,若前端在用)
- **FR-005**: BFF MUST 流式透传画布执行 SSE 响应,保留上游 `Content-Type: text/event-stream` 等响应头,不缓冲 body,不重写事件序列
- **FR-006**: BFF MUST 流式透传 multipart 上传请求 body,不缓冲到内存,保留 `Content-Type: multipart/form-data; boundary=...` 请求头
- **FR-007**: BFF MUST 在画布操作上游错误(不可达/非 200)时返回 502 + `{code: 502, message: ...}` 响应,日志记录上游 URL 与错误信息,不吞异常
- **FR-008**: 前端 `api.ts` MUST 新增 `bffCanvas = '/api/bff/canvas'` 常量,将所有画布相关 endpoint 从 `${restAPIv1}/agents/...` 或 `${bffAgents}/...` 迁移到 `${bffCanvas}/...`(单点改动,对齐 Constitution "前端 API 迁移两阶段")
- **FR-009**: BFF MUST 保留 `/api/bff/proxy/v1/agents/*` catch-all 路由不删除(Constitution 验收 Gate "改回 `/api/v1` 可瞬时回滚" 约束),前端迁移后不再发起该路径请求
- **FR-010**: BFF MUST 保留 `bff-agents.ts` 中的 Agent 概览/Sessions CRUD + chat/completions 路径不变(US1 仅迁出画布相关 passthrough,不动 Agent 域已迁移路径,SC-006 零回归)

#### US2 — 画布按租户隔离

- **FR-011**: `CanvasService` MUST 通过 `BffTenant.canvasBackendId` 解析目标 Intellect RAG 后端,而非默认回退到首个 `type=intellect-rag` backend
- **FR-012**: 当 BffTenant 已设置 `canvasBackendId` 但该 ID 在 HarnessStore 中不存在或类型非 `intellect-rag` 时,BFF MUST 返回 503 + `{code: 503, message: "Tenant ${tenantId} canvas backend ${canvasBackendId} not found or invalid"}`,不静默回退
- **FR-013**: 当 BffTenant 未设置 `canvasBackendId` 时,BFF MUST 按以下顺序处理:
  - 若 `tenantId=default` 或社区版(无 `X-Tenant-Id`):回退到首个 `type=intellect-rag` backend,保持社区版零回归
  - 若 `tenantId` 为企业版租户(非 default):返回 503 + `{code: 503, message: "Tenant ${tenantId} has no canvas backend bound"}`
- **FR-014**: `AdapterRegistry` MUST 提供 `getCanvasBackendForTenant(tenantId)` 方法,返回 `IntellectRagAdapter` 实例;同一 tenant 的 Adapter 实例 MUST 被复用,不重复创建(对齐 P1 FR-011 实例复用约束)
- **FR-015**: `CanvasService` MUST 不注入 `X-Intellect-Team` / `X-Intellect-Project` Team/Project 组织隔离头,因 Intellect RAG 是单租户后端(对齐 P1 FR-014)

#### US3 — Proxy 路由收口

- **FR-016**: 前端 `api.ts` MUST 在迁移完成后无任何画布相关路径使用 `${restAPIv1}/agents/...` 或 `${bffAgents}/...` 形式
- **FR-017**: BFF `bff-agents.ts` MUST 移除画布相关 passthrough 路径(POST/PUT/DELETE `/agents`、`/agents/:id/components/*`、`/agents/templates`、`/agents/tags`、`/agents/:id/versions/*`、`/agents/:id/upload`、`/agents/:id/reset`、`/agents/:id/logs/*`、`/agents/:id/webhook/*`、`/agents/test_db_connection`、`/agents/rerun`、`/agents/prompts`、`/agents/attachments/*`、`/agents/download`、`/tasks/:id/cancel`、`/agentbots/:id/inputs`),仅保留 `GET /agents`、`GET /agents/:id`、`/agents/:id/sessions/*`、`POST /agents/chat/completions`(US1 不动 Agent 域已迁移路径)
- **FR-018**: BFF `proxy.ts` catch-all 路由 MUST 保留不删除,继续服务 Intellect RAG 专属域(datasets/kb/search/memory/mcp 等)
- **FR-019**: BFF MUST 在 `index.ts` 注册 `/canvas/*` 路由,挂载顺序与 `/agents/*`、`/admin/*`、`/capabilities/*`、`/auth/*` 等并列,路径前缀不冲突

#### 测试与质量

- **FR-020**: BFF MUST 为 `CanvasService` 提供单元测试,Mock `IntellectRagAdapter`,覆盖:listCanvas / saveCanvas / executeCanvas / upload / debug / trace 等核心方法,以及 US2 三种绑定场景(已绑定/未绑定/default 回退)
- **FR-021**: BFF MUST 为 `/api/bff/canvas/*` 路由提供集成测试,覆盖:鉴权(401)、租户上下文注入、上游 502 错误、SSE 流式响应、multipart 上传流式透传
- **FR-022**: BFF MUST 保留现有 `bff-agents.test.ts`、`proxy` 相关测试 100% 通过(零回归,SC-006)
- **FR-023**: 前端 `agent-service.ts` MUST 跟随 `api.ts` 常量迁移更新 url 引用,TypeScript 编译零错误
- **FR-024**: BFF 与前端 MUST 通过 `tsc --noEmit` 编译零错误,Vitest 全部通过

### Key Entities *(include if feature involves data)*

- **CanvasService**: BFF 服务层实体,封装画布操作对 Intellect RAG Adapter 的调用;硬绑定 `IntellectRagAdapter`,不实现 Adapter 接口(画布是 Intellect RAG 专属能力,不纳入统一 Adapter schema,Constitution Principle III + VII)
- **BffTenant.canvasBackendId**(已有字段,本 spec 复用): BFF 租户绑定画布后端的引用,指向 HarnessBackend.id(`type=intellect-rag`);未设置时按 FR-013 处理
- **Canvas Route Registry**: BFF 路由层实体,显式声明所有 `/api/bff/canvas/*` 子路径,无 catch-all;每个子路径对应 `CanvasService` 的一个方法调用
- **AdapterRegistry.getCanvasBackendForTenant(tenantId)**(新增方法): 按租户解析画布后端,返回 `IntellectRagAdapter` 实例;复用 Adapter 实例(对齐 P1 FR-011)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 前端画布操作 100% 经 `/api/bff/canvas/*` 单一入口,`api.ts` 中无任何画布相关路径残留 `${restAPIv1}/agents/...` 或 `${bffAgents}/...` 形式(可通过 grep 校验)
- **SC-002**: 画布冒烟用例(列表 → 创建 → 编辑 DSL → 保存 → 执行调试 → 上传附件 → 查看 trace → 列出版本 → 重置 → 删除)100% 通过,响应与原透传模式逐字段一致(零回归)
- **SC-003**: 企业版租户(非 default)未绑定 `canvasBackendId` 时调画布操作,100% 返回 503 + 明确错误信息,不静默回退到默认 Intellect RAG
- **SC-004**: BffTenant 已绑定 `canvasBackendId` 但后端不存在/类型错误时,100% 返回 503 + 明确错误信息,不静默回退
- **SC-005**: 社区版/default 租户调画布操作,100% 回退到默认 Intellect RAG 后端,行为与迁移前一致(社区版零回归)
- **SC-006**: 现有 P0 透明代理路由 `/api/bff/proxy/v1/*` 100% 不回归,未迁移域(Dataset/KB/Search/Memory/MCP)继续正常工作(对齐 P1 SC-006 约束)
- **SC-007**: BFF Agent 原生路由 `/api/bff/agents/*` 中 Agent 概览/Sessions CRUD + chat/completions 100% 不回归,响应格式与 P1 透传模式逐字段一致(对齐 P1 SC-007 约束)
- **SC-008**: TypeScript 编译通过(`tsc --noEmit` 零错误),Vitest 全部通过(对齐 Constitution Principle VII Test-First)
- **SC-009**: `CanvasService` 单元测试覆盖率 ≥ 80%(核心方法 listCanvas/saveCanvas/executeCanvas/upload/debug/trace 必有测试,对齐 Constitution Principle VII)
- **SC-010**: BFF 路由表中 `/canvas/*` 路由挂载点与 `/agents/*`、`/admin/*`、`/capabilities/*`、`/auth/*` 并列,路径前缀无冲突(可通过 `bff/src/index.ts` 静态检查校验)
- **SC-011**: 前端 `api.ts` 改回 `${restAPIv1}/agents/...` 可瞬时回滚到 US1 之前的透传行为,无需 BFF 配合(对齐 Constitution "前端 API 迁移两阶段" FR-006 约束)

## Assumptions

- **画布后端类型锁定**: `canvasBackendId` 指向的 HarnessBackend 必须 `type=intellect-rag`,不允许指向 `intellect-enterprise`(Constitution Principle III,企业版无画布)
- **Canvas Workflow SSE 协议不变**: 本 spec 不修改 SSE 解析逻辑,`parseCanvasWorkflowSSE` 与 StreamChunk 映射保持 P1 实现不变(Constitution Principle IV)
- **`bff-agents.ts` 的 chat/completions 路径保留**: US1 仅迁出画布执行到 `/canvas/:id/execute`,`/agents/chat/completions` 路径保留(因 Agent 概览的 chat/completions 与画布执行在 P1 已合并,且前端 `agentChatCompletion` 常量已迁移到 `bffAgents`;本 spec 不动此路径,仅新增 `/canvas/:id/execute` 作为画布执行的显式入口,前端按需迁移)
- **`/api/bff/proxy/v1/agents/*` 路径保留不删除**: 仅前端不再发起该路径请求,catch-all 路由本身保留作为回滚通道(Constitution 验收 Gate 约束)
- **社区版租户的 default 回退行为**: 社区版无多租户概念,`tenantId=default` 或无 `X-Tenant-Id` 时回退到首个 `type=intellect-rag` backend,保持社区版零回归;此回退仅对 default 租户生效,企业版租户严格执行 FR-013
- **不引入 Canvas IR 中间表示**: 画布操作直接用 Intellect RAG 原生格式,BFF 不引入画布 IR schema(Constitution Principle III)
- **不修改 Intellect RAG 上游 API**: 本 spec 仅在 BFF 层重构,Intellect RAG `/api/v1/agents/*` 等 API 契约不变
- **不修改 `BffTenant` schema**: `canvasBackendId` 字段已在 P0/P1 阶段定义,本 spec 仅复用,不新增字段
- **依赖现有 `authMiddleware` 与 `tenantContextMiddleware`**: 本 spec 不修改中间件实现,仅复用
- **前端 `agent-service.ts` 跟随迁移**: `api.ts` 常量迁移后,`agent-service.ts` 中 url 引用自动跟随,无需单独修改(对齐 P1 T019 单点改动约束)
