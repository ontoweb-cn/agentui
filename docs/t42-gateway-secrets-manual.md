# Gateway 联网搜索密钥 API 使用手册(T4.2 / L-T42-01)

> 状态:2026-11-25 已实现 Gateway 能力;agentui BFF/前端**尚未接线**(下一模块 `t42-m1-wire`)。
> 新写入路径已在 Gateway PATCH 内自保:提取 provider key 后剥离 PC;不必等 BFF 接线才阻止**新的**明文落库。历史明文仍需 M2 回填,前端 M3 未做。
> 契约:[web-search-secrets-gateway-api-contract.md](./web-search-secrets-gateway-api-contract.md)

## 1. 能力概述

为每个 chat session 按 provider 保存联网搜索 API Key:

- 一个 session 可保存多个 provider(切回不丢);
- Key 使用 `INTELLECT_SECRET_KEY`(AES-256-GCM)加密后落库;
- API 只返回 `configured` / `key_version` / `updated_at`,**永不返回明文或密文**;
- 仅 session 所有者(或 profile/admin bypass)可读写;
- 审计写入 `secret_access_log`,只记录 provider,不记录 Key。

## 2. 配置

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `INTELLECT_PG_DSN` | 是 | Gateway PostgreSQL |
| `INTELLECT_SECRET_KEY` | 是(写路径) | 32-byte base64;缺失时 PUT 返回 503(fail-closed) |
| `API_SERVER_ENABLED=1` | 是 | 启用 HTTP API |
| `API_SERVER_KEY` | 建议 | Bearer token;未配置时按 Gateway 现有匿名策略 |
| `INTELLECT_TENANT_ID` | 部署需要 | 租户标识 |

数据库迁移由 `intellect-storage/migrations/20261125000001_web_search_secrets.sql` 提供,随 `intellect-migrate` 执行。

## 3. API

基址:`<gateway>/api/sessions/{session_id}/web-search-secrets`

### 3.1 写入/轮换

```http
PUT /api/sessions/{session_id}/web-search-secrets/{provider}
Authorization: Bearer <token>
Content-Type: application/json

{ "api_key": "<plaintext once>" }
```

| 状态 | 含义 |
|---|---|
| `204` | 写入或轮换成功;`key_version` +1 |
| `400` | provider 不在白名单 / key 为空或使用内部 `enc:v1:`/`plain:v1:` 前缀 |
| `401` | 未认证 |
| `404` | session 不存在或无权 |
| `413` | key > 8192 bytes |
| `503` | 未配置 `INTELLECT_SECRET_KEY` |

### 3.1.1 Rotate 别名(可选)

```http
POST /api/sessions/{session_id}/web-search-secrets/{provider}/rotate
{ "api_key": "<plaintext once>" }
```

语义与 PUT 相同;返回 204。

### 3.2 状态查询

```http
GET /api/sessions/{session_id}/web-search-secrets
```

```json
{
  "items": [
    {
      "provider": "tavily",
      "configured": true,
      "updated_at": "2026-11-25T12:21:30+00:00",
      "key_version": 2
    }
  ]
}
```

### 3.3 删除

```http
DELETE /api/sessions/{session_id}/web-search-secrets/{provider}
→ 204 / 404
```

## 3.4 PATCH 兼容(重要)

即使调用方仍按旧方式提交:

```json
{
  "prompt_config": {
    "web_search_provider": "tavily",
    "tavily_api_key": "<plaintext>",
    "prologue": "..."
  }
}
```

Gateway 会:

1. 提取 `tavily_api_key` → `web_search_secrets`(相同 key 不重复轮换);
2. 剥离所有 `*_api_key`/`*ApiKey` 字段;
3. 仅把 `{"web_search_provider":"tavily","prologue":"..."}` 写入 `sessions.prompt_config`;
4. secrets 与 PC 在同一事务内提交;任何提取/加密/PC 更新失败 → PATCH 失败并回滚,不会回退明文。

## 3.5 OpenAPI

```text
GET /docs/openapi-web-search-secrets.json
```

独立文档(3 个 path),与审批 OpenAPI 分开。

## 4. Provider 白名单

`anysearch`, `brave`, `exa`, `firecrawl`, `keirolabs`, `linkup`, `parallel`, `perplexity`, `querit`, `search1api`, `searchapi`, `serply`, `tavily`, `youcom`。

大小写/首尾空格会归一化;其余值 400。

## 5. 安全语义

- 加密:AES-256-GCM(`intellect-storage/src/secret_crypto.rs`),Web 搜索使用 AAD 绑定的 `enc:v2:...`(`session_id:provider`);
- 无主密钥时写失败,不会降级明文;即使设置了 `INTELLECT_ALLOW_PLAINTEXT_SECRETS=1`,本 API 仍拒绝明文落库;
- 非 owner 统一 404,避免泄露 session 存在性;
- SQL 全部绑定参数;
- 审计失败不影响写入,但服务端日志会记录错误;
- `GET` 列表不含 ciphertext,响应 `Cache-Control: no-store`;
- 相同 key 的重复 PATCH 不增加 `key_version`。

## 5.1 M3 用户侧

设置页已接入「已配置 — 留空保持现有密钥」:见 [t42-m3-configured-ui-manual.md](./t42-m3-configured-ui-manual.md)。GET session 返回 sanitized PC 与 configured 名单,不返回 key。

## 6. 当前不包含

- BFF PATCH 自动提取 key 并调用 PUT;
- `GET session` 返回 `web_search_key_configured` / 前端 M3「已配置/重新输入」UI;
- 历史 M2 回填(CLI 已提供:[t42-gateway-secrets-backfill.md](./t42-gateway-secrets-backfill.md);生产未执行);
- 检索侧 M4 resolve(store 已提供 `resolve` 方法,但未暴露 HTTP);
- 生产部署(L-09 无 kubectl)。

以上属于后续 `t42-m1-wire` / M2–M4。
