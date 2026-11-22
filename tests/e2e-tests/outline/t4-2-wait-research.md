# 调研 — T4.2 / 写侧 prune 等待 Gateway(module: t4-2-wait)

## L-T42-01

设计已完成:`docs/web-search-secret-storage-design.md`(方案 C,M0–M4)。  
本仓 `sanitizePromptConfigWebSearchKeys` 已就绪但 **PATCH 不接线**(与「换回不丢 key」冲突,定案延期至 secrets 表落地)。

**退出条件**:Gateway 提供 `web_search_secrets` API 契约后再开九步实现 module。
