# 联网搜索 API Key 独立存储架构评估(T4.2)

> 日期:2026-11-22;九步交付 module: ragflow-next-iter
> 状态:**设计评估**(本批不改现网行为)
> 关联:清单 T4.2 / T4.1a ④ / T2.4;[ragflow-t41a-manual.md](./ragflow-t41a-manual.md);安全评审「prompt_config 明文密钥」高项

## 1. 现状与问题

| 维度 | 今天 |
|---|---|
| 存储 | Rust Gateway `sessions.prompt_config` JSON 内嵌 14 个 `*_api_key` 明文 |
| 写入 | 前端整包 → BFF PATCH(T2.10 透传 + T2.7 校验)→ Gateway **整列替换** |
| 读出 | 认证态设置页拿整包(含 Key);分享页 `external-info` 仅 bool(T4.1a,不回传 Key) |
| 非活动 Key | 短期保留(T2.4:换回不丢);写侧 prune 延期至本设计落地(T4.1a ④) |

问题:
1. **机密与配置耦合**——任意能读 session 的主体都能见全部第三方 Key;
2. **审计困难**——Key 出现在 PATCH body、日志、备份 JSON;
3. **过滤两难**——整列替换下前端剥离=永久丢失;不剥=密钥滞留扩大面。

## 2. 目标

1. Key **独立存储**;`prompt_config` 只保留 `web_search_provider` + **引用**(或「已配置」标记);
2. 默认读路径 **不回传明文**(设置页编辑用专用「揭秘/轮换」API,带权限与审计);
3. 承接 T4.1a ④:**存储侧只保留活动 provider 的密钥记录**,非活动可归档/TTL,换回需重填或从归档恢复(产品拍板);
4. 作为 intellect-rag / Gateway Go 化 **Phase A/B 数据模型输入**,避免在 Python fork 一次性投入。

## 3. 方案对比

| 方案 | 描述 | 优点 | 缺点 | 裁决 |
|---|---|---|---|---|
| A. 继续整包明文 | 现状 | 零改动 | 安全评审高项不收敛 | 否 |
| B. BFF 写侧 prune only | PATCH 时丢掉非活动 `*_api_key` | 小改 | 换回丢 Key;仍明文存活动 Key | 过渡可选,非终态 |
| C. Gateway secrets 表 + 引用 | `web_search_secrets(session_id, provider, ciphertext, …)`;PC 存 `web_search_secret_ref` 或仅 provider | 机密分离;可轮换/审计 | 需 Gateway schema + BFF 适配 | **推荐终态** |
| D. 外部 KMS/Vault | Key 只存 Vault 路径 | 企业合规最优 | 运维重;本地/社区版难 | Phase 后期可选 |

**推荐路径**:短期可保留 A(+ 已有公开面脱敏);中期 **C**;合规加强时叠加 D。

## 4. 推荐架构(C)

```text
Browser 设置页
  │  save: { web_search_provider, api_key? }   // key 仅在「新建/轮换」时出现
  ▼
BFF PATCH /agents/chat/sessions/:id
  │  ① 校验 provider/key(T2.7)
  │  ② 若带 api_key → secrets.upsert(session, provider, encrypt(key))
  │  ③ 写 prompt_config 时剥离所有 *_api_key,只留 provider(+has_* 可由查询派生)
  ▼
Gateway
  sessions.prompt_config   // 无明文 key
  web_search_secrets       // 按 session+provider;ciphertext;updated_at
  ▼
检索执行(T4.1b / Phase C)
  resolve(provider) → decrypt(secret) → 调用搜索 API;日志脱敏
```

### 4.1 数据模型草稿

```text
web_search_secrets(
  id, session_id, provider,  -- unique(session_id, provider)
  ciphertext,                -- AEAD;主密钥来自 env/KMS
  key_version,
  created_at, updated_at,
  last_used_at nullable
)
```

`prompt_config` 保留字段示例:`web_search_provider`, `prologue`, `system`, …;**禁止**持久化 `*_api_key`。

### 4.2 API 草图

| API | 行为 |
|---|---|
| `PATCH .../sessions/:id` | body 可含一次性 `web_search_api_key`;响应 **永不**回 key |
| `GET .../sessions/:id` | PC 无 key;可附 `web_search_key_configured: bool` |
| `POST .../sessions/:id/web-search-secret/rotate` | 轮换;旧密文作废 |
| `DELETE .../sessions/:id/web-search-secret` | 清除当前 provider 密钥 |
| `GET .../external-info` | 继续只用 `has_web_search_provider`(已实现) |

### 4.3 与「换回不丢 Key」产品决策

T2.4 短期选择整包保体验。终态两种产品选项(需业务拍板,记入本设计):

1. **多 provider 密钥并存**(secrets 表多行)——切回即用,接近今日体验;
2. **仅活动 provider 一行 + 归档 TTL**——切回需重填或从归档恢复。

推荐默认 **选项 1**(表允许多行),用 `last_used_at` 做闲置清理策略,兼顾安全与体验。

## 5. 迁移阶段

| 阶段 | 动作 | 仓库 |
|---|---|---|
| M0(已做) | 分享/公开面不回传 key | agentui T4.1a |
| M1 | BFF:写路径接受 key → 调 Gateway secrets API;读路径剥 key | agentui BFF + Gateway |
| M2 | 存量:扫 `prompt_config.*_api_key` → 迁入 secrets → 回写剥后的 PC | Gateway 批任务 |
| M3 | 前端设置页改为「已配置 / 重新输入」UI,不再期望 GET 回填明文 | agentui |
| M4 | 检索执行改为 secrets.resolve(T4.1b) | intellect-rag Go / Phase C |
| M5(可选) | 主密钥进 KMS(方案 D) | 运维 |

**不在 Python fork 上做 M1–M4 一次性投入**;Gateway secrets 可先于 Phase C 落地(chat 配置已在 Gateway)。

## 6. 验收标准(落地时)

- [ ] GET session / external-info 响应 JSON 不含 `*_api_key` 或疑似密钥字段
- [ ] 配置 Exa 后分享页 `has_web_search_provider=true`,设置页可「已配置」展示
- [ ] 轮换后旧 key 无法再用于检索;审计日志有 rotate 事件且无明文
- [ ] 迁移任务 M2 幂等;回滚手册具备
- [ ] T2.7 语义保持:缺 key 的需密钥 provider → 400

## 7. 非目标

- 本设计不实现模型供应商 Key、RAG Admin Token、SSO client_secret(另有 vault/env 通道);
- 不在本批改 PATCH prune 行为(避免未建 secrets 表时丢数据)。

## 8. 结论

采纳 **方案 C(Gateway secrets + 引用)**,分 M0–M4 演进;T4.1a ④ 写侧过滤在 M1/M2 与多行 secrets 策略一并落地。agentui 侧下一代码批优先配合 Gateway secrets API 契约评审,而非先行 prune。

## 9. 后续(v9 / 2026-11-23)

- **契约草案已出**:[web-search-secrets-gateway-api-contract.md](./web-search-secrets-gateway-api-contract.md)— 供 Gateway 评审实现。
- **取证**:intellect-gateway / agentui 仍无 `web_search_secrets` 路由 → **L-T42-01** 延续;BFF **未**接线 `sanitizePromptConfigWebSearchKeys`。
- Gateway 可探测实现后开九步 module `t42-m1-wire`。

## 10. 过渡期读路径风险与缓解(评审加固 2026-11-23)

| 路径 | 密钥面 | 过渡策略 |
|---|---|---|
| `GET .../external-info` | 无明文 | 已上线(M0) |
| `listSessions`(enterprise / rag / mcp / openai-base) | 无明文 | `redactSessionWebSearchSecrets` / normalize 脱敏 |
| `GET .../sessions/:id` | **仍含明文** `*_api_key` | **有意保留**:设置页整包回填与「换回不丢 key」(T2.4)依赖;须认证且同会话所有者。**禁止**在无 secrets 表时对详情脱敏(会破坏保存回写)。终态见契约 §4.5 → `web_search_key_configured` + 无明文 |
| PATCH 写侧 prune | 未启用 | 无表 prune = 永久丢非活动 key;见 §7 |

残余 Medium(安全评审):详情 GET 暴露活动+非活动 key——接受为 **L-T42-01 / M1–M3** 债;缓解=鉴权边界 + 列表/分享已脱敏 + 契约已冻结。

## 11. M1 预备客户端(2026-11-23)

- 代码:`bff/src/utils/web-search-secrets-client.ts`(`probeWebSearchSecretsApi` / `buildWebSearchSecretPutUrl`)。
- **仍禁止**在 probe≠available 时对 PATCH 调用 `sanitizePromptConfigWebSearchKeys`。
- 九步复证报告:[REPORT-exec-triad-20261123.md](../tests/e2e-tests/reports/REPORT-exec-triad-20261123.md)。
