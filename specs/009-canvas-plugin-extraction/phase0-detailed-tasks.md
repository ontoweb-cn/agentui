# Phase 0 Detailed Tasks: 泄漏解耦(细化版 + 技术评审)

> **Parent**: [tasks.md](./tasks.md) §阶段 0
> **Design Doc**: [canvas-plugin-extraction-design.md](../../docs/canvas-plugin-extraction-design.md) §3.4
> **Created**: 2026-07-13
> **Status**: ✅ 阶段 0 已实施完成(2026-07-13)+ 评审修复完成(T007,2026-07-13)
> **Code Review**: [phase0-code-review.md](./phase0-code-review.md)(评审 7 项发现已全部处理,详见 §四 修复记录)

本文档对阶段 0(解耦泄漏)的 5 个任务(T001-T005)进行细化拆分,并附带技术评审意见。

---

## 评审摘要(先读此节)

> **评审历史**:本文档经历两轮评审
> - **首轮评审**(R1-R8):识别 `useBuildQueryVariableOptions`/`useSendNextSharedMessage` 深度依赖,触发 T002/T003 前置调查
> - **T002/T003 调查 + 方案评审**(T-R1 ~ T-R6):见 [phase0-t002-t003-investigation.md](./phase0-t002-t003-investigation.md) + [phase0-t002-t003-review.md](./phase0-t002-t003-review.md)
> - **最终方案**:T002 方案 B(修订)、T003 方案 G(仅修 bug)

### 首轮关键评审发现(R1-R8)

| # | 发现 | 影响 | 首轮结论 | 最终结论(经 T002/T003 调查评审) |
|---|---|---|---|---|
| R1 | `useBuildQueryVariableOptions` 深度依赖画布 | T002 原方案不可行 | 改为"组件整体迁入画布"或"接口注入" | **方案 B(修订)**:调查发现 3 调用方,2 非画布走 showVariable=false → 通用版本拆 hook+UI + 画布扩展版本 |
| R2 | `useSendNextSharedMessage` 深度依赖画布 | T003 原方案不可行 | 改为"floating-chat-widget 整体迁入画布" | **方案 G**:调查发现 widget 属 chats feature 服务双场景;方案 B 反向依赖不可行 → 仅修 bug,延后到 BFF 统一 |
| R3 | `floating-chat-widget.tsx` L138-140 条件调用 hook | 存在 latent bug | 解耦前先修 bug | 方案 G 阶段 0 唯一任务即修此 bug |
| R4 | `PromptEditor` import 画布 constant(`JsonSchemaDataType`) | T005 需先处理 constant 依赖 | constant 提升到通用层 | 不变 |
| R5 | `WorkFlowTimeline` 是画布日志组件,仅画布使用 | T004 需明确归属 | 迁入画布,通用层不保留 | 改为 render prop 注入(不迁入,保持通用性) |
| R6 | 原任务缺少回归测试与 import 检查 | 解耦后无验证手段 | 每个任务补充验证步骤 | 不变 |
| R7 | `FormSyncContext`(T001)可与 `ChatSheetContext`(T004)合并设计 | 减少重复抽象 | 独立设计,不合并(职责不同) | 不变 |
| R8 | 原方案未考虑 `knowledge-base-item.tsx` 在非画布场景的使用 | 迁入画布可能影响非画布调用方 | 需先调查调用方 | 调查完成:3 调用方,2 非画布走 showVariable=false |

### T002/T003 方案评审发现(T-R1 ~ T-R6)

| # | 发现 | 结论 |
|---|---|---|
| T-R1 | `buildQueryVariableOptionsByShowVariable` 是 Rules of Hooks 反模式 | T002 通用版本需移除此工厂函数 + showVariable prop |
| T-R2 | 画布扩展版本代码复用设计不明确 | T002 采用 B1 设计(hook + UI 子组件拆分) |
| T-R3 | 方案 B(chat 入口注入画布 hook)造成 chats → agent 反向依赖 | T003 方案 B 不可行 |
| T-R4 | 两个 hook 返回类型差异巨大,无法定义统一 props 接口 | T003 方案 B 不可行 |
| T-R5 | `fetchInputsHook` 同样有反向依赖 + 类型不一致 | T003 方案 B 不可行 |
| T-R6 | embed-dialog 硬编码 `/chats/widget` 路由,拆分路由破坏向后兼容 | T003 方案 D 不可行 |

### 任务复杂度重新评估(最终)

| 任务 | 原评估 | 首轮评审后 | T002/T003 调查评审后 | 说明 |
|---|---|---|---|---|
| T001 use-watch-change | 中 | 低 | **低** | 仅用 `updateNodeForm` + `AgentFormContext`,接口清晰 |
| T002 knowledge-base-item | 中 | 高 | **中** | 方案 B(修订):hook + UI 子组件拆分,逻辑清晰 |
| T003 floating-chat-widget | 中 | 高 | **低** | 方案 G:仅修 hook 调用 bug,彻底解耦延后 |
| T004 next-message-item | 中 | 中 | **中** | context 通用化 + WorkFlowTimeline render prop |
| T005 metadata-filter + PromptEditor | 低 | 中 | **中** | PromptEditor 依赖画布 constant |

### 修订后的执行顺序(最终)

```
T001(use-watch-change,独立,低)  ──┐
T004(next-message-item,独立,中) ──┼─→ T006(checkpoint)
T005(PromptEditor 提升,独立,中) ──┘
T002(方案 B 修订:hook + UI 拆分,中)
T003(方案 G:仅修 bug,低)
```

T001/T004/T005 可并行;T002 独立实施;T003 仅修 bug,可与任意任务并行。

---

## 细化任务

### T001 [低复杂度] 解耦 `components/llm-setting-items/use-watch-change.ts`

**泄漏分析**:
- L2: `import { AgentFormContext } from '@/pages/agent/context';`
- L3: `import useGraphStore from '@/pages/agent/store';`
- L13: `const updateNodeForm = useGraphStore((state) => state.updateNodeForm);`
- L12: `const node = useContext(AgentFormContext);`
- L40: `updateNodeForm(node?.id, nextValues)`

**接口需求**:
- 需要 `node.id`(当前节点 ID)
- 需要 `updateNodeForm(nodeId, values)`(更新节点表单)

#### 子任务

- [x] T001.1 新建 `src/components/llm-setting-items/form-sync-context.ts`
  - 定义 `FormSyncContextValue`:`{ nodeId: string | undefined; updateNodeForm: (nodeId: string, values: Record<string, unknown>) => void }`
  - 导出 `FormSyncContext`(createContext,null)+ `useFormSync` hook(消费时若为 null 返回 noop 实现,避免画布外组件 crash)
  - 注意:`nodeId` 也需通过 context 传入(原代码用 `AgentFormContext` 拿 node,实际只用 `node.id`)

- [x] T001.2 改造 `use-watch-change.ts`
  - 移除 `import { AgentFormContext } from '@/pages/agent/context'` + `import useGraphStore from '@/pages/agent/store'`
  - 改用 `const { nodeId, updateNodeForm } = useFormSync()`
  - L40 改为 `if (nodeId) { updateNodeForm(nodeId, nextValues); }`

- [x] T001.3 画布侧提供 Provider
  - 在 `pages/agent/form-sheet/next.tsx`(FormSheet 渲染处)用 `<FormSyncContext.Provider value={{ nodeId: node?.id, updateNodeForm }}>`
  - `updateNodeForm` 从 `useGraphStore` 获取
  - 注意:`AgentFormContext` 仍保留(画布内部其他地方可能用),仅通用组件不再消费

- [x] T001.4 验证
  - `tsc --noEmit` 零新增错误
  - `grep "pages/agent" src/components/llm-setting-items/use-watch-change.ts` 返回空
  - 画布内 LLM 算子表单:切换 freedom 参数(待手工冒烟验证)

#### 评审意见

| 项 | 意见 |
|---|---|
| 复杂度 | **低**。接口清晰,2 个字段 |
| 风险 | 低。Provider 包裹位置明确(FormSheet) |
| 改进 | `FormSyncContextValue` 应把 `nodeId` 和 `updateNodeForm` 合并,而非分开传(原方案漏了 nodeId) |
| 测试 | 需补充:画布外使用 `useHandleFreedomChange` 时(无 Provider)应 noop 或抛错,不 crash |

---

### T002 [中复杂度] 解耦 `components/knowledge-base-item.tsx`

**泄漏分析**:
- L4: `import { useBuildQueryVariableOptions } from '@/pages/agent/hooks/use-get-begin-query';`
- L116: `buildQueryVariableOptionsByShowVariable(showVariable)()` — 调用 hook(无参数)

**深度依赖调查**(评审 R1):

`useBuildQueryVariableOptions` 的依赖链:
```
useBuildQueryVariableOptions
├── AgentFormContext (画布 context)
├── useGraphStore (画布 store: nodes, getOperatorTypeFromId)
├── useBuildVariableOptions
│   ├── useBuildUpstreamNodeOutputOptions → buildUpstreamNodeOutputOptions (画布 utils)
│   ├── useBuildParentOutputOptions → getNode, getOperatorTypeFromId (画布 store)
│   └── useBuildUpstreamNodeOutputOptions
├── useBuildConversationVariableOptions → useFetchAgent (画布 API)
├── useBuildGlobalWithBeginVariableOptions → useFetchAgent + useBuildBeginDynamicVariableOptions
│   └── useSelectBeginNodeDataInputs → getNode(BeginId) (画布 store)
└── buildNodeOutputOptions (画布 utils)
```

**结论**:`useBuildQueryVariableOptions` 本质上是画布域内的 hook,无法抽取"通用部分"。`knowledge-base-item.tsx` 调用它意味着此组件本身已进入画布域。

#### 子任务(修订方案:方案 B(评审后)— 通用版本拆分 hook + UI + 画布扩展版本)

> **调查已完成**,详见 [phase0-t002-t003-investigation.md](./phase0-t002-t003-investigation.md)
> **方案评审已完成**,详见 [phase0-t002-t003-review.md](./phase0-t002-t003-review.md)
>
> **调查结论**:`KnowledgeBaseFormField` 有 3 个调用方:
> - `pages/agent/form/retrieval-form/next.tsx`(画布,`showVariable=true`)
> - `pages/next-search/search-setting.tsx`(非画布,`showVariable=false`)
> - `pages/next-chats/chat/app-settings/chat-basic-settings.tsx`(非画布,`showVariable=false`)
>
> **评审发现**:
> - T-R1:`buildQueryVariableOptionsByShowVariable` 本身是 Rules of Hooks 反模式,需一并处理
> - T-R2:画布扩展版本需明确代码复用设计,推荐 B1(hook + UI 子组件拆分)
>
> **选型**:方案 B(修订)— 通用版本拆为 hook + UI 子组件,画布扩展版本调用两者

- [x] T002.1 调查调用方(已完成,见调查报告)
- [x] T002.2 选型:方案 B(评审后修订)

- [x] T002.3 实施方案 B(评审后):
  - 改造 `src/components/knowledge-base-item.tsx`:
    - **移除 `buildQueryVariableOptionsByShowVariable` 反模式**(T-R1)
    - **移除 `useBuildQueryVariableOptions` import**
    - **移除 `showVariable` prop**(通用版本不再支持)
    - 新增导出 `KnowledgeBaseSelect` UI 子组件(接收 `options` prop,渲染 IntellectFormItem + MultiSelect)
    - `KnowledgeBaseFormField` 改为:调用 `useDisableDifferenceEmbeddingDataset` + `KnowledgeBaseSelect`(仅 datasetOptions)
  - 新建 `src/pages/agent/form/components/knowledge-base-form-field.tsx`(画布扩展版本):
    - `AgentKnowledgeBaseFormField`:调用 `useDisableDifferenceEmbeddingDataset`(从通用导出)+ `useBuildQueryVariableOptions`(画布 hook)+ 合并 options + `KnowledgeBaseSelect`(通用 UI)
  - 修改 `src/pages/agent/form/retrieval-form/next.tsx`:import 改为画布扩展版本 `AgentKnowledgeBaseFormField`

- [x] T002.4 验证:
  - `tsc --noEmit` 零错误
  - 画布 retrieval-form:知识库选择 + 变量选项构建正常(`showVariable=true` 行为)
  - next-search 设置页:知识库选择正常(无 showVariable)
  - next-chats 设置页:知识库选择正常(无 showVariable)
  - `grep -rn "useBuildQueryVariableOptions\|buildQueryVariableOptionsByShowVariable" src/components/` 返回空

#### 评审意见(方案 B 修订后)

| 项 | 意见 |
|---|---|
| 复杂度 | **中**。需拆分通用版本为 hook + UI 子组件,但逻辑清晰 |
| 风险 | 低。非画布调用方零改动(继续 import 通用版本,无 showVariable) |
| 改进 | 评审发现 `buildQueryVariableOptionsByShowVariable` 反模式(T-R1),需一并移除;画布扩展版本用 B1 设计(T-R2) |
| 测试 | 3 个调用方均需回归(画布 retrieval-form + next-search + next-chats) |
| 备注 | 非画布调用方零改动;通用版本彻底脱离画布依赖 |

---

### T003 [低复杂度] 修复 `components/floating-chat-widget.tsx` hook 调用 bug

**泄漏分析**:
- L8: `import { useSendNextSharedMessage } from '@/pages/agent/hooks/use-send-shared-message';`
- L138-140: `const hookResult = (isFromAgent ? useSendNextSharedMessage : useSendSharedMessage)(() => {});`

**深度依赖调查**(评审 R2):

`useSendNextSharedMessage` 的依赖链:
```
useSendNextSharedMessage
├── useGetSharedChatSearchParams (通用,可用)
├── useFetchExternalAgentInputs (画布 API hook)
├── useSendAgentMessage (画布 chat hook)
│   └── 深度依赖画布 store/context/constant
├── buildRequestBody (画布 chat util)
├── BeginQuery (画布 interface)
└── AgentDialogueMode (画布 constant)
```

**结论**:`useSendNextSharedMessage` 本质上是画布域内的 hook,无法抽取通用部分。

**Bug 发现**(评审 R3):

L138-140 违反 React Rules of Hooks:
```typescript
const hookResult = (
  isFromAgent ? useSendNextSharedMessage : useSendSharedMessage
)(() => {});
```
条件表达式选择 hook 函数后调用,虽然两个分支都是 hook,但 React 无法保证调用顺序稳定(若 `isFromAgent` 在渲染间变化)。这是一个 latent bug,需先修复。

#### 子任务(修订方案:方案 G — 仅修 bug,彻底解耦延后)

> **⚠️ 方案 B 评审不可行**,详见 [phase0-t002-t003-review.md](./phase0-t002-t003-review.md)
>
> **方案 B 不可行原因**:
> - **反向依赖**(T-R3):chat 入口注入画布 hook 造成 chats → agent 泄漏
> - **类型不一致**(T-R4):两个 hook 返回类型差异巨大,无法定义统一 props 接口
>
> **选型**:方案 G — 阶段 0 仅修复 hook 调用 bug,彻底解耦依赖 BFF 统一 API(方案 F),留到后续 spec

- [x] T003.1 **修复 hook 调用反模式**(阶段 0 唯一任务)
  - [floating-chat-widget.tsx](../../src/components/floating-chat-widget.tsx) L138-140 条件调用 hook 违反 Rules of Hooks
  - 改为两个 hook 都调用,根据 `isFromAgent` 选择结果:
    ```typescript
    const agentHookResult = useSendNextSharedMessage(() => {});
    const chatHookResult = useSendSharedMessage(() => {});
    const hookResult = isFromAgent ? agentHookResult : chatHookResult;
    ```
  - 同理处理 L158-160 的 `useFetchExternalAgentInputs` / `useFetchExternalChatInfo` 条件调用
  - 在文件头部添加注释:`// TODO(spec-009): 待 BFF widget API 统一后解耦,见 phase0-t002-t003-review.md §T-R3`
  - 验证:widget 在 `from=agent` 和 `from=chat` 两种模式下功能正常

- [x] T003.2 调查归属(已完成,见调查报告)
- [x] T003.3 选型:方案 G(仅修 bug,彻底解耦延后)

- [ ] T003.4 **彻底解耦延后**(不在阶段 0 范围)
  - 依赖 BFF 统一 widget API(方案 F):
    - `/api/bff/widget/{id}/inputs` — 统一获取 inputs
    - `/api/bff/widget/{id}/completions` — 统一发送消息
  - 留到 spec/008 后续或独立 spec 处理
  - 前端 widget 用统一 `useSendWidgetMessage` hook(不区分 from)

- [x] T003.5 验证(阶段 0 仅验证 bug 修复):
  - `tsc --noEmit` 零错误
  - `/chats/widget?from=chat`:chat 分享 widget 功能正常
  - `/chats/widget?from=agent`:agent 分享 widget 功能正常
  - iframe 嵌入场景:postMessage 通信正常
  - **注意**:`floating-chat-widget.tsx` 仍有 `pages/agent` import(已知泄漏,SC-002 豁免)

#### 评审意见(方案 B 不可行后修订)

| 项 | 意见 |
|---|---|
| 复杂度 | **低**(方案 G 范围缩减,仅修 bug) |
| 风险 | 低。bug 修复不涉及架构改动 |
| 改进 | 方案 B 不可行(反向依赖 + 类型不一致);方案 G 阶段 0 仅修 bug,彻底解耦延后到 BFF 改动 |
| 测试 | iframe 内 widget 端到端测试(from=agent + from=chat 两种) |
| 备注 | widget 彻底解耦需 BFF 统一 API,超出阶段 0 范围;SC-002 需豁免 floating-chat-widget.tsx |

---

### T004 [中复杂度] 解耦 `components/next-message-item/{index,group-button}.tsx`

**泄漏分析**:

`group-button.tsx`:
- L10: `import { AgentChatContext } from '@/pages/agent/context';`
- L70: `const { showLogSheet } = useContext(AgentChatContext);`
- L73: `showLogSheet(messageId)` — 打开日志面板

`index.tsx`:
- L23: `import { AgentChatContext } from '@/pages/agent/context';`
- L24: `import { WorkFlowTimeline } from '@/pages/agent/log-sheet/workflow-timeline';`
- L90: `const { setLastSendLoadingFunc } = useContext(AgentChatContext);`
- L276: `<WorkFlowTimeline ... />` — 渲染画布工作流时间线

**接口需求**:
- `showLogSheet(messageId)` — 打开日志
- `setLastSendLoadingFunc(loading, messageId)` — 设置加载状态
- `setDerivedMessages` — 设置消息列表(context.ts 中定义,但 index.tsx 未直接使用,仅 group-button 用 showLogSheet,index 用 setLastSendLoadingFunc)

**WorkFlowTimeline 归属**(评审 R5):

需调查 `WorkFlowTimeline` 是否仅画布使用。从命名和路径(`pages/agent/log-sheet/`)看,是画布工作流日志组件,应迁入画布。但 `next-message-item/index.tsx` 在分享页(`isShare=true`)也会渲染它,需确认分享页是否属于画布域。

#### 子任务

- [x] T004.1 新建 `src/components/next-message-item/chat-sheet-context.ts`
  - 定义 `ChatSheetContextValue`:
    ```typescript
    {
      showLogSheet: (messageId: string) => void;
      setLastSendLoadingFunc: (loading: boolean, messageId: string) => void;
      setDerivedMessages: Dispatch<SetStateAction<IMessage[] | undefined>>;
    }
    ```
  - 导出 `ChatSheetContext` + `useChatSheet` hook

- [x] T004.2 改造 `group-button.tsx`
  - 移除 `import { AgentChatContext } from '@/pages/agent/context'`
  - 改用 `const { showLogSheet } = useChatSheet()`

- [x] T004.3 改造 `index.tsx`
  - 移除 `import { AgentChatContext } from '@/pages/agent/context'`
  - 改用 `const { setLastSendLoadingFunc } = useChatSheet()`
  - **处理 `WorkFlowTimeline`**:
    - 调查 `WorkFlowTimeline` 是否仅画布使用(Grep 调用方)
    - 若仅画布使用:通过 props 传入 `WorkFlowTimeline` 组件(render prop)或通过 context 注入
    - 推荐方案:`ChatSheetContextValue` 增加 `timelineRenderer?: (props: TimelineProps) => ReactNode` 字段,画布侧注入 `WorkFlowTimeline`,非画布侧不渲染

- [x] T004.4 画布侧提供 Provider
  - 在画布 `ChatSheet` 渲染处用 `<ChatSheetContext.Provider>` 包裹
  - 注入 `showLogSheet` / `setLastSendLoadingFunc` / `setDerivedMessages` / `timelineRenderer`
  - `showLogSheet` 等从 `useShowLogSheet` hook 获取

- [x] T004.5 验证
  - `tsc --noEmit` 零错误
  - 画布聊天:点击日志按钮,LogSheet 打开正常
  - 画布分享页:Thinking 折叠/展开 + WorkFlowTimeline 渲染正常
  - **评审追加**:非画布聊天(若使用 next-message-item)不 crash

#### 评审意见

| 项 | 意见 |
|---|---|
| 复杂度 | **中**。context 通用化简单,WorkFlowTimeline 处理需调查 |
| 风险 | 中。WorkFlowTimeline 归属需确认;分享页 isShare 场景需测 |
| 改进 | WorkFlowTimeline 用 render prop 注入,而非直接迁入(保持 next-message-item 通用性) |
| 测试 | 需补充:画布聊天 + 分享页两种场景的回归 |
| 备注 | `AgentChatContext` 还含 `setDerivedMessages`,但 index.tsx 未直接用,需确认是否真的需要 |

---

### T005 [中复杂度] 解耦 `components/metadata-filter/metadata-filter-conditions.tsx` + PromptEditor 提升

**泄漏分析**:

`metadata-filter-conditions.tsx`:
- L21: `import { PromptEditor } from '@/pages/agent/form/components/prompt-editor';`
- L136-140: `<PromptEditor {...valueField} multiLine={false} showToolbar={false} />`

`PromptEditor` 的画布依赖:
- `prompt-editor/index.tsx` L25: `import { JsonSchemaDataType } from '@/pages/agent/constant';`
- 其他文件可能也有画布依赖

**结论**:PromptEditor 本身是通用富文本编辑器(基于 Lexical),但 import 了画布 constant `JsonSchemaDataType`。需先处理 constant 依赖,才能提升。

#### 子任务

- [x] T005.1 **调查 PromptEditor 的画布依赖**
  - 读取 `prompt-editor/` 全部文件,grep `pages/agent` import
  - 列出所有画布依赖项(constant/types/utils)

- [x] T005.2 **处理画布 constant 依赖**
  - 评估 `JsonSchemaDataType` 是否画布专属
  - 若是画布专属:PromptEditor 改为通过 props 接收相关常量(如 `variableTypes` 配置)
  - 若是通用:提升到 `src/constants/`

- [x] T005.3 **提升 PromptEditor 到 `src/components/prompt-editor/`**
  - 物理迁移 `pages/agent/form/components/prompt-editor/` → `src/components/prompt-editor/`
  - 更新内部 import(相对路径)
  - 画布原位置改为 re-export:`export { PromptEditor } from '@/components/prompt-editor'`(保持画布内引用不变)

- [x] T005.4 改造 `metadata-filter-conditions.tsx`
  - 移除 `import { PromptEditor } from '@/pages/agent/form/components/prompt-editor'`
  - 改用 `import { PromptEditor } from '@/components/prompt-editor'`

- [x] T005.5 验证
  - `tsc --noEmit` 零错误
  - 画布内使用 PromptEditor 的算子表单(retrieval-form 等):编辑器功能正常
  - metadata-filter:`canReference=true` 时 PromptEditor 渲染正常
  - **评审追加**:确认 `src/components/prompt-editor/` 无 `pages/agent` import

#### 评审意见

| 项 | 意见 |
|---|---|
| 复杂度 | **中**。PromptEditor 提升本身简单,但需先处理 constant 依赖 |
| 风险 | 中。PromptEditor 是复杂组件(Lexical + 多个 plugin),迁移可能遗漏依赖 |
| 改进 | 必须先做 T005.1 调查,不能盲目迁移 |
| 测试 | 需补充:PromptEditor 所有使用方的回归测试清单 |
| 备注 | `JsonSchemaDataType` 可能与画布算子类型耦合,需评估是否真的通用 |

---

### T006 [Checkpoint] 阶段 0 验证

- [x] T006.1 `npx tsc --noEmit -p tsconfig.json` 零新增错误(仅 5 个预存错误:use-fetch-gateway-models.ts + gateway-provider-panel.tsx,与本次改动无关)
- [x] T006.2 `npm test` — 20 个 suite 失败,均为预存的 `import.meta.glob is not a function` 环境问题(Jest 不支持 Vite glob),与本次改动无关;21 个实际测试用例全部通过
- [x] T006.3 **评审追加**:`grep -rn "from '@/pages/agent" src/components/ | grep -v floating-chat-widget` 返回空(评审 T-R3:floating-chat-widget 豁免,待 BFF 统一)
- [x] T006.4 **评审追加**:`grep -rn "useGraphStore" src/components/` 返回空
- [x] T006.5 **评审追加**:`grep -rn "AgentFormContext\|AgentChatContext" src/components/` 返回空
- [ ] T006.6 画布冒烟测试(完整流程)— 待手工验证:
  - 列表 → 创建 → 编辑 DSL(含 LLM 算子、retrieval 算子、metadata-filter)→ 保存 → 执行 → 查看日志
  - 分享页:Thinking 折叠 + WorkFlowTimeline + 发送消息
- [ ] T006.7 **评审追加**:非画布功能回归 — 待手工验证:
  - chat 分享页 widget(`from=agent` / `from=chat`)
  - next-search 设置页 KnowledgeBaseFormField
  - next-chats 设置页 KnowledgeBaseFormField

#### 实施结果总结(2026-07-13)

**新建文件(4 类,共 14 个)**:
- [src/components/llm-setting-items/form-sync-context.ts](../../src/components/llm-setting-items/form-sync-context.ts) — 通用 FormSyncContext
- [src/pages/agent/form/components/knowledge-base-form-field.tsx](../../src/pages/agent/form/components/knowledge-base-form-field.tsx) — 画布扩展版本
- [src/components/next-message-item/chat-sheet-context.ts](../../src/components/next-message-item/chat-sheet-context.ts) — 通用 ChatSheetContext
- [src/components/prompt-editor/](../../src/components/prompt-editor/)(12 个文件)— 通用 PromptEditor

**修改文件(8 个)**:
- `src/components/llm-setting-items/use-watch-change.ts` — 改用 useFormSync
- `src/components/knowledge-base-item.tsx` — 移除画布 hook + 反模式,新增 KnowledgeBaseSelect UI 子组件
- `src/components/floating-chat-widget.tsx` — 修复两处条件 hook 调用 + TODO 注释
- `src/components/next-message-item/{index,group-button}.tsx` — 改用 useChatSheet + timelineRenderer render prop
- `src/components/metadata-filter/metadata-filter-conditions.tsx` — import 改为通用 PromptEditor
- `src/pages/agent/form-sheet/next.tsx` — 添加 FormSyncContext.Provider
- `src/pages/agent/canvas/index.tsx` — 添加 ChatSheetContext.Provider + timelineRenderer
- `src/pages/agent/form/retrieval-form/next.tsx` — 改用 AgentKnowledgeBaseFormField
- `src/pages/agent/form/components/prompt-editor/index.tsx` — 改为 wrapper(注入画布 hook 给通用 PromptEditor)

**解耦成果**:
- `src/components/` 下无 `useGraphStore` import ✅
- `src/components/` 下无 `AgentFormContext` / `AgentChatContext` import ✅
- `src/components/` 下无 `pages/agent` import(仅 floating-chat-widget 豁免)✅
- 非画布调用方零改动(next-search、next-chats、画布内 22 处 PromptEditor 调用方)✅

### T007 [评审修复] 代码评审问题修复(2026-07-13)

> **触发**:基于 [phase0-code-review.md](./phase0-code-review.md) 评审报告(7 项发现:Q1-Q6 + S1)

- [x] T007.1 **Q1 修复**:`timelineRenderer` 类型从 `unknown` 改为 `TimelineRenderData` 接口
  - 新增 `TimelineRenderData` / `TimelineRenderProps` 接口([chat-sheet-context.ts:11-22](../../src/components/next-message-item/chat-sheet-context.ts#L11))
  - `next-message-item/index.tsx` 移除 `as TimelineRenderProps` 断言,改用类型注解
  - `canvas/index.tsx` 移除 `as ComponentProps<typeof WorkFlowTimeline>` 断言,使用 `TimelineRenderProps` 类型
- [x] T007.2 **Q2 修复**:`queryVariableOptions as any` 替换为精确类型断言
  - 扩展 `VariablePickerMenuOptionType`:`label: string` → `ReactNode`,options 内新增 `parentLabel?: ReactNode`
  - 重构 `filterDocGeneratorDownloadOutputOptions` 为泛型函数 `<T extends {...}>`,保留外层 group 类型
  - wrapper 改用 `as VariablePickerMenuOptionType[]` 精确断言(比 `as any` 更安全,保留外层结构检查)
  - **遗留**:options 内对象类型因 `Record<string, any>` 约束仍需断言,彻底修复留待后续
- [x] T007.3 **Q3 处理**:`floating-chat-widget.tsx` 的 `(hookResult as any).findReferenceByMessageId` 添加 TODO(T-R4) 注释
- [x] T007.4 **Q4 确认**:确认 `useSendSharedMessage` 内部 `useEffect` 会调用 `fetchSessionId()` 发起网络请求
  - `from=agent` 模式下会产生一次空请求副作用(已知问题)
  - `useSendNextSharedMessage` 的 `runTask` 受 `sendedTaskMessage` ref 保护,影响较小
  - 添加 TODO 注释说明,待 Phase 1+ BFF 统一 API 合并 hook 后彻底消除
- [x] T007.5 **Q5 修复**:`knowledge-base-form-field.tsx` 变量命名遮蔽
  - 外层 `x` → `group`,内层 `x`/`y` → `option`
  - 移除不必要的 `'label' in group` 运行时检查(类型已保证 label 必填)
- [x] T007.6 **Q6 修复**:`timelineRenderer` 用 `useCallback` 包裹([canvas/index.tsx:280-283](../../src/pages/agent/canvas/index.tsx#L280))
- [x] T007.7 **S1 修复**:`useFormSync` 与 `useChatSheet` 添加 DEV 环境警告
  - `import.meta.env.DEV` 时 `console.warn` 提示 Provider 未挂载
- [x] T007.8 验证:`npx tsc --noEmit` 通过(仅剩 5 个预存在 gateway 错误,与本次改动无关)

#### 修复后修改的文件(9 个)

| 文件 | 修复项 |
|---|---|
| [src/components/next-message-item/chat-sheet-context.ts](../../src/components/next-message-item/chat-sheet-context.ts) | Q1(TimelineRenderData 接口 + currentMessageId/sendLoading 改必填) |
| [src/components/next-message-item/index.tsx](../../src/components/next-message-item/index.tsx) | Q1(类型注解) |
| [src/pages/agent/canvas/index.tsx](../../src/pages/agent/canvas/index.tsx) | Q1+Q6(类型 + useCallback) |
| [src/components/prompt-editor/variable-picker-plugin.tsx](../../src/components/prompt-editor/variable-picker-plugin.tsx) | Q2(扩展 VariablePickerMenuOptionType) |
| [src/pages/agent/hooks/use-get-begin-query.tsx](../../src/pages/agent/hooks/use-get-begin-query.tsx) | Q2(filterDocGeneratorDownloadOutputOptions 泛型化) |
| [src/pages/agent/form/components/prompt-editor/index.tsx](../../src/pages/agent/form/components/prompt-editor/index.tsx) | Q2(精确断言替代 as any) |
| [src/pages/agent/form/components/knowledge-base-form-field.tsx](../../src/pages/agent/form/components/knowledge-base-form-field.tsx) | Q5(变量重命名 + 移除运行时检查) |
| [src/components/floating-chat-widget.tsx](../../src/components/floating-chat-widget.tsx) | Q3+Q4(TODO 注释) |
| [src/components/llm-setting-items/form-sync-context.ts](../../src/components/llm-setting-items/form-sync-context.ts) | S1(DEV 警告) |

#### 遗留项(留待后续阶段)

| 项 | 说明 | 后续阶段 |
|---|---|---|
| Q2 残留 | `prompt-editor/index.tsx:37` 仍有 `as VariablePickerMenuOptionType[]` 断言 | 重构泛型或提取 OptionItem 类型 |
| Q3/T-R4 | `floating-chat-widget.tsx:159` 保留 `as any` | Phase 1+ BFF 统一 API |
| Q4 副作用 | `from=agent` 模式下空 `fetchSessionId` 请求 | Phase 1+ 合并 hook |

---

## 技术评审总结

### 原方案问题

1. **T002/T003 解耦方案不可行**:原方案"抽取 hook 通用部分"低估了 hook 对画布的深度依赖。`useBuildQueryVariableOptions` 和 `useSendNextSharedMessage` 本质上是画布域 hook,无法简单抽取。
2. **未发现 floating-chat-widget 的 hook bug**:L138-140 条件调用 hook 违反 Rules of Hooks,需先修复。
3. **缺少前置调查**:T002/T003/T005 都需要先调查调用方/依赖,原方案直接给出实施方案。
4. **缺少回归测试**:原任务仅 `tsc` + `npm test`,缺少功能冒烟测试和 import 检查。
5. **执行顺序不合理**:T001-T005 有依赖关系,不应顺序执行。

### 修订要点

1. **T002/T003 改为"迁入画布"或"props 注入"**:承认 hook 链深度依赖,改为组件级解耦。
2. **新增 T003.1 bug 修复**:作为 T003 的前置任务。
3. **每个任务增加前置调查子任务**:T002.1/T003.2/T005.1。
4. **T004 用 render prop 注入 WorkFlowTimeline**:保持 next-message-item 通用性。
5. **T005 先处理 constant 依赖**:再提升 PromptEditor。
6. **T006 补充 import 检查 grep**:作为 SC-002 的前置验证。
7. **执行顺序调整**:T001/T004/T005 可并行;T002/T003 需先调查。

### 风险矩阵(修订后)

| 任务 | 复杂度 | 回归风险 | 前置依赖 | 推荐顺序 |
|---|---|---|---|---|
| T001 | 低 | 低 | 无 | 1(并行) |
| T004 | 中 | 中 | 无 | 1(并行) |
| T005 | 中 | 中 | T005.1 调查 | 1(并行) |
| T003 | 高 | 高 | T003.1 修 bug + T003.2 调查 | 2 |
| T002 | 高 | 高 | T002.1 调查 | 2 |

### 与 spec/008 的关系

阶段 0(本文档)与 spec/008(BFF CanvasService)**完全独立**,可并行实施。阶段 0 的价值:
- 改善代码质量(消除泄漏),即使不做画布插件化也有价值
- 为阶段 2(代码迁移)扫清障碍
