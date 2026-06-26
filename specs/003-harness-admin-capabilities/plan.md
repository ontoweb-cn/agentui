# Implementation Plan: Multi-Harness P2 — Harness Admin 管理端 + 前端能力探测

**Branch**: `003-harness-admin-capabilities` | **Date**: 2026-06-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-harness-admin-capabilities/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

P2 在 P1 基础上实现 Harness Admin 管理端(BFF 后端配置 CRUD + 热加载 + AdapterRegistry 缓存失效)与前端能力探测(useHarnessCapabilities hook + Admin 页面 + 条件渲染)。运维可在线配置后端无需重启,前端按后端能力条件渲染 UI。所有前置条件已满足(HarnessStore.saveConfig/load 已实现,AdapterRegistry 需扩展 invalidate 方法)。

## Technical Context

**Language/Version**: TypeScript 5.9.x (BFF), React 18 + TypeScript (前端)

**Primary Dependencies**:
- BFF: Hono(已用), Vitest 3.x(P0 引入), HarnessStore/AdapterRegistry(P0/P1 已实现)
- 前端: TanStack Query(已用,管理能力探测请求), Ant Design(已用,Admin 页面表单/表格)

**Storage**: 文件存储(JSON,P0 已实现 HarnessStore.saveConfig 写回 harness-backends.json)

**Testing**: Vitest 3.x(BFF,91 个现有测试), Jest(前端,已有配置)

**Target Platform**: Node.js 23.x(BFF), 浏览器(前端)

**Project Type**: web-service(BFF) + web-app(前端)

**Performance Goals**: 后端 CRUD 响应 < 500ms(含 JSON 写盘 + 热加载);能力探测响应 < 100ms(内存查询)

**Constraints**:
- Token Security(Constitution):任何 API 响应不含 adminToken 明文
- P0/P1 功能 100% 不回归(91 个测试通过 + 透传 + Agent 原生路由)
- Admin 路由受 authMiddleware 保护(与现有 admin 路由一致)
- capabilities 路由受 authMiddleware + tenantContextMiddleware 保护

**Scale/Scope**: 单实例 BFF(无并发写冲突,P2 用 last-write-wins),1 个 Admin 页面,1 个前端 hook

**NEEDS CLARIFICATION**: 无。所有前置条件已验证(HarnessStore.saveConfig/load 已实现,TenantStore.listTenants 可校验绑定,AdapterRegistry.adapterCache 需扩展 invalidate 但属 P2 实现范畴)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. BFF-Mediated Frontend | ✅ PASS | P2 前端经 BFF Admin 路由 + capabilities 路由,不直连后端 |
| II. Adapter Abstraction | ✅ PASS | P2 capabilities 经 AdapterRegistry 获取,路由层不感知后端;AdapterRegistry 缓存失效保证配置变更生效 |
| III. Canvas Hard-Bound to Intellect RAG | ✅ PASS | P2 不涉及 canvas 路由,仅暴露 capabilities 供前端探测 |
| IV. SSE Dual-Protocol Parsing | ✅ PASS | P2 不涉及 SSE |
| V. Tenant Isolation via BFF | ✅ PASS | capabilities 路由按 X-Tenant-Id 返回该 tenant 绑定后端能力;Admin 路由非租户隔离(运维操作) |
| VI. No ACP in BFF | ✅ PASS | P2 不涉及 ACP |
| VII. YAGNI + Test-First | ✅ PASS | BFF 路由 + AdapterRegistry.invalidate 必有测试,覆盖率 ≥ 80% |
| VIII. BFF ↔ Intellect Enterprise Access Contract | ✅ PASS | P2 不涉及企业版接入 |

**Token Security 约束**:
- HarnessBackendConfig(持久化 JSON)只含 adminTokenEnvVar 引用,不含 adminToken 明文(P0 已实现)
- P2 CRUD API 返回 HarnessBackendConfig + ready 状态,**不**返回 adminToken
- 自动化测试验证任何 API 响应不含 `"adminToken":` 字段

**Gate Status**: ✅ 所有原则 PASS,无 VIOLATION,无 NEEDS CLARIFICATION。可直接进入 Phase 1 设计。

## Project Structure

### Documentation (this feature)

```text
specs/003-harness-admin-capabilities/
├── plan.md              # This file
├── research.md          # Phase 0 output(无 NEEDS CLARIFICATION,research 记录设计决策)
├── data-model.md        # Phase 1 output(DTO + 校验规则)
├── quickstart.md        # Phase 1 output(验证场景)
├── contracts/           # Phase 1 output(Admin API + capabilities API 契约)
└── tasks.md             # Phase 2 output(/speckit-tasks)
```

### Source Code (repository root)

```text
bff/
├── src/
│   ├── services/
│   │   ├── adapter-registry.ts          # P1 已实现,新增 invalidate(backendId) 方法
│   │   ├── harness-store.ts             # P0 已实现 saveConfig/load,P2 直接调用
│   │   └── tenant-store.ts              # P0 已实现 listTenants,P2 用于校验删除绑定
│   ├── routes/
│   │   ├── harness-admin.ts             # P2 新增:后端配置 CRUD 路由
│   │   ├── capabilities.ts              # P2 新增:能力探测路由
│   │   └── bff-agents.ts                # P1 已实现,不改动
│   ├── types/
│   │   └── harness-admin.ts             # P2 新增:DTO 类型(HarnessBackendWithStatus 等)
│   └── index.ts                         # 注册新路由
└── data/
    └── harness-backends.json            # P0 已实现,P2 CRUD 写回此文件

src/                                              # 前端
├── hooks/
│   └── use-harness-capabilities.ts               # P2 新增:能力探测 hook
├── pages/
│   └── admin/
│       └── harness-backends.tsx                  # P2 新增:Admin 页面
├── services/
│   └── harness-admin-service.ts                  # P2 新增:Admin API 调用
└── utils/
    └── api.ts                                    # P2 新增 harness admin + capabilities 路径常量
```

**Structure Decision**: 沿用 P0/P1 的 BFF 单项目结构。harness-admin 路由独立于现有 admin 路由(现有 admin 是 whitelist/role/resource,harness-admin 是后端配置),挂载到 `/api/bff/admin/harness-backends`。capabilities 路由挂载到 `/api/bff/capabilities`(经 Vite rewrite 后 BFF 收到 `/capabilities`)。前端新增 hook + Admin 页面 + service,复用现有 Ant Design 组件。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

无 Constitution 违规,P2 复用 P0/P1 基础设施,仅扩展 AdapterRegistry.invalidate 和新增路由/页面,无过度工程。
