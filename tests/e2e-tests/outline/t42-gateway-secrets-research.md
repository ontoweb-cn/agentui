# 调研 — t42-gateway-secrets(L-T42-01)

> 2026-11-25;九步步骤 1。模块:A. Gateway 密钥能力;仓库:agentui + intellect-team/intellect-gateway。
> 用户指令:「调用九步交付实施 A. 等 Gateway 密钥能力(L-T42-01)」。

## 1. 闸门基线

`node scripts/check-exec-gates.mjs`(2026-11-25):

| ID | 结果 | 说明 |
|---|---|---|
| L-T42-01 | **BLOCK** | Gateway 源码无 `web_search_secret(s)` 实现 |
| L-09 | BLOCK | 无 kubectl |
| L-PHASEB-01 | BLOCK | Go canvas SSE 未稳定 |

本模块只处理 **L-T42-01**;L-09/L-PHASEB 不在范围。

## 2. 代码事实

### agentui

- 契约:[web-search-secrets-gateway-api-contract.md](../../../docs/web-search-secrets-gateway-api-contract.md)
- 设计:[web-search-secret-storage-design.md](../../../docs/web-search-secret-storage-design.md)
- BFF 预备客户端:`bff/src/utils/web-search-secrets-client.ts`(probe + PUT URL,**未接线**)
- BFF PATCH:`bff/src/routes/bff-agents.ts`(仍整包透传,未 prune)
- BFF sanitize:`bff/src/utils/web-search-validation.ts`(单测就绪,未挂 PATCH)
- 前端 provider 枚举:14 个(`anysearch`…`youcom`),keyless:anysearch/youcom

### intellect-gateway

- 仓库:`/Users/simon/workspace/intellect-team/intellect-gateway`
- 基线:`597c2890 docs(rag): E2E 实测 11/11 通过...`
- Session API:`src/platform/api_server.rs`
  - `GET/POST /api/sessions`
  - `GET/PATCH/DELETE /api/sessions/{id}`
  - `GET /api/sessions/{id}/messages`
  - 路由注册:约 L3262–3286
- Session DTO:`SessionResp` 当前不含 `prompt_config`(BFF normalize 兼容读取,存量缺口另记)
- 存储:`intellect-storage` `SessionStore`(sqlx/Postgres),migrations 位于 `intellect-storage/migrations`
- 加密:`intellect-storage/src/secret_crypto.rs`
  - AES-256-GCM;`INTELLECT_SECRET_KEY` 32-byte base64
  - `encrypt_secret` / `decrypt_secret`;无 key 默认 fail-closed
  - 格式 `enc:v1:{base64(nonce||ciphertext)}`
- 审计:`secret_access_log` 表 + `SessionStore::record_secret_access`(已有)

### 本机运行库

| 项 | 值 |
|---|---|
| Postgres | 15.18,localhost:5432,运行中 |
| DB | `intellect`、`intellect_test` |
| Gateway API | 未运行;`API_SERVER_ENABLED` 默认 false |
| 远程 Gateway | `https://ai.wust.edu.cn/intellect-gateway`(本批不修改/不部署) |

## 3. 差距结论

1. Gateway 没有 `web_search_secrets` 表/路由。
2. 没有 provider 密钥的加密持久化 API;现有 `secret_crypto` 可直接复用。
3. `secret_access_log` 可复用做 rotate/delete 审计。
4. BFF 已有 probe 客户端和 sanitize 函数,但按约束**本批不接线**;Gateway 合入后再开 `t42-m1-wire`。

## 4. 本批范围(裁决)

**只做 Gateway 能力**,不改 agentui BFF/前端:

- migration:`web_search_secrets`
- storage module:upsert/list/delete(+resolve 占位)
- HTTP:
  - `PUT /api/sessions/{id}/web-search-secrets/{provider}`
  - `GET /api/sessions/{id}/web-search-secrets`
  - `DELETE /api/sessions/{id}/web-search-secrets/{provider}`
- provider 白名单 + 8 KiB 上限 + 空值拒绝
- 会话所有者/管理员鉴权;不向非 owner 泄露存在性
- 审计:upsert/delete 写 `secret_access_log`(best-effort)
- 单元 + 本地 PG 集成测试

**不做**:BFF PATCH 接线、前端 M3 UI、历史 M2 回填、检索 M4 resolve、生产部署(L-09)。

## 5. 风险与限制

- 无法验证真实生产 Gateway/UI;R6 记录。
- `SessionResp` 不含 `prompt_config` 是存量 API 缺口,本批不扩大改动。
- 主密钥未配置时 PUT 必须 503/fail-closed,不能明文落库。
- 远程 Gateway 未部署,HTTP probe 仅本地/单测可做。
