# 企业版 RAG 管理员凭证分析 — 技术评审

> **评审日期**: 2026-08-14
> **评审对象**: [docs/enterprise-rag-admin-credential-analysis.md](./enterprise-rag-admin-credential-analysis.md)（初稿）
> **修订**: 2026-08-14 分析已按下文 C1–C2 / I1–I6 / M1–M4 改写。本节保留为评审记录；实施以修订后的分析为准。
> **评审范围**: AgentUI BFF 现有代码（`bff/src`）与 spec 011；intellect-rag-app / intellect-team 源码不在本仓，RAG 侧结论仍为待证
> **结论（针对初稿）**: 方向正确，**不能按初稿直接开工**。须修正对「已登录即走 `imt_`」覆盖面的高估，并补上鉴权存在性检查带来的提权路径。

---

## 1. 总评

分析把「进程级 RAG 超管账号」和「已登录 TEAM 用户身份」拆开，否定「用 TEAM 登录再换发 RAG JWT」，这个判断成立，也和 spec 011 方案 B 的方向一致。

问题在于：**把「proxy 路径在有 cookie 时传 `imt_`」写成了「企业版用户请求已经基本不走超管」**。对照 `index.ts` 的中间件挂载，后者不成立。方案 A 若按原文只改 `rag-fetch.ts` 的降级逻辑，会漏掉 `/canvas/*`、`/agents/*` 上企业版用户仍走 admin JWT 的主路径，也会漏掉「任意 `Authorization` 头即可过 BFF 再被换成超管」的提权面。

**Verdict（初稿）**: 分析可作为设计输入，**须修订后再写实施计划**。修订后的分析已吸收本节意见。

---

## 2. 成立的部分

- EMAIL/PASSWORD 是 BFF 服务账号登录，不是当前用户换 JWT。`rag-token-provider.ts` 用全局单例缓存一份 JWT，与请求用户无关。
- 再换发 RAG JWT 会把双 ID（RAG UUID vs TEAM `member_id`）拉回来。方案 B 的目标是 `imt_` 路径下 `current_user.id == member_id`。
- 认证（是谁）和授权（能不能管）必须分开。BFF `resolveMemberInfo` 能拿到 TEAM `role`，但从未把它传给 RAG。
- spec 011 数据流里 `ensure_team_user` 写 `role=member` 是授权缺口的合理假设；未在本仓验证，分析把它标成「待核对」是对的。
- 社区版仍需要某种 RAG 凭证；不能无差别删掉这两个变量。
- 方案 B（换发 JWT）不应作为目标态；方案 C（机器身份）跨仓、周期更长。方案 A 仍是正确方向，但范围比原文大。

---

## 3. Issues

### Critical（修订分析 / 实施计划前必须处理）

#### C1. 「已登录企业版用户已经走 `imt_`」覆盖面被高估

分析 §3、§6 写成：企业版已登录 → cookie → `sessionToken` → RAG。这 **只对挂了 `authSessionMiddleware` 的路由为真**。

`bff/src/index.ts` 实际挂载：

| 路由 | `authSessionMiddleware` | `backendContextMiddleware` | 企业版身份 |
|---|---|---|---|
| `/proxy/*` | 有 | 无（proxy 内联读 cookie） | 有 cookie 时用 `imt_` |
| `/auth/me`、`/auth/logout` | 有 | 无 | 不调 RAG |
| `/agents/*` | **无** | 有 | `getAuthSession()` 为空 → `sessionToken` 未设 → **admin JWT** |
| `/canvas/*` | **无** | 有 | 同上 |
| `/capabilities/*` | **无** | 有 | 不调 RAG 上游鉴权，但同样拿不到 session |

`backendContextMiddleware` 依赖 `getAuthSession(c)`，而 `AUTH_SESSION_KEY` 只由 `authSessionMiddleware` 写入。未挂 session 中间件时，adapter 的 `fallbackStaticToken` / `resolveRagToken()` 就会上场。

画布是 Constitution Principle III 硬绑定 intellect-rag 的路径。企业版用户操作画布时，分析声称的「真实身份透传」**当前并未发生**。

方案 A 第一步应是：在 `/agents/*`、`/canvas/*`（以及所有走 `backendContextMiddleware` 且会调 RAG 的路由）挂上 `authSessionMiddleware`，而不是先禁 EMAIL/PASSWORD 降级。

#### C2. `authMiddleware` 只检查头是否存在 + proxy 剥掉客户端 token = 提权面

`bff/src/middleware/auth.ts`：`Authorization` 头存在即放行，不校验签名、过期或用户。

`bff/src/services/intellect-rag-client.ts`：删除客户端 `Authorization`，再由 `fetchWithRagToken` 注入 `sessionToken` 或动态/静态超管 JWT。`llm-auth.ts` 注释仍写「`/proxy/*` 靠上游拒绝无效 token」——与当前实现相反。

因此：

- 企业版不带 cookie、只带任意 `Authorization: Bearer x`：过 BFF → 无 `sessionToken` → **以 RAG 超管执行**。
- 社区版用户自己的 RAG JWT 被剥掉，代理请求同样变成超管。EMAIL/PASSWORD 在社区版不是「兜底」，而是 **proxy 的主身份**。

分析写「cookie 一旦没带上会静默降级成超管」方向对，但把场景缩成「未登录/cookie 丢失」，低估了攻击面：伪造一个存在的 header 即可。`llm-auth.ts` 正是为同一模式在 `/llm/*` 上补的洞；`/proxy/*` 没有对等的 fail-closed。

方案 A「无会话则 401」必须同时改 `authMiddleware`（企业版只认有效 cookie，或校验 token），不能只改 `rag-fetch.ts`。

### Important（分析应补写，否则实施会踩坑）

#### I1. 三套 RAG 凭据通道，分析只写了两套

| 通道 | 位置 | 行为 |
|---|---|---|
| `INTELLECT_RAG_ADMIN_EMAIL` / `PASSWORD` | `rag-token-provider.ts` | 登录换 JWT，请求级动态注入 |
| `HARNESS_INTELLECT_RAG_ADMIN_TOKEN` | env + `resolveRagToken` 降级 | 静态 JWT |
| TokenVault `email-password` | `harness-store.ts` + wizard | **把 password 当成 `adminToken` 明文**，不走 login |

Wizard 注释写「完整鉴权由 setup 后的 RagTokenProvider 接管」，但 store 加载时 `credential.kind === 'email-password'` 会把 password 填进 `backend.adminToken`。与 `INTELLECT_RAG_ADMIN_*` 并行且语义不一致。方案 A 若不收口 vault，EMAIL/PASSWORD 删了，wizard 配的账号仍可能当静态 token 用。

#### I2. 动态登录成功也救不活「backend 被 skip」

`harness-store.ts`：`adminToken` 为空则 skip 该 backend，adapter 不会注册。`ragTokenProvider.login()` 在 store 加载之后、且不回写 `adminToken`。只配 EMAIL/PASSWORD、不配 `HARNESS_INTELLECT_RAG_ADMIN_TOKEN`、vault 也没有 bearer 时：启动仍会 warn skip，画布/RAG adapter 503，和动态登录是否成功无关。

分析把「未配置 EMAIL/PASSWORD」理解成「proxy 降级到静态 token」，漏了 **backend 根本加载不进来** 这一层。

#### I3. 社区版身份模型被写成「还需要凭证」，实际是「全体超管代理」

社区版前端把用户 JWT 放在 `Authorization`；BFF 有意不转发，改为服务账号。用户隔离若还存在，只能靠已剥离的客户端 JWT（当前没有）或尚未注入的 `X-Intellect-User`（企业版才解析 member_id）。

方案 A「社区版保留 EMAIL/PASSWORD」在工程上可行，但应写明：**这是有意的服务账号代理，不是用户 JWT 透传**。若产品期望社区版按登录用户隔离 KB/画布，保留超管账号解决不了，需要恢复转发用户 JWT 或另建身份头。

#### I4. TEAM `admin`/`owner` 与 BFF 现有 RBAC 不一致

分析按「admin 或 owner 即可」写 RAG 管理权。BFF `llm-auth.ts` 破坏性操作只认 `info.role !== 'admin'`，**不含 `owner`**。认知兵棋前端/计划则是 admin 或 owner。

实施时必须先统一角色语义（TEAM 实例角色 vs team 内角色 vs RAG `tenant_membership.role`），并决定 `owner` 是否与 `admin` 等价。否则「同步 TEAM 角色到 RAG」会在三条链路上各写各的。

#### I5. 硬编码 RSA 公钥未列入风险

`rag-token-provider.ts` 内嵌 intellect-rag `conf/public.pem`。RAG 换钥后登录静默失败并降级静态 token。方案 A 若短期仍保留社区版动态登录，应把公钥配置化或从 RAG 拉取；分析未提。

#### I6. `/health` 是否真的匿名，分析当作已定事实

方案 A 写 `healthCheck` 改走不鉴权 `/health`。未引用 RAG 侧该端点的鉴权要求。若 `/health` 也要 JWT，去掉 `fetchWithRagToken` 会让 capabilities/就绪探针变红。应标为待证，或 BFF 自有 `/health` 不探上游鉴权。

### Minor

#### M1. `fetchWithRagToken` 文件头注释与实现不一致

文件头仍写「显式 Authorization > 动态 token > fallback」，实现已插入 `sessionToken`。分析引用了实现优先级（对），未指出注释过期，后续改代码容易按注释回退。

#### M2. `ensure_team_user` 一律 `member` 是 spec 011 示意图，不是本仓证据

表述「数据流写明」易被当成已证实。应写成「spec 011 §8 示意图；须在 rag-app 源码确认」。

#### M3. 未列回归与特性开关

方案 A 会改变企业版未带 cookie 的请求从「超管成功」变成 401，以及画布从「超管身份」变成「用户身份」（ownership、可见性会变）。应有：按 authMode 开关、分阶段先挂 session 中间件再禁降级、以及 KB/画布归属的数据修复说明。

#### M4. 方案 C 与 LLM proxy 现状可对齐得更具体

`llm-proxy.ts` 已用 `API_SERVER_KEY` 调 intellect-team，不转发用户 token。方案 C 在 TEAM 侧已有先例；缺口只在 RAG 是否接受机器身份。分析可把这一点写进方案 C 的可行性，而不是只写「跨仓周期长」。

---

## 4. 对三种改法的再评估

| 方案 | 原文评价 | 评审后 |
|---|---|---|
| A 企业版只认 `imt_` | 推荐，工作量主要在 BFF | 仍推荐，但 **BFF 工作量大于原文**：补 session 中间件、收紧 `authMiddleware`、收口 vault、处理 harness-store skip、社区版身份策略。RAG 角色同步仍是授权前置。 |
| B 换发 RAG JWT | 不建议 | 同意。不能用来绕过 C1：换发后画布仍是超管 UUID。 |
| C 机器身份 / 用户身份分离 | 长期 | 同意。LLM proxy 已是 TEAM 侧样板。RAG 未认 `API_SERVER_KEY` 前，C 不能替代 A 的用户路径。 |

修订后的方案 A 顺序建议：

1. 在 `/agents/*`、`/canvas/*` 挂 `authSessionMiddleware`（行为变化：画布从超管变为用户；先观察 ownership）。
2. RAG：核对 `ensure_team_user` 角色；统一 admin/owner 语义。
3. 企业版 `authMiddleware` fail-closed（只认有效 `imt_token`，禁止「有任意 Authorization 即放行」）。
4. 企业版禁止 `resolveRagToken()` 降级；社区版明确为服务账号代理或改为转发用户 JWT。
5. 收口 TokenVault `email-password` 与 `INTELLECT_RAG_ADMIN_*`，避免 password 当 JWT。
6. 启动预热 / healthCheck 与 harness-store skip 条件按 authMode 拆开。

原文顺序（先 RAG 角色同步 → 再 BFF 禁降级）在授权上更稳，但 **解决不了 C1**：禁降级之前，画布/agents 根本没带 `imt_`。C1 应提前。

---

## 5. 原文判断表修订

| 原文判断 | 修订 |
|---|---|
| 企业版用户请求不再用 EMAIL/PASSWORD，大部分已经是这样 | **仅 `/proxy/*` 且 cookie 存在时成立**。`/canvas/*`、`/agents/*` 仍走超管。 |
| TEAM admin/owner 自动拥有 RAG 管理权，关键在 RAG | 方向对。另需统一 BFF `llm-auth`（只认 admin）与兵棋（admin\|owner）。 |
| 完全删除这两个变量：社区版还需要 | 对，但社区版当前是全体超管代理，需产品确认是否接受。 |
| 未登录不该拿到 JWT | 对。实现上任意 Authorization 头仍能拿到超管身份（C2）。 |

---

## 6. Assessment

**分析是否可直接进入实施计划？** 初稿否。修订稿已吸收 C1、C2、I1–I6，可作为实施计划输入。

**方向是否值得做？** 是。企业版用 TEAM 会话替代 RAG 超管账号是正确目标；继续换发 RAG JWT 不是。

**最大风险**：按原文改 `rag-fetch`「企业版无 session 则 401」，会让 `/canvas/*`、`/agents/*` 在仍未注入 `sessionToken` 时全面 401，而真正该修的是中间件挂载与存在性鉴权。
