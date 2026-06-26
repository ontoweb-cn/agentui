# Implementation Plan: Intellect Enterprise Adapter

**Branch**: `004-intellect-enterprise-adapter` | **Date**: 2026-06-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-intellect-enterprise-adapter/spec.md`

## Summary

实现 `IntellectEnterpriseAdapter`,对接 intellect-team `POST /api/sessions/{id}/chat/stream` 主通道(Constitution Principle VIII 锁定),实现 `IHarnessAdapter` 核心层接口。新增 `parseIntellectEnterpriseSSE` 解析企业版自定义 SSE 事件(`assistant.delta`/`tool.progress`/`run.completed`/`done`/`error`,Constitution Principle IV),输出统一 `StreamChunk`。注册 `IntellectEnterpriseAdapterFactory` 到 AdapterRegistry,支持 `backendType === 'intellect-enterprise'` 后端选择。BFF 路由层零改动(Principle II),P0/P1/P2 功能 100% 不回归。

## Technical Context

**Language/Version**: TypeScript 5.x(Node.js 20+,BFF Hono runtime)

**Primary Dependencies**:
- Hono(BFF HTTP 框架,已用)
- `IHarnessAdapter` / `StreamChunk` / `HarnessBackend` 等类型(P1 已定义,复用)
- `AdapterRegistry`(P1 已实现,扩展注册)
- intellect-team REST API(`/api/sessions/*` + `/v1/models` + `/v1/capabilities` + `/health`)

**Storage**: 无新增存储。复用 P0 `HarnessStore`(JSON + env)配置企业版后端;intellect-team 自管 session/message 数据,BFF 不持久化(Principle V)

**Testing**: Vitest(BFF 既有测试框架),契约测试 fixture(录制 intellect-team SSE 流),Mock fetch

**Target Platform**: BFF Node.js server(localhost:9390)

**Project Type**: BFF library/adapter module(扩展现有 `bff/src/services/adapters/` 目录)

**Performance Goals**: SSE 首字节时延 < 2s(intellect-team 正常负载);Adapter 方法调用时延 < 500ms(不含 intellect-team 响应时间)

**Constraints**:
- 必须复用 P1 `StreamChunk` 类型(8 值,启用 `tool_progress`)
- 必须复用 P1 `IHarnessAdapter` 接口,不修改接口签名
- BFF 路由层代码零改动(Principle II)
- 禁用 `/v1/chat/completions` stateless 端点(Principle VIII)
- 鉴权用 `API_SERVER_KEY`,不实现 `imt_p_*` 项目级 token(Principle VIII)

**Scale/Scope**: 1 个 Adapter 类 + 1 个 SSE 解析器 + 1 个 HTTP 客户端 + 1 个工厂注册 + 单元测试。预估 ~600 LOC(含测试)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I. BFF-Mediated Frontend | Adapter 在 BFF 内,前端经 BFF 路由消费,不直连 intellect-team | ✅ Pass |
| II. Adapter Abstraction | 实现 `IHarnessAdapter` 核心层,路由层零改动,通过 AdapterRegistry 选择 | ✅ Pass |
| III. Canvas Hard-Bound to RAG | 企业版 capabilities.canvas=false,不实现画布;画布仍走 IntellectRagAdapter hard-bound | ✅ Pass |
| IV. SSE Dual-Protocol | 新增 `parseIntellectEnterpriseSSE`,不复用 parseCanvasWorkflowSSE/parseOpenAISSE;启用 StreamChunk.tool_progress | ✅ Pass |
| V. Tenant Isolation | BFF Tenant 绑定 intellectTeamId/intellectProjectId,Adapter 注入 X-Intellect-Team/X-Intellect-Project 头;不存 Team/Project 业务数据 | ✅ Pass(需 Phase 0 确认 BffTenant 字段) |
| VI. No ACP in BFF | 用 HTTP REST + SSE,不实现 ACP | ✅ Pass |
| VII. YAGNI + Test-First | 核心层 + SSE 解析器必有单元测试;不实现 runs/fork/imt_p_*(留 P4+) | ✅ Pass |
| VIII. BFF ↔ Intellect Enterprise Access Contract | 主通道 `/api/sessions/{id}/chat/stream`,鉴权 `API_SERVER_KEY`,禁用 `/v1/chat/completions` + `/v1/runs/*` | ✅ Pass |

**GATE RESULT**: All principles pass. 无 Complexity Tracking 违规需记录。

## Project Structure

### Documentation (this feature)

```text
specs/004-intellect-enterprise-adapter/
├── plan.md              # This file
├── research.md          # Phase 0 output (intellect-team API 实证 + BffTenant 字段确认)
├── data-model.md        # Phase 1 output (IntellectEnterpriseAdapter + SSE 事件实体)
├── quickstart.md        # Phase 1 output (冒烟验证场景)
├── contracts/           # Phase 1 output (SSE 事件 → StreamChunk 映射契约)
│   └── intellect-enterprise-sse-mapping.ts
└── tasks.md             # Phase 2 output (/speckit-tasks,本命令不创建)
```

### Source Code (repository root)

```text
bff/src/
├── services/
│   └── adapters/
│       └── intellect-enterprise/                    # P3 新增目录(Principle 命名规范)
│           ├── intellect-enterprise-adapter.ts      # IntellectEnterpriseAdapter 类
│           ├── intellect-enterprise-adapter.test.ts # 单元测试(Mock fetch)
│           ├── parse-intellect-enterprise-sse.ts    # parseIntellectEnterpriseSSE 解析器
│           ├── parse-intellect-enterprise-sse.test.ts # 契约测试(SSE fixture)
│           └── http-client.ts                       # IntellectEnterprise HTTP 客户端封装
├── services/
│   └── adapter-registry.ts                          # P1 已存在,P3 仅新增 registerFactory 调用
├── types/
│   ├── adapter.ts                                    # P1 已存在,不修改
│   ├── stream.ts                                     # P1 已存在,不修改(tool_progress 已预留)
│   └── stores.ts                                     # P0 已存在,Phase 0 确认是否需扩展 BffTenant 字段
└── data/
    └── harness-backends.json                         # P0 已存在,P3 新增一条 intellect-enterprise 配置样例
```

**Structure Decision**: 沿用 P1 IntellectRagAdapter 的目录结构(`bff/src/services/adapters/<backend-type>/`),保持一致。Adapter + SSE 解析器 + HTTP 客户端三文件分离,对应三个测试文件,符合 P1 模式。

## Complexity Tracking

> 无 Constitution Check 违规,本节为空。
