# Spec 批准门 — t42-gateway-secrets(L-T42-01)

> 2026-11-25;九步 5/6 门。用户指令:「调用九步交付实施 A. 等 Gateway 密钥能力(L-T42-01)」视为预授权。
> 范围:Gateway secrets 能力;**不接线 agentui BFF/前端**。

## 1. 缺陷/缺口清单

| # | 类型 | 内容 | 修复/处置 |
|---|---|---|---|
| D1 | 缺口 | Gateway 无 `web_search_secrets` 表/路由 | 已加 migration + store + API |
| D2 | 缺口 | 无 provider 密钥加密持久化 | 复用 `secret_crypto`;fail-closed |
| D3 | 缺口 | 无审计 | 写 `secret_access_log`(best-effort) |
| D4 | 安全 | 旧 PATCH 仍把 `*_api_key` 写入 PC | Gateway PATCH 提取 → secrets → 剥离 PC |
| F1 | 实现 | `SecretRow` 缺 `FromRow` | 已修 |
| F2 | 实现 | NaN 时间戳渲染 1970 | 已修 + 单测 |
| F3 | 安全 | profile 审计 actor 错标 | 已修 |
| F4 | 安全 | plaintext escape hatch 可致明文 | store 拒绝非 enc 结果 |
| F5 | 安全 | 客户端 `enc:v1:` 前缀绕过加密 | 拒绝 envelope 前缀 |

## 2. 修复方案(已实施)

1. `intellect-storage/migrations/20261125000001_web_search_secrets.sql`
2. `intellect-storage/src/web_search_secrets.rs`(upsert/list/delete/resolve)
3. `intellect-gateway/src/platform/api_server.rs`:
   - PUT/GET/DELETE 三路由 + PATCH 提取/剥离
   - AES-GCM AAD `enc:v2:`(`session_id:provider`)
   - PATCH secrets + PC 同事务
   - `GET` no-store
   - provider 白名单、8KiB、空值/前缀校验
   - owner-only 鉴权、404 防泄露、审计
4. 测试:
   - Gateway 4 个纯函数单测
   - PG 集成测试(加密/轮换/删除)
   - 本地 Gateway HTTP 8 组实测

## 3. 明确不在本批

- BFF 显式调用 PUT / `sanitize` 接线(下一模块 `t42-m1-wire`;Gateway 已自保 PATCH)
- 前端 M3 UI
- M2 历史回填
- M4 检索 resolve
- 生产部署(L-09 无 kubectl)
- 契约中的 rotate 别名/OpenAPI 条目(可选/后续)

## 4. 验收

- [x] PUT 204,GET metadata,无明文/密文
- [x] PATCH 提取/剥离,PC 无 key
- [x] key_version 轮换
- [x] DELETE 204/404
- [x] 401/400/413 边界
- [x] DB ciphertext `enc:v1:`
- [x] 审计无 key
- [x] AAD 绑定,交换密文解密失败
- [x] GET `Cache-Control: no-store`
- [x] 本地 HTTP 实测
- [ ] 生产部署(受限 L-09)
- [ ] BFF/前端联调(下一模块)

## 5. 回滚

- 删除 API 路由/文件,保留 migration(向后兼容);
- 若已写密文,删除表/行即可,不影响 sessions.prompt_config;
- 本批未改 PC 读写,回滚无数据迁移。
