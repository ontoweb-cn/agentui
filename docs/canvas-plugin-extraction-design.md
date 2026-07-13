# Canvas Plugin Extraction — 技术方案(评审后)

> **Status**: 阶段 0 已实施完成(2026-07-13,含评审修复 T007),阶段 1-4 待实施
> **Date**: 2026-07-13
> **Prerequisites**: spec/008-explicit-canvas-service(BFF CanvasService 独立化)
> **Related**: [multi-harness-design.md](./multi-harness-design.md) §3.4 / §6.4

## 一、背景与目标

### 1.1 问题陈述

当前画布(Canvas)功能高度内聚于 `src/pages/agent/`(30+ hook、27+ 节点、30+ 算子表单),但存在以下问题:

1. **BFF 端画布入口分散**:寄生在 `bff-agents.ts` 的 `passthrough()` 与 `proxy.ts` catch-all 上,语义混淆(spec/008 正在解决)
2. **前端画布与 agent 列表耦合**:共用 `features/agents/manifest.ts`、`agent-service.ts`、`use-agent-request.ts`,未按 canvas/agent 维度切分
3. **画布内部细节泄漏到通用组件层**:6 个 `components/` 下的文件直接 import 画布的 store/hook/context/组件
4. **无法独立替换/扩展**:画布代码随主应用一起发版,无法按需启用/禁用或替换为第三方实现

### 1.2 目标

- **解耦**:消除画布内部细节(store/hook/context)向 `components/` 的泄漏
- **内聚**:画布代码物理迁入独立包 `packages/canvas-plugin/`,形成清晰边界
- **可插拔**:复用现有 `features/_registry.ts` module system,画布作为可启用/禁用的 module
- **零回归**:画布功能行为与迁移前 100% 一致

### 1.3 非目标(YAGNI)

- ❌ 不引入完整插件协议(`PluginHostContext` / `PluginModule` 契约)— 复用现有 `ModuleDefinition`
- ❌ 不做外部 npm 包动态加载 — 阶段 1 仅做 monorepo 内置包
- ❌ 不抽离共享 UI 组件库为独立包 — 工作量过大,收益不匹配
- ❌ 不实现跨插件通信机制 — 当前仅画布一个候选插件

## 二、技术评审记录

> 本节记录对初版方案(完整插件化)的评审意见,作为最终方案选型依据。

### 2.1 评审发现 1:过度设计 — 重复造轮子

**问题**:初版方案设计了一套独立的 `PluginHostContext` / `PluginModule` / `PluginRegistry` 插件协议,但项目**已有**完整的 module system:

- [features/_registry.ts](../src/features/_registry.ts) — 模块发现、能力检查、路由/导航/i18n 收集
- [features/_types.ts](../src/features/_types.ts) — `ModuleDefinition` 接口(含 `enabled`/`routes`/`nav`/`i18n`/`providers`/`init`)
- `ModuleContext` 已包含 `isEnterprise` + `capabilities: Set<string>`,支持能力门控
- 已有 6 个 feature agents/chats/datasets/files/memories/searches 使用此机制

**结论**:废弃独立插件协议,复用现有 `ModuleDefinition`。画布插件只需实现 `ModuleDefinition` 接口即可被 `_registry.ts` 加载。

### 2.2 评审发现 2:泄漏评估不准确

**问题**:初版方案称"`useGraphStore` 泄漏到 8 个外部文件",实际核实:

| 文件 | 泄漏类型 | 严重程度 |
|---|---|---|
| `components/llm-setting-items/use-watch-change.ts` | `useGraphStore` + `AgentFormContext` | 高(store + context) |
| `components/knowledge-base-item.tsx` | `useBuildQueryVariableOptions`(画布 hook) | 中(hook) |
| `components/floating-chat-widget.tsx` | `useSendNextSharedMessage`(画布 hook) | 中(hook) |
| `components/next-message-item/group-button.tsx` | `AgentChatContext` | 中(context) |
| `components/next-message-item/index.tsx` | `AgentChatContext` + `WorkFlowTimeline` | 中(context + 组件) |
| `components/metadata-filter/metadata-filter-conditions.tsx` | `PromptEditor`(画布组件) | 低(组件) |

**实际**:6 个文件泄漏,类型多样(store/hook/context/component),非单一 store 泄漏。解耦需针对每种类型设计对应方案。

### 2.3 评审发现 3:共享层抽离成本过高

**问题**:初版方案提议抽离 `packages/shared-ui/`(原 `components/ui/`),但:
- `components/ui/` 含 50+ 组件(button/dialog/sheet/table/form/...)
- 画布几乎使用全部 UI 组件
- 抽离需处理 peerDependencies、类型导出、样式隔离、tree-shaking
- 工作量巨大(预估 2-3 周),且收益仅服务于"画布独立"单一目标

**结论**:废弃共享 UI 包抽离。画布插件通过 monorepo workspace 直接引用主应用 `components/ui/`(alias 方式),不强制物理隔离 UI 层。

### 2.4 评审发现 4:monorepo 基础设施已就绪

**核实**:[package.json](../package.json) 已配置 `"workspaces": ["bff"]`,npm workspaces 机制可用。

**结论**:扩展 `workspaces` 到 `["bff", "packages/*"]` 即可,无需引入 pnpm/turborepo(增加复杂度,YAGNI)。继续用 npm workspaces。

### 2.5 评审发现 5:测试框架不一致

**核实**:前端用 jest([jest.config.ts](../jest.config.ts)),BFF 用 vitest([bff/vitest.config.ts](../bff/vitest.config.ts))。

**风险**:画布插件独立后,需选择测试框架。若选 jest(与前端一致),则插件需自带 jest 配置;若选 vitest(更现代),则与前端不一致。

**结论**:画布插件沿用 jest(与前端一致),配置独立 `jest.config.ts`。后续可统一迁移到 vitest(独立任务)。

### 2.6 评审发现 6:spec/008 是硬前置

**核实**:spec/008-explicit-canvas-service 尚未实施(无 tasks.md,无 `canvas-service.ts`)。

**结论**:前端画布插件化的"物理迁移"阶段(阶段 3)依赖 spec/008 完成,否则画布插件无法独立调用 BFF `/api/bff/canvas/*`。但"解耦"阶段(阶段 1)和"包结构搭建"阶段(阶段 2)可与 spec/008 并行。

## 三、最终方案

### 3.1 架构概览

```
agentui/                          (monorepo root, npm workspaces)
├── package.json                  workspaces: ["bff", "packages/*"]
├── src/                          主应用(Shell + 其他 features)
│   ├── features/_registry.ts     复用现有 module system(不改动)
│   ├── features/canvas/          画布 module 入口(薄封装,指向 packages/canvas-plugin)
│   ├── components/ui/            UI 组件库(不抽离,画布通过 alias 引用)
│   └── ...
├── packages/
│   └── canvas-plugin/            画布独立包
│       ├── package.json          name: @agentui/canvas-plugin
│       ├── tsconfig.json         extends root
│       ├── jest.config.ts        独立测试配置
│       ├── src/
│       │   ├── index.ts          导出 ModuleDefinition
│       │   ├── manifest.ts       画布 module 定义(routes/nav/i18n/enabled)
│       │   ├── editor/           原 pages/agent/(整体迁入)
│       │   ├── service/          画布 API client(调 /api/bff/canvas/*)
│       │   ├── types/            画布类型(原 interfaces/database/agent.ts)
│       │   └── i18n/             画布国际化(原 features/agents/locales/)
│       └── README.md
└── bff/                          BFF(独立 workspace,已存在)
```

### 3.2 关键设计决策

| 决策点 | 选型 | 理由 |
|---|---|---|
| 插件协议 | 复用 `ModuleDefinition` | 项目已有,避免重复造轮子(评审发现 1) |
| 物理结构 | monorepo `packages/canvas-plugin/` | npm workspaces 已就绪(评审发现 4) |
| UI 组件共享 | 主应用 alias 引用,不抽离共享包 | 成本过高(评审发现 3) |
| 状态管理 | `useGraphStore` 随画布迁入,内部封装不导出 | 消除泄漏(评审发现 2) |
| API client | 画布插件自带 `canvas-service.ts`,调 `/api/bff/canvas/*` | 依赖 spec/008(评审发现 6) |
| 测试框架 | jest(与前端一致) | 一致性(评审发现 5) |
| 构建方式 | 随主应用一起编译(非独立构建) | 阶段 1 简化,延后独立构建 |

### 3.3 复用现有 Module System

画布插件实现 `ModuleDefinition` 接口,被 `_registry.ts` 自动发现:

```typescript
// packages/canvas-plugin/src/index.ts
import type { ModuleDefinition } from '@agentui/features-types';  // 从 _types.ts 导出

const canvasModule: ModuleDefinition = {
  name: 'canvas',
  order: 40,
  enabled: (ctx) => ctx.capabilities.has('canvas'),  // 能力门控
  routes: [/* 原 features/agents/manifest.ts 的画布路由 */],
  nav: [/* 画布导航项 */],
  i18n: { namespaces: ['canvas'], lazy: {/* ... */} },
  init: (ctx) => { /* 初始化 canvas service */ },
};

export default canvasModule;
```

```typescript
// src/features/canvas/manifest.ts(薄封装,指向独立包)
export { default } from '@agentui/canvas-plugin';
```

`_registry.ts` 的 `import.meta.glob('./*/manifest.ts', { eager: true })` 自动发现 `features/canvas/manifest.ts`,无需改动 registry 代码。

### 3.4 泄漏解耦方案

> **详细任务与评审**:见 [specs/009-canvas-plugin-extraction/phase0-detailed-tasks.md](../specs/009-canvas-plugin-extraction/phase0-detailed-tasks.md)
> **T002/T003 调查与评审**:见 [phase0-t002-t003-investigation.md](../specs/009-canvas-plugin-extraction/phase0-t002-t003-investigation.md) + [phase0-t002-t003-review.md](../specs/009-canvas-plugin-extraction/phase0-t002-t003-review.md)

针对 6 个泄漏文件,按类型设计解耦方案(已含 T002/T003 调查与评审结论):

#### 类型 A:Store 泄漏(1 个文件)— T001

**文件**:`components/llm-setting-items/use-watch-change.ts`

**方案**:定义通用 `FormSyncContext`,画布在 FormSheet 内提供实现:

```typescript
// src/components/llm-setting-items/form-sync-context.ts(新建,通用接口)
export interface FormSyncContextValue {
  updateField: (path: string, value: unknown) => void;
}
export const FormSyncContext = createContext<FormSyncContextValue | null>(null);
export const useFormSync = () => useContext(FormSyncContext);

// 画布侧提供实现(画布内部,不外泄):
// packages/canvas-plugin/src/editor/form-sheet/next.tsx
const updateField = useGraphStore((s) => s.updateNodeForm);
<FormSyncContext.Provider value={{ updateField }}>
  <OperatorForm />
</FormSyncContext.Provider>

// 通用组件改造:
// components/llm-setting-items/use-watch-change.ts
const { updateField } = useFormSync();  // 不再直接 import useGraphStore
```

#### 类型 B-1:Hook 泄漏 — T002(方案 B 修订)

**文件**:`components/knowledge-base-item.tsx`

**调查结论**:3 个调用方,其中 2 个非画布调用方(next-search、next-chats)走 `showVariable=false`,不触发画布 hook。

**评审结论**:
- T-R1:`buildQueryVariableOptionsByShowVariable` 是 Rules of Hooks 反模式,需移除
- T-R2:采用 B1 设计(hook + UI 子组件拆分)

**方案(评审后)**:通用版本拆为 hook + UI 子组件,画布扩展版本调用两者:

```
src/components/knowledge-base-item.tsx (通用,改造):
├── useDisableDifferenceEmbeddingDataset (导出,不变)
├── KnowledgeBaseSelect (新增,UI 子组件,接收 options)
└── KnowledgeBaseFormField (改造,移除 showVariable + 反模式,仅 datasetOptions)

src/pages/agent/form/components/knowledge-base-form-field.tsx (画布,新建):
└── AgentKnowledgeBaseFormField
    ├── 调用 useDisableDifferenceEmbeddingDataset (从通用导出)
    ├── 调用 useBuildQueryVariableOptions (画布 hook)
    ├── 合并 options
    └── 渲染 KnowledgeBaseSelect (通用 UI 子组件)
```

非画布调用方零改动(继续 import 通用版本,无 showVariable)。

#### 类型 B-2:Hook 泄漏 — T003(方案 G,仅修 bug)

**文件**:`components/floating-chat-widget.tsx`

**调查结论**:widget 仅在 `features/chats` 注册(`/chats/widget`),通过 URL 参数 `from=agent|chat` 复用,同时服务两种场景;chat 版 hook 无画布依赖,agent 版深度依赖画布。

**评审结论**:
- T-R3:方案 B(props 注入)会造成 chats → agent 反向依赖,不可行
- T-R4:两个 hook 返回类型差异巨大,无法定义统一 props 接口

**方案(评审后)**:**方案 G — 阶段 0 仅修复 hook 调用 bug,彻底解耦延后**:
- 阶段 0 仅修复 [floating-chat-widget.tsx](../src/components/floating-chat-widget.tsx) L138-140 / L158-160 的条件 hook 调用反模式
- 改为两个 hook 都调用,根据 `isFromAgent` 选择结果
- widget 彻底解耦依赖 BFF 统一 widget API(方案 F):
  - `/api/bff/widget/{id}/inputs` — 统一获取 inputs(BFF 内部按 from 路由)
  - `/api/bff/widget/{id}/completions` — 统一发送消息(BFF 内部按 from 路由)
- 留到 spec/008 后续或独立 spec 处理

**注意**:`floating-chat-widget.tsx` 在阶段 0 后仍有 `pages/agent` import(已知泄漏,SC-002 豁免,待 BFF 统一后解决)。

#### 类型 C:Context 泄漏(2 个文件)— T004

**文件**:`components/next-message-item/{index,group-button}.tsx`

**方案**:将 `AgentChatContext` 提升为通用 `ChatSheetContext`,定义在 `src/components/next-message-item/`:

```typescript
// src/components/next-message-item/chat-sheet-context.ts(通用接口)
export interface ChatSheetContextValue {
  showLogSheet: (messageId: string) => void;
  setLastSendLoadingFunc: (fn: () => void) => void;
  setDerivedMessages: (msgs: unknown[]) => void;
}
export const ChatSheetContext = createContext<ChatSheetContextValue | null>(null);
```

画布侧提供实现,通用组件消费通用 context。`WorkFlowTimeline` 用 render prop 注入,保持 next-message-item 通用性。

#### 类型 D:组件泄漏(1 个文件)— T005

**文件**:`components/metadata-filter/metadata-filter-conditions.tsx` import `PromptEditor`

**方案**:将 `PromptEditor` 提升到 `src/components/prompt-editor/`(通用富文本编辑器),画布 form/components/prompt-editor 改为引用通用版。需先处理 `PromptEditor` 对画布 constant(`JsonSchemaDataType`)的依赖(评审发现 R4)。

### 3.5 BFF 端配合(依赖 spec/008)

前端画布插件化依赖 spec/008 完成:

| spec/008 交付物 | 画布插件消费方 |
|---|---|
| `/api/bff/canvas/*` 路由 | `packages/canvas-plugin/src/service/canvas-service.ts` |
| `CanvasService` 服务层 | 画布 API client 调用入口 |
| `BffTenant.canvasBackendId` 路由 | 企业版租户画布隔离 |
| `/api/bff/capabilities` 返回 `canvas: boolean` | `ModuleDefinition.enabled` 能力门控 |

```typescript
// packages/canvas-plugin/src/service/canvas-service.ts
const BFF_CANVAS = '/api/bff/canvas';

export const canvasService = {
  list: () => apiClient.get(`${BFF_CANVAS}`),
  get: (id: string) => apiClient.get(`${BFF_CANVAS}/${id}`),
  save: (id: string, dsl: unknown) => apiClient.put(`${BFF_CANVAS}/${id}`, dsl),
  execute: (id: string, body: unknown) => apiClient.stream(`${BFF_CANVAS}/${id}/execute`, body),
  upload: (id: string, formData: FormData) => apiClient.post(`${BFF_CANVAS}/${id}/upload`, formData),
  // ... 对齐 spec/008 FR-004 子路径清单
};
```

## 四、实施路线图

### 阶段 0:前置(可与 spec/008 并行)

> **详细任务**:见 [specs/009-canvas-plugin-extraction/phase0-detailed-tasks.md](../specs/009-canvas-plugin-extraction/phase0-detailed-tasks.md)(T001-T006)

| 任务 | 依赖 | 说明 |
|---|---|---|
| T001. 反向解耦 `use-watch-change.ts`(类型 A:Store 泄漏) | 无 | 新建 `FormSyncContext`,画布提供实现 |
| T002. 反向解耦 `knowledge-base-item.tsx`(类型 B-1:Hook 泄漏) | 无 | 方案 B(修订):通用版本拆为 hook + UI 子组件 + 画布扩展版本;非画布调用方零改动 |
| T003. 修复 `floating-chat-widget.tsx` hook 调用 bug(类型 B-2:Hook 泄漏) | 无 | 方案 G:仅修 bug,彻底解耦延后到 BFF 统一 widget API;SC-002 豁免此文件 |
| T004. 反向解耦 `next-message-item`(类型 C:Context 泄漏) | 无 | 新建 `ChatSheetContext`,`WorkFlowTimeline` 用 render prop 注入 |
| T005. 提升 `PromptEditor` + 解耦 `metadata-filter`(类型 D:组件泄漏) | 无 | 先处理画布 constant 依赖,再提升到 `components/prompt-editor/` |
| T006. Checkpoint 验证 | T001-T005 | `tsc --noEmit` + grep 检查(豁免 floating-chat-widget)+ 冒烟测试 |

**注意**:原 0d "抽离 useBuildQueryVariableOptions / useSendNextSharedMessage 通用部分" 已废弃:
- `useBuildQueryVariableOptions`:T002 改为画布扩展版本直接调用,不抽通用部分
- `useSendNextSharedMessage`:T003 方案 G 不解耦,留到 BFF 统一 API

### 阶段 1:包结构搭建(依赖阶段 0)

| 任务 | 依赖 | 说明 |
|---|---|---|
| 1a. 创建 `packages/canvas-plugin/` 骨架 | T001-T005 | package.json + tsconfig + jest.config |
| 1b. 扩展根 `package.json` workspaces 到 `["bff", "packages/*"]` | 1a | npm workspaces |
| 1c. 配置 vite.config.ts alias `@agentui/canvas-plugin` | 1a | 开发期 alias |
| 1d. 配置 tsconfig paths | 1a | TypeScript 路径映射 |
| 1e. 创建 `src/features/canvas/manifest.ts` 薄封装 | 1a | 指向独立包 |

### 阶段 2:代码迁移(依赖阶段 1 + spec/008)

| 任务 | 依赖 | 说明 |
|---|---|---|
| 2a. 迁移 `src/pages/agent/` → `packages/canvas-plugin/src/editor/` | 1e + spec/008 | 整体物理迁移 |
| 2b. 迁移画布类型 `interfaces/database/agent.ts` → 插件 `types/` | 2a | 类型迁移 |
| 2c. 迁移画布 i18n `features/agents/locales/` 画布部分 → 插件 `i18n/` | 2a | i18n 拆分 |
| 2d. 拆分 `agent-service.ts` 画布部分 → 插件 `service/canvas-service.ts` | 2a + spec/008 | service 拆分 |
| 2e. 拆分 `use-agent-request.ts` 画布部分 → 插件 `service/canvas-hooks.ts` | 2d | React Query hooks 拆分 |
| 2f. 拆分 `features/agents/manifest.ts` — 画布路由迁入插件,agent 列表路由保留 | 2a | manifest 拆分 |
| 2g. 迁移 `components/canvas/background.tsx` + `components/xyflow/` → 插件 | 2a | 共享画布组件迁入 |

### 阶段 3:验证与收尾(依赖阶段 2)

| 任务 | 依赖 | 说明 |
|---|---|---|
| 3a. 运行 `tsc --noEmit` 零错误 | 2g | 类型检查 |
| 3b. 运行 `npm test` 全部通过 | 2g | 测试验证 |
| 3c. 画布冒烟测试(列表→编辑→保存→执行→上传→trace→版本→重置→删除) | 2g | 功能零回归 |
| 3d. 验证能力门控:`capabilities.canvas=false` 时画布入口隐藏 | 2g | 能力探测 |
| 3e. 清理 `src/pages/agent/`(确认空目录后删除) | 3c | 清理遗留 |
| 3f. 更新文档(frontend-architecture.md + multi-harness-design.md) | 3d | 文档同步 |

### 阶段 4(可选,延后):独立构建

| 任务 | 说明 |
|---|---|
| 4a. 配置 vite library mode 独立构建画布插件 | 仅在需要独立发版时实施 |
| 4b. 发布为 npm 包 | 阶段 4a 验证后 |

## 五、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| 泄漏解耦引入画布表单联动回归 | 中 | 高 | 逐个文件改造 + 充分手工冒烟 |
| 物理迁移导致 import 路径大面积失效 | 高 | 中 | 用 codemod 批量替换,分批迁移 |
| Vite alias 与 monorepo workspace 解析冲突 | 中 | 中 | 优先 workspace 解析,alias 仅开发期 |
| spec/008 延期阻塞阶段 2 | 中 | 高 | 阶段 0/1 可并行,不阻塞 |
| 画布与 agent 列表共用的类型/hook 拆分边界争议 | 中 | 中 | 按"画布专属 vs agent 通用"原则切分,有争议时保留在主应用 |
| jest 配置在 monorepo 下的模块解析问题 | 低 | 中 | 参考现有 jest.config.ts 配置 moduleNameMapper |

## 六、与现有架构对齐

### 6.1 Constitution 对齐

| Principle | 对齐情况 |
|---|---|
| I. BFF-Mediated Frontend | ✅ 画布插件调 BFF `/api/bff/canvas/*`,不直连 Intellect RAG |
| III. Canvas Hard-Bound to Intellect RAG | ✅ BFF `CanvasService` 硬绑定(spec/008),前端插件不感知后端选择 |
| VII. YAGNI + Test-First | ✅ 不引入完整插件协议(YAGNI);迁移后保留现有测试 |
| V. Tenant Isolation | ✅ 画布按 `BffTenant.canvasBackendId` 路由(spec/008 US2) |

### 6.2 与 spec/008 的关系

spec/008 解决 **BFF 端**画布服务独立化,本方案解决 **前端**画布代码独立化。两者正交:

- spec/008 阶段 1-2(BFF CanvasService + 路由)可独立完成,前端继续用 `bffAgents`/`restAPIv1` 路径
- 本方案阶段 0-1(解耦 + 包结构)可独立完成,前端继续用现有路径
- 本方案阶段 2(代码迁移)**依赖** spec/008 完成,画布插件才能调用 `/api/bff/canvas/*`

### 6.3 与现有 module system 的关系

本方案**不改动** `features/_registry.ts` 与 `_types.ts`,仅利用现有机制:

- 画布插件实现 `ModuleDefinition` 接口
- `features/canvas/manifest.ts` 作为薄封装,指向 `@agentui/canvas-plugin`
- `_registry.ts` 的 `import.meta.glob` 自动发现 `features/canvas/manifest.ts`
- `ModuleContext.capabilities` 已支持 `canvas` 能力门控

## 七、验收标准

| ID | 标准 | 验证方式 |
|---|---|---|
| SC-001 | `src/pages/agent/` 目录删除,画布代码全部迁入 `packages/canvas-plugin/` | 目录检查 |
| SC-002 | `src/components/` 下无任何文件 import `@/pages/agent/*` | `grep -r "pages/agent" src/components/` 返回空 |
| SC-003 | 画布冒烟测试(列表→编辑→保存→执行→上传→trace→版本→重置→删除)100% 通过 | 手工冒烟 |
| SC-004 | `capabilities.canvas=false` 时画布导航入口隐藏 | 配置 BFF 返回 canvas=false 验证 |
| SC-005 | `tsc --noEmit` 零错误 | 类型检查 |
| SC-006 | `npm test` 全部通过 | 测试运行 |
| SC-007 | 现有非画布功能(agent 列表/模板/日志)100% 不回归 | 冒烟测试 |
| SC-008 | 画布插件自带 `canvas-service.ts`,所有画布 API 经 `/api/bff/canvas/*` | 代码检查 + 网络请求验证 |
| SC-009 | `features/agents/manifest.ts` 仅保留 agent 列表/模板路由,画布路由迁入插件 | manifest 检查 |
| SC-010 | `packages/canvas-plugin/` 可独立运行 `npm test` | 测试运行 |

## 八、附录:泄漏文件清单(评审核实)

| # | 文件 | 泄漏类型 | import 内容 | 解耦方案 |
|---|---|---|---|---|
| 1 | `components/llm-setting-items/use-watch-change.ts` | store + context | `useGraphStore`, `AgentFormContext` | `FormSyncContext` 通用接口 |
| 2 | `components/knowledge-base-item.tsx` | hook | `useBuildQueryVariableOptions` | hook 通用部分抽到 `src/hooks/` |
| 3 | `components/floating-chat-widget.tsx` | hook | `useSendNextSharedMessage` | hook 通用部分抽到 `src/hooks/` |
| 4 | `components/next-message-item/group-button.tsx` | context | `AgentChatContext` | `ChatSheetContext` 通用接口 |
| 5 | `components/next-message-item/index.tsx` | context + component | `AgentChatContext`, `WorkFlowTimeline` | `ChatSheetContext` + 组件迁入画布 |
| 6 | `components/metadata-filter/metadata-filter-conditions.tsx` | component | `PromptEditor` | 组件提升到 `components/prompt-editor/` |
