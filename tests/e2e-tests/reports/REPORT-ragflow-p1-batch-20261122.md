# 九步交付报告 — RAGFlow P1 剩余批次(module: ragflow-p1-batch)

> 日期:2026-11-22;方法:九步交付法;spec:[ragflow-p1-batch-spec.md](../spec/ragflow-p1-batch-spec.md)(用户指令预授权,连续执行);关联清单:[ragflow-ui-alignment-followup-tasks.md v4](../../docs/ragflow-ui-alignment-followup-tasks.md)

## 一、结论摘要

| 交付项 | 状态 | 验收证据 |
|---|---|---|
| **T2.3** schema 纯构建器 + useMemo | **完成**(`ff76959`) | `buildChatSettingFormSchema(t)` 导出,hook `useMemo` 包装;上游模式照搬,agentui 字段差异保留(tts/use_kg/reference_metadata/vector 权重) |
| **T2.9** KB 校验移植 + 决策 | **完成,裁决=移植**(`ff76959`) | `validate-chat-prompt.ts` 零漂移移植 + superRefine 接入;决策依据:zh/en 默认模板与 variableTip 内嵌 `{knowledge}`(运行时语义活跃)+ 生产无存量对话(L-10);zh/en 新增 `knowledgePlaceholderMessage` |
| **T1.4** schema 测试族移植 | **完成**(`ff76959`) | 3 个测试文件 19 例全绿;最少 3 断言全覆盖(Search1API 缺 key 路径断言 / `''` 清除 parse 通过 / AnySearch keyless 通过)+ KB 七分支 + 空 system/空变量名 |
| **T2.8** 保存错误揭示机制 | **完成**(`f73e588`) | hook 移植 + ChatSettings 接线(handleInvalidSubmit + formContainerRef)+ ChatPromptEngine 受控展开;**关键配套:`collapse.tsx` 移植上游渲染期受控版本**;组件级集成测试实证:无效提交 → 面板展开 + FormMessage 可见 + scrollIntoView(smooth/center)定位于错误指示元素 |
| **T2.1** legacy Tavily 预选 | **完成**(`f70df0f`) | reset effect `getWebSearchProvider(...) ?? ''`(上游同款);组件级 3 例:legacy 预选 + Key 回填 / 新对话不预选 / 显式清除不回落 |
| **T2.2** provider 目录单一来源 | **完成**(`f70df0f`) | `web-search-catalog.ts`(仅 name/logo/helpUrl);字段名与 Tip/Message 键由 `webSearchProviderBaseKey` 派生;守卫测试:枚举↔catalog 一一对应 + 派生 field 全量一致 + 56 个派生语言键 zh/en 存在 |
| **T2.7** BFF PATCH 校验镜像 | **完成**(`d2bc74c`) | `bff/src/utils/web-search-validation.ts` 纯函数 + PATCH 路由 400;10 例纯函数 + 7 例路由用例 |
| 守卫修复(批次外最小修复) | **完成**(`98c921d`) | main 合入(v0.4.6)在 login-next 新增 amber 裸色横幅(3 处命中,5→8)打破 color-tokens 守卫 → 等义替换 `state-error` 语义 token,守卫恢复绿 |

## 二、用例执行结果(TC 矩阵,见 [outline](../outline/ragflow-p1-batch.md))

| 用例 | 层级 | 结果 | 说明 |
|---|---|---|---|
| TC-RP1-01/03 schema+KB 规则 | jest | **PASS**(13 例) | `chat-setting-schema.test.ts` + `validate-chat-prompt.test.ts` |
| TC-RP1-02 hook 形态 schema | jest | **PASS**(6 例) | renderHook + save/reload 往返 |
| TC-RP1-04 揭示 hook | jest | **PASS**(3 例) | 上游 harness 语义还原 |
| TC-RP1-05 组件级无效提交 | jest | **PASS**(2 例) | 真实 ChatSettings + 沉重组件 mock;断言面板展开/FormMessage/scroll 目标 |
| TC-RP1-06 legacy 预选 | jest | **PASS**(3 例) | 含面板展开前置操作 |
| TC-RP1-07 catalog 完备性 | jest | **PASS**(5 例) | 三处对齐守卫 |
| TC-RP1-08/09 BFF 校验 | vitest | **PASS**(17 例) | 纯函数 10 + 路由 7 |
| TC-RP1-10 真浏览器走查 | E2E | **受限**(L-RP1-01) | 见 §四 |

## 三、交付物清单

- 代码:`src/pages/next-chats/chat/app-settings/{use-chat-setting-schema.tsx,validate-chat-prompt.ts,use-reveal-submit-errors.ts,chat-settings.tsx,chat-prompt-engine.tsx}`、`src/components/{collapse.tsx,web-search-form-field.tsx}`、`src/pages/next-chats/chat/{web-search-api-key.ts,web-search-catalog.ts}`、`bff/src/{routes/bff-agents.ts,utils/web-search-validation.ts}`、`src/locales/{zh,en}.ts`(2 键)、`jest.config.ts`(mapper 顺序)
- 测试资产:app-settings 下 5 个测试文件 + `web-search-catalog.test.ts`(32 新例)
- 文档:手册 [chat-settings-web-search-manual.md](../../docs/chat-settings-web-search-manual.md)、调研笔记、大纲、5 组用例、spec、本报告;清单升 v4
- 提交:`ff76959` → `f73e588` → `f70df0f` → `d2bc74c` → `98c921d`(另 docs 提交见文末)

## 四、受限注记专节

| 编号 | 内容 |
|---|---|
| L-RP1-01 | TC-RP1-10 真浏览器走查未执行(需本地登录态 + 已注册后端/存量对话);以 TC-RP1-05/06 组件级证据代验,环境可用后补跑 |
| L-RP1-02 | 空变量名 zod required_error 为英文原文("Required"),上游同款照搬,非本批范围 |
| L-RP1-03 | **main 合入(v0.4.6)遗留 BFF tsc 9 处类型错误**(`auth.ts` ×6 / `auth.test.ts` ×1 / `backchannel-logout.ts` jose 类型 ×2)——vitest 1187/1187 全绿、运行时无碍;本批门禁 = vitest 全绿 + tsc 错误集不新增(实测 delta=0,本批文件零污染);根因修复单独立项 |
| L-RP1-04 | main 合入遗留 login-next 裸色值破守卫——**已顺手修复**(`98c921d`,1 行等义替换),登记以说明批次外改动缘由 |
| L-RP1-05 | 三跑并行时 jest 出现 1 例超时偶发(资源竞争),单独串行复跑 782/782 全绿;回归口径以串行为准 |
| — | 前端 jest 基线漂移说明:750→782 为本批 +32 例;BFF 1170→1187 为 main 合入 SSO 批次(+48)与本批(+17)叠加 |

## 五、遗留建议(不阻塞)

1. **T4.1a 尽早发起**——`has_web_search_provider` 聚合位仍是分享页修复实际生效的前提;
2. L-RP1-03 的 BFF tsc 修复(auth context 类型收窄 + jose 类型用法)建议随下个 BFF 批次清偿;
3. T2.5 第一步(ee 骨架)/T2.6(oxlint)按下个迭代节奏;
4. `use-reveal-submit-errors` 的 model/naive/agentic 四态在 agentui 仅接 advanced——若未来引入模型设置外的错误字段,补接线即可;
5. 真浏览器 E2E(含 legacy 预选与揭示视觉验证)待环境就绪补 TC-RP1-10。

## 六、九步闭环声明

调研 ✅(上游 91c702e 全文取证 + 本仓 9 靶点源码定位);手册 ✅(§2 新建);双向检视 ✅(差异并入调研 §3:模型折叠区无错误字段→modelSettingOpen 不接线等);大纲用例 ✅(10 TC + R6 预登记);基线/执行 ✅(前端 750/750、BFF 1170/1170 实测);批准门 ✅(用户指令预授权);实施 ✅(4 代码提交,每项含测试);审查+构建 ✅(自审查 diff + 门禁三面);回归 ✅(**前端 jest 60 套件 782/782、BFF vitest 67 文件 1187/1187、三守卫全绿**;BFF tsc delta=0);终检/归档/记忆 ✅(本报告 + 清单 v4 + CLAUDE.md 测试基建备忘)。受限项编号登记,未伪造通过。
