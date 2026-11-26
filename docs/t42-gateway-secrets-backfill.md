# M2 历史明文密钥回填(Gateway)

> 2026-11-25;对应 T4.2 M2。工具:**dry-run 默认**,`--apply` 才写入。

## 1. 作用

扫描 `sessions.prompt_config` 中残留的 `*_api_key`/`*ApiKey`(SQL `ILIKE '%api_key%'`,已迁移会话不会被重复计入 limit):

1. 解析 PC;
2. 提取已知 provider key → `web_search_secrets`(AES-GCM `enc:v2:` / AAD);
3. 从 PC 删除所有 key 字段;
4. 事务内 CAS 更新 PC(`WHERE prompt_config = 原值`),并发 PATCH 时回滚跳过,失败回滚;
5. best-effort 写 `secret_access_log`。

同一 key 已存在时跳过,支持幂等重跑。

## 2. 命令

```bash
cd intellect-team/intellect-gateway

# 先 dry-run(默认)
INTELLECT_PG_DSN=postgresql://... \
INTELLECT_SECRET_KEY=<32-byte-base64> \
cargo run -p intellect-gateway --bin web-search-secrets-backfill -- \
  --limit 1000

# 确认后 apply
INTELLECT_PG_DSN=postgresql://... \
INTELLECT_SECRET_KEY=<32-byte-base64> \
cargo run -p intellect-gateway --bin web-search-secrets-backfill -- \
  --limit 1000 --apply

# 回填后验证:无明文 key、无 v2 前旧密文
INTELLECT_PG_DSN=postgresql://... \
cargo run -p intellect-gateway --bin web-search-secrets-backfill -- --verify
```

可选 `--session-id <id>` 只处理单个会话。

## 3. 前置

- 已应用 `20261125000001_web_search_secrets.sql`;
- `INTELLECT_SECRET_KEY` 有效(32-byte base64);
- 先备份 DB / 确认回滚窗口;
- 生产执行需 L-09 权限。

## 4. 输出

```text
dry-run t42m2-a: 1 key(s) -> tavily
dry-run scanned=2 changed_sessions=1 written_keys=0

applied scanned=2 changed_sessions=1 written_keys=1
verify plaintext_sessions=0 non_v2_secrets=0
```

## 5. 回滚

- 工具不删除原 PC 中的非 key 字段;`web_search_secrets` 新增行可删除;
- 若需恢复明文 PC,只能从备份恢复(本工具按安全目标不保留明文副本)。

## 6. 验证记录

本地 PG 测试:

```text
t42m2-a prompt_config → {"prologue":"a","web_search_provider":"tavily"}
web_search_secrets → tavily/key_version=1/enc:v2:
```

## 7. 尚未做

- **生产实跑**(L-09);
- 跨租户/大批量断点续跑(当前按 limit/单 session);
- 审计 actor 固定为 `system`(后续可接 job id)。
