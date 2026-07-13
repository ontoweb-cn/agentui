# T002/T003 方案 B 技术评审

> **Date**: 2026-07-13
> **Parent**: [phase0-t002-t003-investigation.md](./phase0-t002-t003-investigation.md)
> **Status**: 评审完成,方案已修订,阶段 0 已实施完成(2026-07-13)

## 评审摘要

| 任务 | 方案 | 评审结论 | 严重问题数 |
|---|---|---|---|
| T002 | 方案 B(通用版本 + 画布扩展版本) | **基本可行,需修订** | 1 个高 + 1 个中 |
| T003 | 方案 B(通用外壳 + props 注入) | **不可行,需改方案** | 2 个高(根本性问题) |

---

## 一、T002 方案 B 评审

### 评审发现 T-R1 [高] `buildQueryVariableOptionsByShowVariable` 本身是 Rules of Hooks 反模式

**问题**:[knowledge-base-item.tsx](../../src/components/knowledge-base-item.tsx) L14-16:

```typescript
function buildQueryVariableOptionsByShowVariable(showVariable?: boolean) {
  return showVariable ? useBuildQueryVariableOptions : () => [];
}
```

L116:`const nextOptions = buildQueryVariableOptionsByShowVariable(showVariable)();`

这是一个**条件返回 hook** 的工厂函数:
- `showVariable=true` → 返回 `useBuildQueryVariableOptions`(hook)
- `showVariable=false` → 返回 `() => []`(普通函数)

然后 L116 无条件调用。这违反 Rules of Hooks — React 无法保证 hook 调用顺序稳定(若 `showVariable` 在渲染间变化)。

**影响**:
- 方案 B 的"移除 showVariable prop"不能简单删除,需一并处理这个反模式
- 即使非画布调用方(`showVariable=false`),当前代码也会执行这个工厂函数(虽然返回 noop,但仍是反模式)

**修订建议**:
- 通用版本:完全移除 `buildQueryVariableOptionsByShowVariable` + `showVariable` prop + `useBuildQueryVariableOptions` import,只保留 `knowledgeOptions` 构建
- 画布扩展版本:直接调用 `useBuildQueryVariableOptions`(不通过工厂函数),符合 Rules of Hooks

### 评审发现 T-R2 [中] 画布扩展版本的代码复用设计不明确

**问题**:方案 B 说"新建画布扩展版本包装通用版本",但未明确:
- 通用版本是否暴露 `useDisableDifferenceEmbeddingDataset` hook?
- 画布扩展版本如何复用通用版本的 UI(IntellectFormItem + MultiSelect)?

**两种可能的设计**:

| 设计 | 通用版本暴露 | 画布扩展版本 | 问题 |
|---|---|---|---|
| B1:hook + UI 子组件 | 暴露 `useDisableDifferenceEmbeddingDataset` + `KnowledgeBaseSelect` UI 子组件 | 调用 hook + 追加 variable options + 调用 UI 子组件 | 需拆分通用版本为 hook + UI 两部分 |
| B2:options prop 注入 | 仅渲染(接收 `extraOptions` prop) | 自己构建 variable options,通过 prop 传入 | 画布扩展版本需复制 datasetOptions 构建逻辑(重复) |

**修订建议**:采用 **B1**(hook + UI 子组件拆分):
- 通用版本拆为:
  - `useDisableDifferenceEmbeddingDataset`(已有,导出)
  - `KnowledgeBaseSelect`(新增,接收 `options` prop,渲染 IntellectFormItem + MultiSelect)
  - `KnowledgeBaseFormField`(保留,组合 hook + UI,无 showVariable)
- 画布扩展版本:
  - `AgentKnowledgeBaseFormField`(新增,调用 `useDisableDifferenceEmbeddingDataset` + `useBuildQueryVariableOptions`,合并 options,调用 `KnowledgeBaseSelect`)

### T002 修订后方案

```
src/components/knowledge-base-item.tsx (通用,改造):
├── useDisableDifferenceEmbeddingDataset (导出,不变)
├── KnowledgeBaseSelect (新增,UI 子组件,接收 options)
└── KnowledgeBaseFormField (改造,移除 showVariable,仅渲染 datasetOptions)

src/pages/agent/form/components/knowledge-base-form-field.tsx (画布,新建):
└── AgentKnowledgeBaseFormField
    ├── 调用 useDisableDifferenceEmbeddingDataset (从通用导出)
    ├── 调用 useBuildQueryVariableOptions (画布 hook)
    ├── 合并 options
    └── 渲染 KnowledgeBaseSelect (通用 UI 子组件)
```

**复杂度评估**:中(需拆分通用版本为 hook + UI,但逻辑清晰)

---

## 二、T003 方案 B 评审(不可行)

### 评审发现 T-R3 [高·根本性问题] chat 入口注入画布 hook 造成反向依赖

**问题**:方案 B 提议"chat 入口根据 `from` 参数选择 hook,通过 props 传入"。但:

- [next-chats/widget/index.tsx](../../src/pages/next-chats/widget/index.tsx) 属于 **chats feature**
- 当 `from=agent` 时,需注入 `useSendNextSharedMessage`(来自 [pages/agent/hooks/use-send-shared-message.ts](../../src/pages/agent/hooks/use-send-shared-message.ts))
- 这意味着 `pages/next-chats/` 要 `import` `pages/agent/` 的代码

**当前泄漏**:`components/` → `pages/agent/`(通用 → 画布)
**方案 B 后泄漏**:`pages/next-chats/` → `pages/agent/`(chat → 画布)

**泄漏方向变了,但依然存在!** 方案 B 没有解决问题,只是把泄漏从通用组件移到了 chat 页面。

### 评审发现 T-R4 [高·根本性问题] 两个 hook 返回类型严重不一致

**问题**:对比两个 hook 的返回类型:

| 字段 | `useSendSharedMessage`(chat) | `useSendNextSharedMessage`(agent) |
|---|---|---|
| `handlePressEnter` | ✅ `(params: {enableThinking, enableInternet}) => void` | ✅ `() => void`(签名不同,无 params) |
| `handleInputChange` | ✅ | ❌(agent 版通过 `useSendAgentMessage` 间接提供,签名可能不同) |
| `value` | ✅ | ✅ |
| `sendLoading` | ✅ `!done` | ✅ |
| `derivedMessages` | ✅ | ✅ |
| `hasError` | ✅ | ✅(硬编码 `false`) |
| `findReferenceByMessageId` | ❌ | ✅(widget L149 用 `(hookResult as any).findReferenceByMessageId` 访问) |
| `loading` | ✅ | ❌ |
| `stopOutputMessage` | ✅ | ✅(通过 `useSendAgentMessage`) |
| `scrollRef` | ✅ | ✅ |
| `messageContainerRef` | ✅ | ✅ |
| `removeAllMessages` | ✅ | ✅ |
| `parameterDialogVisible` | ❌ | ✅ |
| `inputsData` | ❌ | ✅ |
| `isTaskMode` | ❌ | ✅ |
| `showParameterDialog` | ❌ | ✅ |
| `ok` | ❌ | ✅ |

**影响**:
- widget 实际使用的字段:`handlePressEnter`、`handleInputChange`、`value`、`sendLoading`、`derivedMessages`、`hasError`、`findReferenceByMessageId`、`inputsData`(L162 `data.title`)
- 两个 hook 返回类型差异巨大,无法定义统一的 props 接口
- `handlePressEnter` 签名不同(chat 版接收 params,agent 版无 params)
- `findReferenceByMessageId` 仅 agent 版有(widget L149 用 `as any` 访问,类型不安全)
- `inputsData` 仅 agent 版有(widget L162 用 `data.title`)

**结论**:props 注入需要定义公共接口,但两个 hook 返回类型不一致,公共接口会丢失关键能力(如 `findReferenceByMessageId`、`inputsData`),或需要复杂的可选字段处理。

### 评审发现 T-R5 [中] fetchInputsHook 同样有反向依赖 + 类型不一致

**问题**:[floating-chat-widget.tsx](../../src/components/floating-chat-widget.tsx) L158-160:

```typescript
const { data } = (
  isFromAgent ? useFetchExternalAgentInputs : useFetchExternalChatInfo
)();
```

- `useFetchExternalAgentInputs` 来自 `@/hooks/use-agent-request`(画布 API)
- `useFetchExternalChatInfo` 来自 `@/hooks/use-chat-request`(chat API)
- 两个 hook 返回的 `data` 结构不同:`inputsData` 有 `inputs`/`mode`/`title`,chat 版 `chatInfo` 有 `llm_id`/`title`
- widget L162 用 `data.title`(两者都有),但 L68 用 `inputsData.mode`(仅 agent 版)

方案 B 的 `fetchInputsHook` props 注入同样面临反向依赖 + 类型不一致问题。

### 评审发现 T-R6 [中] embed-dialog 硬编码 `/chats/widget` 路由

**问题**:[embed-dialog/index.tsx](../../src/components/embed-dialog/index.tsx) L171-176:

```typescript
const baseRoute =
  embedType === 'widget'
    ? Routes.ChatWidget  // 总是用 /chats/widget,即使 from=agent
    : from === SharedFrom.Agent
      ? Routes.AgentShare
      : Routes.ChatShare;
```

**影响**:
- widget 模式下,无论 `from` 是 agent 还是 chat,嵌入 URL 都是 `/chats/widget?from=agent|chat`
- 现有已部署的嵌入代码可能依赖此 URL 结构
- 若改为方案 D(拆分路由,agent 用 `/agent/widget`),需修改 embed-dialog 生成的 URL,**可能破坏向后兼容性**

---

## 三、T003 替代方案分析

### 方案 D:拆分路由(chat 用 `/chats/widget`,agent 用 `/agent/widget`)

**设计**:
- chat 入口 [next-chats/widget/index.tsx](../../src/pages/next-chats/widget/index.tsx):只注入 chat hook,不 import 画布
- agent 入口(新建 `pages/agent/widget/index.tsx`):只注入画布 hook,在画布 feature 注册 `/agent/widget`
- 通用外壳 `FloatingChatWidget`:通过 props 接收 hook 实现
- embed-dialog:修改 baseRoute 逻辑,agent 用 `/agent/widget`,chat 用 `/chats/widget`

**优点**:
- 消除反向依赖(chats 不 import 画布,画布不 import chats)
- 每个 feature 独立注入自己的 hook

**缺点**:
- **向后兼容性风险**:已部署的嵌入代码可能硬编码 `/chats/widget?from=agent`,改为 `/agent/widget` 会破坏
- 需要定义公共 props 接口(T-R4 类型不一致问题仍存在,但可强制对齐)

### 方案 E:widget 留在 chats,agent hook 通过动态 import 注入(不推荐)

**设计**:
- chat 入口保持不变,继续用 `/chats/widget?from=agent|chat`
- 当 `from=agent` 时,动态 `import('@/pages/agent/hooks/use-send-shared-message')` 获取画布 hook

**优点**:
- 向后兼容(URL 不变)

**缺点**:
- 动态 import 增加运行时开销
- 仍是反向依赖(chats → agent),只是延迟到运行时
- 类型安全差

### 方案 F(推荐):widget 留在 chats,通过 BFF 层抽象 + 前端公共接口

**设计**:
1. **BFF 层**:统一 agent/chat widget 的 API,前端不区分 from
   - `/api/bff/widget/{id}/inputs` — 统一获取 inputs(BFF 内部按 from 路由到 agentbots/chatbots)
   - `/api/bff/widget/{id}/completions` — 统一发送消息(BFF 内部按 from 路由)
2. **前端**:widget 用统一的 `useSendWidgetMessage` hook(不区分 from)
3. **embed-dialog**:URL 不变,仍用 `/chats/widget?from=agent|chat`,但 from 仅用于 BFF 路由

**优点**:
- 消除前端反向依赖(widget 不 import 画布)
- 向后兼容(URL 不变)
- 前端 hook 类型统一

**缺点**:
- 需 BFF 新增 widget 统一 API(工作量增加)
- 不属于阶段 0 范围(阶段 0 是前端解耦,不涉及 BFF 改动)

### 方案 G(推荐·阶段 0 可行):widget 保留现状 + 标记为例外

**设计**:
- 阶段 0 **暂不处理** T003,将 `floating-chat-widget.tsx` 标记为"已知泄漏,待 BFF 统一后解决"
- 在 [phase0-detailed-tasks.md](./phase0-detailed-tasks.md) 中记录:widget 泄漏需配合 BFF 改动(方案 F),留到 spec/008 后续或独立 spec 处理
- 仅修复 T003.1 的 hook 调用 bug(改为两个 hook 都调用,选择结果),不彻底解耦

**优点**:
- 阶段 0 范围可控(不引入 BFF 改动)
- 修复 latent bug(优先级高)
- 不引入反向依赖

**缺点**:
- widget 仍有画布 import(但已标记,可追踪)
- 不彻底解耦

---

## 四、评审结论与修订建议

### T002 评审结论

**方案 B 基本可行,需修订**:
1. 处理 `buildQueryVariableOptionsByShowVariable` 反模式(T-R1)
2. 明确画布扩展版本的代码复用设计(T-R2),推荐 B1(hook + UI 子组件拆分)

### T003 评审结论

**方案 B 不可行**,原因:
1. 反向依赖(T-R3):chat 入口注入画布 hook 造成 chats → agent 泄漏
2. 类型不一致(T-R4):两个 hook 返回类型差异巨大,无法定义统一接口

**推荐改为方案 G(阶段 0 暂不彻底解耦 + 修 bug)**:
- 阶段 0 仅修复 T003.1 的 hook 调用 bug(高优先级,latent bug)
- widget 彻底解耦依赖 BFF 统一 API(方案 F),留到后续 spec 处理
- 在文档中明确标记 widget 为"已知泄漏,待 BFF 统一"

### 修订后的阶段 0 任务范围

| 任务 | 原方案 | 评审后 | 说明 |
|---|---|---|---|
| T001 | 解耦 | 解耦 | 不变 |
| T002 | 方案 B | **方案 B(修订)** | 处理反模式 + B1 设计 |
| T003 | 方案 B | **方案 G(仅修 bug)** | 彻底解耦留到 BFF 改动后 |
| T004 | 解耦 | 解耦 | 不变 |
| T005 | 解耦 | 解耦 | 不变 |

### 修订后的 SC-002 验收标准调整

原 SC-002:`src/components/` 下无任何文件 import `@/pages/agent/*`

评审后:**SC-002 需豁免 `floating-chat-widget.tsx`**(标记为已知泄漏,待 BFF 统一):

- `grep -rn "from '@/pages/agent" src/components/ | grep -v floating-chat-widget` 返回空
- `floating-chat-widget.tsx` 在文件头部添加 `// TODO(spec-009): 待 BFF widget API 统一后解耦,见 phase0-t002-t003-review.md §T-R3`

---

## 五、风险矩阵(修订后)

| 任务 | 复杂度 | 回归风险 | 方案可行性 | 备注 |
|---|---|---|---|---|
| T001 | 低 | 低 | ✅ 可行 | 独立 |
| T002 | 中 | 中 | ✅ 可行(需修订) | 处理反模式 + B1 |
| T003 | 低(仅修 bug) | 低 | ✅ 可行(范围缩减) | 彻底解耦延后 |
| T004 | 中 | 中 | ✅ 可行 | 独立 |
| T005 | 中 | 中 | ✅ 可行 | 需先调查 PromptEditor |

阶段 0 整体风险从"中"降为"低-中"(T003 范围缩减)。
