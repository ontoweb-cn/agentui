# Spec — RAGFlow P1 剩余批次实施(module: ragflow-p1-batch)

> 日期:2026-11-22;**批准门:用户指示「调用九步交付技能实施“一、P1 主线:RAGFlow UI 对齐清单 v3 剩余项”」(预先授权)**,依据九步交付法"批准后连续执行至全部完成,不再中途确认"条款推进。

## 一、范围(7 项)

| 任务 | 交付物 | 实施要点 |
|---|---|---|
| T2.3 | `use-chat-setting-schema.tsx` 重构 | 导出纯构建器 `buildChatSettingFormSchema(t)`;hook 内 `useMemo`;保留 agentui 字段(tts/use_kg/reference_metadata/vector 权重),不引入 agentui 不存在的上游字段(agentic_rag/decision_id/rerank-candidates) |
| T2.9 | `validate-chat-prompt.ts` 移植 + 决策记录 | **裁决:移植**(依据:zh/en 默认模板与 variableTip 均内嵌 `{knowledge}`,运行时语义活跃;生产无存量对话,L-10);superRefine 接入;`knowledgePlaceholderMessage` zh/en 新增 |
| T1.4 | 测试族移植 | `chat-setting-schema.test.ts`(纯构建器)+ `use-chat-setting-schema.test.tsx`(renderHook)+ `validate-chat-prompt.test.ts`;按 agentui 现状取舍(弃 agentic_rag 断言,相似度权重用 vector 口径);最少 3 断言全覆盖 |
| T2.8 | 错误揭示机制 | 移植 `use-reveal-submit-errors`(+测试);`chat-prompt-engine.tsx` 加 `advancedSettingOpen/onAdvancedSettingOpenChange` 受控 props(agentui 仅一个 Collapse,naive/agentic/model 不接线记差异);`chat-settings.tsx` `handleSubmit(onSubmit, handleInvalidSubmit)` + `formContainerRef` |
| T2.1 | legacy Tavily 预选 | reset effect 加 `web_search_provider: getWebSearchProvider(data.prompt_config) ?? ''`(上游同款) |
| T2.2 | 映射收敛单一来源 | 新 `web-search-catalog.ts`(displayName/logo/helpUrl 真实数据);枚举首字母小写派生 base key → field/tip/placeholder 三态派生;`webSearchApiKeyFields` 由派生生成;新增 catalog 完备性守卫测试 |
| T2.7 | BFF PATCH 校验镜像 | 新 `bff/src/utils/web-search-validation.ts` 纯函数(枚举 14 值 + 必填 key + snake/camel 双兼容);PATCH 路由 promptConfig 透传前校验,非法 400;路由测试 + 纯函数测试 |

**不实施**(记录):T2.4(决策已定,实施并入 T4.1a/T4.2)、T2.5/T2.6(清单 v3 自身排定下个迭代)。

## 二、缺陷与修复方案取舍

- 基线发现 main 合入遗留 **BFF tsc 12 处类型错误**(auth/backchannel-logout/jose 类型,vitest 1170/1170 全绿)——**不在本批范围**,登记 L-RP1-03,本批 BFF 门禁 = vitest 全绿 + tsc 错误集不新增(delta 口径)。
- 空变量名 zod required_error 为英文原文(上游同款)——照搬,记 L-RP1-02。

## 三、门禁与验收

1. 前端 jest 全量 ≥ 750 通过 0 失败(新增用例净增);type-check 三守卫零错误;
2. BFF vitest 全量 ≥ 1170 通过 0 失败;BFF tsc 错误集与基线逐条一致(仅允许减少);
3. 每任务独立提交;清单 v3 状态回写(T2.1/T2.2/T2.3/T2.7/T2.8/T2.9/T1.4 → 已完成 + commit hash);
4. 报告归档 `tests/e2e-tests/reports/REPORT-ragflow-p1-batch-20261122.md`。

## 四、提交切分

1. `feat(chats): T2.3+T2.9+T1.4` — schema 纯构建器 + KB 校验移植 + 测试族
2. `feat(chats): T2.8` — 错误揭示机制
3. `feat(chats): T2.1+T2.2` — legacy 预选 + catalog 单一来源
4. `fix(bff): T2.7` — PATCH 校验镜像
5. `docs:` 清单回写 + 报告归档
