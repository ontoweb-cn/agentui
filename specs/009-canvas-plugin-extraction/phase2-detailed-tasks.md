# Phase 2 Detailed Tasks: 代码迁移(细化版)

> **Parent**: [tasks.md](./tasks.md) §阶段 2
> **Design Doc**: [canvas-plugin-extraction-design.md](../../docs/canvas-plugin-extraction-design.md) §3.1 + §3.5
> **Created**: 2026-07-13
> **Status**: 待实施
> **Prerequisites**: 阶段 1 已完成 + **spec/008 已完成**(硬依赖)
> **⚠️ CRITICAL**: 本阶段硬依赖 spec/008 完成,否则画布插件无法调用 `/api/bff/canvas/*`

## 概述

将画布代码从 `src/pages/agent/` 物理迁入 `packages/canvas-plugin/src/`,拆分共用的 service/hook/manifest/types/i18n/constants。迁移完成后,`src/pages/agent/` 目录清空,画布作为独立 module 被 `_registry.ts` 加载。

**核心原则**:
- 整体物理迁移,保持内部相对路径不变
- `@/` alias 仍指向主应用通用层(画布插件引用主应用 UI/工具)
- 共享类型/常量保留主应用权威源,画布插件 re-export
- 每个子任务后验证 `tsc --noEmit` 通过

---

## 前置调查结论

### 文件归属清单(基于源码调查)

#### 1. `src/services/agent-service.ts` 方法归属

**迁入画布插件**(画布专属,21 个方法):
- `getAgent`、`createAgent`、`fetchVersionList`、`fetchVersion`、`resetAgent`
- `agentChatCompletion`、`listAgentTemplate`、`testDbConnect`、`getInputElements`、`debugSingle`
- `uploadAgentFile`、`trace`、`inputForm`、`fetchAgentLogs`、`fetchExternalAgentInputs`
- `fetchPrompt`、`cancelDataflow`、`cancelCanvas`、`createAgentSession`
- `updateAgent`、`fetchTrace`、`fetchAgentLogsByCanvasId`、`fetchAgentLogsById`、`fetchWebhookTrace`
- `deleteAgentSession`(命名导出)

**保留主应用**(agent 列表专属,4 个方法):
- `listAgents`、`listAgentTags`、`deleteAgent`、`updateAgentTags`、`fetchPipeLineList`

#### 2. `src/hooks/use-agent-request.ts` hook 归属

**迁入画布插件**(画布专属,~24 个 hook):
- `useFetchAgent`、`useResetAgent`、`useSetAgent`、`useUploadAgentFile`、`useUploadAgentFileWithProgress`
- `useFetchMessageTrace`、`useTestDbConnect`、`useDebugSingle`、`useFetchInputForm`
- `useFetchVersionList`、`useFetchVersion`、`useFetchAgentLog`、`useFetchSessionsByCanvasId`
- `useFetchExternalAgentInputs`、`useFetchPrompt`、`useCancelDataflow`、`useCancelConversation`
- `useFetchFlowSSE`、`useFetchWebhookTrace`、`useCreateAgentSession`、`useDeleteAgentSession`
- `useFetchSessionManually`、`useExportAgentLog`、`useFetchAgentTemplates`

**保留主应用**(agent 列表专属,~8 个 hook):
- `useFetchAgentListByPage`、`useFetchAllAgentList`、`useUpdateAgentSetting`、`useDeleteAgent`
- `useFetchAgentTags`、`useUpdateAgentTags`、`useFetchAgentList`
- `AgentApiAction`(enum,共享)、`IAgentTagCount`(interface,agent-list)

#### 3. `src/constants/agent.tsx` 常量归属

**迁入画布插件**(画布专属):
- `ProgrammingLanguage`、`CodeTemplateStrMap`、`AgentGlobals`、`AgentGlobalsSysQueryWithBrace`
- `variableCheckBoxFieldMap`、`initialLlmBaseValues`
- `DataflowOperator`、`Operator`、`ComparisonOperator`、`SwitchOperatorOptions`
- `AgentStructuredOutputField`、`JsonSchemaDataType`、`SwitchLogicOperator`
- `WebhookJWTAlgorithmList`、`AgentDialogueMode`、`initialBeginValues`、`BeginId`、`EmptyDsl`

**保留主应用**(共享):
- `AgentCategory`(enum:`AgentCanvas` / `DataflowCanvas`)— 列表筛选 + 画布类型区分共用
- `AgentQuery`(enum)— 查询参数 key 共用

#### 4. `src/interfaces/database/agent.ts` 类型归属

**迁入画布插件**(画布专属,绝大多数):
- 所有 `I*Form` / `I*Node` / `I*Item` 类型
- `DSLComponents`、`DSL`、`IOperator`、`IOperatorNode`、`IFlow`、`IFlowTemplate`
- `BaseNodeData`、`BaseNode`、`IntellectNodeType`、`IGraph`
- `ITraceData`、`IAgentLogResponse`、`IAgentLogsResponse`、`IAgentLogsRequest`、`IAgentLogMessage`
- `GlobalVariableType`、`IWebhookTrace`

**保留主应用**(agent 列表共用):
- `IPipeLineListRequest`(管道列表请求参数)

**共享类型处理**:
- `IFlow` 虽然语义上是画布实体,但 agent-list 接口返回 `IFlow[]` → 主应用保留权威源,画布插件 re-export

**⚠️ 代码质量问题**:
- `ISwitchCondition` / `ISwitchItem` / `ISwitchForm` 在文件中声明了两次(第 15 行与第 134 行),迁移时清理重复声明

#### 5. `src/interfaces/request/agent.ts` 类型归属

**迁入画布插件**(均为画布专属):
- `IDebugSingleRequestBody`、`IAgentWebhookTraceRequest`

#### 6. i18n 命名空间归属

**关键发现**:`flow.*` 命名空间不在 feature locale 中,而位于全局 `src/locales/{zh,en}.ts` 的 `translation.flow` 子树。

**迁移方案**:
- 从全局 `src/locales/{zh,en}.ts` 提取 `flow.*` 子树到 `packages/canvas-plugin/src/i18n/{zh,en}.ts`
- 画布插件 manifest 声明 `i18n: { namespaces: ['flow'], lazy: {...} }`
- `_registry.ts` 的 `collectI18nLazy()` 会将 `flow.*` 合并到 `translation` 子树(现有机制支持)
- `agents.*` 命名空间保留主应用(feature locale 当前为空 stub)
- `header.flow`(导航文案)保留全局(非画布专属)

#### 7. `src/utils/canvas-util.tsx` 归属

**全部迁入画布插件**(10 个函数,均为画布专属):
- `filterAllUpstreamNodeIds`、`filterChildNodeIds`、`isAgentStructured`
- `buildVariableValue`、`buildSecondaryOutputOptions`、`buildOutputOptions`
- `buildNodeOutputOptions`、`buildUpstreamNodeOutputOptions`、`buildChildOutputOptions`
- `getStructuredDatatype`

#### 8. `src/features/agents/routes.ts` 归属

**迁入画布插件**:
- `Agent`(`/agent`)、`AgentExplore`(`/agent/:id/explore`)、`AgentLogPage`(`/agent-log-page`)、`AgentShare`(`/agent/share`)

**保留主应用**:
- `AgentTemplates`(`/agent-templates`)、`Agents`(`/agents`)、`AgentList`(`/agent-list`)

---

## 细化任务

### 2.1 核心迁移

#### T022 迁移 `src/pages/agent/` → `packages/canvas-plugin/src/editor/`

**操作**:
1. `git mv src/pages/agent/ packages/canvas-plugin/src/editor/`
2. 更新内部 import 路径:
   - 相对路径不变(`./xxx`、`../xxx`)
   - `@/` alias 仍指向主应用 `src/*`(无需改动)
3. 验证:`npx tsc --noEmit` 通过

**子任务**:
- T022.1:迁移 `canvas/` 目录(节点、边、上下文菜单等)
- T022.2:迁移 `form/` 目录(30+ 算子表单)
- T022.3:迁移 `form-sheet/`、`run-sheet/`、`log-sheet/` 等 sheet 组件
- T022.4:迁移 `hooks/` 目录(30+ 画布 hook)
- T022.5:迁移 `chat/`、`explore/`、`share/` 目录
- T022.6:迁移 `constant/`、`utils/`、`store.ts`、`context.ts`、`hooks.tsx`、`interface.ts` 等顶层文件
- T022.7:运行 `npx tsc --noEmit` 验证,修复 import 路径

**验证**:
- `packages/canvas-plugin/src/editor/` 目录结构完整
- `src/pages/agent/` 目录已清空(或仅剩 README)
- `npx tsc --noEmit -p packages/canvas-plugin/tsconfig.json` 通过

#### T023 迁移画布类型 `src/interfaces/database/agent.ts` → 插件 `types/`

**操作**:
1. 画布专属类型迁入 `packages/canvas-plugin/src/types/canvas.ts`
2. 共享类型(`IFlow`、`IPipeLineListRequest`)保留主应用,画布插件 re-export
3. 清理 `ISwitchCondition` / `ISwitchItem` / `ISwitchForm` 重复声明
4. 更新所有 import 路径

**子任务**:
- T023.1:创建 `packages/canvas-plugin/src/types/canvas.ts`,迁入画布专属类型
- T023.2:在 `packages/canvas-plugin/src/types/index.ts` re-export 共享类型(`export type { IFlow, IPipeLineListRequest } from '@/interfaces/database/agent'`)
- T023.3:清理 `ISwitchCondition` / `ISwitchItem` / `ISwitchForm` 重复声明
- T023.4:更新 `packages/canvas-plugin/src/editor/` 内 import 路径

**验证**:
- `npx tsc --noEmit` 通过
- `grep -r "from '@/interfaces/database/agent'" packages/canvas-plugin/src/` 仅在 `types/index.ts` 出现(re-export)

#### T024 迁移 `src/interfaces/request/agent.ts` 画布部分 → 插件 `types/`

**操作**:
1. `IDebugSingleRequestBody`、`IAgentWebhookTraceRequest` 迁入 `packages/canvas-plugin/src/types/request.ts`
2. 更新 import 路径

**验证**:
- `npx tsc --noEmit` 通过

#### T025 迁移画布 i18n `flow.*` → 插件 `i18n/`

**操作**:
1. 从 `src/locales/zh.ts` 提取 `translation.flow` 子树到 `packages/canvas-plugin/src/i18n/zh.ts`
2. 从 `src/locales/en.ts` 提取 `translation.flow` 子树到 `packages/canvas-plugin/src/i18n/en.ts`
3. 全局 locale 文件移除 `flow` 子树
4. 画布插件 manifest 声明 i18n

**子任务**:
- T025.1:创建 `packages/canvas-plugin/src/i18n/zh.ts`,从全局 locale 提取 `flow.*` 子树
- T025.2:创建 `packages/canvas-plugin/src/i18n/en.ts`,同上
- T025.3:从 `src/locales/{zh,en}.ts` 移除 `flow` 子树
- T025.4:在画布插件 manifest 声明 `i18n: { namespaces: ['flow'], lazy: { zh: () => import('./i18n/zh'), en: () => import('./i18n/en') } }`

**验证**:
- `npm run dev` 启动后,画布页面 i18n 文案正常显示
- `grep -r "flow\." packages/canvas-plugin/src/editor/` 引用能正确解析

### 2.2 Service 拆分

#### T026 拆分 `src/services/agent-service.ts` — 画布方法迁入插件

**操作**:
1. 画布方法迁入 `packages/canvas-plugin/src/service/canvas-service.ts`
2. URL 改为 `/api/bff/canvas/*`(依赖 spec/008)
3. 主应用保留 agent 列表方法

**子任务**:
- T026.1:创建 `packages/canvas-plugin/src/service/canvas-service.ts`,迁入 21 个画布方法
- T026.2:URL 从 `${restAPIv1}/agents/...` 改为 `${bffCanvas}/...`(对齐 spec/008 contracts)
- T026.3:从 `src/services/agent-service.ts` 移除画布方法,保留 5 个 agent 列表方法
- T026.4:更新所有调用方 import 路径(画布内调用方改用 `canvas-service`)

**URL 映射**(对齐 spec/008 contracts/canvas-api.ts):
```
GET    /api/bff/canvas/:id              → canvasService.get(id)
POST   /api/bff/canvas                  → canvasService.create(body)
PUT    /api/bff/canvas/:id              → canvasService.save(id, dsl)
DELETE /api/bff/canvas/:id              → canvasService.delete(id)
POST   /api/bff/canvas/:id/execute      → canvasService.execute(id, body)
POST   /api/bff/canvas/:id/debug        → canvasService.debugSingle(id, body)
POST   /api/bff/canvas/:id/upload       → canvasService.upload(id, formData)
GET    /api/bff/canvas/:id/trace        → canvasService.trace(id, messageId)
GET    /api/bff/canvas/:id/versions     → canvasService.fetchVersionList(id)
GET    /api/bff/canvas/:id/sessions     → canvasService.fetchAgentLogs(id)
... (完整清单见 spec/008 contracts)
```

**验证**:
- `npx tsc --noEmit` 通过
- `grep -r "restAPIv1.*agents" packages/canvas-plugin/src/` 返回空(画布插件不再用旧路径)
- 画布冒烟测试 API 请求路径均为 `/api/bff/canvas/*`

#### T027 拆分 `src/hooks/use-agent-request.ts` — 画布 hooks 迁入插件

**操作**:
1. 画布 hooks 迁入 `packages/canvas-plugin/src/service/canvas-hooks.ts`
2. hooks 内部调用 `canvas-service.ts`(而非 `agent-service.ts`)
3. 主应用保留 agent 列表 hooks

**子任务**:
- T027.1:创建 `packages/canvas-plugin/src/service/canvas-hooks.ts`,迁入 24 个画布 hook
- T027.2:hooks 内部 import 改为 `./canvas-service`(而非 `@/services/agent-service`)
- T027.3:从 `src/hooks/use-agent-request.ts` 移除画布 hooks,保留 8 个 agent 列表 hooks
- T027.4:更新所有调用方 import 路径

**验证**:
- `npx tsc --noEmit` 通过
- `grep -r "use-agent-request" packages/canvas-plugin/src/` 返回空(画布插件不引用主应用 hooks)

### 2.3 Manifest 拆分

#### T028 拆分 `src/features/agents/manifest.ts` — 画布路由迁入插件

**操作**:
1. 画布路由迁入 `packages/canvas-plugin/src/index.ts` 的 `ModuleDefinition.routes`
2. agent 列表路由保留 `features/agents/manifest.ts`
3. 画布导航项迁入插件 manifest

**子任务**:
- T028.1:在 `packages/canvas-plugin/src/index.ts` 实现完整 `ModuleDefinition`:
  ```typescript
  const canvasModule: ModuleDefinition = {
    name: 'canvas',
    order: 40,
    enabled: (ctx) => ctx.capabilities.has('canvas'),
    routes: [
      { path: '/agent/:id', Component: () => import('./editor') },
      { path: '/agent/:id/explore', Component: () => import('./editor/explore') },
      { path: '/agent/share', layout: false, Component: () => import('./editor/share') },
      { path: '/agent-log-page/:id', Component: () => import('@/pages/agents/agent-log-page') },
    ],
    nav: [
      { path: '/agents', labelKey: 'header.flow', pathMap: ['/agents', '/agent-templates'], testId: 'nav-agent' },
    ],
    i18n: { namespaces: ['flow'], lazy: { zh: () => import('./i18n/zh'), en: () => import('./i18n/en') } },
  };
  ```
- T028.2:从 `src/features/agents/manifest.ts` 移除画布路由,仅保留 agent 列表/模板路由
- T028.3:将 `src/features/canvas/manifest.ts` 的 `enabled` 从 `() => false` 改为 `(ctx) => ctx.capabilities.has('canvas')`
- T028.4:迁移 `src/features/agents/routes.ts` 画布路由常量到插件

**验证**:
- `npm run dev` 启动后,画布路由正常工作(`/agent/:id` 可访问)
- `capabilities.canvas=false` 时画布入口隐藏(SC-004)
- `features/agents/manifest.ts` 仅保留 agent 列表/模板路由(SC-009)

#### T029 迁移 `src/components/canvas/background.tsx` → 插件

**操作**:
1. `git mv src/components/canvas/background.tsx packages/canvas-plugin/src/editor/components/background.tsx`
2. 更新 import 路径

**验证**:
- `npx tsc --noEmit` 通过
- `src/components/canvas/` 目录已清空(或删除)

#### T030 迁移 `src/components/xyflow/` → 插件

**操作**:
1. `git mv src/components/xyflow/ packages/canvas-plugin/src/editor/components/xyflow/`
2. 更新 import 路径

**子任务**:
- T030.1:迁移 `base-node.tsx`、`tooltip-node.tsx`
- T030.2:更新画布内 import 路径

**验证**:
- `npx tsc --noEmit` 通过
- `src/components/xyflow/` 目录已删除

#### T031 迁移 `src/utils/canvas-util.tsx` → 插件

**操作**:
1. `git mv src/utils/canvas-util.tsx packages/canvas-plugin/src/editor/utils/canvas-util.tsx`
2. 更新 import 路径

**验证**:
- `npx tsc --noEmit` 通过
- `grep -r "canvas-util" src/` 返回空(主应用不再引用)

#### T032 迁移 `src/constants/agent.tsx` 画布专属常量 → 插件

**操作**:
1. 画布专属常量迁入 `packages/canvas-plugin/src/editor/constant/canvas-constants.tsx`
2. 共享常量(`AgentCategory`、`AgentQuery`)保留主应用,画布插件 re-export

**子任务**:
- T032.1:创建 `packages/canvas-plugin/src/editor/constant/canvas-constants.tsx`,迁入画布专属常量
- T032.2:在 `packages/canvas-plugin/src/types/index.ts` re-export 共享常量(`export { AgentCategory, AgentQuery } from '@/constants/agent'`)
- T032.3:更新 `src/constants/agent.tsx`,移除画布专属常量,仅保留共享常量
- T032.4:更新所有 import 路径

**验证**:
- `npx tsc --noEmit` 通过
- 画布内 `import { Operator } from ...` 正确解析到插件内常量

---

## Checkpoint(阶段 2)

### T033 主应用 tsc 验证

```bash
npx tsc --noEmit -p tsconfig.json
```

**预期**:零错误(`src/pages/agent/` 已清空,所有画布代码迁入插件)。

### T034 插件包 tsc 验证

```bash
cd packages/canvas-plugin && npx tsc --noEmit
```

**预期**:零错误。

### T035 测试验证

```bash
npm test
```

**预期**:全部测试通过(画布相关测试在插件包内通过)。

### T036 目录清理验证

```bash
ls src/pages/agent/
```

**预期**:目录已清空(或仅剩 README)。

### T037 import 泄漏验证

```bash
grep -r "pages/agent" src/components/ | grep -v floating-chat-widget
```

**预期**:返回空(T003 方案 G 豁免 `floating-chat-widget.tsx`)。

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 物理迁移导致 import 路径大面积失效 | 高 | 中 | `@/` alias 不变,相对路径不变;用 `git mv` 保留历史;分批迁移(T022.1-T022.7) |
| spec/008 延期阻塞阶段 2 | 中 | 高 | 阶段 0/1 可先行;阶段 2 待 spec/008 就绪后启动 |
| 类型拆分边界争议(`IFlow` 共享) | 中 | 中 | 共享类型主应用保留权威源,画布 re-export |
| i18n 迁移导致文案丢失 | 中 | 中 | T025.4 验证画布页面文案正常;`_registry` 的深度合并机制保证 `flow.*` 正确加载 |
| URL 路径迁移导致 API 请求失败 | 高 | 高 | T026.2 严格对齐 spec/008 contracts;画布冒烟测试验证所有 API 路径 |
| 画布与 agent 列表共用 hook/service 拆分不彻底 | 中 | 中 | 按调查清单严格拆分;有争议时保留主应用 |

---

## 执行顺序与依赖

```
T022(核心迁移) ──┬─→ T023(类型迁移)
                ├─→ T024(request 类型迁移)
                ├─→ T025(i18n 迁移)
                ├─→ T026(service 拆分) ──→ T027(hooks 拆分)
                ├─→ T029(background 迁移)
                ├─→ T030(xyflow 迁移)
                ├─→ T031(canvas-util 迁移)
                └─→ T032(constants 迁移)

T028(manifest 拆分) 依赖 T022 + T025

T033-T037(Checkpoint) 依赖所有任务完成
```

**并行机会**:
- T023/T024/T025 可并行(不同文件)
- T029/T030/T031 可并行(不同文件)
- T026 依赖 T022(service 内部 import 画布类型)

---

## 与 spec/008 的依赖关系

本阶段**硬依赖** spec/008:
- T026.2:URL 改为 `/api/bff/canvas/*`,需 spec/008 提供 `/api/bff/canvas/*` 路由
- T028.3:`enabled: (ctx) => ctx.capabilities.has('canvas')`,需 spec/008 提供 `capabilities.canvas`

**若 spec/008 未完成**:
- T026 可暂用旧路径(`${restAPIv1}/agents/...`),待 spec/008 完成后切换
- T028.3 可暂用 `enabled: () => true`,待 spec/008 完成后切换
- 但这样会违反 SC-008(所有画布 API 经 `/api/bff/canvas/*`),不推荐
