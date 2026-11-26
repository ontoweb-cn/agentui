# 审查 — t42-gateway-secrets(L-T42-01)

> 2026-11-25;九步步骤 3。范围:Gateway secrets API/storage/migration;agentui 不改。

## 1. 审查面

| 面 | 检查 |
|---|---|
| 鉴权 | Bearer/身份;owner-only;non-owner 404;profile bypass |
| 加密 | `secret_crypto` AES-256-GCM;缺 key fail-closed;禁止 plaintext escape |
| 输入 | provider 白名单;空 key;8KiB;内部 envelope 前缀 |
| SQL | 绑定参数;UPSERT 唯一键;FK cascade |
| 输出 | 只返回 metadata;无 plaintext/ciphertext |
| 审计 | `secret_access_log`;不写 key;best-effort |
| 并发 | UPSERT 原子;`key_version` 递增 |
| 错误 | 400/401/404/413/503 映射;内部错误不泄密 |

## 2. 发现

### 已修复(实现/自测中)

| # | 发现 | 修复 |
|---|---|---|
| F1 | `SecretRow` 未实现 `FromRow` | 加 `#[derive(sqlx::FromRow)]` |
| F2 | `f64::NAN` 时间戳被 cast 成 0 → 返回 1970 | 非有限/负数返回空串;单测 |
| F3 | profile 模式审计 actor_type 误写 `member`、actor_id `anonymous` | 区分 `profile`/`profile-owner` |
| F4 | `encrypt_secret` 在 `INTELLECT_ALLOW_PLAINTEXT_SECRETS=1` 时可返回明文 | store 拒绝非 `enc:v1:` 结果(503) |
| F5 | 客户端可提交 `enc:v1:` 前缀绕过加密 | 拒绝内部 envelope 前缀(400) |

### 接受/残留

| # | 级别 | 内容 | 处理 |
|---|---|---|---|
| R1 | 中 | agentui BFF 仍整包 PATCH,未调用 PUT;GET 详情仍可能带 key | **本批不接线**,下一模块 t42-m1-wire |
| R2 | 中 | 前端无 M3「已配置/重新输入」UI | 后续 M3 |
| R3 | 低 | `SessionResp` 当前不含 `prompt_config`,BFF 兼容读取;本批不扩大改动 | 存量缺口 |
| R4 | 低 | ciphertext 用 TEXT 而非契约的 BYTEA | 复用 `secret_crypto` 文本 envelope,已在 migration 注释 |
| R5 | 低 | 无 rotate 别名 `POST .../rotate` | 契约可选;PUT 已轮换 |
| R6 | 低 | `resolve` 未暴露 HTTP/未更新 last_used | M4/T4.1b |
| R7 | 低 | 无 OpenAPI 条目 | 路由可探;后续补 |
| R8 | 中 | 生产 Gateway 未部署(L-09) | R6 受限;本地 HTTP 已验 |

## 3. 结论

Gateway 侧 secrets 能力可交付;L-T42-01 的 **Gateway 实现**已解除。
**agentui BFF/前端未接线,不得把 T4.2 整体标记完成**;需另开 `t42-m1-wire`。
