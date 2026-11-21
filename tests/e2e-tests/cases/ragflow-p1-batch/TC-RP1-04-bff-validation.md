# TC-RP1-08 BFF 校验纯函数 + TC-RP1-09 PATCH 路由校验

> 组:ragflow-p1-batch / BFF vitest;隔离:MockSetup 内存夹具,无网络
> 关联:手册 §4(末行技术口径);任务 T2.7

## TC-RP1-08 纯函数(bff/src/utils/web-search-validation.ts)

| # | 操作 | 预期 |
|---|---|---|
| 1 | 合法 keyed provider + key | ok |
| 2 | keyed provider 缺 key / 全空白 key | 不 ok,message 含字段名 |
| 3 | keyless(anysearch/youcom)无 key | ok |
| 4 | web_search_provider='' 或 缺失 | ok |
| 5 | 未知 provider 字符串 | 不 ok,message 含 'unknown web_search_provider' |
| 6 | legacy(仅 tavily_api_key,无 provider) | ok |
| 7 | snake_case 与 camelCase 键名双兼容 | 均识别 |

## TC-RP1-09 PATCH 路由(BFF)

| # | 操作 | 预期 |
|---|---|---|
| 1 | 合法 prompt_config 保存 | 200,透传不变 |
| 2 | prompt_config 含 tavily 无 key | 400,message 含字段名 |
| 3 | prompt_config 含未知 provider | 400 |
| 4 | 无 prompt_config(仅 title/kb_ids) | 200(校验不误伤) |
| 5 | prompt_config 非 JSON 对象 | 200 不透传(既有 T2.10 语义保持) |

> 回归修订日期:2026-11-22(首次建档)
