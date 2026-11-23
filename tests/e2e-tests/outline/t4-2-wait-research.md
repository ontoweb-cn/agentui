# 调研 — T4.2 / 写侧 prune 等待 Gateway(module: t4-2-wait)

## L-T42-01

设计已完成:`docs/web-search-secret-storage-design.md`(方案 C,M0–M4)。  
本仓 `sanitizePromptConfigWebSearchKeys` 已就绪但 **PATCH 不接线**(与「换回不丢 key」冲突,定案延期至 secrets 表落地)。

**退出条件**:Gateway **实现** `web_search_secrets` API 后再开九步 module `t42-m1-wire`。

> 2026-11-23:agentui 侧契约草案已出 — [web-search-secrets-gateway-api-contract.md](../../../docs/web-search-secrets-gateway-api-contract.md);Gateway 实现仍缺 → L-T42-01。
