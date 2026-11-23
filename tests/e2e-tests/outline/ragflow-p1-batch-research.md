# 调研笔记 — RAGFlow UI 对齐 P1 剩余批次(module: ragflow-p1-batch)

> 日期:2026-11-22;方法:九步交付法步骤 1
> 范围:清单 v3 P1 剩余项 **T2.8 / T2.3 / T1.4 / T2.9 / T2.1 / T2.2 / T2.7**(T2.4 无独立动作,决策已并入 T4.1a/T4.2;T2.5/T2.6 清单自身排定"下个迭代",不在本批)
> 上游基线:`infiniflow/ragflow @ 91c702e`(与既有移植文件 provenance 一致)

## 1. 靶点定位(全部已读源码)

| 靶点 | 文件 | 现状 |
|---|---|---|
| T2.3 | `src/pages/next-chats/chat/app-settings/use-chat-setting-schema.tsx` | hook 内联 schema,无纯构建器、无 useMemo |
| T2.9 | 同上 + `validate-chat-prompt.ts`(缺失) | superRefine 仅 missing-key 一条;agentui 自 fork 起 `chatPromptKbIssues` 缺失 |
| T1.4 | `app-settings/` 测试族(缺失) | 现仅有 `web-search-api-key.test.ts`(纯函数层) |
| T2.8 | `app-settings/chat-settings.tsx`(onInvalid 为 `void errors` 空操作)、`chat-prompt-engine.tsx`(Collapse 非受控) | 错误有处渲染但折叠面板看不见、无滚动聚焦 |
| T2.1 | `chat-settings.tsx` reset effect(L116-139) | 未做 `getWebSearchProvider(...) ?? ''` 归一,legacy 对话设置页 provider 不回显 |
| T2.2 | `src/components/web-search-form-field.tsx`(providerKeyConfig 字面量)+ `web-search-api-key.ts`(webSearchApiKeyFields 字面量) | 两份映射并存,新增 provider 需改 5 处 |
| T2.7 | `bff/src/routes/bff-agents.ts` PATCH(L244-308,T2.10 后透传 title/kb_ids/prompt_config) | 无 provider 枚举/key 校验,superRefine 可被直调绕过 |

## 2. 上游源码取证(经 GitHub raw @91c702e 全文取回)

- `app-settings/use-chat-setting-schema.tsx`:纯构建器 `buildChatSettingFormSchema(t)` + hook `useMemo`;superRefine = `chatPromptKbIssues` 循环 + `missingWebSearchApiKeyField`。
- `app-settings/validate-chat-prompt.ts` + 测试:两条规则——①绑定知识库且 system 非空但缺 `{knowledge}` → issue(system);②未绑定知识库且 empty_response 非空 → issue(empty_response)。
- `app-settings/use-reveal-submit-errors.ts` + 测试:4 个 section 开合态 + `invalidSubmitSignal` 计数器 + `formContainerRef`;错误指示选择器 `[aria-invalid="true"], [id$="-form-item-message"]`;`scrollIntoView({behavior:'smooth', block:'center'})`。
- `app-settings/chat-settings.tsx`:reset effect 含 `web_search_provider: getWebSearchProvider(data.prompt_config) ?? ''`(= T2.1 上游实现形态);`handleSubmit(onSubmit, handleInvalidSubmit)`(= T2.8 接线形态)。
- `app-settings/chat-prompt-engine.tsx`:受控展开 props(advanced/naive/agentic)。
- 上游测试族:`chat-setting-schema.test.ts`(纯构建器)、`use-chat-setting-schema.test.tsx`(renderHook)、`validate-chat-prompt.test.ts`、`use-reveal-submit-errors.test.tsx`。

## 3. 运行时证据与关键判断

- **`{knowledge}` 在 agentui 是活跃运行时概念**:zh/en 语言包默认系统模板内嵌 `{knowledge}`(zh L942-957 / en L1040-1057),`variableTip` 明示其为预留变量;检索执行在 intellect-rag fork(上游同款语义)。→ **T2.9 裁决:选项 1(移植)**。
  - 存量回归风险实测评估:生产 BFF 未完成首装登记(L-10,backendCount:0),生产无存量对话;默认模板自带 `{knowledge}`,校验仅命中"绑库且自定义 prompt 删掉了占位符"的错误配置类。决策与依据记入清单 v3→v4。
- **T2.9 附带键缺失**:`knowledgePlaceholderMessage` 全仓无(zh/en 需新增);`emptyResponseMessage` 各语言已存在。
- **shadcn 原语兼容**:`ui/form.tsx` `formMessageId = ${id}-form-item-message`、FormControl `aria-invalid={!!error}` — 上游错误指示选择器原样可用(只读核查 ui/,不改)。
- **Collapse 已支持受控**(`src/components/collapse.tsx` open/onOpenChange),T2.8 只需接线。
- **LlmSettingFieldItems** `showCollapse` 的 collapseProps 不透传 open(L90-91):模型设置折叠区内无校验错误字段(system/empty_response/web key 全在高级设置 Collapse),**modelSettingOpen 不接线**,记为适配差异。
- **agentui 无 naive/agentic section** → hook 保留 4 态(上游对齐)但只接 advanced。
- **parameters key 校验**:agentui `DynamicVariableForm` append `{key: undefined}` 可存空键;上游 schema `key: z.string().min(1, t('variableKeyMessage'))`。随 T2.3 照搬(空键变量无意义),`variableKeyMessage` zh/en 新增。
- **T2.2 派生规律成立**:14 个 provider 的 enum 值首字母小写化后即得键基元(`Search1API→search1api`、`YouCom→youcom`、`SearchApi→searchapi`),field=`${base}_api_key`、tip=`${base}ApiKeyTip`、placeholder=`${base}ApiKeyMessage` 全部吻合现有字面量——可安全以派生替代两份手写映射。
- **jest 资产 mock 已备**(`__mocks__/fileMock.js` 覆盖 webp/png/svg)→ catalog(含 logo import)可测。
- **BFF PATCH 测试挂点**:`bff-agents.test.ts` L550-664 describe(T2.10)+ L1359 体积上限 describe,MockSetup/createApp 夹具可复用。

## 4. 门禁基线(实施前)

- BFF:`npx vitest run`(基线 1122/1122);前端 jest(基线 750/750);type-check 三守卫。
- jest 需 `ESBUILD_BINARY_PATH=/tmp/esb025/node_modules/esbuild/bin/esbuild`(清单 v3 备忘,Linux 口径;Windows 本机按 jest.config 走自定义 transformer 实测为准)。

## 5. 风险与取舍(预登记)

| 风险 | 处置 |
|---|---|
| T2.9 移植后"绑库+无 {knowledge}"存量对话保存被阻 | 生产无存量(L-10);错误信息明确指引;发布说明记录行为变化 |
| T2.7 直调存量数据含未知 provider → 后续保存全被 400 | 枚举 14 值覆盖全部表单来源;`''`/缺失放行;测试覆盖 |
| T2.8 真浏览器滚动行为 jsdom 不可测 | jsdom 组件级断言(开合/焦点/scrollIntoView mock)+ 真浏览器走查列入受限项,环境可用时补 |
| T2.2 派生替代字面量引漂移 | 既有 14-provider 映射测试全量保留作回归网;新增 catalog 完备性守卫测试 |
