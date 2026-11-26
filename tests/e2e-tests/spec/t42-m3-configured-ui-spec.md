# M3 执行规格与修复清单

> module:`t42-m3-configured-ui`;2026-11-25。用户已授权继续 M3;本 spec 记录缺陷、修复与验收口径。

## 1. 缺陷/缺口

| # | 级别 | 现象 | 根因 | 修复 |
|---|---|---|---|---|
| F1 | P1 | 设置页拿不到 provider | Gateway GET session 无 PC | `session_response_with_web_search` 返回 sanitized PC |
| F2 | P1 | 已配置 provider 仍要求重填 key | 前端/BFF 只看 PC 中的 key | configured 列表 + 校验放行 |
| F3 | P1 | 已配置时 Internet 开关消失 | `hasWebSearchProvider` 只看 key | 接受 configured 列表 |
| F4 | P1 | BFF 拒绝空 key 保存 | 服务端镜像校验只认 PC key | PATCH 前查 Gateway secrets 状态 |
| F5 | P1 | 运行时无 key 可用 | Gateway 未从 secrets resolve | `apply_session_rag_config` 注入内存配置 + audit/touch |
| F6 | P2 | 旧 Gateway/状态查询失败可能误放行 | 无回落 | 查询失败回落严格校验 |
| F7 | P2 | GET session 可能把历史 key 回给浏览器 | 老 PC 未回填 | 响应前 strip;DB 仍待 M2 |
| F8 | P2 | legacy 仅 key 无 provider,迁移后无法选中 | 只有 key 字段 | 单 key 时自动补 `web_search_provider` |

## 2. 修改面

- Gateway:`api_server.rs`(session response/runtime resolve)、`web_search_providers.rs`;
- Storage:复用 `WebSearchSecretStore`(list/resolve/touch);
- BFF:`bff-agents.ts`、`web-search-validation.ts`、enterprise adapter/interface;
- Frontend:`chat-settings.tsx`、`chat-prompt-engine.tsx`、`web-search-form-field.tsx`、`web-search-api-key.ts`、`use-show-internet.ts`、`map-gateway-session-to-dialog.ts`、`IDialog`、locales;
- 测试:Gateway/Storage/BFF/Frontend;文档/用例/报告。

## 3. 验收口径

- GET session: sanitized PC + `web_search_configured_providers`;无 key/ciphertext;
- 已配置 provider:空 key 保存 200,secret key_version 不变;
- 未配置 provider:空 key 400/表单错误;
- keyless provider:空 key 放行;
- 已配置 provider:Internet 开关可见;
- 运行时:Gateway resolve 出 key 并注入内存 config;不写回 PC;
- 前端 66 suites/809 tests、BFF 71 files/1271 tests、tsc/build 全绿。

## 4. 取舍

- 不把 key 回传浏览器;用 provider 名单 + 空 key 保留语义。
- BFF 每次都查 status;失败回落严格,避免拿旧 Gateway 放行。
- 运行时注入仅在内存,避免再次落库;真实外部搜索调用不在本批。

## 5. 批准门

用户 2026-11-25 明确「调用九步交付技能继续 M3」,视为执行授权;本 spec 作为执行前记录,后续按九步继续修复/回归/报告。
