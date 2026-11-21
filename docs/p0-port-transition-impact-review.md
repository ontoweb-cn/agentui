# P0 移植的过渡期影响评审(代码 + 文档)

> 生成时间:2026-11-21 10:29
> **v2(2026-11-21 11:19):按文档技术评审,以 intellect-gateway 源码实证修正——"Gateway PATCH 能力限制"假设被推翻,瓶颈确认纯在 BFF 层,修复降级为 BFF 单层**
> 评审对象:`dev` @ `66f2f3d`(P0 主提交 `65f69b4` + 评审修复 `66f2f3d`)及两份文档
> 评审方法:全链路代码核实(保存链路、adapter 实现、上游对照、BFF 拓扑)+ 文档时效性检查
> 重点:除质量与安全外,评估当前代码对**移植过渡期**(上游同步 / Go 化 Phase A-D / 后端切换)的影响

## 一、总体结论

1. **本次 P0 移植的前端代码本身对过渡期是安全的**:逐字移植的 3 个文件零漂移;改动均为配置层、不依赖任何后端专属端点;`has_web_search_provider ?? has_tavily_key` 的回落设计在字段未就绪时行为正确。
2. **但发现一个存量集成断点(P0 级阻塞,非本次引入)**:聊天设置保存链路在 BFF 层被截断为 title-only——`prompt_config`(含本次新加的 web-search 配置)**到不了 Rust Gateway**,整个设置页的保存(改名以外)疑似自 next-chats 新前端上线起即不生效。
3. **任务清单 T4.1 靶点有误**:provider 配置的存储/聚合位/校验都在 **Rust Gateway + BFF 层**,不在 intellect-rag;因此 **Python→Go 切换(Phase C)不触及本次改动的持久化路径**(正面结论),但 Gateway 能力是当前真正约束。

## 二、过渡期实际拓扑(核实后)

```text
Browser ──▶ Nginx ──┬──▶ BFF(Hono,防腐层,adapter-registry 多后端)
                    │        ├─ bff-agents.ts(/api/bff/agents/chat/sessions/*)
                    │        └─ adapters: intellect-enterprise / -community / -rag / hermes / kag
                    │             └─▶ intellect-team Rust Gateway(/api/sessions/*)
                    │                  ← chat 会话与 prompt_config 实际存储于此
                    └──▶ intellect-rag(Python fork v0.26.1)← RAG/数据集/检索

关键事实:gateway-chat-service.ts 头注——"intellect-rag chat 功能已全部迁移到
intellect-team Rust Gateway,前端所有 chat 调用经 BFF /api/bff/agents/* 对接
Gateway /api/sessions/*";上游 RAGFlow 无 session API(patchAgentSession 零命中),
该层为 agentui/Intellect 特有。
计划中的 Go 化(Phase A/B/C)针对 intellect-mem/dsl/rag —— 不触及 Rust Gateway。
```

## 三、证据链(保存链路逐环核实)

| 环节 | 位置 | 行为 |
|---|---|---|
| 前端提交 | `src/pages/next-chats/chat/app-settings/chat-settings.tsx` L34/L98 → `useUpdateChat`(use-chat-request.ts L266) | patchData **整包含** `name/title/kb_ids/prompt_config` |
| service | `src/services/gateway-chat-service.ts` L53 `patchGatewayChat` → `api.patchAgentSession(GATEWAY_CHAT_AGENT_ID, chatId)`(`GATEWAY_CHAT_AGENT_ID = 'chat'`,L18) | URL = `/api/bff/agents/chat/sessions/:id` |
| BFF 路由 | `bff/src/routes/bff-agents.ts` L244-262 | **只取 `title`**(缺失即 400);`prompt_config`/`kb_ids` 被丢弃 |
| adapter | `bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts` L240-259(另核实 intellect-rag L122、shared L208 —— **所有** adapter 的 `updateSession` 签名均为 `{ title?: string }`) | 仅发 `title` 到 Gateway `PATCH /api/sessions/{id}` |
| 对照 | 同文件 `createSession` L178-194 | **POST 明确支持** `title/kb_ids/prompt_config`("body 可带") |
| Gateway 实证(v2) | `intellect-team/intellect-gateway/src/platform/api_server.rs`:L3285 路由注册、L426 `PatchSessionReq`、L1308 `handle_patch_session` | **PATCH 完整支持 `title/end_reason/kb_ids/prompt_config`**:字段白名单校验 + `UPDATE sessions SET prompt_config=$1` / `kb_ids=$1` 直写;全空时报 "allowed: title, end_reason, kb_ids, prompt_config"。**注意:`prompt_config` 为整列替换语义(整个 JSON 覆盖)** |
| 勘误(v2) | `gateway-chat-service.ts` L14 区"仅支持 title"、`bff-agents.ts` L240"重命名 session" | 系**过时注释**,不构成 Gateway 能力证据;前端发送层注释(use-chat-request.ts L278"Gateway session 支持 title + kb_ids + prompt_config 字段更新")早已写明真实契约 |

## 四、发现(按严重度)

| 严重度 | 位置 | 发现 |
|---|---|---|
| **高(P0 级阻塞,存量)** | BFF PATCH 路由 + 实现 `updateSession` 的 adapter(intellect-enterprise / intellect-rag / shared) | **设置保存链路 title-only 断点(定性已实证)**:前端按正确契约整包发送(F-3),Gateway 完整支持接收(F-1)——**中间的 BFF 把两者焊死**(路由丢字段 + adapter 签名窄)。本次移植的 web-search 配置、乃至设置页全部字段的保存到不了 Gateway,且保存返回成功(**静默失败**)。属 BFF 落后于两侧契约的存量缺陷,非本次引入。附带缺陷:`kb_ids` 仅在 `dataset_ids?.length` 时发送(use-chat-request.ts L281-283),**清空知识库绑定无法保存**。修复为 BFF 单层(见第六节 T2.10);端到端验证方式见第七节 |
| 高 | 任务清单 T4.1、改进文档"P0 实施记录" | **T4.1 靶点错误**:provider 配置的存储(Rust Gateway)、聚合位 `has_web_search_provider`(BFF/Gateway external info)、PATCH 校验(T2.7 落点=BFF)都在 Gateway/BFF 层;intellect-rag 仅涉检索执行联动。T4.1 需拆分重写——**已落实:任务清单 v3 的 T4.1a/T4.1b**;**正面结论:Python→Go 切换不触及配置持久化** |
| 中 | 数据模型层 | **模型级漂移**:上游 web-search 配置基于 dialog 模型(`/v1/chat`),agentui 基于 session 模型(Gateway)。上游后续演进(key 独立存储等)无法直接跟随——应在 T3.6 同步机制中维护"数据模型差异表" |
| 中 | `web-search-form-field.tsx`、`tailwind.css`/`.config.js` | **同步漂移面盘点**:逐字移植的 3 个文件(api-key 助手/枚举/truncated-text)零漂移;但 ①`web-search-form-field.tsx` 结构性偏离(shadcn 表单原语 + FormMessage),上游每次演进需手工重适配——建议文件头加 provenance 注释(ported from upstream `91c702e` + 适配点);②`--colors-*` 别名块为共享样式文件中的 agentui 独有增量,子树同步必冲突——建议块注释标注 agentui-only,同步时按块保留 |
| 低 | `CLAUDE.md` L24 | 后端表述过时:`Browser → Nginx → (intellect-rag Python backend OR BFF)` 未含 Rust Gateway 链路,与实际三层拓扑不符 |
| 低 | 改进文档"P0 实施记录" | "后端枚举同步属 intellect-rag 仓库事项"的表述需按 T4.1 拆分同步修正 |
| 信息 | `66f2f3d` + 文档 | 质量与安全增量复核:上次评审后代码增量仅 3 文件 +6/−1 与守卫脚本,无新问题;title-only 断点为存量缺陷 |
| 信息(正面) | adapter-registry、share 页回落 | 多后端防腐层设计对过渡期健全(Go 化后换 adapter 指向即可);分享页回落路径在过渡期成立 |

## 五、确认无误的部分

- 逐字移植文件(`web-search-api-key.ts`、枚举、`truncated-text.tsx`)与上游零漂移;
- 前端改动不引入任何 Python 专属端点依赖,Phase A-D 切换不破坏之;
- `check-color-tokens` 守卫按仓库相对路径工作,目录结构变化不影响;
- 文档中的时点快照表述(如"react-virtual 未安装")属清单固有性质,已带时间戳。

## 六、对任务清单的修订建议(v3)

1. **新增 T2.10(插队为最高优先)**:设置保存链路修复——**已收敛为 BFF 单层**(Gateway 能力经源码实证,F-1,无需 Rust 改动):①`bff-agents.ts` PATCH 路由透传 `prompt_config`/`kb_ids`(移除 title-only 提取与 400 拦截逻辑);②三个实现 `updateSession` 的 adapter(intellect-enterprise/intellect-rag/shared)签名扩展为 `{ title?, kbIds?, promptConfig? }` 并透传;③`adapter-registry-types` 接口同步。预估 0.5-1 天;**它阻塞 T2.4/T2.7/T2.8 的实际价值**;BFF 改动的验收走 bff 包自带测试(`cd bff && npm run test`/`npm run type-check`,vitest),根 lint/type-check 不覆盖 `bff/`。
2. **T4.1 拆分**:
   - T4.1a **Rust Gateway/BFF**:确认 `prompt_config` 存储透传性、`has_web_search_provider` 聚合位、PATCH 校验(T2.7 并入);
   - T4.1b **intellect-rag**:仅检索执行联动(并入 Phase C 评估)。
3. **T2.4**:PATCH 语义确认对象改为 Rust Gateway;**T2.7**:落点写死 BFF `bff-agents`。
4. **新增文档任务**:CLAUDE.md L24 拓扑修正;provenance/漂移标注约定(可并入 T2.5 或 T3.6)。

## 七、后续动作(待确认)

1. 端到端验证 F1:设置页修改 system prompt → 保存 → `GET /api/sessions/{id}` 观察 `prompt_config` 是否变化(**当前预期:不变**,坐实断点;BFF 修复后预期:变化);
2. 任务清单更新为 v3(含 T2.10 插队、T4.1 拆分);
3. CLAUDE.md L24 与改进文档表述修正;
4. 为移植文件补 provenance 注释(可与 T2.5/T3.6 合并执行)。
