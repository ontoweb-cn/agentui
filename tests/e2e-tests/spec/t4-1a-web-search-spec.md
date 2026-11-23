# Spec — T4.1a(module: t4-1a-web-search)

> 批准门:unfinished-batch-20261122 Module 2。

## 本批实施

1. `sanitizePromptConfigWebSearchKeys` + PATCH 接线  
2. `computeHasWebSearchProvider` 纯函数 + 单测  
3. 路由回归:透传前剥离非活动 key  

## 不实施(受限)

- L-T41A-01:分享页 `has_web_search_provider` 上游字段落地  
- L-T41A-02:Gateway 侧存储过滤(与 BFF 重复则不必;当前 BFF 先行)  
- T4.1b 检索联动  

## 门禁

`vitest`:`web-search-validation.test.ts` + `bff-agents.test.ts` 全绿。
