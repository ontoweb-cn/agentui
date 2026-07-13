# Implementation Plan: Multi-Harness P1 — IntellectRagAdapter 实现 + 路由原生迁移

**Branch**: `002-multi-harness-p1` | **Date**: 2026-06-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-multi-harness-p1/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

P1 在 P0 基础上实现 `IntellectRagAdapter`(Layer 1)、Canvas Workflow SSE 解析器、`AdapterRegistry` 与 `TenantContext` 中间件,将 BFF Agent/Session 非流式路由从透明代理迁移到 Adapter 原生调用。**关键发现**:Intellect RAG 存在两套 SSE 协议(canvas workflow 自定义事件 + OpenAI 兼容标准),前端实际消费 canvas workflow SSE,与 constitution Principle IV v1.1.0 描述存在偏差,需在 research.md 中修订。

## Technical Context

**Language/Version**: TypeScript 5.9.x (BFF), React 18 + TypeScript (前端)

**Primary Dependencies**:
- BFF: Hono(已用), Vitest 3.x(P0 引入), node-fetch(已用)
- 前端: eventsource-parser(已用,消费 SSE)
- Intellect RAG: Flask + canvas.py(workflow SSE 源)

**Storage**: 文件存储(JSON,P0 已实现 HarnessStore + TenantStore)

**Testing**: Vitest 3.x(P0 已配置,43 个 Store 测试通过)

**Target Platform**: Node.js 23.x(BFF), 浏览器(前端)

**Project Type**: web-service(BFF) + web-app(前端)

**Performance Goals**: Adapter 单次调用 < 50ms 开销(透传基线对比);SSE 流式首字节延迟 < 100ms(相对透传)

**Constraints**:
- 前端行为零回归(Constitution Principle I)
- P0 透明代理路由 100% 不回归(SC-006)
- Adapter 核心层测试覆盖率 ≥ 80%(Constitution Principle VII)

**Scale/Scope**: 单后端(Intellect RAG)场景验证,3 个路由域迁移(Agent CRUD/Session CRUD/OpenAI 兼容流式)

**NEEDS CLARIFICATION**(Phase 0 research 解决):
1. **SSE 协议偏差**: Constitution Principle IV v1.1.0 描述"Intellect RAG: OpenAI 兼容 `data: {"choices":[{"delta":...}]}`",但 Intellect RAG `/api/v1/agents/chat/completions` 实际返回 canvas workflow 自定义事件(`workflow_started`/`message`/`message_end`),前端 `use-send-message.ts` 消费此格式。OpenAI 兼容格式仅存在于 `/openai/{chat_id}/chat/completions` 端点(外部集成用)。P1 应实现哪个解析器?
2. **Session 路由契约映射**: Intellect RAG session 挂在 `/agents/{agentId}/sessions` 下(嵌套),契约 `listSessions(ctx)` 无 agentId 参数。Session 域是否迁移到 Adapter 还是保留透传?
3. **Canvas workflow 流式范围**: Canvas workflow SSE 是 Principle III "Canvas Hard-Bound" 范畴,还是 Principle IV "SSE Dual-Protocol" 范畴?P1 是否迁移 canvas workflow 流式到 Adapter?

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. BFF-Mediated Frontend | ✅ PASS | P1 强化 BFF 原生路由,前端继续经 BFF 调用 |
| II. Adapter Abstraction | ✅ PASS | P1 实现 IntellectRagAdapter,验证"加后端不改路由" |
| III. Canvas Hard-Bound to Intellect RAG | ⚠️ NEEDS CLARIFICATION | Canvas workflow SSE 是否属 canvas hard-bound 范畴?若是,P1 不迁移;若否,P1 实现 parseCanvasWorkflowSSE |
| IV. SSE Dual-Protocol Parsing | ⚠️ VIOLATION (待修订) | Constitution v1.1.0 描述 Intellect RAG 为 OpenAI 兼容格式,但实际有双协议(canvas workflow + OpenAI 兼容)。需修订 Principle IV 反映实际,见 research.md |
| V. Tenant Isolation via BFF | ✅ PASS | P1 实现 TenantContext 中间件,Intellect RAG 不注入 Team/Project 组织隔离头 |
| VI. No ACP in BFF | ✅ PASS | P1 不涉及 ACP |
| VII. YAGNI + Test-First | ✅ PASS | Adapter 核心层必有测试,覆盖率 ≥ 80% |
| VIII. BFF ↔ Intellect Enterprise Access Contract | ✅ PASS | P1 仅涉及 Intellect RAG,不触发企业版契约 |

**Gate Status**: ⚠️ Principle IV VIOLATION 需在 Phase 0 research.md 中修订 constitution 并重新评估。Principle III 边界需在 research.md 中明确。

## Constitution Check (Post-Design Re-evaluation)

*Phase 1 设计完成后复评,基于 research.md / data-model.md / contracts/ 结论*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. BFF-Mediated Frontend | ✅ PASS | P1 路由层全部经 BFF,前端仅路径常量改动 |
| II. Adapter Abstraction | ✅ PASS | IntellectRagAdapter 实现 IHarnessAdapter,Registry 按 tenantId 选择,路由层不感知后端 |
| III. Canvas Hard-Bound to Intellect RAG | ✅ PASS (边界澄清) | Canvas DSL 编辑/节点组件/RAG reference 保留透传(Layer 3);Canvas Workflow SSE 传输属 Principle IV 迁移范畴(research.md R2) |
| IV. SSE Dual-Protocol Parsing | ⚠️ NEEDS CONSTITUTION REVISION | v1.1.0 描述偏差已实证(research.md R1),需修订为 v1.2.0 反映 Intellect RAG 双协议(canvas workflow + OpenAI 兼容)。P1 实现 parseCanvasWorkflowSSE |
| V. Tenant Isolation via BFF | ✅ PASS | TenantContext 中间件实现,Intellect RAG 不注入 Team/Project 组织隔离头 |
| VI. No ACP in BFF | ✅ PASS | P1 不涉及 ACP |
| VII. YAGNI + Test-First | ✅ PASS | parseOpenAISSE 推迟到 P3(YAGNI),P1 仅实现前端实际用的 parseCanvasWorkflowSSE,覆盖率 ≥ 80% |
| VIII. BFF ↔ Intellect Enterprise Access Contract | ✅ PASS | P1 仅涉及 Intellect RAG,不触发企业版契约 |

**Post-Design Gate Status**: ✅ 所有原则 PASS,唯 Principle IV 待 constitution 修订(v1.1.0 → v1.2.0,见 research.md R5)。修订不影响 P1 实施,P1 按 research.md 结论实现 parseCanvasWorkflowSSE。

**Constitution 修订待办**(P1 实施前或实施中执行):
- 修订 Principle IV 描述为 Intellect RAG 双协议(canvas workflow + OpenAI 兼容)
- 澄清 Principle III 边界(Canvas DSL 编辑透传 vs Canvas Workflow SSE 迁移)
- 版本号 v1.1.0 → v1.2.0
- 同步更新 bff/src/types/stream.ts 注释(反映 canvas workflow 映射)

## Project Structure

### Documentation (this feature)

```text
specs/002-multi-harness-p1/
├── plan.md              # This file
├── research.md          # Phase 0 output (SSE 双协议 + 契约映射)
├── data-model.md        # Phase 1 output (Adapter/Registry/Context 实体)
├── quickstart.md        # Phase 1 output (验证场景)
├── contracts/           # Phase 1 output (Adapter 接口契约)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
bff/
├── src/
│   ├── services/
│   │   ├── adapters/
│   │   │   └── intellect-rag/
│   │   │       ├── intellect-rag-adapter.ts    # IntellectRagAdapter (Layer 1)
│   │   │       ├── parse-canvas-workflow-sse.ts # Canvas Workflow SSE 解析器
│   │   │       ├── parse-openai-sse.ts          # OpenAI 兼容 SSE 解析器(P1 预留,P3 企业版用)
│   │   │       └── intellect-rag-adapter.test.ts
│   │   ├── adapter-registry.ts                  # AdapterRegistry (单例,按 tenantId 返回 Adapter)
│   │   ├── adapter-registry.test.ts
│   │   ├── harness-store.ts                     # P0 已实现
│   │   └── tenant-store.ts                      # P0 已实现
│   ├── middlewares/
│   │   └── tenant-context.ts                    # TenantContext 中间件
│   ├── routes/
│   │   ├── agents.ts                            # 迁移到 Adapter 原生调用
│   │   ├── sessions.ts                          # 条件迁移(见 research.md)
│   │   └── proxy.ts                             # P0 透明代理,保留未迁移域
│   ├── types/
│   │   ├── adapter.ts                           # P0 已定义 IHarnessAdapter
│   │   ├── stream.ts                            # P0 已定义 StreamChunk
│   │   └── tenant-context.ts                    # TenantContext 类型
│   └── index.ts
├── data/
│   ├── harness-backends.json                    # P0 已实现
│   └── tenants.json                             # P0 已实现
├── vitest.config.ts                             # P0 已配置
└── package.json

src/                                              # 前端(最小改动)
└── utils/
    └── api.ts                                    # Agent 路径常量从 proxy/v1/agents 改为 bff/agents
```

**Structure Decision**: 沿用 P0 的 BFF 单项目结构(bff/),新增 `services/adapters/intellect-rag/` 子目录存放 Adapter 实现,符合 constitution 命名规范(`intellect-rag/` 目录,非 `intellect/`)。前端改动最小化(仅 api.ts 路径常量)。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle IV v1.1.0 描述偏差 | Intellect RAG 实际有双 SSE 协议(canvas workflow + OpenAI 兼容),constitution 仅描述 OpenAI 兼容 | 仅描述 OpenAI 兼容会导致 P1 实现 parseOpenAISSE 但前端实际用 canvas workflow,Adapter 无法消费前端流式 |
| P1 可能实现两个 SSE 解析器 | 前端用 canvas workflow,外部集成用 OpenAI 兼容,两种都有真实消费者 | 只实现一个会导致要么前端流式无法迁移,要么外部集成无标准协议 |
