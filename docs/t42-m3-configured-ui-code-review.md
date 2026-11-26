# M3 代码评审:已配置 / 重新输入

> 2026-11-25;范围:Gateway session metadata/runtime resolve、BFF status/validate、前端设置页。结论:**M3 代码可合入;仍有 3 个中危设计/环境缺口,不能把 T4.2 标为完成**。

## 一、评审后已修

| # | 级别 | 问题 | 修复 |
|---|---|---|---|
| H1a | HIGH | `GET /api/sessions/{id}` 对 team/project 可见成员新增返回 `prompt_config`,可能暴露作者 system prompt;且 None==None 会把匿名当 owner | 仅 `bypass_member_filter` 或 `auth.member_id.is_some() && owner` 返回 sanitized PC + configured;其余只返回原 SessionResp |
| H1b | HIGH | `handle_delete_session` 同样把 `None==None` 当 owner,匿名可删无 member 会话 | 改为 `bypass || (member_id.is_some() && owner)` |
| H1c | HIGH | member token 对 legacy `member_id=NULL` 会话可 GET/PATCH secrets,可改走 secret 状态 | PATCH/secrets/fork/messages 使用 strict `allow_legacy_access=false`,Forbidden→404 |
| H1d | HIGH | chat 路径仍可读 legacy session;若直接 resolve,member 会消耗 owner 的 web-search key | resolve 前校验 owner/bypass;非 owner 不注入 secret |
| H1e | HIGH | `apply_session_rag_config_core` 把历史 PC 明文 key 复制给任意可见成员 | 进入 agent config 前 strip 全部 key;单测覆盖 |
| H6 | HIGH | Python 共享 env 注入会让 Exa/Parallel/Firecrawl 缓存客户端跨会话复用上一会话 key | 仅 Tavily 允许 env override;Gateway 也只对 Tavily 注入;Exa/Parallel/Firecrawl 暂不接 |
| H2 | MEDIUM | M2 回填 SQL 只匹配 `%api_key%`,漏 `tavilyApiKey` 等 camelCase | 增加 `%apikey%`;camelCase 回填实测 |
| H3 | MEDIUM | 回填事务内 `resolve` 借用第二连接,小池死锁;并发 PATCH 可覆盖新 PC | resolve 移出事务;PC CAS `WHERE prompt_config=原值` |
| H4 | MEDIUM | legacy 只有 key 无 provider,迁移后 UI 选不中 | 单 key 自动补 `web_search_provider` |
| H5 | MEDIUM | M3 显示已配置,但运行时仍没有 key | `apply_session_rag_config` resolve 后注入 `RuntimeSecret` 专用字段(M4 路径) |

## 二、仍存风险

| # | 级别 | 问题 | 建议 |
|---|---|---|---|
| M1 | LOW | Gateway→Python 已接 Tavily/Exa/Parallel/Firecrawl/Brave;cache reset 防串 key;其他 provider/native/真实端到端未接 | 见 [契约](./t42-runtime-web-search-consumer-contract.md) |
| M5 | LOW | `check_fn` 已支持 `INTELLECT_WEB_SEARCH_GATEWAY_MANAGED=1`;Gateway 在配主密钥时注入,工具可发现 | 已处理;无 session key 时调用仍会 provider 报错 |
| M2 | MEDIUM | 历史明文生产回填未执行;M2 CLI 已有 `--verify` | 生产窗口 dry-run→apply→verify,备份/回滚 |
| M3 | LOW | member-token 跨用户 GET/PATCH 已本地 HTTP 验证(PATCH/secrets 404,GET 无 PC) | 保持 CI 夹具 |
| M4 | MEDIUM | 主密钥无版本/轮换;`enc:v1` 兼容路径绕过 AAD | 方案见 [t42-secret-master-key-rotation-design.md](./t42-secret-master-key-rotation-design.md);代码未实现 |
| L1 | LOW | provider guard 已挂 `npm run type-check`(无 sibling 时 skip) | 已处理 |
| L2 | LOW | BFF 仅在严格校验缺 key 时才查 secrets;旧 Gateway 回落严格 | 已优化 |
| L3 | LOW | configured 文案只加 en/zh,其他 locale 回落 key | 按需补全 |
| L4 | LOW | 无真实浏览器/provider 端到端 | R6 受限记录,不伪造 |

## 三、验证

| 检查 | 结果 |
|---|---|
| Frontend Jest | 66 suites / 809 tests |
| BFF vitest | 71 files / 1271 tests |
| Gateway 单测 | 6 passed |
| Core RuntimeSecret | 1 passed |
| Storage PG | 1 passed |
| Frontend build/type-check/lint | 通过/0 errors |
| M3 HTTP | sanitized PC、configured 名单、空 key 保留 key_version、legacy 补 provider |
| M2 camelCase backfill | PASS(本地 PG) |

## 四、结论

- **新写入 + M3 UI/BFF + runtime resolve 代码路径**:质量可接受,未发现可直接越权读取 key 的路径;
- **H1a/H1b/H1c/H1d/H1e/H2/H3/H4/H5/H6 已修;M1 运行时边界已收口**;
- **T4.2 整体仍未完成**:native/consumer 接线、M2 生产回填、M4 主密钥、真实浏览器/provider 验收。
