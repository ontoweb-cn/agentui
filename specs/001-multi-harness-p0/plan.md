# Implementation Plan: Multi-Harness P0 — BFF 接入点 + Adapter 骨架

**Branch**: `001-multi-harness-p0` | **Date**: 2026-06-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from [specs/001-multi-harness-p0/spec.md](./spec.md)

## Summary

P0 是 multi-harness 方案的基础设施层,交付三件事:

1. **BFF 反向代理接入点**(P0-前置):新增 `/api/bff/proxy/v1/*` catch-all 路由,透传到 Intellect RAG `/api/v1/*`,前端只改一个 API 路径常量即可全部流量经 BFF;支持回滚(双代理并存)
2. **Adapter 契约定义**(P0):定义 `IHarnessAdapter` / `IMultiTenantAdapter` 接口、`StreamChunk` / `TenantContext` / `HarnessCapabilities` / `AgentSummary` / `Session` / `Team` / `Project` 等数据模型,作为 P1 IntellectRagAdapter 和 P3 IntellectEnterpriseAdapter 的共同契约
3. **后端配置 + 租户绑定存储**(P0):`HarnessStore`(从 JSON + env 加载后端) + `TenantStore`(维护 BffTenant ↔ Backend 绑定),为 P1 `AdapterRegistry.getAdapterForTenant()` 提供数据基础

技术栈沿用项目现状:Hono(BFF) + Vite/React(前端) + TypeScript 全栈 + JSON 文件存储。P0 不引入新依赖,不引入 BFF 测试框架(留待 P1 第一份 Adapter 实现时一并引入 Vitest,符合 Constitution Principle VII YAGNI)。

## Technical Context

**Language/Version**: TypeScript 5.9.3(BFF + 前端共用)

**Primary Dependencies**:
- BFF:Hono ^4.6.0、@hono/node-server ^1.13.0、Zod ^3.23.8、tsx ^4.0.0、esbuild ^0.24.0
- 前端:Vite ^7.2.7、React ^18.2.0、axios ^1.12.0、eventsource-parser ^1.1.2(已安装,前端 SSE 解析复用)
- 共用:TypeScript ^5.9.3

**Storage**:
- `bff/data/harness-backends.json` — 后端配置(非敏感,可入库)
- `.env` — admin token(敏感,gitignore)
- 内存 — 运行时合并 env + JSON 为完整 `HarnessBackend` 对象
- `bff/data/bff-tenants.json` — BFF Tenant + 绑定关系(非敏感,可入库)

**Testing**:
- 类型检查:`tsc --noEmit`(BFF + 前端各自)
- 手工冒烟:登录 → Agent → Session → 流式对话 → 画布 → 知识库 CRUD → Admin
- P0 不引入 Vitest(留待 P1 第一份 Adapter 实现时一并引入)
- Constitution Principle VII 例外说明:P0 只交付契约(类型定义)与存储 CRUD 模板,无 SSE 解析器、无 Adapter 实现,符合 YAGNI

**Target Platform**:
- BFF:Node.js ≥ 18.20.4(engines 约束),HTTP Server,端口 9390
- 前端:现代浏览器(Chrome/Edge/Firefox/Safari 最新版),Vite dev server 端口 5173

**Project Type**: web-service(BFF) + web-app(前端),monorepo via npm workspaces

**Performance Goals**:
- BFF 反向代理透传 SSE,首字延迟增加 ≤ 50ms(本地环境,SC-002)
- 代理层无请求体大小限制(透传,不缓冲)
- BFF 启动时 `HarnessStore.load()` + `TenantStore.load()` < 100ms

**Constraints**:
- 前端业务代码零改动(只改 API 路径常量)
- 现有 BFF 路由(agent/session/admin/health)行为 100% 不回归
- 改回 API 常量可瞬时回滚,无需 BFF 配合
- 契约文件独立编译通过(不依赖任何 Adapter 实现)

**Scale/Scope**:
- 新增 BFF 路由:1 个(`/api/bff/proxy/v1/*` catch-all)
- 新增 BFF 服务:2 个 Store(HarnessStore + TenantStore)
- 新增 BFF 契约文件:约 6-8 个 TypeScript 类型定义文件
- 新增前端改动:1 行 API 路径常量
- 新增 Vite 配置:1 条 proxy 规则
- 不涉及 UI 改动、不涉及新页面

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| **I. BFF-Mediated Frontend (NON-NEGOTIABLE)** | ✅ PASS | P0-前置直接实现该原则:新增 `/api/bff/proxy/v1/*` 反向代理,前端只改一个常量全部流量经 BFF。设计文档 §十二 已定义两阶段迁移策略,P0-前置是阶段 A。 |
| **II. Adapter Abstraction** | ✅ PASS | P0 只定义 `IHarnessAdapter` / `IMultiTenantAdapter` 契约,不实现 Adapter。契约含 Layer 1(核心层 Agent/Session/Message)和 Layer 2(扩展层 Team/Project),Layer 3 透传层不纳入契约。 |
| **III. Canvas Hard-Bound to Intellect RAG (NON-NEGOTIABLE)** | ✅ N/A | P0 不涉及画布路由。`HarnessCapabilities.canvas` 字段在契约中声明,但 P0 不实现画布路由硬绑定(留待 P1 画布路由重构时)。 |
| **IV. SSE Dual-Protocol Parsing** | ✅ PASS | P0 在契约中定义 `StreamChunk` 类型,`type` 枚举为 `delta\|reasoning\|tool_start\|tool_complete\|usage\|done\|error`,覆盖两后端所有事件。P0 不实现解析器(P1 实现 `parseOpenAISSE`,P3 实现 `parseIntellectEnterpriseSSE`)。 |
| **V. Tenant Isolation via BFF** | ✅ PASS | P0 `TenantStore` 维护 `BffTenant` 实体,只存 id/name/intellectTenantId/intellectBackendId/canvasBackendId,不存 Team/Project/Member。 |
| **VI. No ACP in BFF (NON-NEGOTIABLE)** | ✅ N/A | P0 不涉及 ACP。 |
| **VII. YAGNI + Test-First** | ✅ PASS(例外已说明) | P0 不实现 Adapter / SSE 解析器,只交付契约 + 存储 CRUD。`tsc --noEmit` + 手工冒烟覆盖。Vitest 引入留待 P1(第一份 Adapter 实现时),记录在 [research.md](./research.md) §4。 |
| **命名规范** | ✅ PASS | 契约中使用 `'intellect-rag'` / `'intellect-enterprise'` 字面量,目录 `adapters/intellect-rag/` / `adapters/intellect-enterprise/`(P1/P3 创建),类名 `IntellectRagAdapter` / `IntellectEnterpriseAdapter`(P1/P3 实现)。 |
| **Token 安全** | ✅ PASS | `HarnessStore` 从 env 读 token,JSON 只存 `adminTokenEnvVar` 引用。`.env` 在 gitignore。 |

**Gate 结论**:无 NON-NEGOTIABLE 违规,Phase 0 可启动。Principle VII 例外已在 [research.md](./research.md) §4 说明。

## Project Structure

### Documentation (this feature)

```text
specs/001-multi-harness-p0/
├── spec.md                       # /speckit-specify 输出
├── plan.md                       # 本文件(/speckit-plan 输出)
├── research.md                   # Phase 0:技术决策依据
├── data-model.md                 # Phase 1:实体模型
├── quickstart.md                 # Phase 1:验证场景指南
├── contracts/                    # Phase 1:接口契约(TypeScript)
│   ├── harness-backend.ts        # HarnessBackend / HarnessCapabilities
│   ├── stream-chunk.ts           # StreamChunk 统一类型
│   ├── tenant-context.ts         # TenantContext / BffTenant
│   ├── harness-adapter.ts        # IHarnessAdapter 核心层契约
│   ├── multi-tenant-adapter.ts   # IMultiTenantAdapter 扩展层契约
│   ├── domain-models.ts          # AgentSummary / Session / Team / Project / Member
│   └── stores.ts                 # HarnessStore / TenantStore 接口契约
└── tasks.md                      # /speckit-tasks 输出(下一步)
```

### Source Code (repository root)

```text
bff/
├── data/
│   ├── harness-backends.json     # 默认后端配置(可入库,无 token 明文)
│   └── bff-tenants.json          # BFF Tenant + 绑定关系(可入库)
├── src/
│   ├── index.ts                  # 修改:挂载 proxy 路由
│   ├── routes/
│   │   └── proxy.ts              # 新增:catch-all /api/bff/proxy/v1/* → intellect-rag /api/v1/*
│   ├── services/
│   │   ├── intellect-client.ts   # 修改:新增 proxy(path, req) 透明代理方法
│   │   ├── harness-store.ts      # 新增:HarnessStore 实现
│   │   ├── tenant-store.ts       # 新增:TenantStore 实现
│   │   └── adapters/
│   │       └── shared/
│   │           └── (空,P1 创建 sse-parser.ts)
│   └── types/
│       ├── harness.ts            # 新增:契约文件(从 specs/.../contracts/ 复制或 symlink)
│       ├── adapter.ts            # 新增:IHarnessAdapter / IMultiTenantAdapter
│       ├── stream.ts             # 新增:StreamChunk
│       └── tenant.ts             # 新增:BffTenant / TenantContext
└── package.json                  # 不改动

src/
└── utils/
    └── api.ts                    # 修改:restAPIv1 单行改动 /api/v1 → /api/bff/proxy/v1

vite.config.ts                    # 修改:新增 /api/bff proxy 规则,保留 /api/v1 旧规则

.env.example                      # 修改:新增 HARNESS_*_ADMIN_TOKEN / VITE_BFF_BASE

tests/                            # P0 不引入 BFF 测试框架,留待 P1
```

**Structure Decision**:沿用现有 monorepo 结构(bff/ + src/),不新增顶层目录。契约文件先在 `specs/001-multi-harness-p0/contracts/` 定义(版本化、可审查),P0 实施时复制到 `bff/src/types/`(运行时消费)。P1/P3 实现 Adapter 时直接 import `bff/src/types/`。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

无 NON-NEGOTIABLE 违规,无需记录。

Principle VII YAGNI 例外(不引入 Vitest)记录在 [research.md](./research.md) §4,非违规而是符合 YAGNI 的取舍。
