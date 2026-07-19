# Tasks: Canvas Plugin Extraction(画布插件化)

> **Design Doc**: [canvas-plugin-extraction-design.md](../../docs/canvas-plugin-extraction-design.md)
> **Prerequisites**: spec/008-explicit-canvas-service(BFF CanvasService 独立化,阶段 2 硬依赖)
> **Status**: 阶段 0 ✅ | 阶段 1 ✅ | 阶段 2 ✅(核心迁移完成) | 阶段 3 📋 | 阶段 4 ⏸️
> **Created**: 2026-07-13

## 文档导航

| 阶段 | 详细任务文档 | 状态 |
|---|---|---|
| 阶段 0(解耦) | [phase0-detailed-tasks.md](./phase0-detailed-tasks.md) | ✅ 已实施 + 评审修复完成 |
| 阶段 1(包结构) | [phase1-detailed-tasks.md](./phase1-detailed-tasks.md) | ✅ 已实施(2026-07-20) |
| 阶段 2(代码迁移) | [phase2-detailed-tasks.md](./phase2-detailed-tasks.md) | ✅ 核心完成(2026-07-20): T022 物理迁移+T028 manifest拆分 |
| 阶段 3(验证收尾) | 本文档 §阶段 3 | 📋 待实施(需运行环境) |
| 阶段 4(独立构建) | 本文档 §阶段 4 | ⏸️ 可选,延后 |

### 评审文档

| 文档 | 说明 |
|---|---|
| [phase0-t002-t003-investigation.md](./phase0-t002-t003-investigation.md) | T002/T003 前置调查 |
| [phase0-t002-t003-review.md](./phase0-t002-t003-review.md) | T002/T003 方案评审 |
| [phase0-code-review.md](./phase0-code-review.md) | 阶段 0 代码评审 + 修复记录 |

## 概述

将画布(Canvas)功能从 `src/pages/agent/` 物理迁入独立包 `packages/canvas-plugin/`,复用现有 `features/_registry.ts` module system,实现画布代码内聚与可插拔。

**核心原则**(评审后确立):
- 复用现有 `ModuleDefinition` 接口,不引入独立插件协议(YAGNI)
- 不抽离共享 UI 组件库(成本过高)
- monorepo 内置包模式,延后独立构建
- 阶段 0/1 可与 spec/008 并行,阶段 2 依赖 spec/008

---

## 阶段 0:前置 — 反向解耦泄漏(可与 spec/008 并行)

**目标**:消除 `src/components/` 下 6 个文件对画布内部细节(store/hook/context/component)的直接依赖。

> **⚠️ 详细任务与技术评审见 [phase0-detailed-tasks.md](./phase0-detailed-tasks.md)**(含子任务拆分、复杂度评估、风险矩阵、修订方案)
>
> **评审关键结论**:
> - T002/T003 原方案(抽取 hook 通用部分)不可行 — hook 深度依赖画布,改为"迁入画布"或"props 注入"
> - T003 存在 hook 调用 bug(L138-140 条件调用 hook),需先修复
> - 执行顺序:T001/T004/T005 可并行 → T002/T003 需先调查

### 泄漏清单与解耦任务(概要,详见 phase0-detailed-tasks.md)

- [x] T001 [低复杂度] 解耦 `src/components/llm-setting-items/use-watch-change.ts`(store + context 泄漏)
  - 新建 `FormSyncContext`(含 `nodeId` + `updateNodeForm`)
  - ✅ 已实施:新建 [form-sync-context.ts](../../src/components/llm-setting-items/form-sync-context.ts),画布 [form-sheet/next.tsx](../../src/pages/agent/form-sheet/next.tsx) 添加 Provider
  - 详见 [phase0-detailed-tasks.md §T001](./phase0-detailed-tasks.md#t001-低复杂度-解耦-componentsllm-setting-itemsuse-watch-changets)

- [x] T002 [中复杂度] 解耦 `src/components/knowledge-base-item.tsx`(hook 泄漏)
  - **采用方案 B(修订)**:调查发现 3 调用方(2 非画布走 showVariable=false)
  - 通用版本拆为 hook(`useDisableDifferenceEmbeddingDataset`)+ UI 子组件(`KnowledgeBaseSelect`)+ 画布扩展版本(`AgentKnowledgeBaseFormField`)
  - ✅ 已实施:非画布调用方零改动;[retrieval-form/next.tsx](../../src/pages/agent/form/retrieval-form/next.tsx) 改用画布扩展版本
  - 详见 [phase0-detailed-tasks.md §T002](./phase0-detailed-tasks.md#t002-中复杂度-解耦-componentsknowledge-base-itemtsx)

- [x] T003 [低复杂度] 修复 `src/components/floating-chat-widget.tsx` hook 调用 bug(hook 泄漏)
  - **⚠️ 方案 B 不可行**:chat 入口注入画布 hook 造成反向依赖(T-R3)+ 两个 hook 返回类型不一致(T-R4)
  - **采用方案 G**:阶段 0 仅修复 L138-140/L158-160 条件调用 hook 反模式;彻底解耦延后到 BFF 统一 widget API
  - ✅ 已实施:两处条件 hook 调用改为无条件调用 + TODO 注释;SC-002 豁免 `floating-chat-widget.tsx`
  - 详见 [phase0-detailed-tasks.md §T003](./phase0-detailed-tasks.md#t003-低复杂度-修复-componentsfloating-chat-widgettsx-hook-调用-bug)

- [x] T004 [中复杂度] 解耦 `src/components/next-message-item/group-button.tsx` + `index.tsx`(context + component 泄漏)
  - 新建 `ChatSheetContext`(`showLogSheet` / `setLastSendLoadingFunc` / `setDerivedMessages` / `timelineRenderer`)
  - `WorkFlowTimeline` 用 render prop 注入,保持 next-message-item 通用性
  - ✅ 已实施:新建 [chat-sheet-context.ts](../../src/components/next-message-item/chat-sheet-context.ts),画布 [canvas/index.tsx](../../src/pages/agent/canvas/index.tsx) 添加 Provider
  - 详见 [phase0-detailed-tasks.md §T004](./phase0-detailed-tasks.md#t004-中复杂度-解耦-componentsnext-message-itemindexgroup-buttexts)

- [x] T005 [中复杂度] 解耦 `src/components/metadata-filter/metadata-filter-conditions.tsx`(component 泄漏)
  - **⚠️ 前置**:`PromptEditor` import 画布 constant(`JsonSchemaDataType`),需先处理
  - 修订:先调查 PromptEditor 依赖(T005.1)→ 处理 constant → 提升 PromptEditor
  - ✅ 已实施:PromptEditor 提升到 [src/components/prompt-editor/](../../src/components/prompt-editor/),画布原位置改为 wrapper(22 处调用方零改动)
  - 详见 [phase0-detailed-tasks.md §T005](./phase0-detailed-tasks.md#t005-中复杂度-解耦-componentsmetadata-filtermetadata-filter-conditionstsx--prompteditor-提升)

### Checkpoint(阶段 0)

> 详见 [phase0-detailed-tasks.md §T006](./phase0-detailed-tasks.md#t006-checkpoint-阶段-0-验证) + [§T007 评审修复](./phase0-detailed-tasks.md#t007-评审修复-代码评审问题修复2026-07-13)

- [x] T006.1 `npx tsc --noEmit -p tsconfig.json` 零新增错误(仅 5 个预存错误,与本次改动无关)
- [x] T006.2 `npm test` — 20 个 suite 失败,均为预存的 `import.meta.glob is not a function` 环境问题(Jest 不支持 Vite glob),与本次改动无关
- [x] T006.3 `grep -rn "from '@/pages/agent" src/components/ | grep -v floating-chat-widget` 返回空(T003 方案 G 豁免 floating-chat-widget)
- [x] T006.4 `grep -rn "useGraphStore" src/components/` 返回空
- [x] T006.5 `grep -rn "AgentFormContext\|AgentChatContext" src/components/` 返回空
- [ ] T006.6 画布冒烟测试(完整流程:列表→创建→编辑 DSL→保存→执行→查看日志→分享页)— 待手工验证
- [ ] T006.7 非画布功能回归(若 T002/T003 保留通用版本)— 待手工验证

### 评审修复(阶段 0)

> 详见 [phase0-code-review.md §四 修复记录](./phase0-code-review.md)

- [x] T007 代码评审问题修复(7 项发现:Q1-Q6 + S1,2026-07-13)
  - Q1:`timelineRenderer` 类型 `unknown` → `TimelineRenderData` 接口 ✅
  - Q2:`queryVariableOptions as any` → 精确类型断言 + 泛型化 ✅(部分修复,遗留 options 内对象类型)
  - Q3:`floating-chat-widget as any` 添加 TODO(T-R4) 注释 ✅
  - Q4:确认 hook 双重执行副作用 + 添加 TODO 注释 ✅
  - Q5:`knowledge-base-form-field` 变量命名遮蔽修复 ✅
  - Q6:`timelineRenderer` 用 `useCallback` 包裹 ✅
  - S1:`useFormSync` / `useChatSheet` 添加 DEV 环境警告 ✅

---

## 阶段 1:包结构搭建(依赖阶段 0)

**目标**:创建 `packages/canvas-plugin/` 骨架,配置 monorepo workspace,打通开发期编译链路。

> **⚠️ 详细任务见 [phase1-detailed-tasks.md](./phase1-detailed-tasks.md)**(含前置调查、依赖清单、子任务拆分、验证步骤、风险矩阵)
>
> **可与 spec/008 并行**:本阶段不依赖 BFF `/api/bff/canvas/*`

- [x] T010 [P] 创建 `packages/canvas-plugin/package.json`
  - `name: "@agentui/canvas-plugin"`
  - `private: true`(阶段 1 不发布)
  - `main: "src/index.ts"`(源码直接引用,无构建步骤)
  - `peerDependencies`: react / react-router / @tanstack/react-query / react-i18next / zustand / @xyflow/react
  - `dependencies`: human-id / eventsource-parser / immer

- [x] T011 [P] 创建 `packages/canvas-plugin/tsconfig.json`
  - `extends: "../../tsconfig.json"`
  - `compilerOptions.paths`: 映射 `@/*` 到 `../../src/*`(引用主应用通用层)

- [x] T012 [P] 创建 `packages/canvas-plugin/jest.config.ts`
  - 沿用根 jest 配置,`moduleNameMapper` 映射 `@agentui/canvas-plugin` 到 `src/`
  - `rootDir: src`

- [x] T013 修改根 `package.json`,`workspaces` 扩展为 `["bff", "packages/*"]`

- [x] T014 修改根 `tsconfig.json`,新增 paths:
  - `"@agentui/canvas-plugin": ["./packages/canvas-plugin/src"]`
  - `"@agentui/canvas-plugin/*": ["./packages/canvas-plugin/src/*"]`

- [x] T015 修改 `vite.config.ts`,新增 resolve.alias:
  - `'@agentui/canvas-plugin': resolve(__dirname, 'packages/canvas-plugin/src')`
  - 保留现有 `@` alias

- [x] T016 创建 `packages/canvas-plugin/src/index.ts` 占位(导出空 `ModuleDefinition`)

- [x] T017 创建 `src/features/canvas/manifest.ts` 薄封装:
  ```typescript
  export { default } from '@agentui/canvas-plugin';
  ```
  - 验证 `_registry.ts` 自动发现 `features/canvas/manifest.ts`(暂为空 module,不影响现有功能)

### Checkpoint(阶段 1)

- [x] T018 运行 `npm install`,确认 workspace 解析成功
- [x] T019 运行 `npx tsc --noEmit -p tsconfig.json`,确认零错误
- [x] T020 运行 `npm run dev`,确认主应用正常启动(画布功能仍由 `features/agents` 提供)
- [x] T021 运行 `cd packages/canvas-plugin && npx tsc --noEmit`,确认插件包独立编译通过

---

## 阶段 2:代码迁移(依赖阶段 1 + spec/008 完成)

**目标**:将画布代码从 `src/pages/agent/` 物理迁入 `packages/canvas-plugin/src/`,拆分共用的 service/hook/manifest。

**⚠️ CRITICAL**: 本阶段硬依赖 spec/008 完成,否则画布插件无法调用 `/api/bff/canvas/*`。

> **⚠️ 详细任务见 [phase2-detailed-tasks.md](./phase2-detailed-tasks.md)**(含前置调查、文件归属清单、子任务拆分、URL 映射、风险矩阵)
>
> **关键调查结论**:
> - `agent-service.ts`:21 个画布方法迁入插件,5 个 agent 列表方法保留主应用
> - `use-agent-request.ts`:24 个画布 hook 迁入插件,8 个 agent 列表 hook 保留主应用
> - `constants/agent.tsx`:画布专属常量迁入插件,`AgentCategory`/`AgentQuery` 共享保留主应用
> - `interfaces/database/agent.ts`:绝大多数类型迁入插件,`IFlow`/`IPipeLineListRequest` 共享保留主应用
> - i18n `flow.*` 子树从全局 locale 迁入插件,`agents.*` 保留主应用

### 2.1 核心迁移

- [x] T022 迁移 `src/pages/agent/` → `packages/canvas-plugin/src/editor/`(整体物理迁移)
  - 包括:canvas/、form/、form-sheet/、run-sheet/、log-sheet/、chat/、explore/、share/、hooks/、constant/、utils/、store.ts、context.ts、hooks.tsx、interface.ts 等
  - 更新内部 import 路径(相对路径不变,`@/` alias 仍指向主应用通用层)
  - 验证:`tsc --noEmit` 通过

- [x] T023 迁移画布类型 `src/interfaces/database/agent.ts` → `packages/canvas-plugin/src/types/`
  - `IntellectNodeType` / `BaseNode` / `IRagNode` / `IFlow` / `IFlowTemplate` / `ITraceData` / `IAgentLogResponse` 等
  - 评估:agent 列表也用的类型保留在主应用,画布专属类型迁入插件
  - 若有共享类型,主应用保留权威源,插件 re-export

- [x] T024 迁移 `src/interfaces/request/agent.ts` 画布部分 → 插件 `types/`
  - `IAgentWebhookTraceRequest` / `IDebugSingleRequestBody` 等

- [ ] T025 迁移画布 i18n `src/features/agents/locales/{en,zh}.ts` 画布部分 → `packages/canvas-plugin/src/i18n/`
  - 拆分 `flow.*` 命名空间到插件,`agents.*` 命名空间保留主应用
  - 更新 `features/agents/manifest.ts` 的 i18n 配置

### 2.2 Service 拆分

- [ ] T026 拆分 `src/services/agent-service.ts` — 画布方法迁入插件
  - 迁入插件的方法:`getAgent`(画布详情)、`createAgent`、`fetchVersionList`、`fetchVersion`、`resetAgent`、`agentChatCompletion`、`listAgentTemplate`、`testDbConnect`、`getInputElements`、`debugSingle`、`uploadAgentFile`、`trace`、`inputForm`、`fetchAgentLogs`、`fetchExternalAgentInputs`、`fetchPrompt`、`cancelDataflow`、`cancelCanvas`、`createAgentSession`、`fetchWebhookTrace`
  - 保留主应用的方法:`listAgents`(agent 列表)、`deleteAgent`(若 agent 列表用)
  - 在插件创建 `packages/canvas-plugin/src/service/canvas-service.ts`,URL 改为 `/api/bff/canvas/*`(依赖 spec/008)

- [ ] T027 拆分 `src/hooks/use-agent-request.ts` — 画布 hooks 迁入插件
  - 迁入:`useFetchAgent`、`useSetAgent`、`useResetAgent`、`useFetchAgentTemplates`、`useFetchVersionList`、`useFetchVersion`、`useUploadAgentFile`、`useFetchMessageTrace`、`useFetchWebhookTrace`、`useTestDbConnect`、`useDebugSingle`、`useFetchInputForm`、`useFetchAgentLog`、`useFetchExternalAgentInputs`、`useFetchPrompt`、`useCancelDataflow`、`useCancelConversation`、`useCreateAgentSession`、`useDeleteAgentSession`、`useFetchAgentTags`、`useUpdateAgentTags`
  - 保留主应用:`useFetchAgentListByPage`、`useFetchAllAgentList`、`useFetchAgentList`、`useDeleteAgent`(agent 列表用)
  - 在插件创建 `packages/canvas-plugin/src/service/canvas-hooks.ts`

### 2.3 Manifest 拆分

- [x] T028 拆分 `src/features/agents/manifest.ts` — 画布路由迁入插件
  - 迁入插件的路由:`/agent/:id`(画布编辑器)、`/agent/:id/explore`、`/agent/share`(画布分享)、`/agent-log-page/:id`
  - 保留主应用的路由:`/agent-list`、`/agents`、`/agent-templates`(agent 列表/模板)
  - 在 `packages/canvas-plugin/src/index.ts` 实现完整 `ModuleDefinition`:
    - `name: 'canvas'`
    - `enabled: (ctx) => ctx.capabilities.has('canvas')`(能力门控)
    - `routes: [/* 画布路由 */]`
    - `nav: [/* 画布导航项 */]`
    - `i18n: { namespaces: ['canvas'], lazy: {/* ... */} }`

- [x] T029 迁移 `src/components/canvas/background.tsx` → `packages/canvas-plugin/src/editor/`
  - 画布专属背景组件

- [x] T030 迁移 `src/components/xyflow/` → `packages/canvas-plugin/src/editor/`
  - `base-node.tsx` / `tooltip-node.tsx`(画布专属共享节点)

- [x] T031 迁移 `src/utils/canvas-util.tsx` → `packages/canvas-plugin/src/editor/utils/`
  - `filterAllUpstreamNodeIds` / `buildOutputOptions` 等画布工具函数

- [ ] T032 迁移 `src/constants/agent.tsx` 画布专属常量 → 插件 `constant/`
  - 评估 `AgentCategory` / `AgentGlobals` / `AgentStructuredOutputField` 是否画布专属

### Checkpoint(阶段 2)

- [ ] T033 运行 `npx tsc --noEmit -p tsconfig.json`,确认主应用零错误
- [ ] T034 运行 `cd packages/canvas-plugin && npx tsc --noEmit`,确认插件包零错误
- [ ] T035 运行 `npm test`,确认全部测试通过
- [ ] T036 验证 `src/pages/agent/` 目录已清空(或仅剩 README)
- [ ] T037 验证 `grep -r "pages/agent" src/components/` 返回空(SC-002)

---

## 阶段 3:验证与收尾(依赖阶段 2)

**目标**:端到端验证,确保零回归 + 能力门控生效 + 文档同步。

### 3.1 功能验证

- [ ] T038 [P] 画布冒烟测试(完整流程,SC-003):
  - T038.1 列表画布 → 创建画布 → 编辑 DSL(含 LLM/Retrieval/Code/Agent 算子)
  - T038.2 保存画布 → 重新打开,验证 DSL 逐字段一致
  - T038.3 执行调试 → 验证 SSE 流式响应 + WorkFlowTimeline 渲染
  - T038.4 上传附件 → 验证文件上传 + 引用
  - T038.5 查看 trace → 验证 trace 数据完整
  - T038.6 列出版本 → 验证版本列表 + 单版本详情
  - T038.7 重置画布 → 验证重置后状态
  - T038.8 分享页 → 验证 `/agent/share` 页面功能(Thinking 折叠 + 发送消息)
  - T038.9 webhook → 验证 webhook trace 页面

- [ ] T039 [P] 验证能力门控(SC-004):
  - T039.1 配置 BFF `/api/bff/capabilities` 返回 `canvas: false`
  - T039.2 启动前端,验证画布导航入口隐藏
  - T039.3 直接访问 `/agent/:id`,验证降级渲染(`fallback` 或 404)
  - T039.4 恢复 `canvas: true`,验证画布功能恢复

- [ ] T040 [P] 验证非画布功能零回归(SC-007):
  - T040.1 agent 列表页(`/agents`)正常 — 列表/筛选/分页/标签
  - T040.2 agent 模板页(`/agent-templates`)正常
  - T040.3 agent 日志页(`/agent-log-page/:id`)正常
  - T040.4 其他 features(datasets/memory/search/chats 等)正常
  - T040.5 next-search 设置页知识库选择(T002 通用版本)
  - T040.6 next-chats 设置页知识库选择(T002 通用版本)
  - T040.7 widget(`/chats/widget?from=agent` 和 `from=chat`)— T003 bug 修复验证

### 3.2 测试与 API 验证

- [ ] T041 [P] 验证插件包独立测试(SC-010):
  - T041.1 `cd packages/canvas-plugin && npm test` 通过
  - T041.2 确认画布相关测试在插件包内通过(无主应用依赖)
  - T041.3 确认主应用 `npm test` 通过(画布测试已迁出,无重复执行)

- [ ] T042 [P] 验证所有画布 API 经 `/api/bff/canvas/*`(SC-008):
  - T042.1 打开浏览器 DevTools Network
  - T042.2 执行画布冒烟流程(T038)
  - T042.3 确认所有画布请求路径前缀为 `/api/bff/canvas/`(无 `/api/v1/agents/` 或 `/api/bff/proxy/v1/agents/`)
  - T042.4 确认 SSE 流式响应正常(Canvas Workflow SSE)

### 3.3 清理与文档

- [ ] T043 清理 `src/pages/agent/` 目录(确认空后删除)
  - T043.1 验证 `src/pages/agent/` 目录已清空
  - T043.2 `git rm -r src/pages/agent/`(若存在空目录)
  - T043.3 更新 `tsconfig.json` include/exclude(若需要)

- [ ] T044 [P] 更新 `docs/frontend-architecture.md`,新增"画布插件"章节
  - T044.1 描述画布插件架构(`packages/canvas-plugin/` 结构)
  - T044.2 描述 module system 集成方式
  - T044.3 描述能力门控机制
  - T044.4 描述与 spec/008 BFF CanvasService 的关系

- [ ] T045 [P] 更新 `docs/multi-harness-design.md` §10,新增"Canvas Plugin Extraction"实施记录
  - T045.1 记录 4 阶段实施过程
  - T045.2 记录关键决策(复用 ModuleDefinition、不抽离共享 UI 等)
  - T045.3 记录遗留项(Q2 残留、Q3/T-R4、Q4 副作用)

- [ ] T046 更新 `src/features/agents/manifest.ts`,移除已迁出的画布路由
  - T046.1 仅保留 agent 列表/模板路由(SC-009)
  - T046.2 移除 `AgentRoutes` 中画布相关常量
  - T046.3 验证 `features/agents` module 正常加载

- [ ] T047 git commit + tag `canvas-plugin-extraction-v1`
  - T047.1 提交所有改动
  - T047.2 创建 tag `canvas-plugin-extraction-v1`
  - T047.3 更新 spec.md 状态为"已完成"

### Final Checkpoint

- [ ] T048 SC-001:`src/pages/agent/` 目录删除,画布代码全部迁入 `packages/canvas-plugin/`
- [ ] T049 SC-002:`src/components/` 下无任何文件 import `@/pages/agent/*`
- [ ] T050 SC-003:画布冒烟测试 100% 通过
- [ ] T051 SC-004:`capabilities.canvas=false` 时画布入口隐藏
- [ ] T052 SC-005:`tsc --noEmit` 零错误
- [ ] T053 SC-006:`npm test` 全部通过
- [ ] T054 SC-007:非画布功能 100% 不回归
- [ ] T055 SC-008:所有画布 API 经 `/api/bff/canvas/*`
- [ ] T056 SC-009:`features/agents/manifest.ts` 仅保留 agent 列表/模板路由
- [ ] T057 SC-010:`packages/canvas-plugin/` 可独立运行 `npm test`

---

## 阶段 4(可选,延后):独立构建与发布

**目标**:画布插件独立构建为 npm 包,支持外部加载。仅在需要独立发版时实施。

- [ ] T058 配置 `packages/canvas-plugin/vite.config.ts`(library mode)
  - `build.lib`: entry 为 `src/index.ts`,formats 为 `['es']`
  - `rollupOptions.external`: react / react-dom / @tanstack/react-query / @xyflow/react 等 peerDependencies

- [ ] T059 配置 `packages/canvas-plugin/package.json` 构建脚本:
  - `"build": "vite build"`
  - `"main": "dist/index.js"`(切换到构建产物)

- [ ] T060 验证主应用引用构建产物(而非源码)
  - 修改 `tsconfig.json` paths 指向 `dist/`
  - 修改 `vite.config.ts` alias 指向 `dist/`
  - 运行主应用,验证画布功能正常

- [ ] T061(可选)发布到内部 npm registry

---

## 依赖关系与执行顺序

### Phase Dependencies

- **阶段 0(解耦)**: 无依赖,可与 spec/008 并行
- **阶段 1(包结构)**: 依赖阶段 0(泄漏已解耦),可与 spec/008 并行
- **阶段 2(代码迁移)**: 依赖阶段 1 + spec/008 完成(**硬依赖**)
- **阶段 3(验证收尾)**: 依赖阶段 2
- **阶段 4(独立构建)**: 可选,依赖阶段 3,延后实施

### Critical Path

```
阶段 0(T001-T005 解耦) → 阶段 1(T010-T017 包结构) → spec/008 完成 → 阶段 2(T022-T032 迁移) → 阶段 3(T038-T047 验证)
```

### Parallel Opportunities

- 阶段 0 内部:T001/T002/T003/T004/T005 可并行(不同文件)
- 阶段 0 ∥ spec/008 实施可并行
- 阶段 1 内部:T010/T011/T012 可并行(不同配置文件)
- 阶段 2 内部:2.1/2.2/2.3 部分可并行(不同文件)

---

## Notes

- 本方案是 [canvas-plugin-extraction-design.md](../../docs/canvas-plugin-extraction-design.md) 的任务拆分,实施前请先阅读设计文档
- 阶段 0 的解耦工作本身有价值(改善代码质量),即使后续不实施画布插件化也建议完成
- 阶段 2 硬依赖 spec/008,若 spec/008 延期,阶段 0/1 可先行,阶段 2 待 spec/008 就绪后启动
- 阶段 4 为可选项,当前阶段不实施(YAGNI),仅在出现独立发版需求时启动
