# M3 调研:设置页「已配置 / 重新输入」

> 2026-11-25;T4.2 M3。目标:Gateway 已存密钥时,前端不再拿到明文,也能显示 provider 已配置、允许空 key 保存。

## 1. 前端组件树

| 层 | 文件 | 作用 |
|---|---|---|
| 页面 | `src/pages/next-chats/chat/app-settings/chat-settings.tsx` | 设置弹窗;读 `useFetchChat().data`;调用 schema/表单 |
| 表单 | `.../chat-prompt-engine.tsx` | 组合 Prompt/联网字段;透传 `configuredProviders` |
| 字段 | `src/components/web-search-form-field.tsx` | provider 下拉 + provider key 输入;必填/占位/提示 |
| 纯函数 | `.../web-search-api-key.ts` | provider/key 字段派生、缺 key 判定、`hasWebSearchProvider` |
| 运行时开关 | `.../use-show-internet.ts` | 依据 `hasWebSearchProvider` 显示 Internet 开关 |
| 映射 | `src/hooks/map-gateway-session-to-dialog.ts` | Gateway/BFF session → `IDialog`;透传 PC/configured |
| 类型 | `src/interfaces/database/chat.ts` | `IDialog.prompt_config` / `web_search_configured_providers` |

## 2. BFF 链路

| 文件 | 作用 |
|---|---|
| `bff/src/routes/bff-agents.ts` PATCH | 保存 PC 前做联网校验;M3 先查 Gateway secret 状态 |
| `bff/src/utils/web-search-validation.ts` | 服务端镜像校验;新增 configured 放行 |
| `bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts` | `getWebSearchSecretStatus` + `normalizeSession` metadata |
| `bff/src/types/adapter.ts` | 可选 `getWebSearchSecretStatus`(MCP/KAG 不实现) |

## 3. Gateway 链路

| 文件 | 作用 |
|---|---|
| `intellect-gateway/src/platform/api_server.rs` | GET/PATCH/fork session 返回 sanitized PC + `web_search_configured_providers`;运行时 resolve |
| `intellect-storage/src/web_search_secrets.rs` | list/resolve/upsert/touch |
| `web_search_providers.rs` | PC 提取/剥离、allowlist |

## 4. 真实运行库

- 本地临时 PG `intellect_t42gs` + Gateway `127.0.0.1:9099`;
- 无浏览器 dev server 可用(本 session 无浏览器自动化工具),前端验证限 jsdom/unit;
- 未调用真实 Tavily/外部 provider;不验证外部搜索返回。

## 5. 关键口径

- 空 key + provider 已配置 = 保留旧 secret,不重复轮换;
- 新 provider 未配置 = key 必填;
- keyless provider(anysearch/youcom)= 可空;
- 切换 provider 时按新 provider 的 configured 状态判定;
- 后端只返回 provider 名称,不返回 key/ciphertext。

## 6. 风险

- 运行时 web-search 是否真正消费 agent `prompt_config` 取决于下游 provider;本批只保证 Gateway `apply_session_rag_config` 注入解析后的 key,未对真实外部 provider 做端到端搜索调用(R6)。
- 历史明文仍需 M2 生产回填。
