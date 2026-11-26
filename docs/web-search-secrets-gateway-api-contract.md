# Gateway `web_search_secrets` API 契约草案(T4.2 M1 前置)

> 日期:2026-11-23;九步 module: `t42-phasebc-prep`
> 状态:**Gateway API + PATCH 提取/剥离 + M3 前端/BFF 已实现(2026-11-25);运行时真实 provider 与 M2 生产回填待验**
> 关联:[web-search-secret-storage-design.md](./web-search-secret-storage-design.md) 方案 C / M1–M2;清单 T4.2 / T4.1a ④ / T2.4

## 1. 目的

在 **不先行 PATCH prune**(避免无 secrets 表时丢 key)的前提下,把 M1 所需的 Gateway HTTP 契约写死,供 intellect-team / intellect-gateway 评审与实现。agentui BFF 仅在本契约合入且有联调证据后接线 `sanitizePromptConfigWebSearchKeys`。

## 2. 现状取证(2026-11-23)

| 探查 | 结果 |
|---|---|
| agentui 仓内 `web_search_secrets` / rotate API | **无**实现 |
| intellect-gateway `sessions` + `prompt_config` | 整列 JSON 存储,密钥仍嵌在 PC |
| BFF `sanitizePromptConfigWebSearchKeys` | utils + 单测就绪,**未**挂 PATCH(待 `t42-m1-wire`) |
| BFF list 脱敏 / external-info | 已上线(M0) |

**结论(2026-11-25 更新)**:Gateway 侧 PUT/GET/DELETE + migration/store 已实现;M1/M2 的 **BFF 接线**仍未落地 → T4.2 整体保持未完成。

## 3. 资源模型

```text
web_search_secrets(
  id              uuid PK,
  session_id      text NOT NULL,   -- FK → sessions.id
  provider        text NOT NULL,   -- 与前端 WebSearchProvider 枚举对齐
  ciphertext      bytea NOT NULL,  -- AEAD;主密钥 env/KMS
  key_version     int NOT NULL DEFAULT 1,
  created_at      timestamptz,
  updated_at      timestamptz,
  last_used_at    timestamptz NULL,
  UNIQUE(session_id, provider)
)
```

产品默认:**多 provider 多行并存**(设计 §4.3 选项 1);闲置清理用 `last_used_at` TTL 策略(运维可配,非本契约强制)。

## 4. HTTP 契约(建议挂在既有 `/api/sessions/*` 旁)

基址与现网 chat session 一致(BFF → Gateway)。所有路径要求与 `GET/PATCH session` **同等鉴权**(会话所有者 / 同租户策略与现网一致)。响应 **永不**返回明文 key 或 ciphertext。

### 4.1 Upsert(写/轮换合一,M1 最小集)

```http
PUT /api/sessions/{session_id}/web-search-secrets/{provider}
Authorization: <与 session API 相同>
Content-Type: application/json

{ "api_key": "<plaintext once>" }
```

| 响应 | 语义 |
|---|---|
| `204` | 已写入/覆盖该 provider 密文;`key_version++` |
| `400` | provider 非法或 `api_key` 空 |
| `404` | session 不存在或无权 |
| `413` | key 超长(建议上限 8 KiB) |

### 4.2 状态查询(设置页「已配置」)

```http
GET /api/sessions/{session_id}/web-search-secrets
```

```json
{
  "items": [
    { "provider": "tavily", "configured": true, "updated_at": "...", "key_version": 2 }
  ]
}
```

无密文、无明文。

### 4.3 删除

```http
DELETE /api/sessions/{session_id}/web-search-secrets/{provider}
→ 204 | 404
```

### 4.4 可选:显式 rotate 别名

```http
POST /api/sessions/{session_id}/web-search-secrets/{provider}/rotate
{ "api_key": "..." }
```

语义同 PUT;若 Gateway 只实现 PUT,BFF 可映射。

### 4.5 Session 读写行为变更(M1 同步)

| API | 变更 |
|---|---|
| `PATCH .../sessions/{id}` | **Gateway 已实现**:body 可含一次性 `web_search_api_key` 或 legacy `*_api_key`;写入 secrets 后 PC 剥离全部 key;secrets+PC 同事务;加密/PC 更新失败则 PATCH 失败回滚 |
| `GET .../sessions/{id}` | PC **已剥离** key;返回 `web_search_configured_providers` 名单(M3);不返回 key/ciphertext |
| `GET .../external-info` | 不变(已无 key) |
| 列表 sessions | 继续脱敏或无 key(已有 redact) |

**过渡期(契约未落地)**:`GET session` 详情仍回明文 key 供设置页回填——见设计文档 §10。agentui 已对 **list** 路径全 adapter 脱敏(`redactSessionWebSearchSecrets`);**不得**在 M1 前对详情 GET 调用同一脱敏。

### 4.6 检索侧 resolve(M4 / T4.1b,本契约仅占位)

```http
# 仅服务端内部 / 检索执行身份;不对浏览器开放
POST /internal/web-search-secrets/resolve
{ "session_id", "provider" }
→ { "api_key": "..." }  // 短 TTL 审计;日志脱敏
```

## 5. BFF 接线顺序(契约就绪后)

1. enterprise adapter:PUT secret → 再 PATCH PC(剥 key);
2. PATCH 路由:调用已有 `sanitizePromptConfigWebSearchKeys`(**仅当** secrets upsert 成功或 Gateway 已确认剥离);
3. GET session:映射 `web_search_key_configured`;
4. 前端 M3:「已配置 / 重新输入」UI(另批)。

**禁止**:在无 4.1 成功路径时对 PATCH 启用 sanitize(会永久丢非活动 key)。

## 6. 验收(Gateway + agentui 联调)

- [x] PATCH 后 DB `prompt_config` 无任何 `*_api_key`(已实测)(需 BFF/PC 接线,下一批)
- [ ] GET secrets 返回 `configured:true`;external-info `has_web_search_provider` 仍正确
- [ ] 缺 key 的需密钥 provider → BFF 仍 400(T2.7)
- [x] 多 provider 行并存(存储层已测);切回 UI 需 M3
- [ ] 审计日志无明文

## 7. 退出本受限项

Gateway 路由 + 新写入剥离已就绪;仍须 M2 历史回填与前端 M3,才能关闭 T4.2。
