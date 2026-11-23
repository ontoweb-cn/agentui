# 测试大纲 — Chat 会话加载(module: chat-session-load)

关联分析:`docs/chat-session-load-error-analysis.md`;spec:`../spec/chat-session-load-spec.md`。

## 范围

| 任务 | 内容 |
|---|---|
| F-01 | BFF 404 误判(id 含 404) |
| F-02 | 前端加载失败显式错误态 |
| F-03 | i18n zh/en |
| — | Gateway 500 / 脏列表 / 双 toast → 受限不测通 |

## 五轴

- 正常:结构化 404 → 404;合法 session 加载(回归不破坏)  
- 边界:id 含 `404` + 上游 500 → 502  
- 错误:前端非 new 加载失败 → alert + 重试  
- 联动:返回聊天列表导航  
- 回归:BFF bff-agents 全套 + type-check
