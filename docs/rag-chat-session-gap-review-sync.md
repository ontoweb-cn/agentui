# RAG 集成进 CHAT Session 缺口评审 — 同步给 AgentUI

> 同步日期: 2026-08-05
> 来源: intellect-team 缺口评审 v2 [2026-08-05-rag-chat-session-gap-review.md](file:///Users/simon/project/intellect-team/docs/plans/2026-08-05-rag-chat-session-gap-review.md)(含 B1-B16 共 16 项阻塞点)
> 同步范围: 从 AgentUI 视角提炼**需要前端/BFF 感知或决策**的事项
> 关联文档:
> - [chat-session-gateway-migration-review.md](file:///Users/simon/project/agentui/docs/chat-session-gateway-migration-review.md)(Gateway 迁移可行性评审, §九 Gateway 端缺口 G1-G9)
> - [chat-session-gap-analysis.md](file:///Users/simon/project/agentui/docs/chat-session-gap-analysis.md)(会话功能差距分析, 方案 B 落地)
> - 本文档为 **信息同步**, 不改变既有方案 B 决策; 阻塞点修复由 intellect-team 侧负责

---

## 一、为何需要 AgentUI 感知

AgentUI 的 Hono BFF 是**双后端透明代理**(见 `bff/src/routes/proxy.ts`):
- `:9380` = intellect-rag-app(Python, RAG 增强 chat、KB 上传)
- `:8642` = intellect-team Gateway(Rust, 纯 LLM chat、会话 REST)

因此 RAG 相关的阻塞点不只在 intellect-team 侧,还会**传导到前端行为**:AgentUI 当前依赖的通道(`/v1/chat/completions`、`/v1/rag/*` proxy、`useUploadAndParseFile`)正是部分阻塞点所在的路径。

---

## 二、阻塞点速览(AgentUI 影响视角)

| # | 阻塞点 | 等级 | AgentUI 影响 |
|---|---|---|---|
| B1 | Python 插件 `intellect_upload` 依赖缺失的 `pipeline.py`,摄取工具不可用 | P0 | ⚠️ KB 摄取不能走会话内工具; 现有上传仍走 RAG proxy |
| B2 | Gateway 无原生 multipart 上传,仅 proxy 到 RAG-app | P0 | ⚠️ `useUploadAndParseFile` 仍绑定 intellect-rag,切断引擎依赖受阻 |
| B10 | intellect-rag 工具绕过 member RBAC(`TOOL_RBAC` 死配置) | P1·安全 | ⚠️ 低权限成员可经会话内工具调 admin 级 `intellect_build_graph` |
| B3 | Gateway 检索 100% 依赖外部服务,`intellect-storage` 无 RAG 数据表 | P1 | ⚠️ 未部署 RAG 服务时,经 Gateway 的检索返回空 |
| B4 | `/v1/chat/completions` 创建与续聊回合均不承载 `kb_ids` | P1 | ⚠️ **若 AgentUI 走该通道,RAG 配置无法附加**; 需改走 REST `/api/sessions/{id}/chat` 或等修复 |
| B11 | `is_available()` 仅查 URL,后端离线时 prefetch 静默吞错 | P1 | ⚠️ 用户无感知地拿到无 RAG 增强的回答 |
| B12 | `rerank_id` 已落库但检索请求从不携带 | P1 | ⚠️ 会话级 rerank 配置名存实亡 |
| B13 | `/v1/embeddings`/`/v1/rerank` 与 RAG 隔离,不读 `tenant_model_config` | P1 | ⚠️ NFR5 无支撑 |
| B14 | k8s 无 RAG 工作负载,`deploy/rag` QS 依赖不完整 | P1 | ⚠️ k8s 部署无法上线 RAG |
| B5 | Document/File 所有权列仍引擎 TODO | P1 | ⚠️ 隔离由引擎执行,旧引擎上有跨租户读取风险 |
| B16 | RAG 代理端点仅 `authenticate_or_401`,上传写操作无身份要求 | P2 | ⚠️ 经 Gateway 的 RAG 上传无本地成员校验 |
| B6 | `on_session_end`/`on_pre_compress` 声明但 intellect-rag 未实现 | P2 | 影响会话级 RAG 积累,前端无直接感知 |
| B7 | 上下文注入位置分歧(user 消息 vs system prompt) | P2 | 影响 prompt cache 与行为一致性 |
| B15 | `tenant_model_config` 孤表 | P2 | 模型路由空转,与 B13 联动 |
| B8 | 工具命名三套(`intellect_*`/`lightrag_*`/`search_knowledge`) | P3 | 前端工具面需按端适配 |
| B9 | 默认配置空转,`.env.example` 无 RAG 变量文档 | P3 | 部署入口不明确 |

✦ 完整证据与修复建议见 [intellect-team v2 评审](file:///Users/simon/project/intellect-team/docs/plans/2026-08-05-rag-chat-session-gap-review.md)

---

## 三、AgentUI 侧需要决策的事项

以下决策项供进一步分析与决策(当前方案 B 不变,仅记录分歧点):

### D1 — 会话通道标准化:REST `/api/sessions/{id}/chat` vs `/v1/chat/completions`

- **现状分歧**: REST 通道读会话 `kb_ids`(`api_server.rs:1543/1701`,patch 后立即生效);OpenAI 兼容通道创建与续聊都不承载 `kb_ids`(B4)
- **决策点**: AgentUI 对"有 KB 的会话"是(a) 固定走 REST 通道,还是(b) 等待 B4 修复后统一走 `/v1/chat/completions`?
- **影响**: 若走 (b) 且 B4 未修,已绑 KB 的会话每次续聊回到无 KB 状态

### D2 — 文件上传路径:`useUploadAndParseFile` 的绑定

- **现状**: 前端上传仍指向 intellect-rag `/proxy/v1/document/upload`(G6 未解,即 B2);Gateway 侧仅 `/v1/rag/knowledge-bases/{kb_id}/documents` proxy
- **决策点**: (a) 保持 RAG proxy 依赖,等 Gateway 原生上传子项目(B2);(b) 前端降级/提示; (c) 改用会话内摄取工具(当前 B1 不可用,不可行)
- **影响**: 影响"切断 intellect-rag 依赖"的产品目标

### D3 — KB 检索通道与空数据兜底

- **现状**: Gateway 检索依赖 `RAG_SERVICE_URL`(B3);后端离线时 prefetch 静默降级(B11),用户拿到无增强回答而无提示
- **决策点**: 前端是否需要对"RAG 未启用/后端离线"状态做 UI 标识,避免用户误判回答可靠性?

### D4 — 安全收敛:RAG 工具/代理的权限边界

- **现状**: intellect-rag 工具绕过 member RBAC(B10);Gateway RAG 代理仅 `authenticate_or_401`(B16);引擎所有权列 TODO(B5)
- **决策点**: 企业版租户场景下,是否在 BFF 层对 `/v1/rag/*` 写操作做租户级门控作为过渡兜底,直至 intellect-team 侧修复?

---

## 四、建议配合动作

1. **短期**: AgentUI 对"有 KB 的会话"显式走 REST `/api/sessions/{id}/chat` 通道,规避 B4
2. **短期**: 上传功能保持现状(RAG proxy),并记录 B1/B2 为"切断依赖"前置项
3. **中期**: 与 intellect-team 对齐 B10/B16 修复节奏(可在 Python/Gateway 侧独立修复,不影响前端)
4. **中期**: 前端增加 RAG 可用性提示(对应 B3/B11 的状态暴露)
5. **文档**: 在 AgentUI 用户手册标注"Gateway chat 模式与 RAG chat 功能差异"(延续 G6/R3 建议)

---

## 五、同步结论

- **不改变方案 B**;本同步仅将 intellect-team v2 评审的 16 项阻塞点映射到 AgentUI 影响面
- **AgentUI 应立即规避的只有 D1**(会话通道选择),其余为配合项
- 阻塞点修复进度以 [intellect-team v2 评审](file:///Users/simon/project/intellect-team/docs/plans/2026-08-05-rag-chat-session-gap-review.md) 为准
