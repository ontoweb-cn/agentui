# T002/T003 前置调查报告

> **Date**: 2026-07-13
> **Parent**: [phase0-detailed-tasks.md](./phase0-detailed-tasks.md) §T002.1 / §T003.2
> **Status**: 调查完成,方案已评审修订,阶段 0 已实施完成(2026-07-13)
>
> **⚠️ 评审后状态**:本报告记录的是调查阶段的事实发现与初步选型。调查后进行了方案技术评审(见 [phase0-t002-t003-review.md](./phase0-t002-t003-review.md)),评审结论修订如下:
> - **T002**:方案 B 基本可行,但需修订(处理 `buildQueryVariableOptionsByShowVariable` 反模式 + B1 设计),详见 §1.3 修订说明
> - **T003**:方案 B **不可行**(反向依赖 + 类型不一致),改为**方案 G**(仅修 bug,彻底解耦延后到 BFF 统一 API),详见 §2.3 修订说明
>
> **最终方案以 [phase0-detailed-tasks.md](./phase0-detailed-tasks.md) 为准**。本报告保留调查事实,选型结论以修订后的为准。

## 一、T002.1 调查:`knowledge-base-item.tsx` 调用方

### 1.1 调查结果

`KnowledgeBaseFormField` 共 3 个调用方(不含自身定义):

| # | 调用方文件 | 所在 feature | showVariable | 在 FormProvider 内 | 其他画布依赖 |
|---|---|---|---|---|---|
| 1 | [pages/agent/form/retrieval-form/next.tsx#L92](../../src/pages/agent/form/retrieval-form/next.tsx) | **画布** | `true` | 是(画布 FormSheet) | 无 |
| 2 | [pages/next-search/search-setting.tsx#L357](../../src/pages/next-search/search-setting.tsx) | **search**(非画布) | 未传(默认 `false`) | 是(search 设置表单) | 无 |
| 3 | [pages/next-chats/chat/app-settings/chat-basic-settings.tsx#L66](../../src/pages/next-chats/chat/app-settings/chat-basic-settings.tsx) | **chat**(非画布) | 未传(默认 `false`) | 是(chat 设置表单) | 无 |

`useDisableDifferenceEmbeddingDataset` 仅在 `knowledge-base-item.tsx` 内部使用,无外部调用方。

### 1.2 关键发现

1. **`showVariable=true` 仅画布使用**:只有 `retrieval-form/next.tsx` 传了 `showVariable`,且这是唯一触发 `useBuildQueryVariableOptions`(画布 hook)的路径
2. **2 个非画布调用方都走 `showVariable=false`**:`next-search` 和 `next-chats` 都未传 `showVariable`,因此不会调用画布 hook
3. **非画布调用方完全不需要画布能力**:它们的 `showVariable=false` 分支只构建 `knowledgeOptions`(知识库列表),不涉及变量引用

### 1.3 方案选型结论(评审后修订)

> **初步选型**:方案 B(通用版本 + 画布扩展版本)
> **评审修订**:方案 B 可行,但需处理 `buildQueryVariableOptionsByShowVariable` 反模式(T-R1)+ 采用 B1 设计(hook + UI 子组件拆分,T-R2)
> **评审详见**:[phase0-t002-t003-review.md](./phase0-t002-t003-review.md) §一

**采用方案 B(评审后修订)**:通用版本拆为 hook + UI 子组件,画布扩展版本调用两者。

**理由**(调查事实):
- 2 个非画布调用方(search + chat)需要继续使用 `KnowledgeBaseFormField`,不能整体迁入画布
- 但它们都不需要 `showVariable` 能力,因此通用版本可以不依赖画布 hook
- `showVariable=true` 仅画布需要,可作为画布专属扩展

**具体实施**(评审后):
- 通用版本 `src/components/knowledge-base-item.tsx`(改造):
  - **移除 `buildQueryVariableOptionsByShowVariable` 反模式**(T-R1)
  - **移除 `useBuildQueryVariableOptions` import**
  - **移除 `showVariable` prop**(通用版本不再支持)
  - 新增导出 `KnowledgeBaseSelect` UI 子组件(接收 `options` prop,渲染 IntellectFormItem + MultiSelect)
  - `KnowledgeBaseFormField` 改为:调用 `useDisableDifferenceEmbeddingDataset` + `KnowledgeBaseSelect`(仅 datasetOptions)
- 画布扩展版本 `src/pages/agent/form/components/knowledge-base-form-field.tsx`(新建):
  - `AgentKnowledgeBaseFormField`:调用 `useDisableDifferenceEmbeddingDataset`(从通用导出)+ `useBuildQueryVariableOptions`(画布 hook)+ 合并 options + `KnowledgeBaseSelect`(通用 UI)
  - `retrieval-form/next.tsx` 改为 import 画布扩展版本

**优势**:
- 非画布调用方零改动(继续 import 通用版本,无 showVariable)
- 画布调用方仅改 1 处 import(`retrieval-form/next.tsx`)
- 通用版本彻底脱离画布依赖

### 1.4 修订 T002 子任务(评审后)

> **最终方案以 [phase0-detailed-tasks.md §T002](./phase0-detailed-tasks.md) 为准**

- [x] T002.1 调查调用方(本文档完成)
- [x] T002.2 选型:方案 B(评审后修订)
- [ ] T002.3 实施方案 B(评审后):
  - 改造 `src/components/knowledge-base-item.tsx`:移除反模式 + 移除 hook import + 移除 showVariable + 新增 KnowledgeBaseSelect UI 子组件
  - 新建 `src/pages/agent/form/components/knowledge-base-form-field.tsx`:画布扩展版本
  - 修改 `src/pages/agent/form/retrieval-form/next.tsx`:import 改为画布扩展版本
- [ ] T002.4 验证:
  - `tsc --noEmit` 零错误
  - 画布 retrieval-form:知识库选择 + 变量选项构建正常
  - next-search 设置页:知识库选择正常
  - next-chats 设置页:知识库选择正常
  - `grep -rn "useBuildQueryVariableOptions\|buildQueryVariableOptionsByShowVariable" src/components/` 返回空

---

## 二、T003.2 调查:`floating-chat-widget.tsx` 归属

### 2.1 调查结果

#### widget 路由注册

| 路由路径 | feature | 组件 | 说明 |
|---|---|---|---|
| `/chats/widget` | **chats** | [pages/next-chats/widget/index.tsx](../../src/pages/next-chats/widget/index.tsx) | chat widget 入口,渲染 `<FloatingChatWidget />` |

**关键发现**:`FloatingChatWidget` **仅在 `features/chats` 注册一次**,`features/agents` 下**没有** widget 路由。

#### agent 分享页(`/agent/share`)

[pages/agent/share/index.tsx](../../src/pages/agent/share/index.tsx) 是 agent 分享页:
- **不使用** `FloatingChatWidget`
- 直接使用 `useSendNextSharedMessage` + `NextMessageInput` + `MessageItem`
- 是完整的分享页 UI(非 iframe widget)

#### widget 内部的 `from` 参数逻辑

`floating-chat-widget.tsx` L103:`const isFromAgent = from === SharedFrom.Agent;`

- `from=Agent` → 调 `useSendNextSharedMessage`(画布 hook)
- `from=Chat` → 调 `useSendSharedMessage`(chat hook)

但 widget 路由仅在 `features/chats` 注册(`/chats/widget`),说明:
- widget 的访问者通过 URL 参数 `from=agent|chat` 区分场景
- 即使是 agent 分享的 widget,也通过 `/chats/widget?from=agent` 访问(而非 `/agent/widget`)

#### 两个 hook 的差异对比

| 维度 | `useSendNextSharedMessage`(画布) | `useSendSharedMessage`(chat) |
|---|---|---|
| 文件位置 | `pages/agent/hooks/use-send-shared-message.ts` | `pages/next-chats/hooks/use-send-shared-message.ts` |
| API URL | `/api/v1/agentbots/{id}/completions` | `/api/v1/{agentbots\|chatbots}/{id}/completions`(根据 from 动态) |
| 底层 hook | `useSendAgentMessage`(画布 chat hook) | `useSendMessageWithSse`(通用 SSE hook) |
| 任务模式 | 支持 `AgentDialogueMode.Task`(自动发送) | 不支持 |
| 依赖 | `buildRequestBody` / `BeginQuery` / `AgentDialogueMode`(画布) | 无画布依赖 |
| 复杂度 | 高(画布 chat 逻辑) | 低(通用 SSE) |

### 2.2 关键发现

1. **widget 仅在 chats feature 注册**:`FloatingChatWidget` 的路由入口是 `/chats/widget`,属于 `features/chats`,不属于画布
2. **agent 分享页不用 widget**:`/agent/share` 是独立完整页面,不渲染 `FloatingChatWidget`
3. **widget 通过 `from` 参数复用**:同一 widget 实例同时服务 agent 和 chat 两种分享场景,通过 URL 参数区分
4. **chat 版 hook 无画布依赖**:`useSendSharedMessage`(chat)完全通用,基于 `useSendMessageWithSse`
5. **agent 版 hook 深度依赖画布**:`useSendNextSharedMessage` 依赖 `useSendAgentMessage` / `buildRequestBody` / `BeginQuery` / `AgentDialogueMode`

### 2.3 方案选型结论(评审后修订)

> **初步选型**:方案 B(通用外壳 + props 注入 sendMessage hook)
> **评审修订**:方案 B **不可行**(反向依赖 + 类型不一致),改为**方案 G**(仅修 bug,彻底解耦延后到 BFF 统一 API)
> **评审详见**:[phase0-t002-t003-review.md](./phase0-t002-t003-review.md) §二

**方案 B 不可行原因**(评审发现):
- **反向依赖**(T-R3):chat 入口注入画布 hook 造成 chats → agent 泄漏,泄漏方向变了但依然存在
- **类型不一致**(T-R4):两个 hook 返回类型差异巨大(chat 版有 `loading`/`stopOutputMessage`/`scrollRef`,agent 版有 `parameterDialogVisible`/`inputsData`/`isTaskMode`/`ok`),无法定义统一 props 接口

**采用方案 G**:阶段 0 仅修复 hook 调用 bug,彻底解耦依赖 BFF 统一 API(方案 F),留到后续 spec。

**具体实施**(方案 G):
- 阶段 0 仅修复 [floating-chat-widget.tsx](../../src/components/floating-chat-widget.tsx) L138-140 / L158-160 的条件 hook 调用反模式
- 改为两个 hook 都调用,根据 `isFromAgent` 选择结果
- widget 彻底解耦依赖 BFF 统一 widget API(方案 F):
  - `/api/bff/widget/{id}/inputs` — 统一获取 inputs(BFF 内部按 from 路由)
  - `/api/bff/widget/{id}/completions` — 统一发送消息(BFF 内部按 from 路由)
- 留到 spec/008 后续或独立 spec 处理

**优势**:
- 阶段 0 范围可控(不引入 BFF 改动)
- 修复 latent bug(高优先级)
- 不引入反向依赖

### 2.4 修订 T003 子任务(评审后)

> **最终方案以 [phase0-detailed-tasks.md §T003](./phase0-detailed-tasks.md) 为准**

- [ ] T003.1 **修复 hook 调用反模式**(阶段 0 唯一任务)
  - 改为两个 hook 都调用,根据 `isFromAgent` 选择结果
  - 在文件头部添加 `// TODO(spec-009): 待 BFF widget API 统一后解耦` 注释

- [x] T003.2 调查归属(本文档完成)
- [x] T003.3 选型:方案 G(仅修 bug,彻底解耦延后)

- [ ] T003.4 **彻底解耦延后**(不在阶段 0 范围)
  - 依赖 BFF 统一 widget API(方案 F)
  - 留到 spec/008 后续或独立 spec 处理

- [ ] T003.5 验证(阶段 0 仅验证 bug 修复):
  - `tsc --noEmit` 零错误
  - `/chats/widget?from=chat`:chat 分享 widget 功能正常
  - `/chats/widget?from=agent`:agent 分享 widget 功能正常
  - iframe 嵌入场景:postMessage 通信正常
  - **注意**:`floating-chat-widget.tsx` 仍有 `pages/agent` import(已知泄漏,SC-002 豁免)

---

## 三、调查总结(评审后)

### 方案选型汇总(评审后)

| 任务 | 调查前方案 | 调查后初选 | 评审后最终方案 | 理由 |
|---|---|---|---|---|
| T002 | 抽取 hook 通用部分 | 方案 B(通用+扩展) | **方案 B(修订)**:hook + UI 子组件拆分 | 调查:2 个非画布调用方走 showVariable=false;评审:需处理反模式(T-R1)+ B1 设计(T-R2) |
| T003 | 抽取 hook 通用部分 | 方案 B(通用外壳+props) | **方案 G**:仅修 bug,彻底解耦延后 | 调查:widget 属 chats feature;评审:方案 B 反向依赖(T-R3)+ 类型不一致(T-R4) |

### 修订后复杂度(评审后)

| 任务 | 调查前 | 调查后 | 评审后最终 | 说明 |
|---|---|---|---|---|
| T002 | 高 | 中 | **中** | 方案 B(修订):hook + UI 子组件拆分,逻辑清晰 |
| T003 | 高 | 中 | **低** | 方案 G:仅修 hook 调用 bug,彻底解耦延后 |

### 对 phase0-detailed-tasks.md 的修订(已落地)

本文档的调查结论 + 评审结论已更新到 [phase0-detailed-tasks.md](./phase0-detailed-tasks.md):
- T002 → 方案 B(修订):通用版本拆为 hook + UI 子组件 + 画布扩展版本
- T003 → 方案 G:仅修 bug,彻底解耦延后,SC-002 豁免 floating-chat-widget.tsx

### 风险降低

调查 + 评审后两项任务的风险显著降低:
- T002:非画布调用方明确(search + chat),方案 B(修订)保证它们零改动
- T003:方案 G 仅修 bug,不涉及架构改动;widget 彻底解耦延后到 BFF 统一 API

### 下一步

T002/T003 的方案已最终确定,可进入实施阶段。建议执行顺序:
1. T001(低复杂度,独立)
2. T002(中复杂度,方案 B 修订已明确)
3. T003(低复杂度,方案 G 仅修 bug)
4. T004(中复杂度,独立)
5. T005(中复杂度,需先调查 PromptEditor 依赖)
