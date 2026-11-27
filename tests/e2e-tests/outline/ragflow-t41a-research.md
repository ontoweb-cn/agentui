# 调研笔记 — T4.1a Gateway/BFF 联网搜索聚合与存储侧(module: ragflow-t41a)

> 日期:2026-11-22;方法:九步交付法步骤 1
> 基线:`dev` @ `d208f4b`(P1 批次 + T2.5 第一步 + 复评闭环已合入)
> 范围:清单 v5 **T4.1a**(含 T2.4 存储侧协同口径);T4.1b / T4.2 / T2.6 / T2.5 第二步不在本批
> 上游对照:RAGFlow Querit PR #17813 在 `chatbots/{id}/info` 增 `has_web_search_provider`(保留 `has_tavily_key`)

## 1. 靶点定位(已读源码)

| 子项 | 文件 | 现状 |
|---|---|---|
| ① prompt_config 透传 | `bff-agents.ts` PATCH L241-314;enterprise adapter `updateSession` L244-265 | **已完成**(T2.10 `7de6206`);Gateway 整列替换,无裁剪 provider key 白名单 |
| ② 聚合位 | 前端 `share/index.tsx` L118-120;`IExternalChatInfo`;`useFetchExternalChatInfo` → `/api/bff/proxy/v1/chatbots/{id}/info` | 前端已消费;`has_web_search_provider` **无任何后端生产者**(仅 RAG `has_tavily_key`) |
| ③ PATCH 校验 | `bff/src/utils/web-search-validation.ts` + `bff-agents.ts` L292-297 | **已完成**(T2.7 `d2bc74c`) |
| ④ 存储侧过滤 | PATCH 透传整包 | **未做**;T2.4 选定"短期整包保体验,过滤并入 T4.1a/T4.2" |
| GET 丢字段 | enterprise `normalizeSession` L593-614 | 仅保留 id/title/timestamps,**丢弃** `prompt_config`/`kb_ids`——阻塞从 BFF GET 聚合 |

## 2. 调用链(分享页)

```text
share/index.tsx
  → useFetchExternalChatInfo (use-chat-request.ts L868)
  → chatService.fetchExternalChatInfo
  → GET /api/bff/proxy/v1/chatbots/{shared_id}/info
  → BFF proxy.ts catch-all → intellect-kb-app GET /api/v1/chatbots/{id}/info
  → 仅返回 has_tavily_key=bool(tavily_api_key.strip())
```

认证态设置保存(对照):

```text
ChatSettings → useUpdateChat → PATCH /api/bff/agents/chat/sessions/:id
  → validateWebSearchPromptConfig → adapter.updateSession
  → Gateway PATCH /api/sessions/{id} (prompt_config 整列替换)
```

嵌入 `token` = Gateway **session id**(`sessions.tsx` EmbedDialog);info API 却按 RAG **dialog id** 查——拓扑分叉是聚合位落点必须在 BFF/Gateway 的根因。

## 3. 上游语义(应镜像)

`has_web_search_provider` ≡ 活动 provider 可用:
- keyless(`anysearch`/`youcom`)选中即 true;
- 其余需非空对应 `*_api_key`;
- legacy:无 provider 但有 `tavily_api_key` → 视为 Tavily 可用(前端 `getWebSearchProvider`/`hasWebSearchProvider` 已实现)。

agentui 前端权威实现:`src/pages/next-chats/chat/web-search-api-key.ts` `hasWebSearchProvider` L143-154。
BFF 已有枚举/keyless 集合于 `web-search-validation.ts`,可复用派生聚合纯函数。

## 4. 本批实施方案(agentui-only)

| 子项 | 决策 |
|---|---|
| ① | 复核+单测断言 PATCH 不裁剪未知 `*_api_key` 字段(已有透传用例加一条"多 provider key 共存") |
| ② | **BFF 专用 enrich**:挂载 `GET /proxy/v1/chatbots/:id/info`(或 agents 侧 external-info)——优先读 Gateway session 原始 `prompt_config` 计算双 flag;Gateway 不可达/无 session 时回落透传 RAG 响应并(若有)用其 `has_tavily_key`,同时补算 `has_web_search_provider` 仅当能拿到 PC |
| ③ | 无代码;回归既有 T2.7 用例 |
| ④ | **写侧 prune 本批不做**(与 T2.4"换回不丢 key"冲突,正式落地等 T4.2 密钥独立存储)。本批交付:**响应侧永不回传 key**(external-info 只出 bool)+ 文档登记 T4.2 承接写侧过滤 |
| GET | `normalizeSession` 将 `prompt_config`/`kb_ids` 放入 `metadata`(Constitution Layer 3 透传),供聚合读取;对外 Session schema 不变 |

## 5. 运行库与门禁基线

- 工作分支:`dev`(跟踪 `origin/dev`)
- 预期门禁:BFF vitest 全绿 + tsc;`npm run type-check` 三守卫;相关 jest 若触达 share 类型不变应零改前端
- 真浏览器分享页走查需登录态+已嵌入会话 → 预登记受限 L-T41A-01

## 6. 风险与取舍

| 风险 | 处置 |
|---|---|
| Gateway session 与 RAG dialog id 不一致导致 info 404 | enrich 优先 Gateway;失败回落 RAG;双 miss 如实 4xx,R6 注记 |
| 聚合函数前后端漂移 | BFF 纯函数单测覆盖 14 provider + keyless + legacy Tavily + 清除态 |
| 写侧过滤误伤体验 | 明确排除本批;手册写明"切换服务商 Key 仍保留" |
| intellect-kb-app 未改 | 不阻塞(BFF 聚合);T4.1b/Phase C 再做检索分发 |
