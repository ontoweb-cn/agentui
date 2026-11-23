# TC-RP1-06 legacy Tavily 预选 + TC-RP1-07 catalog 完备性

> 组:ragflow-p1-batch / 前端 jest;隔离:jsdom/localStorage 无网络
> 关联:手册 §2.3、§2.1;任务 T2.1、T2.2

## TC-RP1-06 legacy Tavily 预选

| # | 操作 | 预期 |
|---|---|---|
| 1 | 仅含 tavily_api_key 的 prompt_config → getWebSearchProvider | Tavily(既有 helper 已测;本组验证 reset 接线后组件级回显) |
| 2 | ChatSettings reset effect 接线后:data 无 provider 字段 | form 值 web_search_provider='tavily'(预选) |
| 3 | 新建空对话框 data(无 provider 无 key) | form 值 web_search_provider=''(不预选) |
| 4 | 显式 '' 的 data | form 值保持 ''(不回落 Tavily) |

## TC-RP1-07 catalog 完备性与派生一致性

| # | 操作 | 预期 |
|---|---|---|
| 1 | WebSearchProvider 枚举 14 值 ↔ catalog 条目 | 一一对应(不多不少),name/logo/helpUrl 非空 |
| 2 | 派生 field(base+'_api_key')↔ getWebSearchApiKeyField(provider) | 全 14 值一致 |
| 3 | 派生 tip/placeholder 键(`base}ApiKeyTip/Message`)在 zh/en 语言包存在 | 全 28 键存在 |

> 回归修订日期:2026-11-22(首次建档)
