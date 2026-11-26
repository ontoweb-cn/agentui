# Gateway 密钥能力代码评审(T4.2 / L-T42-01)

> **范围**:2026-11-25 的 Gateway secrets 实现(migration/store/API/测试)
> **结论**:**Gateway API + PATCH 新写入路径通过安全评审;T4.2 整体仍未关闭**。
> 新写入已不再把 key 写入 `sessions.prompt_config`,并加了 AAD/事务;但历史明文回填(M2)
> 与前端 M3 未完成,仍不能把 T4.2 标记完成。

---

## 一、评审对象

| 仓库 | 文件 |
|---|---|
| intellect-storage | `migrations/20261125000001_web_search_secrets.sql`、`src/web_search_secrets.rs`、`tests/web_search_secrets_pg.rs` |
| intellect-gateway | `src/platform/api_server.rs`(routes/handlers/tests) |
| agentui | `scripts/check-exec-gates.mjs`、文档/用例 |

---

## 二、安全评审

### S1(评审后:新写入已关闭;存量仍待 M2)旧 PATCH 明文路径

评审后已在 Gateway PATCH 写入路径加入提取/剥离:

- 遍历 `prompt_config` 的 `*_api_key` / `*ApiKey`;
- 已知 provider → `web_search_secrets.upsert`(相同 key 不重复轮换);
- 未知/一次性 key 字段一律从 PC 删除;
- 仅写入剥离后的 PC;
- secrets 与 PC 在同一 PostgreSQL 事务内提交,PC 更新失败会回滚 secrets,避免“200 但明文仍在”。

实测:

```text
PATCH 200
secrets: configured=true, key_version=1
sessions.prompt_config = {"prologue":"x","web_search_provider":"tavily"}
web_search_secrets.ciphertext = enc:v2:..., 明文包含=false
```

**仍存量的风险**:历史会话里已有的明文 key 不会自动迁移;已提供 M2 CLI [t42-gateway-secrets-backfill.md](./t42-gateway-secrets-backfill.md),生产回填未执行;
前端 M3「已配置」UI 也未做。新写入路径已安全,旧数据仍待处理。

### S2(LOW,已补 HTTP 验证)ownership

`require_owned_session` 用 strict `get_session_for_actor_ext(..., false)` + `Forbidden → 404`;
PG 测试已补 primitive,HTTP 层已用 member token 验证:
GET 200 但无 PC,PATCH/GET secrets → 404。

**建议**:把 member token 夹具固化到 CI。

### S3(评审后:AAD 已加;主密钥轮换未做)主密钥没有域隔离

- 复用 `INTELLECT_SECRET_KEY`(与 OAuth/provider key 共用);
- **已加 AAD**:`enc:v2:` 绑定 `session_id:provider`;交换密文行解密失败(PG 测试);
- `key_version` 是 provider key 版本,不是主密钥版本;
- 主密钥轮换/历史 v1 兼容仍未做。

影响:主密钥轮换会使历史密文不可解;需版本化方案。
**建议**:M4 前设计主密钥版本/轮换;历史 v1 数据迁移。

### S4(LOW,已加 no-store)响应缓存与错误细节

- `GET secrets` 响应没有 `Cache-Control: no-store`;
- 错误信息会回显 provider/长度,但不含 key;可接受。

**建议**:加 `Cache-Control: no-store`;错误保持通用。

### S5(LOW)provider 白名单跨仓重复

Gateway `WEB_SEARCH_PROVIDERS` 与 BFF/前端枚举手工同步;未来新增 provider 容易漏。
**已加**:`scripts/check-web-search-providers.mjs`(Gateway/BFF/前端三方对比);仍建议契约文档维护唯一列表。

### S6(LOW)明文 fallback 已缓解但需部署检查

`secret_crypto` 的 `INTELLECT_ALLOW_PLAINTEXT_SECRETS` 是全局逃生门;
store 已强制拒绝非 `enc:v1:` 结果,但生产仍需 grep/部署门禁确认该变量未开启。

---

## 三、质量评审

### 已修复

| # | 问题 | 修复 |
|---|---|---|
| Q1 | `SecretRow` 缺 `FromRow` | derive |
| Q2 | NaN 时间戳 → 1970 | 非有限/负数空串 + 单测 |
| Q3 | profile 审计 actor 错标 | profile/profile-owner |
| Q4 | 无主密钥时可走明文 | store fail-closed |
| Q5 | 客户端 `enc:v1:` 前缀绕过加密 | 拒绝前缀 |

### 遗留

| # | 级别 | 问题 | 建议 |
|---|---|---|---|
| Q6 | 中 | 无自动 HTTP 集成测试;手工 curl | 用 axum Router/TestServer 固化;或脚本化 |
| Q7 | 低 | OpenAPI 已补独立文档 `/docs/openapi-web-search-secrets.json` | 已处理 |
| Q8 | 低 | `cargo fmt --check` 全仓有存量 diff | 勿整文件格式化;新增文件已 rustfmt |
| Q9 | 低 | 运行时 resolve 已加 audit/touch_last_used | 已处理(M3/M4) |
| Q10 | 低 | rotate 别名已补 `POST .../{provider}/rotate` | 已处理 |
| Q11 | 低 | 测试 DB 需手工 createdb/dropdb | 固化到 CI 临时库 |
| Q12 | 低 | BFF/UI M3 已接线;真实浏览器/provider 端到端未验 | 后续验收 |
| Q13 | 低 | M2 回填 CLI 已提供,生产未执行 | 生产窗口执行 |

---

## 四、验证证据

| 检查 | 结果 |
|---|---|
| Gateway 单测 | 6 passed |
| Storage PG 集成 | 1 passed(轮换/多 provider/加密/fail-closed) |
| 本地 Gateway HTTP | PUT/GET/rotate/DELETE、401/400/413、PATCH 提取剥离、密文 `enc:v2:`、审计无 key |
| `cargo check -p intellect-gateway` | 通过 |
| OpenAPI | `/docs/openapi-web-search-secrets.json` 200,3 paths |
| Rotate | `POST .../rotate` 204 |
| Provider guard | 14 providers aligned |
| 闸门 | L-T42-01 OPEN;L-09/L-PHASEB-01 BLOCK |

---

## 五、结论与建议

- **Gateway secrets API**:实现质量可接受,无直接越权读取密钥路径;
- **T4.2 安全风险**:新写入已关闭;历史明文/前端 M3 仍待;
- **必须下一步**:M2 生产回填 + 真实浏览器/provider 验收;
- **建议**:补 non-owner HTTP 自动化、主密钥轮换设计、CI 临时库。

**评审裁决**:Gateway 能力可合入;新写入安全路径已闭环;M3/M4 代码已接入;T4.2 因 M2 生产回填、真实浏览器/provider 验收仍 **未完成**。
