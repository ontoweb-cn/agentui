# TC-RP1-01 纯构建器 schema 校验矩阵 + TC-RP1-03 chatPromptKbIssues 规则族

> 组:ragflow-p1-batch / 前端 jest;夹具:无(内联对象);隔离:纯函数无副作用
> 关联:手册 §3.3、§4;任务 T2.3、T2.9

## TC-RP1-01 buildChatSettingFormSchema(t)

| 项 | 内容 |
|---|---|
| 目的 | 纯构建器可脱离 renderHook 直接单测;四类保存阻断规则齐备 |
| 前置 | T2.3 完成(导出纯构建器) |
| 数据 | 内联 BaseValues(name/icon/dataset_ids/prompt_config/use_kg/similarity/top_n 等) |
| 优先级 | P0 |
| 关联 | 手册 §3.3、§4 |

| # | 操作 | 预期 |
|---|---|---|
| 1 | system='' parse | fail;issue path ['prompt_config','system'] message 'systemMessage' |
| 2 | dataset_ids=['kb1'] + system 无 {knowledge} | fail;path ['prompt_config','system'] message 'knowledgePlaceholderMessage' |
| 3 | parameters=[{key:''}] | fail;path ['prompt_config','parameters',0,'key'] message 'variableKeyMessage' |
| 4 | provider=Search1API 无 key | fail;path ['prompt_config','search1api_api_key'] message 'webSearchApiKeyRequired' |

## TC-RP1-03 chatPromptKbIssues(上游七分支)

| # | 操作 | 预期 |
|---|---|---|
| 1 | 绑库 + system 无 {knowledge} | issue(system, knowledgePlaceholderMessage) |
| 2 | 绑库 + system 含 {knowledge} | [] |
| 3 | 绑库 + system='' | [](min(1) 兜底) |
| 4 | 未绑库 + empty_response 非空 | issue(empty_response, emptyResponseMessage) |
| 5 | 未绑库 + empty_response='' | [] |
| 6 | 绑库 + empty_response 非空 | [] |
| 7 | 未绑库 + empty_response 全空白 | [] |

> 回归修订日期:2026-11-22(首次建档)
