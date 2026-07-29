# 密钥管理操作手册(spec-010 v8 B-11)

> **适用版本**:BFF spec-010 v8
> **相关代码**:[bff/src/services/token-vault.ts](../../bff/src/services/token-vault.ts)
> **相关设计**:[docs/multi-harness-design.md §4 Token 安全存储策略](../../docs/multi-harness-design.md)

## 1. 前置条件

- BFF 已启动(`npm run dev` 或生产部署)
- `.env` 文件位于 `bff/.env`(已加入 `.gitignore`)
- 已完成至少一个后端配置(通过 Wizard 或 Admin 页)

## 2. TokenVault 双模式

BFF 提供 `ITokenVault` 抽象,有两种实现,通过环境变量切换:

| 模式 | 实现类 | 触发条件 | 读写 | 适用场景 |
|------|--------|---------|------|---------|
| A | `EnvTokenVault` | 未设置 `HARNESS_TOKEN_ENCRYPTION_KEY` | 只读 | 开发/测试/P0-P3 |
| B | `EncryptedFileTokenVault` | 设置了 `HARNESS_TOKEN_ENCRYPTION_KEY` | 读写 | 生产/P4+ |

**选择逻辑**(BFF 启动时自动):
```
if (process.env.HARNESS_TOKEN_ENCRYPTION_KEY) {
  // 构造函数只接受可选的 vaultFile 参数,加密密钥从 env var 读取
  // 详见 bff/src/services/token-vault.ts EncryptedFileTokenVault.constructor
  vault = new EncryptedFileTokenVault();
} else {
  vault = new EnvTokenVault();
}
```

---

## 3. 模式 A:EnvTokenVault(默认)

### 3.1 环境变量命名规则

| 凭据类型 | 命名规则 | 示例 |
|---------|---------|------|
| Bearer Token | `{BACKEND_ID_UPPER}_TOKEN` | `INTELLECT_RAG_TOKEN` |
| Email | `{BACKEND_ID_UPPER}_EMAIL` | `INTELLECT_RAG_EMAIL` |
| Password | `{BACKEND_ID_UPPER}_PASSWORD` | `INTELLECT_RAG_PASSWORD` |

**BACKEND_ID_UPPER 规则**:`backendId` 转大写,连字符转下划线。
- `intellect-rag` → `INTELLECT_RAG_TOKEN`
- `intellect-enterprise` → `INTELLECT_ENTERPRISE_TOKEN`
- `my-custom-backend` → `MY_CUSTOM_BACKEND_TOKEN`

### 3.2 配置示例

```bash
# bff/.env
# Intellect RAG 后端(bearer-token 凭据)
INTELLECT_RAG_TOKEN=intellect-xxxxxxxxxxxxxxxx

# Intellect 企业版后端(bearer-token 凭据)
INTELLECT_ENTERPRISE_TOKEN=imt_xxxxxxxxxxxxxxxxxx

# Intellect RAG 后端(email-password 凭据,可选)
INTELLECT_RAG_EMAIL=admin@example.com
INTELLECT_RAG_PASSWORD=secretpassword
```

### 3.3 优缺点

| 优点 | 缺点 |
|------|------|
| 配置简单,符合 12-factor app | **只读**:无法通过 Admin 页录入凭据 |
| 凭据不落盘,安全性高 | 修改凭据需重启 BFF |
| 与容器化部署天然兼容 | 多实例需各自配置 `.env` |

### 3.4 Admin 页操作限制

在 EnvTokenVault 模式下:
- Wizard 第 4 步录入的凭据**不会持久化**(重启后丢失)
- Admin 页编辑后端时,凭据字段**只读**
- 若尝试通过 API 调用 `setCredentials`,将抛出错误:
  ```
  EnvTokenVault does not support setCredentials (backendId=<backendId>). Use EncryptedFileTokenVault or set env vars manually.
  ```

---

## 4. 模式 B:EncryptedFileTokenVault(可选)

### 4.1 启用步骤

**步骤 1:生成加密密钥**

```bash
# 生成 64 hex 字符的密钥(推荐)
openssl rand -hex 32
# 输出示例:a1b2c3d4e5f6...（64 个字符）

# 或生成 32 raw 字符的密钥
openssl rand -base64 24 | tr -d '\n' | head -c 32
```

**步骤 2:配置环境变量**

```bash
# bff/.env
HARNESS_TOKEN_ENCRYPTION_KEY=a1b2c3d4e5f6...（64 hex 字符）
```

**步骤 3:重启 BFF**

```bash
cd bff
npm run dev
# 若 HARNESS_TOKEN_ENCRYPTION_KEY 格不合法(非 64 hex 或 32 raw),
# 启动时会抛出 "HARNESS_TOKEN_ENCRYPTION_KEY must be 32 bytes" 错误。
# 正常启动后无专属日志行,可通过 Admin 页录入凭据验证 vault 是否生效。
```

### 4.2 录入凭据

启用后,可通过两种方式录入凭据:

**方式 1:Wizard 向导**(首次安装)
- 第 4 步"Connection"录入凭据
- 提交后凭据加密存储到 `bff/data/token-vault.json`

**方式 2:Admin 页**(已安装后新增后端)
- 进入 Admin → Harness Backends → New Backend
- 填写凭据字段(token 或 email+password)
- 提交后凭据加密存储

### 4.3 凭据文件

**文件位置**:`bff/data/token-vault.json`(自动创建,加入 `.gitignore`)

**文件格式**(加密后,扁平 `Record<backendId, EncryptedEntry>`,无 `version`/`entries` 包裹层):
```json
{
  "intellect-rag": {
    "encrypted": "base64...",
    "iv": "base64...",
    "tag": "base64..."
  },
  "intellect-enterprise": {
    "encrypted": "base64...",
    "iv": "base64...",
    "tag": "base64..."
  }
}
```

> **注意**:`kind` 字段(bearer-token / email-password)存储在加密后的 `encrypted` 明文 JSON 内,不在外层 entry 中暴露。每个 entry 仅含 `encrypted`/`iv`/`tag` 三个 base64 字段。

**加密细节**:
- 算法:AES-256-GCM
- 密钥:`HARNESS_TOKEN_ENCRYPTION_KEY`(64 hex 或 32 raw)
- IV:每次写入随机生成(12 bytes,base64 编码存储)
- AuthTag:GCM 模式自带(16 bytes,base64 编码存储,字段名 `tag`)
- 密文:base64 编码存储(字段名 `encrypted`,非 `ciphertext`)

### 4.4 优缺点

| 优点 | 缺点 |
|------|------|
| 支持通过 Admin 页录入凭据 | 需管理加密密钥 |
| 凭据加密落盘,审计友好 | 密钥丢失则凭据不可恢复(见 §6) |
| 多实例可共享 `token-vault.json`(NFS) | 当前不支持自动轮换(见 §5) |

---

## 5. 密钥轮换

### ⚠️ 当前状态:手动操作(P5+ 计划自动化)

spec §13.4 描述的 `HARNESS_TOKEN_ENCRYPTION_KEY_NEW` 自动轮换**尚未实现**。当前需手动操作:

### 5.1 手动轮换步骤

**步骤 1:备份当前凭据文件**
```bash
cp bff/data/token-vault.json bff/data/token-vault.json.backup
```

**步骤 2:生成新密钥**
```bash
openssl rand -hex 32
# 输出:newkey1234...
```

**步骤 3:用旧密钥解密 + 用新密钥重新加密**

> ⚠️ **重要**:`EncryptedFileTokenVault` 构造函数只接受 `vaultFile` 参数,加密密钥从 `process.env.HARNESS_TOKEN_ENCRYPTION_KEY` 读取(详见 [token-vault.ts L165-L189](../../bff/src/services/token-vault.ts#L165-L189))。因此轮换需通过切换环境变量 + 创建两个 vault 实例实现。

将以下脚本保存为 `bff/scripts/rotate-vault-key.ts`,用 `tsx` 运行:

```typescript
// bff/scripts/rotate-vault-key.ts
// 用法:OLD_KEY=<旧密钥> NEW_KEY=<新密钥> npx tsx bff/scripts/rotate-vault-key.ts
import { EncryptedFileTokenVault } from '../src/services/token-vault.js';

async function main() {
  const oldKey = process.env.OLD_KEY;
  const newKey = process.env.NEW_KEY;
  if (!oldKey || !newKey) {
    console.error('Usage: OLD_KEY=<old> NEW_KEY=<new> npx tsx bff/scripts/rotate-vault-key.ts');
    process.exit(1);
  }

  // Step 1: 用旧密钥读取所有凭据
  process.env.HARNESS_TOKEN_ENCRYPTION_KEY = oldKey;
  const oldVault = new EncryptedFileTokenVault();
  const backendIds = await oldVault.listBackendIds();
  if (backendIds.length === 0) {
    console.log('No credentials found in vault. Nothing to rotate.');
    return;
  }
  const credsMap = new Map<string, unknown>();
  for (const id of backendIds) {
    const creds = await oldVault.getCredentials(id);
    if (creds) {
      credsMap.set(id, creds);
      console.log(`  - read: ${id}`);
    } else {
      console.warn(`  - skip (decrypt failed): ${id}`);
    }
  }

  // Step 2: 切换到新密钥,重新加密写入
  //   注意:旧 vault 实例的 encryptionKey 已固化,改 env var 不影响旧实例;
  //   newVault 实例化时读取新的 env var,使用新密钥。
  process.env.HARNESS_TOKEN_ENCRYPTION_KEY = newKey;
  const newVault = new EncryptedFileTokenVault();
  for (const [id, creds] of credsMap) {
    await newVault.setCredentials(id, creds as never);
    console.log(`  - write: ${id}`);
  }

  console.log(`\nKey rotation complete. ${credsMap.size} entry/entries re-encrypted.`);
  console.log('Next: update bff/.env HARNESS_TOKEN_ENCRYPTION_KEY=<NEW_KEY> and restart BFF.');
}

main().catch((err) => {
  console.error('Rotation failed:', err);
  process.exit(1);
});
```

**步骤 4:更新 `.env`**
```bash
# bff/.env
HARNESS_TOKEN_ENCRYPTION_KEY=newkey1234...
```

**步骤 5:重启 BFF 并验证**
```bash
cd bff && npm run dev
# 验证:Admin 页能看到后端 ready 状态(说明解密成功)
```

### 5.2 未来自动化计划(P5+)

- 支持 `HARNESS_TOKEN_ENCRYPTION_KEY_NEW` 环境变量
- BFF 启动时检测新密钥,自动解密 + 重新加密所有 entries
- 完成后清空 `_NEW` 变量,记录轮换日志

---

## 6. 密钥丢失恢复

**场景**:`HARNESS_TOKEN_ENCRYPTION_KEY` 丢失或忘记,`token-vault.json` 无法解密。

**恢复步骤**:

1. **删除加密凭据文件**
   ```bash
   rm bff/data/token-vault.json
   ```

2. **重新执行 Wizard 录入凭据**
   ```bash
   # 访问 Wizard,重新配置每个后端的凭据
   open http://localhost:9392/wizard?mode=add
   ```

3. **或切换到 EnvTokenVault 模式**
   ```bash
   # 移除 HARNESS_TOKEN_ENCRYPTION_KEY,改用环境变量
   # bff/.env
   INTELLECT_RAG_TOKEN=newtoken...
   ```

**影响**:
- 所有已存储的凭据永久丢失(无法恢复)
- 已配置的 backend 元数据(id/name/endpoint 等)不受影响,保存在 `harness-backends.json`
- 活跃的 session/run 不受影响(使用运行时内存中的 token)

---

## 7. 多实例部署

### ⚠️ 当前限制:各实例独立凭据文件

当前 `EncryptedFileTokenVault` 的 `token-vault.json` 为本地文件,多实例部署时需手动同步。

### 7.1 方案 A:各实例独立配置(推荐)

每个实例使用相同的 `HARNESS_TOKEN_ENCRYPTION_KEY`,但各自录入凭据。

**适用场景**:实例数 ≤ 3,凭据变更频率低。

### 7.2 方案 B:NFS 共享存储

将 `bff/data/` 目录挂载到 NFS,多实例共享同一 `token-vault.json`。

**注意事项**:
- 需确保 NFS 挂载点的文件锁正常工作(避免并发写入冲突)
- `EncryptedFileTokenVault` 当前**未实现文件锁**,并发写入可能导致数据损坏
- **建议**:多实例场景使用 EnvTokenVault 模式(环境变量天然支持多实例)

### 7.3 未来计划(P5+)

- 支持 Redis/数据库后端的 TokenVault 实现
- 原生支持多实例并发读写

---

## 8. 故障排查

### 8.1 `EnvTokenVault does not support setCredentials`

**原因**:在 EnvTokenVault 模式下尝试写入凭据(通过 Wizard 或 Admin API),触发 `EnvTokenVault does not support setCredentials (backendId=xxx). Use EncryptedFileTokenVault or set env vars manually.`

**解决**:
- 切换到 EncryptedFileTokenVault 模式(设置 `HARNESS_TOKEN_ENCRYPTION_KEY`)
- 或将凭据直接写入 `.env` 文件,重启 BFF

### 8.2 解密失败返回 null

**现象**:BFF 日志显示 `[harness-store] Backend "xxx" skipped: env var ... not set`(vault 解密失败静默返回 null,回退 env var 也未配置时),Admin 页显示后端 `notReady`。

> **注意**:`EncryptedFileTokenVault.getCredentials()` 解密失败时**不输出日志**,静默返回 `null`(见 [token-vault.ts L241-L247](../../bff/src/services/token-vault.ts#L241-L247))。需通过 `[harness-store]` 的 skipped 日志间接判断。

**原因**:
- `HARNESS_TOKEN_ENCRYPTION_KEY` 与加密时不一致(密钥被修改)
- `token-vault.json` 文件损坏
- backendId 与加密时的 key 不匹配(backend 被重命名)

**解决**:
1. 检查 `.env` 中的 `HARNESS_TOKEN_ENCRYPTION_KEY` 是否正确
2. 若密钥丢失,按 §6 恢复
3. 若 backend 被重命名,需手动编辑 `token-vault.json` 中的 key(或删除该 entry 重新录入)

### 8.3 `HARNESS_TOKEN_ENCRYPTION_KEY must be 32 bytes`

**原因**:密钥格式不符合要求。

**要求**:
- 64 hex 字符(推荐,`openssl rand -hex 32` 生成)
- 或 32 raw 字符(`openssl rand -base64 24 | tr -d '\n' | head -c 32`)

**解决**:
```bash
# 重新生成 64 hex 密钥
openssl rand -hex 32
# 更新 .env
# HARNESS_TOKEN_ENCRYPTION_KEY=<新密钥>
```

### 8.4 Wizard 提交后 backend 未出现

**现象**:Wizard 提交成功,但 Admin 页未显示新 backend。

**原因**:可能是 `harness-backends.json` 写入失败(权限问题)或 token 未通过校验。

**排查**:
1. 检查 BFF 日志是否有 `Failed to persist config` 错误
2. 检查 `bff/data/` 目录写入权限
3. 检查 `.env` 中是否设置了对应的 token 环境变量(EnvTokenVault 模式)
4. 若 EncryptedFileTokenVault 模式,检查 `token-vault.json` 是否有对应 entry

### 8.5 intellect-enterprise 后端 ready 但 API 调用 401

**现象**:backend 状态 `ready`(token 校验通过),但实际 API 调用返回 401。

**原因**:token 已过期或被撤销(intellect-team 侧失效)。

**解决**:
1. 在 intellect-team 侧重新生成 API Server Key
2. 更新 BFF 凭据:
   - EnvTokenVault:更新 `.env` 中的 `{BACKEND_ID_UPPER}_TOKEN`,重启 BFF
   - EncryptedFileTokenVault:通过 Admin 页编辑后端,更新 token
3. 验证:Admin 页点击"Test Connection"或发起一次 chat 请求

---

## 9. 密钥管理 Checklist

### 开发环境
- [ ] `.env` 已加入 `.gitignore`
- [ ] `bff/data/` 已加入 `.gitignore`
- [ ] 未设置 `HARNESS_TOKEN_ENCRYPTION_KEY`(使用 EnvTokenVault)
- [ ] 各后端 token 环境变量已配置

### 生产环境
- [ ] `HARNESS_TOKEN_ENCRYPTION_KEY` 已设置(64 hex)
- [ ] 密钥已安全存储(密码管理器/KMS)
- [ ] `bff/data/token-vault.json` 权限为 0600
- [ ] `bff/data/` 目录权限为 0700
- [ ] 已测试密钥恢复流程(§6)
- [ ] 多实例部署已评估共享策略(§7)

### 密钥轮换后
- [ ] 所有实例已更新 `HARNESS_TOKEN_ENCRYPTION_KEY`
- [ ] 所有实例 BFF 已重启
- [ ] Admin 页验证所有 backend 状态为 `ready`
- [ ] `token-vault.json.backup` 已安全删除
