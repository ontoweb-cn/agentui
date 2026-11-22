# 测试大纲 — T4.1a(module: ragflow-t41a)

> 日期:2026-11-22;步骤 3+4。截图目录:`tests/e2e-tests/results/ragflow-t41a/`
> 隔离:R3/R5 — 单测用 mock/夹具,不写生产数据;e2e 前缀 `e2e-t41a-`
> R6:真浏览器分享页走查预登记 L-T41A-01(需登录态+嵌入会话)

## 步骤 3 差异清单(手册↔代码)

| # | 手册口径 | 代码现状 | 处置 |
|---|---|---|---|
| D1 | 分享页按多 provider 显示联网 | 仅 RAG `has_tavily_key`;前端已写 `??` 回落 | **必修** BFF 聚合产出 `has_web_search_provider` |
| D2 | 公开 info 不回传 Key | RAG info 已只出 bool;BFF enrich 须保持 | 验收断言响应无 `*_api_key` |
| D3 | 切换服务商 Key 保留 | PATCH 整包透传,无写侧 prune | **保持**;④ 写侧过滤延期 T4.2 |
| D4 | GET 会话可供聚合读 PC | `normalizeSession` 丢 `prompt_config` | **必修** metadata 透传 |
| D5 | 非法 PATCH 400 | T2.7 已落地 | 回归既有用例 |

## 用例矩阵

| 用例 | 层级 | 目的 | 优先级 |
|---|---|---|---|
| TC-T41A-01 | BFF unit | `hasWebSearchProviderConfig` 纯函数:14 provider / keyless / legacy Tavily / 清除 / 缺 key | P0 |
| TC-T41A-02 | BFF unit | `buildExternalChatInfoFromPromptConfig` 产出双 flag 且无 key 字段泄漏 | P0 |
| TC-T41A-03 | BFF route | GET chatbots/:id/info enrich:Gateway 有 PC → has_web_search_provider=true | P0 |
| TC-T41A-04 | BFF route | Gateway 无 session → 回落 RAG 响应;保留 has_tavily_key;尽量补算 | P0 |
| TC-T41A-05 | BFF route | enrich 响应体不含任何 `*_api_key` | P0 |
| TC-T41A-06 | BFF adapter | getSession normalize 后 metadata 含 prompt_config/kb_ids | P1 |
| TC-T41A-07 | BFF 回归 | T2.7 非法 provider / 缺 key 仍 400 | P0 |
| TC-T41A-08 | BFF 回归 | PATCH 多 key 共存整包透传(① 复核,证 ④ 未误 prune) | P0 |
| TC-T41A-09 | 前端(可选) | share showInternet 优先 has_web_search_provider | P2 既有代码只读 |
| TC-T41A-10 | E2E 真浏览器 | 配置 Exa+Key → 嵌入页显示联网 | P1 **受限 L-T41A-01** |

## 夹具

- `fixtures/ragflow-t41a/prompt-config-*.json`:keyless / keyed / legacy-tavily / cleared / multi-key
- 路由测试 mock Gateway GET + 可选 RAG upstream
