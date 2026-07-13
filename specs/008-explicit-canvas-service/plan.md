# Implementation Plan: 显式 CanvasService — 画布脱离 Proxy 路由

**Branch**: `008-explicit-canvas-service` | **Date**: 2026-06-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-explicit-canvas-service/spec.md`

## Summary

BFF 新增显式 `CanvasService` 服务层 + 单一 `/api/bff/canvas/*` 路由前缀,把当前寄生在 `bff-agents.ts` 的 `passthrough()`(POST/PUT/DELETE `/agents`)与 `proxy.ts` catch-all(`/proxy/v1/agents/*`)上的画布操作(列表/创建/编辑/删除/DSL 执行/组件调试/版本/上传/trace/webhook 等)统一迁出。`CanvasService` 硬绑定 `IntellectRagAdapter`(Constitution Principle III),按 `BffTenant.canvasBackendId` 解析后端;未绑定画布的企业版租户返回 503,社区版 default 租户回退首个 `intellect-rag` backend。proxy catch-all 路由保留(回滚通道),`bff-agents.ts` 仅保留 Agent 概览/Sessions/chat/completions 已迁移路径。前端 `api.ts` 新增 `bffCanvas` 常量,画布相关 endpoint 单点迁移。

## Technical Context

**Language/Version**: TypeScript 5.x(BFF Hono + 前端 React 18)

**Primary Dependencies**:
- BFF: Hono(已用)、Vitest 3.x(P0 已配置)、`IntellectRagAdapter`(P1 已实现)、`AdapterRegistry`(P1 已实现)
- Intellect RAG: Flask + canvas.py(上游不变)
- 前端: `eventsource-parser`(已用,消费 Canvas Workflow SSE)

**Storage**: 无新增持久化。`BffTenant.canvasBackendId` 字段 P0/P1 已定义,本 spec 仅复用;`bff-tenants.json` schema 不变

**Testing**: Vitest 3.x(BFF 既有 ~185 个测试,本 spec 新增 `canvas-service.test.ts` + `canvas-routes.test.ts`)

**Target Platform**: BFF Node.js server(localhost:9390)+ 浏览器前端

**Project Type**: web-service(BFF 路由 + 服务层重构)+ web-app(前端 api.ts 路径迁移)

**Performance Goals**: 画布操作响应延迟与原透传模式逐字段一致(无额外中间层开销,`CanvasService` 直接调 `IntellectRagAdapter.request()` 或流式透传)

**Constraints**:
- 前端画布冒烟用例 100% 通过,响应与原透传逐字段一致(SC-002)
- 社区版 default 租户 100% 零回归(SC-005)
- 现有 `/api/bff/proxy/v1/*` 与 `/api/bff/agents/*` 路由 100% 不回归(SC-006、SC-007)
- `CanvasService` 单元测试覆盖率 ≥ 80%(SC-009,Constitution Principle VII)
- 前端 `api.ts` 改回 `${restAPIv1}/agents/...` 可瞬时回滚(SC-011,Constitution "前端 API 迁移两阶段" FR-006 约束)

**Scale/Scope**: 1 个新服务文件(`canvas-service.ts`)+ 1 个新路由文件(`canvas.ts`)+ 1 个 `AdapterRegistry` 方法扩展(`getCanvasBackendForTenant`)+ 前端 `api.ts` 单点常量迁移 + 2 个测试文件。预估 ~600 LOC(含测试)

**NEEDS CLARIFICATION**(Phase 0 research 解决):
1. **画布路由迁移边界**: `bff-agents.ts` 的 POST/PUT/DELETE `/agents` passthrough(画布 DSL create/edit/delete)是否一并迁到 `/canvas/*`?还是保留在 `/agents/*` 仅迁子域(components/versions/upload/debug/trace 等)?
2. **`CanvasService` 是否新增 IR / DTO 层**: 画布操作直接用 Intellect RAG 原生 JSON,还是引入 Canvas DSL 中间表示?Constitution Principle III + VII 倾向 YAGNI,需 research 确认
3. **`getCanvasBackendForTenant` 与现有 `getAdapterForTenant` 的关系**: 复用 `getAdapterForBackend(canvasBackendId)` 还是新增独立方法?canvas 硬绑定语义是否需要在 Registry 层显式表达?
4. **`/agents/chat/completions` vs `/canvas/:id/execute`**: P1 已将 chat/completions 迁到 `/agents/chat/completions`(经 Adapter + parseCanvasWorkflowSSE),本 spec 是否新增 `/canvas/:id/execute` 作为画布执行显式入口?两路径是否并存?

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I. BFF-Mediated Frontend | 画布操作经 BFF `/api/bff/canvas/*`,前端不直连 Intellect RAG | ✅ Pass |
| II. Adapter Abstraction | `CanvasService` 调 `IntellectRagAdapter`(经 `AdapterRegistry.getCanvasBackendForTenant`),路由层不感知后端 | ✅ Pass(待 research R3 确认 Registry 方法形态) |
| III. Canvas Hard-Bound to Intellect RAG | `CanvasService` 硬绑定 `IntellectRagAdapter`,不允许指向 `intellect-enterprise`;当前代码画布寄生在 `/agents/*` + `/proxy/v1/agents/*` 未显式落实 hard-bound,本 spec 是 Principle III 的首次显式实现 | ✅ Pass(本 spec 直接落实) |
| IV. SSE Dual-Protocol | Canvas Workflow SSE 解析(P1 `parseCanvasWorkflowSSE`)不变,本 spec 仅迁移执行入口路径,不改 SSE 协议 | ✅ Pass |
| V. Tenant Isolation | 画布按 `BffTenant.canvasBackendId` 路由;未绑定画布的企业版租户返回 503,不静默回退;default 租户回退首个 `intellect-rag` backend | ✅ Pass |
| VI. No ACP in BFF | 用 HTTP REST + 透传,不实现 ACP | ✅ Pass |
| VII. YAGNI + Test-First | `CanvasService` 不引入 Canvas IR(待 R2 确认);必有单元测试,覆盖率 ≥ 80% | ✅ Pass(待 R2 确认) |
| VIII. BFF ↔ Intellect Enterprise Access Contract | 画布仅用 Intellect RAG admin token(Bearer),不触发企业版 API_SERVER_KEY 契约 | ✅ Pass |

**GATE RESULT**: All principles pass preliminary check. 4 个 NEEDS CLARIFICATION 在 Phase 0 research.md 解决,无 Constitution 违规需记录。

## Project Structure

### Documentation (this feature)

```text
specs/008-explicit-canvas-service/
├── plan.md              # This file
├── research.md          # Phase 0 output(迁移边界 + IR 决策 + Registry 方法 + 执行入口)
├── data-model.md        # Phase 1 output(CanvasService + Route Registry + Registry 扩展)
├── quickstart.md        # Phase 1 output(画布冒烟场景)
├── contracts/           # Phase 1 output(BFF canvas API 契约)
│   └── canvas-api.ts
└── tasks.md             # Phase 2 output(/speckit-tasks,本命令不创建)
```

### Source Code (agentui repository)

```text
bff/src/
├── services/
│   ├── canvas-service.ts                    # 008 新增:显式 CanvasService(Layer 3 边界)
│   ├── canvas-service.test.ts               # 008 新增:单元测试(覆盖率 ≥ 80%)
│   ├── adapter-registry.ts                  # 008 修改:新增 getCanvasBackendForTenant 方法
│   ├── adapter-registry-types.ts            # 008 修改:IAdapterRegistry 接口加 getCanvasBackendForTenant
│   └── adapters/intellect-rag/
│       └── intellect-rag-adapter.ts         # 008 修改:补 listCanvas/saveCanvas/executeCanvas 等方法
├── routes/
│   ├── canvas.ts                            # 008 新增:/api/bff/canvas/* 路由
│   ├── canvas.test.ts                       # 008 新增:路由集成测试
│   ├── bff-agents.ts                        # 008 修改:移除 POST/PUT/DELETE /agents passthrough(迁到 canvas)
│   └── proxy.ts                             # 008 不改(catch-all 保留,SC-006 回归保护)
├── types/
│   └── canvas.ts                            # 008 新增:Canvas 路由 DTO 类型(对齐 contracts/canvas-api.ts)
└── index.ts                                 # 008 修改:挂载 /canvas/* 路由

src/
├── utils/api.ts                             # 008 修改:新增 bffCanvas 常量,画布 endpoint 迁移
└── services/agent-service.ts                # 008 修改:跟随 api.ts 常量迁移 url 引用
```

**Structure Decision**: 沿用 P1/P4b 的 BFF 单项目结构(bff/),`CanvasService` 放 `services/` 与 `adapter-registry.ts` 并列(非 adapter 子目录,因 CanvasService 是 Layer 3 边界而非 Layer 1 Adapter);`canvas.ts` 路由放 `routes/` 与 `bff-agents.ts`/`auth.ts` 并列;前端改动最小化(仅 `api.ts` 常量 + `agent-service.ts` url 引用)。

## Complexity Tracking

> 无 Constitution Check 违规,本节为空。
