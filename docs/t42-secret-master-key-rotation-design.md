# T4.2 主密钥轮换设计(M4)

> 2026-11-25;当前实现是单 `INTELLECT_SECRET_KEY` + `enc:v2:<b64>`。本设计解决轮换与历史 v1 兼容,**尚未实现代码**。

## 1. 目标

- 主密钥轮换不要求重填用户 provider key;
- 新旧密文可共存;
- 轮换可灰度、可回滚;
- 不把主密钥暴露给 Gateway API。

## 2. 信封 v3

```text
enc:v3:<key_id>:<base64(nonce||ciphertext)>
```

- `key_id`:短标识(如 `k2026q4`),不是密钥;
- AAD:`session_id:provider:key_id`(key_id 进入 AAD);
- 解密按 key_id 从 keyring 取密钥;
- v2 仍可解;v1 仅兼容读取。

## 3. Keyring

```bash
# 当前写密钥
INTELLECT_SECRET_KEY_ID=k2026q4
# 所有可解密钥(JSON;生产用 secret manager 注入,不落仓库)
INTELLECT_SECRET_KEYRING='{"k2026q4":"<b64>","k2026q3":"<b64>"}'
```

规则:

- 写只用 `INTELLECT_SECRET_KEY_ID`;
- 读按信封 key_id 查 keyring;
- 缺 key_id → fail-closed(不回落明文);
- keyring 不写日志;启动只打印 key_id。

## 4. 轮换步骤

1. 生成新密钥,把旧+新加入 keyring,服务发布;
2. 切换 `INTELLECT_SECRET_KEY_ID` 到新 id,服务滚动;
3. 新写入自动 v3/新 id;
4. 后台 job 扫描 `web_search_secrets`,用旧 key 解密、新 key 重加密,更新 `ciphertext` + `updated_at`(幂等,按 ciphertext 前缀过滤);
5. 确认无旧 id 行后,从 keyring 移除旧 key;
6. 保留 v2 读取至少一个发布周期。

## 5. 数据迁移

- `web_search_secrets` 增加 `master_key_id`? 可从信封读,不强制列;
- 为轮询效率可加 `ciphertext LIKE 'enc:v3:k2026q3:%'` 索引/扫描;
- `key_version` 仍是用户 key 版本,不与 master key id 混用。

## 6. 回滚

- 回滚只切回旧写 key,旧密文仍可解;
- 已用新 key 写入的行,旧 key 必须有读权限,否则回滚不可用;
- 因此 keyring 移除旧 key 必须在确认无旧密文后。

## 7. 验收

- 轮换中旧/新行都可 resolve;
- 错误 key_id 解密失败;
- AAD 交换 provider 仍失败;
- 无主密钥 503/fail-closed;
- 日志不含 key/keyring。

## 8. 未做

- 代码实现、迁移 job、生产密钥管理;
- 与 `secret_crypto` 现有 v1/v2 兼容层统一。
