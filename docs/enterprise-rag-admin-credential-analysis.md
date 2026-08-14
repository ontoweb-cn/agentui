# 企业版 RAG 管理员凭证改进分析

> **日期**: 2026-08-14（初稿）/ 2026-08-14（按[技术评审](./enterprise-rag-admin-credential-analysis-review.md)修订）
> **状态**: 分析已吸收评审（未实施；可据此写实施计划）
> **范围**: AgentUI BFF 的 `INTELLECT_RAG_ADMIN_EMAIL` / `INTELLECT_RAG_ADMIN_PASSWORD` 与 intellect-team 已登录身份的关系
> **关联文档**:
> - [技术评审](./enterprise-rag-admin-credential-analysis-review.md)（C1–C2 / I1–I6 已吸收）
> - [RAG 侧验证清单](./enterprise-rag-admin-credential-analysis-rag-verify-checklist.md)（§9 待核对项展开，可交 intellect-rag-app 仓执行）
> - [specs/011-team-rag-tenant-consistency/spec.md](../specs/011-team-rag-tenant-consistency/spec.md)（方案 B：`sessionToken` + `intellectTenantId`；当时非目标为保留 admin JWT 兜底）
> - [specs/006-frontend-login-adaptation/auth-flow.md](../specs/006-frontend-login-adaptation/auth-flow.md)（`imt_` token 登录流程）
> - [docs/identity-model-migration-frontend-impact.md](./identity-model-migration-frontend-impact.md)（身份同步与双 ID）
> - [docs/intellect-team-integration/README.md](./intellect-team-integration/README.md)（member token vs `API_SERVER_KEY`）

---

## 1. 结论

企业版 **不应** 再用 `INTELLECT_RAG_ADMIN_EMAIL` / `INTELLECT_RAG_ADMIN_PASSWORD` 为「当前用户」换 RAG JWT。目标态是：已登录 intellect-team 的请求带着 `imt_` 访问 RAG；BFF 进程级 RAG 超管只用于明确的机器路径（或社区版服务账号），禁止在企业版用户路径上静默降级。

单独再「用 TEAM 登录换发一份 RAG JWT」会把双 ID（RAG UUID vs TEAM `member_id`）拉回来，**不作为目标态**。

当前实现 **尚未** 达到「企业版用户请求已经基本不走超管」。`imt_` 透传只覆盖挂了 `authSessionMiddleware` 的 `/proxy/*`。画布（`/canvas/*`）和 Agent 原生路由（`/agents/*`）即使 cookie 在，也仍走 RAG 超管 JWT。

| 判断 | 修订后说明 |
|---|---|
| 企业版用户请求不再用 EMAIL/PASSWORD | **目标可行**。现状仅 `/proxy/*` 且 cookie 存在时成立；`/canvas/*`、`/agents/*` 仍走超管 |
| TEAM `admin`/`owner` 自动拥有 RAG 管理权 | 可行，关键在 RAG 同步角色 + 接口改认 `tenant_membership`。另须统一 BFF `llm-auth`（只认 `admin`）与兵棋（`admin`\|`owner`） |
| 完全删除这两个变量 | 社区版当前是 **全体超管代理**，仍需要某种 RAG 凭证；是否接受该模型需产品确认。企业版单租户部署可以删 |
| 未登录也「拿到 JWT」 | 不该做。实现上任意 `Authorization` 头仍能过 BFF 再被换成超管身份，这是必须关掉的提权面 |

**推荐**：方案 A（企业版用户路径只认 `imt_`），但 BFF 工作量大于「改 `rag-fetch` 降级」：先补 session 中间件，再收紧 `authMiddleware`，再禁超管降级，并收口 TokenVault。RAG 角色同步仍是授权前置，不能替代中间件修复。

---

## 2. 背景：RAG 凭据实际有三套通道

BFF 代理画布、知识库等请求时，历史上需要一份 intellect-rag 管理员 JWT。原先靠环境变量写死 `HARNESS_INTELLECT_RAG_ADMIN_TOKEN`；JWT 会过期，要人工更新。

后来增加 BFF 用管理员账号调 `POST /api/v1/auth/login`，缓存响应头里的 JWT，401 后再登一次。实现见 `bff/src/services/rag-token-provider.ts`。登录目标由 `INTELLECT_RAG_HOST` + `PYTHON_API_PORT` 决定（默认 `localhost:9380`）。

这不是仅有的通道：

| 通道 | 位置 | 行为 |
|---|---|---|
| `INTELLECT_RAG_ADMIN_EMAIL` / `INTELLECT_RAG_ADMIN_PASSWORD` | `rag-token-provider.ts` | 登录换 JWT，请求级动态注入；密码按前端流程 Base64 + RAG 公钥 RSA |
| `HARNESS_INTELLECT_RAG_ADMIN_TOKEN` | env + `resolveRagToken` 降级 | 静态 JWT |
| TokenVault `email-password` | `harness-store.ts` + wizard | **把 vault 里的 password 填进 `backend.adminToken`**，不走 login |

Wizard 注释写「完整鉴权由 setup 后的 RagTokenProvider 接管」，但 store 加载时 `credential.kind === 'email-password'` 会把 password 当作 `adminToken` 明文。与 `INTELLECT_RAG_ADMIN_*` 并行且语义不一致。只改/删除 EMAIL/PASSWORD 环境变量，wizard 配的账号仍可能当静态 token 用。

`bff/.env.example` 目前只列出静态 token，未列出 EMAIL/PASSWORD。

### 2.1 harness-store skip 与动态登录互不救

`harness-store.ts`：`adminToken` 为空则 skip 该 backend，adapter 不注册。`ragTokenProvider.login()` 在 store 加载之后，且不回写 `adminToken`。

只配 EMAIL/PASSWORD、不配 `HARNESS_INTELLECT_RAG_ADMIN_TOKEN`、vault 也没有可用凭据时：启动 warn skip，画布/RAG adapter 503，与动态登录是否成功无关。动态登录解决的是 **已加载 backend 的请求鉴权**，不是 backend 能否进 registry。

### 2.2 硬编码 RSA 公钥

`rag-token-provider.ts` 内嵌 intellect-rag `conf/public.pem`。RAG 换钥后登录静默失败，再降级静态 token。若社区版短期仍保留动态登录，公钥应配置化或从 RAG 拉取，避免静默降级。

---

## 3. 现状：两套身份，且 `imt_` 覆盖面不完整

| 身份 | 从哪来 | 实际给谁用 |
|---|---|---|
| TEAM member token `imt_*` | 用户登录 intellect-team，HttpOnly cookie `imt_token` | **仅** 已挂 `authSessionMiddleware` 且 cookie 存在的路径（主要是 `/proxy/*`） |
| RAG admin JWT | 上节三套通道 | `/canvas/*`、`/agents/*`、无 session 的 proxy、启动预热、`healthCheck`、社区版 proxy 主身份 |

`fetchWithRagToken`（`bff/src/services/rag-fetch.ts`）**实现**中的 token 优先级：

1. 调用方已带的 `Authorization`（proxy / adapter 会先删掉客户端头，这条对透传路径通常走不到）
2. 用户会话 token（`sessionToken`，企业版 `imt_*`）
3. 动态登录拿到的 RAG admin JWT（EMAIL/PASSWORD）
4. `fallbackStaticToken`（`backend.adminToken`）或 env `HARNESS_INTELLECT_RAG_ADMIN_TOKEN`

文件头注释仍写「显式 Authorization > 动态 token > fallback」，未包含 `sessionToken`。后续改代码时须以实现为准，并同步注释，避免按过期注释回退。

### 3.1 中间件挂载（`imt_` 透传的真实范围）

`backendContextMiddleware` 用 `getAuthSession(c)` 填 `sessionToken`。`AUTH_SESSION_KEY` 只由 `authSessionMiddleware` 写入。未挂 session 中间件时，session 为空，adapter 落到超管 JWT。

`bff/src/index.ts` 实际挂载：

| 路由 | `authSessionMiddleware` | `backendContextMiddleware` | 企业版打 RAG 时的身份 |
|---|---|---|---|
| `/proxy/*` | 有 | 无（proxy 内联读 cookie） | cookie 存在 → `imt_`；否则 → 超管 JWT |
| `/auth/me`、`/auth/logout` | 有 | 无 | 不调 RAG |
| `/agents/*` | **无** | 有 | `sessionToken` 未设 → **超管 JWT** |
| `/canvas/*` | **无** | 有 | 同上。画布是 Constitution Principle III 硬绑定 intellect-rag 的路径 |
| `/capabilities/*` | **无** | 有 | 一般不调 RAG 上游鉴权，同样拿不到 session |

因此：企业版用户操作画布时，分析初稿声称的「真实身份透传」**当前并未发生**。RAG 侧 `from_intellect_team_session` + `ensure_team_user` 只在真正带上 `imt_` 的请求上生效。spec 011 改进 3（tenant 管理接口改认 `owner`/`admin`）同样只覆盖 `imt_` 路径。

EMAIL/PASSWORD 解决的不是「当前登录用户拿 JWT」，而是 **BFF 在没有把用户会话注入上游时，用一份进程级超管身份继续调 RAG**。这覆盖：

- `/canvas/*`、`/agents/*`（即使企业版已登录）
- 社区版 `/proxy/*`（见 §5，这是主身份而非兜底）
- 企业版 cookie 缺失，或只带任意 `Authorization` 头（见 §4）
- 启动预热（`index.ts` 里 `ragTokenProvider.login()`）
- `IntellectRagAdapter.healthCheck`（不传 `sessionToken`）

spec 011 当时的非目标写明「不消除 admin JWT 兜底路径」。本文是该决策的后续评估。

---

## 4. 提权面：存在性鉴权 + 剥离客户端 token

`bff/src/middleware/auth.ts`：`Authorization` 头存在即放行，不校验签名、过期或用户。企业版 cookie 路径同样只检查 cookie 是否存在。

`bff/src/services/intellect-rag-client.ts`：删除客户端 `Authorization`，再由 `fetchWithRagToken` 注入 `sessionToken` 或动态/静态超管 JWT。`llm-auth.ts` 注释仍写「`/proxy/*` 靠上游拒绝无效 token」——与当前实现相反。`/llm/*` 已用 `llm-auth` fail-closed 补同一模式；`/proxy/*` 没有对等校验。

后果：

- 企业版不带 cookie、只带任意 `Authorization: Bearer x`：过 BFF → 无 `sessionToken` → **以 RAG 超管执行**。
- 社区版用户自己的 RAG JWT 被剥掉，代理请求同样变成超管。

「无会话则 401」不能只改 `rag-fetch.ts`。必须同时改企业版 `authMiddleware`：只认有效 `imt_token`（校验或至少要求 cookie，禁止「有任意 Authorization 即放行」）。

---

## 5. 社区版：全体超管代理，不是「还需要一份兜底凭证」

社区版前端把用户 JWT 放在 `Authorization`。BFF 有意不转发，改为服务账号。`X-Intellect-User` 仅在企业版解析 member_id 后注入，社区版代理请求没有用户身份头。

因此 EMAIL/PASSWORD（或静态 token）在社区版是 **proxy 的主身份**：所有社区用户经 BFF 打 RAG 时共享超管。这不是用户 JWT 透传失败后的降级。

方案 A「社区版保留 EMAIL/PASSWORD」在工程上可行，但必须产品确认：

- **接受现状**：社区版继续服务账号代理（无用户级 KB/画布隔离）。
- **要按登录用户隔离**：保留超管账号解决不了，需恢复转发用户 JWT，或另建身份头。

---

## 6. 「登录 TEAM 的 admin/owner 就能拿 JWT」差在哪

两件事不能混：

1. **认证（你是谁）** — 不需要再换 RAG JWT；RAG 认 `imt_`。但 BFF 必须先把 `imt_` 送到 RAG（§3.1 尚未做到画布/agents）。
2. **授权（你能不能当管理员）** — TEAM 的 `admin`/`owner` 和 RAG 的管理员不是自动同一件事。

BFF 已能从 intellect-team `GET /api/members/me` 解析 `{ memberId, role }`（`member-id-resolver.ts`，60s 缓存）。缺的是把该 role 贯通到 RAG 授权，而不是用它去换 RAG JWT。

spec 011 §8 示意图写 `ensure_team_user` 写入 `role=member`。这是示意图，**须在 intellect-rag-app 源码确认**，不能当成已证实行为。若确认一律 `member`，TEAM 的 admin/owner 在 RAG 里仍是普通成员。部分 RAG 接口还可能看 `is_superuser` / RAG UUID。

再换 JWT 会重新引入双 ID，这正是方案 B 在消掉的东西。

### 6.1 角色语义不统一（实施前先定）

| 链路 | 当前规则 |
|---|---|
| 本分析 / 认知兵棋 | `admin` 或 `owner` 可管理 |
| BFF `llm-auth.ts` 破坏性操作 | 只认 `info.role === 'admin'`，**不含 `owner`** |
| RAG `tenant_membership.role`（spec 011 改进 3） | `owner` / `admin` / `member` |

须先统一：TEAM 实例角色 vs team 内角色 vs RAG `tenant_membership.role`，以及 `owner` 是否与 `admin` 等价。否则「同步 TEAM 角色到 RAG」会在三条链路上各写各的。

---

## 7. admin JWT 仍存在的路径（修订）

| 场景 | 行为 |
|---|---|
| `/canvas/*`、`/agents/*`（企业版已登录） | 未挂 `authSessionMiddleware` → 超管 JWT |
| `/proxy/*` 有 cookie | `imt_`（这是目前唯一正确的用户路径） |
| `/proxy/*` 无 cookie、有任意 Authorization | 过存在性检查 → 超管 JWT（提权） |
| 社区版 `/proxy/*` | 剥掉用户 JWT → 超管（主身份） |
| `healthCheck` | 只传 `fallbackStaticToken` |
| BFF 启动预热 | 无条件 `ragTokenProvider.login()` |
| harness-store 加载 RAG backend | 需要 `adminToken`（静态 token 或 vault password），否则 skip |

admin JWT 路径下 `current_user.id` 是 RAG UUID（`init_superuser`），不等于 TEAM `member_id`。方案 B 只在 `sessionToken` 真正存在时消除双 ID。

`healthCheck` 改为直打 `/health` 的前提是 **RAG 该端点确实不鉴权**（待在 rag-app 确认）。若也要 JWT，去掉 `fetchWithRagToken` 会让就绪探针变红。备选：BFF 自有 `/health` 不探上游鉴权，或继续用机器身份（方案 C）。

---

## 8. 三种改法

### 方案 A（建议）：企业版用户路径只认 `imt_`

目标：

- 所有会调 RAG 的用户请求（含 `/proxy/*`、`/canvas/*`、`/agents/*`）：有有效 `imt_token` 则原样传递；企业版无有效会话则 401，禁止降级成超管。
- 企业版 `authMiddleware` fail-closed：只认有效 cookie，禁止「有任意 Authorization 即放行」。
- 启动预热按 authMode 跳过企业版；`healthCheck` 待证后改匿名 `/health` 或机器身份。
- 社区版：显式选择「服务账号代理」或「转发用户 JWT」，不要再写成「保留兜底」。
- 收口 TokenVault `email-password`：password 不得再当 JWT；与 `INTELLECT_RAG_ADMIN_*` 只留一条登录通道。
- harness-store：企业版 RAG canvas backend 的 skip 条件与用户路径解耦（用户走 `imt_` 时不应因静态 token 缺失而 503）。

BFF 工作量大于初稿。RAG 侧仍须核对角色同步与 `is_superuser` 接口；那是授权前置，不能替代 C1（中间件）和 C2（存在性鉴权）。

涉及文件（实施时核对）：

- `bff/src/index.ts` — `/agents/*`、`/canvas/*` 挂 `authSessionMiddleware`；启动预热按 authMode
- `bff/src/middleware/auth.ts` — 企业版 fail-closed
- `bff/src/middleware/backend-context.ts` / `auth-session.ts` — session 注入覆盖所有 RAG 用户路径
- `bff/src/services/rag-fetch.ts` — 企业版无 session 时不要 `resolveRagToken()`；同步文件头注释
- `bff/src/services/intellect-rag-client.ts` / `routes/proxy.ts` — 无 cookie 时不要注入超管
- `bff/src/services/adapters/intellect-rag/intellect-rag-adapter.ts` — `healthCheck` 与 fallback
- `bff/src/services/harness-store.ts` / `token-vault.ts` / `routes/wizard.ts` — 收口 email-password
- `bff/src/middleware/llm-auth.ts` — 与 owner 语义对齐；修正过期注释

### 方案 B：用 `imt_` 换发 RAG JWT

BFF 调新接口 `imt_` → RAG JWT，喂给仍只认 RAG JWT 的老接口。能短期兼容，但会把双 ID 请回来，还多一个过期/刷新通道。

**不能用来绕过 §3.1**：换发后若仍不挂 session 中间件，画布继续用超管 UUID。不作为目标态。

### 方案 C：BFF 机器身份与用户身份彻底拆开

用户永远 `imt_`；BFF 内部用 TEAM 的 `API_SERVER_KEY`（或独立 machine identity），不再用伪造的 RAG 用户。

TEAM 侧已有先例：`llm-proxy.ts` 用 `API_SERVER_KEY` / `INTELLECT_LLM_API_KEY` 调 intellect-team，不转发用户 token。缺口只在 RAG 是否接受机器身份。RAG 未认 `API_SERVER_KEY` 前，C 不能替代 A 的用户路径；可与 A 并行规划探针/后台任务。

---

## 9. RAG 侧待核对

本仓库不含 intellect-rag-app 源码，须在 RAG 仓验证。已展开为可交付的验证清单（含验证位置/方法/判定标准/回传格式），见 [RAG 侧验证清单](./enterprise-rag-admin-credential-analysis-rag-verify-checklist.md)。下列 5 条与其 V1–V5 一一对应：

1. `ensure_team_user` 是否把 TEAM 的 `admin`/`owner` 写成 `tenant_membership.role`，还是一律 `member`（spec 011 §8 示意图；非本仓证据）。（清单 V1）
2. 是否还有接口只认 `User.is_superuser` / RAG UUID，而不认 `tenant_membership.role`。（清单 V2）
3. `from_intellect_team_session` 是否覆盖画布、知识库、tenant 管理等全部代理路径。（清单 V3）
4. 首次 `imt_` 访问是否保证调用 `ensure_team_user`（spec 011 指向 `intellect-rag-app/api/apps/__init__.py`）。（清单 V4）
5. RAG `/health`（或 adapter 所用健康端点）是否要求 JWT。（清单 V5）

若 (1)(2) 未完成：挂上 session 中间件后，画布/KB 会从「超管成功」变成「用户身份」——普通成员可见性变严，TEAM admin 访问部分管理接口可能 403。这是预期行为变化，需要观察 ownership，而不是回退超管。

---

## 10. 建议实施顺序

禁降级之前，画布/agents 必须先能带上 `imt_`。先 RAG 角色同步再禁降级在授权上更稳，但 **解决不了中间件缺口**。

1. **BFF**：`/agents/*`、`/canvas/*`（以及所有走 `backendContextMiddleware` 且会调 RAG 的路由）挂 `authSessionMiddleware`。行为变化：画布从超管变为用户身份；先观察 KB/画布 ownership 与可见性。建议按 `authMode` 开关，企业版先开。
2. **角色语义**：统一 TEAM `admin`/`owner`、BFF `llm-auth`、RAG `tenant_membership`（§6.1）。
3. **RAG**：确认并补齐 TEAM 角色 → `tenant_membership.role`；清点 `is_superuser` 接口；确认 `/health` 鉴权。
4. **BFF**：企业版 `authMiddleware` fail-closed（只认有效 `imt_token`）。
5. **BFF**：企业版禁止 `resolveRagToken()` / 静态超管降级；社区版书面确认服务账号代理或改为转发用户 JWT。
6. **BFF**：收口 TokenVault `email-password` 与 `INTELLECT_RAG_ADMIN_*`；harness-store skip 与用户路径解耦。
7. **BFF**：企业版跳过启动预热；`healthCheck` 按 §7 待证结果改匿名或机器身份。
8. （可选）方案 C：探针/后台任务用机器身份，对齐 `llm-proxy.ts`。

### 10.1 回归与数据影响

- 企业版未带 cookie、只带任意 `Authorization` 的请求：从「超管成功」变为 401。这是安全修复，不是回归失败。
- 企业版画布/agents：从超管 UUID 变为 TEAM `member_id`。已用超管身份写入的 KB/画布归属可能对原操作者不可见，需要数据修复或迁移说明。
- 社区版：若保持服务账号代理，用户路径行为不变；若改为转发用户 JWT，隔离语义整体变化，需单独计划。
- 分阶段：先挂 session 中间件（可观察、可回滚），再禁降级（关掉提权面），避免一步把画布打成 401。

---

## 11. 未决项

1. 社区版是否接受「全体超管代理」，还是要按登录用户隔离。
2. `owner` 是否在全链路与 `admin` 等价。
3. 企业版 RAG canvas backend 在无静态 token 时，harness-store 是否仍必须加载（用户已走 `imt_`）。
4. RAG `/health` 是否匿名。
5. 历史超管身份写入的资源如何归属到 TEAM member。
