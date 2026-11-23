# agentui ← intellect-auth → intellect-team 登录链路现状

> 日期:2026-11-23(同日修订:双版本评审;向导企业双模式选型)  
> 性质:源码 + 既有九步/规格对照的**现状梳理与方案评审**(非实施批次)  
> 范围:**企业版** `authMode=intellect-enterprise` 为主;intellect-team **Rust Gateway + Python adapter 双栈**  
> 关联:`docs/bff-sso-login-manual.md`;`specs/014-sso-token-exchange/spec.md`;`docs/intellect-team-integration/README.md`;`specs/010-multi-harness-wizard/intellect-team-alignment-requirements.md`;`docs/hiedu-app-mgmt-backend-analysis.md`;**向导选型真源** `docs/wizard-enterprise-sso-mode-design.md` **v1.2**(§8 双卡 + §9 质量/安全;废止「SSO 挂在 enterprise 内嵌区块」)

## 1. 结论

**agentui BFF + 向导双模式已就绪；intellect-team 双栈源码已恢复，真网仍卡部署/对账/滚版。**  
- agentui:OIDC RP + exchange 客户端 + `imt_token` Cookie 已通;向导首卡「企业版（SSO模式）」已落地;§9 S1/S2/Q1 本仓已加固。  
- intellect-team:**`origin/main` 已恢复** Rust exchange + providers.`client_id` + Python 同契约(2026-11-23 源码复验);**现网是否已滚到该版本**须运维确认(旧实例仍可能 404)。  
其余阻塞仍含部署 D1–D5 / 身份 I* / HIEDU 开通(§1.4),与 T4.2 / Phase B 无关。

必须分清两枚凭证:

| 凭证 | 谁签发 | 用途 |
|---|---|---|
| **IdP JWT**(access / id_token) | **intellect-auth** | 统一认证会话;可选用于出站调用 / id_token 兑换 |
| **Member token `imt_*`** | **intellect-team Gateway** | agentui BFF 会话(HttpOnly `imt_token`);调 team 用户态 API |

用户最终「登录 agentui / 进入 intellect-team」认的是 **`imt_*`**，不是把 intellect-auth 的 JWT 直接当作 team 会话使用。

**密码登录不经过 intellect-auth**——仅 SSO 路径会拿 IdP JWT / id_token 再向 team 兑换 `imt_*`。

### 1.1 `authMode` 命名(易混点)

| 值 | 含义 |
|---|---|
| **`intellect-community`** | **现行社区版默认**(向导非 enterprise 写入;缺省回落) |
| **`intellect-rag`** | **旧别名**,行为与 community 相同(均透传 intellect-rag `/api/v1/auth/*`) |
| **`intellect-enterprise`** | 企业版 → intellect-team `/api/members/*` + OAuth |

勿与 **`HarnessBackend.type = 'intellect-rag'`**(画布/KB 后端类型)混淆。真源:`bff/src/types/tenant.ts`。

### 1.2 HIEDU / intellect-auth 注册用户能否「直接」经 agentui 访问 intellect-team?

**短答:不能直接、不能仅凭 IdP/HIEDU 注册就进站。**  
在 intellect-auth(含 HIEDU Portal / 应用管理)侧拥有账号,只证明此人能完成**统一认证**;agentui 进入 intellect-team 认的是 **`imt_*` member 会话**。两套身份默认**不自动等价**,中间必须经过开通/对账/兑换。

#### 三套身份面(勿混为一谈)

| 身份面 | 落点 | 典型产物 | 能否单独让 agentui 调 team |
|---|---|---|---|
| **IdP 用户** | intellect-auth(Casdoor) | IdP JWT / 会话;`sub`≈`user.Name` | **否** |
| **HIEDU person / 直授** | HIEDU(`external_identity`、grants、应用纳管) | person→`member_external_id` 等同步线索 | **否**(不写 `imt_*`,也不写 OIDC 绑定) |
| **team member** | intellect-team Gateway | member 行 + `imt_*` | **是**(经 BFF cookie) |

spec-014 明确:hiedu 的 `external_identity`(person → intellect member id,`provider="intellect"`)与网关 SSO 用的 **`(provider_id, sub)` 绑定是两套映射**;前者同步成员时**不包含**后者(见 `specs/014-sso-token-exchange/spec.md`「与 hiedu 已同步成员的对账」)。

#### 用户以为的「直接」vs 实际路径

```text
【仅 HIEDU/IdP 注册】
  用户在 Portal / IdP 有账号
       │
       ▼
  打开 agentui /login
       │
       ├─ 填密码登录 ──► BFF → team POST /api/members/login
       │                 校验的是 **team 本地 member 口令**,不是 IdP/HIEDU 口令
       │                 → IdP-only 用户此处通常失败
       │
       └─ 点「统一认证」SSO ──► IdP 可登录成功
                                  │
                                  ▼
                             BFF/team exchange
                                  │
                                  ├─ 已有 member + (provider_id,sub) 绑定
                                  │     或 member_id_claim 命中既有 member → 签发 imt_* ✅
                                  ├─ auto_provision=1(JIT,缺省关) → 新建 member + 签发 ✅
                                  └─ JIT 关且无绑定/无 claim 接管
                                        → 403 member_not_provisioned ❌
                                          (文案:账号尚未开通)
```

#### 「注册」一词在运维里常指三件不同的事

| 说法 | 实际做了什么 | 对 agentui→team 的效果 |
|---|---|---|
| **IdP/Portal 注册用户** | Casdoor/HIEDU 有自然人账号 | 仅能过统一认证页;不足以拿 `imt_*` |
| **HIEDU 纳管应用 + 直授** | `RegisterApp` / grants;`api_push` 可把成员推到应用侧 | 可能在 team **已有 member 行**(视推送成功),仍**缺** OIDC `(provider_id,sub)` 绑定 |
| **team 注册 / 邀请** | agentui `POST /api/bff/auth/register` → team `/api/members/register` | 得到 team 本地账号,可走**密码**登录;与 IdP 账号仍是两条线,除非再做 SSO 绑定 |

HIEDU 应用管理分析见 `docs/hiedu-app-mgmt-backend-analysis.md`:`api_push` 推送、`external_identity` 携带 `member_external_id`——解决的是**应用侧成员目录**,不是 agentui SSO exchange 的身份键。

#### 何时可以「经 agentui 访问 team」(充分条件)

须**同时**满足部署面 + 身份面:

1. **部署**:agentui 租户 `authMode=intellect-enterprise`;enterprise 后端可达;非 L-10 未首装。目标路径首装选向导 **「企业版（SSO模式）」**(非 SSO 需求选「企业版（非SSO模式）」)。  
2. **渠道**(SSO 路径):OAuth provider(通常 `intellect-auth`)启用且登录页有按钮(`BFF_SSO_ENABLED` 等,见 §2.2);由 SSO 模式卡 envSnippet 落地。  
3. **身份**(下列之一即可):
   - **A. 对账路径(推荐)**:team 已有该自然人 member(常由 HIEDU 同步或管理员建号);上线完成 `(provider_id, sub)` 绑定,**或**配置 `member_id_claim`(如 `cas`)使首次 SSO 自动接管(FR-015/016)。  
   - **B. JIT**:provider `auto_provision=1`(缺省 **0**;与邀请制等策略可能互斥,见 invite 设计)。  
   - **C. 纯密码**:不经 IdP——向导走 **「企业版（非SSO模式）」**;仅在 team 有独立 `login_name`/`password`(与 HIEDU 注册无必然关系)。

缺 A/B 时,即使用户刚在 HIEDU 注册成功并能打开统一认证,点 agentui SSO 仍会停在 **`member_not_provisioned`**。

#### 明确否定的误解

| 误解 | 事实 |
|---|---|
| 「在 HIEDU 注册了就能打开 agentui 用 team」 | 缺 member / 绑定则 exchange 失败 |
| 「IdP JWT 可直接当 team 凭证」 | BFF 会话只认 `imt_*` |
| 「HIEDU `external_identity` = SSO 已开通」 | 那是 person↔member id;不是 `(provider_id,sub)` |
| 「开 JIT 最省事」 | 易与 HIEDU 已同步 member **身份分裂**(同一人两个 member);规格推荐 claim 接管而非盲目 JIT |
| 「社区版 `intellect-community` 也能走这条」 | 社区透传 RAG 鉴权,**不走** intellect-auth→team |

#### 运维核对清单(HIEDU 用户进站)

1. 该用户能否在 IdP 登录(Portal/统一认证)。  
2. team 是否已有对应 member(`enabled=1`);若靠 HIEDU 推送,查 `api_push` / 同步是否成功。  
3. 是否存在 `(provider_id, sub)` 绑定;或 `member_id_claim` 与 `member_external_id`/`cas` 口径是否一致。  
4. agentui 企业态 + SSO 渠道可见;回调 URL 在 IdP 与 provider 白名单一致。  
5. 真走一次 SSO:成功应有 `imt_token`;失败看 `member_not_provisioned` / `identity_conflict` / `tenant_mismatch`。

### 1.3 注册时能否经 HIEDU 拿到 team 的 `imt_*`?加功能是否可行?

#### 现状短答

| 问题 | 结论 |
|---|---|
| IdP/HIEDU **注册账号时**,HIEDU 会不会向 team 代取并回传 `imt_*`? | **不会** |
| HIEDU 现在跟 team 相关的能力是什么? | **成员目录/直授同步**(含 `member_external_id`),不是会话令牌签发 |
| 谁真正签发 `imt_*`? | **仅 intellect-team Gateway** |

`imt_*` 现有签发口(均在 team / 经 agentui BFF 消费,不经 HIEDU 注册流程):

| 入口 | 调用方 | 鉴权 |
|---|---|---|
| `POST /api/members/login` | agentui BFF(密码) | 用户口令 |
| `POST /api/members/oauth/exchange` / `exchange-id-token` | agentui BFF(SSO) | IdP code / id_token |
| OAuth callback 路径带回的 token / 历史 `POST /api/members/{id}/token` | BFF | 后者需 **API_SERVER_KEY**(内部代签) |

HIEDU `api_push` 用的是 **应用侧 M2M**(`m2m_client_id` + env secret),推的是成员/角色行(`app.member.*` 一类 outbox),**契约里没有「为终端用户 mint `imt_*` 并交回浏览器」**。`external_identity` 只存 person↔member id,不存、不转发 member token。

因此:**用户在 IdP/HIEDU 注册成功 ≠ 手里多了一枚可用的 `imt_*`**;要进 agentui 仍须走 §1.2 的 SSO 兑换或 team 本地密码登录。

#### 「加功能:注册/开通时由 HIEDU 代取 `imt_*`」可行性

**技术上可行,产品/安全上不推荐作为主路径**;更合理的是强化「开通 + 首次 SSO 兑换」,而不是让 HIEDU 成为 `imt_*` 分发中心。

```text
若硬做「HIEDU 代签 imt_*」大致要:
  HIEDU(持 team 管理凭证,如 API_SERVER_KEY 或专用 M2M)
    → 确保 team 已有 member(+ 可选绑 (provider_id,sub))
    → POST /api/members/{id}/token(或等价签发 API)
    → 把明文 imt_* 交回…?(Portal? 深链? 写跨域 Cookie?)
```

| 维度 | 评估 |
|---|---|
| **工程量** | 中高:HIEDU 需安全持有 team 签发凭据;要定交付面(谁收 token)、TTL、吊销、审计;agentui 还要接「外来 imt_*」写入 `imt_token` Cookie(跨站/第三方 Cookie 限制) |
| **安全** | **高风险**:`imt_*` 是用户态全权会话。经 HIEDU 中转等于扩大机密面(注册流、Portal、日志、邮件/深链均可能泄漏);违反现行「token 不出前端 JS / 仅 BFF Set-Cookie」原则(spec-014 Principle I) |
| **与现架构契合** | **差**:规格已选定 **SSO exchange 由 team 签发、BFF 落 Cookie**;明确不做跨应用 token 直通。HIEDU 职责是 IdP/组织/纳管,不是 RP 会话代理 |
| **对「注册即可用」的真实缺口** | 缺口是 **member 存在 + 身份绑定**(或受控 JIT / claim 接管),不是「注册瞬间缺一枚 token」。用户下次点 agentui SSO 即可现签 `imt_*` |
| **替代方案(推荐)** | ① HIEDU 开通时只保证 team member + 对账键一致;② agentui 首次 SSO 用 `member_id_claim` 接管并签发;③ 需要「注册完立刻进站」时用 **IdP 已登录 + agentui SSO `prompt=none`/一键渠道**,仍由 BFF exchange 写 Cookie——**不经 HIEDU 持有 imt_*** |
| **若业务强需求「后台代签」** | 只允许 **服务端对服务端**:例如运维/BFF 持 `API_SERVER_KEY` 调 `members/{id}/token`,结果仍只进 HttpOnly Cookie;HIEDU **不**把 `imt_*` 返回给浏览器或 Portal JS。即便如此,也多半用不到「注册当下签发」,登录时签发即可 |

#### 建议决策口径

1. **现状**:不能通过 HIEDU 获取 team 为该用户提供的 `imt_*`。  
2. **加「HIEDU→用户分发 imt_*」**:**可行但不建议**(机密面扩大、与 SSO/BFF 会话模型重复、Cookie/跨域难做对)。  
3. **加「HIEDU→只开通 member / 同步 external id,agentui SSO 现取 imt_*」**:**可行且与规格一致**(补齐 §1.2 充分条件 A,优先于代发 token)。  
4. 若目标是「注册完马上用 agentui」:做 **开通自动化 + SSO 深链/静默兑换**,而不是在 HIEDU 注册响应里塞 `imt_*`。

### 1.4 目标路径下的阻塞项与三方完善清单

> **已接受目标**:HIEDU 负责开通/对账;用户进 agentui 时 SSO(可静默)现换 `imt_*`;若必须后台代签则仅 S2S,结果只进 HttpOnly Cookie。  
> 下列按该目标拆解——**多数不是「缺一段 agentui 业务代码」**,而是身份管道 + 部署配置 + 跨仓契约未闭合。

#### 目标路径(对照用)

```text
HIEDU/IdP 注册或直授
  → HIEDU 确保 intellect-team 有 member(及对账键口径一致)
  → (可选)预写或首次 SSO 时建立 (provider_id, sub) 绑定
  → 用户打开 agentui(/login 或深链)
  → BFF SSO authorize(+ prompt=none 若已有 IdP 会话)
  → team exchange → Set-Cookie(imt_token) → 进站
```

#### 阻塞分层总表

| 层 | ID | 阻塞 | 主要责任方 | 不解决则现象 |
|---|---|---|---|---|
| **W 向导** | W1 | ~~向导仍把 SSO 挂在单张 enterprise 卡内嵌开关下~~ → **本仓已实施双卡**(见 `wizard-ent-sso-mode` 九步 REPORT);真网首装仍须运维走 SSO 模式卡 | agentui | 未用新向导首装则仍易漏配 |
| **W 向导** | W2 | ~~`optionId`/`setupProfile` 未进契约~~ → **已进** backend-types/setup(§8 R1/R5);部署侧须升级到含该契约的 BFF | agentui 部署 | 旧 BFF 无双卡 |
| **W 向导** | W3 | ~~providers 裸 fetch~~ → **已改 `safeFetch`**(§9 S1;公网仍须 `SSRF_ALLOW_PRIVATE_IP=false`) | agentui 部署 | 未关私网放行时内网探测仍可能 |
| **W 向导** | W4 | ~~snippet 未消毒~~ → **已 charset 过滤**(§9 S2;`^[a-zA-Z0-9_-]+$`) | agentui | — |
| **D 部署** | D1 | 生产 BFF 未首装 / 非 enterprise(L-10) | 运维 + agentui 向导 | 无企业 SSO/密码面 |
| **D 部署** | D2 | `BFF_SSO_ENABLED` / `STATE_SECRET` / `PUBLIC_ORIGIN` 未齐 | agentui 部署(SSO 模式卡应产出 envSnippet) | 无渠道按钮或 RP 起不来 |
| **D 部署** | D3 | team `INTELLECT_OAUTH_EXCHANGE_ENABLED` / provider / `redirect_uris` | intellect-team(双栈) | exchange 关或回调拒 |
| **D 部署** | D4 | IdP client(`ia-agentui`)白名单与 tokenFormat | intellect-auth | 授权/验签失败 |
| **D 部署** | D5 | 渠道模板缺 `enabled`/`usage`/`client_id`(F-A3-01) | team(+agentui 过滤) | 登录页无 SSO |
| **T 双栈** | T1 | ~~源码缺失~~ → intellect-team **`origin/main` 已恢复** exchange(2026-11-23 复验);**现网实例是否已滚版**待运维确认 | 运维 + team | 旧集群仍 404 |
| **T 双栈** | T2 | ~~Python 无实现~~ → **源码已有** `agent/sso_exchange.py` + adapter 路由;现网 Python flavor 待滚版/验收 | 运维 + team | 旧 Python 部署仍不可用 |
| **T 双栈** | T3 | ~~无 client_id~~ → **源码已暴露**;现网 providers 响应待滚版验证 | 运维 + team | 旧实例渠道可能仍被 BFF 隐藏 |
| **T 双栈** | T4 | 仅有的 `exchange-id-token`(Rust D2)语义≠spec-014(默认 JIT、错误信封、强依赖 user_jwt) | intellect-team Rust(+agentui 勿误用为主路径) | 身份分裂 / 契约漂移 |
| **I 身份** | I1 | HIEDU `external_identity` ≠ team `(provider_id,sub)`(R-15) | HIEDU + team | 有同步 member 仍 `member_not_provisioned` |
| **I 身份** | I2 | `member_external_id` 与 IdP `cas`/`sub` 口径未统一 | HIEDU(+产品裁定) | claim 接管打不中 |
| **I 身份** | I3 | 上线一次性对账未做(FR-016)且 JIT 默认关 | 运维 + team | 存量用户全员 403 |
| **I 身份** | I4 | `member_id_claim` 未配或 IdP 未出 `cas` | team + IdP | 首次 SSO 无法自动接管 |
| **I 身份** | I5 | 盲目开 JIT 与 HIEDU 已推 member 分裂 | 配置纪律 | 同一人两 member |
| **P 产品** | P1 | 注册后无「进 agentui」深链/一键 SSO | HIEDU Portal + agentui | 须用户自己找登录页点渠道 |
| **P 产品** | P2 | 静默重登依赖已写过 `sso_provider`;**首次**仍须显式授权一次 | agentui(设计如此) | 「注册完完全无感」做不到,除非深链走交互/半静默 |
| **P 产品** | P3 | HIEDU→team **开通自动化**未与 agentui 纳管闭环(谁建 member、何时推) | HIEDU + team | 仅靠人工建号 |
| **S 可选** | S1 | S2S 代签(若要做)的调用方、审计、仅写 Cookie 约定未产品化 | agentui BFF / team | 易走偏成 HIEDU 向浏览器发 token |

#### intellect-team 需完善(**Rust + Python 均须落地同一契约**)

> 策略前提(010 评审已确认):Python **仍在维护、无废弃时间表**;新部署推荐 Rust,存量可走 Python。故目标路径 **禁止「只改 Rust」**。真源契约以 `specs/014-sso-token-exchange/contracts/` + 本 §1.5 验收矩阵为准。

| 优先级 | 项 | Rust Gateway(`intellect-gateway`) | Python(`adapter.py` / `members_oauth.py`) |
|---|---|---|---|
| **P0 恢复/实现** | `POST /api/members/oauth/exchange` | **恢复**被 D2 合并冲掉的实现(基线:`1c034c51` + 收口 `9a0143dd`);合入后加回归测试防再丢 | **新增**同路径同请求/响应/错误码;勿只包一层旧 `/api/oauth/callback` |
| **P0 对账** | `member_id_claim` + `auto_provision` 缺省 0 | 与 spec-014 一致;`cas` 接管 + `bind_identity_if_absent` | 对齐语义(现有 `auto_provision_id_claim=email_local` **不够**;须支持 `cas`/`sub` 与扁平错误码) |
| **P0 公开渠道** | `GET /api/members/oauth/providers` 含 `client_id` | 补回公开字段(现 `OAuthProviderInfo` 无 `client_id`) | 增加公开 members 列表或扩展现有 providers,**字段名一致** |
| **P0 开关与白名单** | exchange 总开关 + `redirect_uris` | `INTELLECT_OAUTH_EXCHANGE_ENABLED`(或等价)默认关;provider metadata 白名单 | 同名/同语义配置键,避免两套 env 名 |
| **P0 数据** | 存量 `(provider_id,sub)` 对账 | 双栈共用存储则一次作业即可;分库则各跑 | 同左 |
| **P1 开通契约** | HIEDU sync / 外部键 | 已有 `hiedu_sync_api` 管团队/项目成员;补齐 **person→member 外部键与 `cas` 同口径**文档;响应**不**含 `imt_*` | 若走 Python 部署,开通/同步入口与 Rust **行为等价**(或明确仅 Rust 接 HIEDU push) |
| **P1 与 D2 边界** | `POST /api/oauth/exchange-id-token` | 保留为 IdP-passthrough 可选路径;**不得**替代 authorization_code exchange;文档写清 JIT/信封差异 | 若实现则与 Rust D2 **同契约**,否则 BFF 在 Python flavor 禁用 passthrough |
| **P1 可观测** | 审计区分拒绝码 | `member_not_provisioned` / `identity_conflict` / claim 未命中 | 同码同审计字段 |
| **P2 可选 S2S** | `POST /api/members/{id}/token` | 两端均已有雏形;收紧鉴权+审计;`kind` 可区分 | 同左 |
| **门禁** | 双栈契约测试 | `cargo test` 覆盖 T-01~T-17 关键子集 | pytest 同矩阵;**CI 要求两栈都绿**才标「agentui SSO 就绪」 |

**纠正先前文档口径**:不可再写「spec-014 网关侧已实现、只差配置」——相对 **2026-11-23 intellect-team `main` 取证**,Rust exchange **代码回归缺失**,Python **功能缺口**。

#### HIEDU(intellect-auth/hiedu)需完善

| 优先级 | 项 | 说明 |
|---|---|---|
| **P0 口径** | 裁定并对齐对账键 | `member_external_id` **必须**与 team `member_id_claim` 所用 claim(建议校园 `cas`)一致;若历史用内部 id,做映射表或一次性改写 |
| **P0 开通** | 「注册/直授 → team 有 member」闭环 | 纳管 agentui/team 应用后:`api_push`(或专用开通 API)确保 member `enabled=1` 且外部键正确;**成功判据是 member 行存在**,不是拿到 token |
| **P1 对账辅助** | 开通时可选通知绑定线索 | 若 team 提供「预绑定 `(provider_id,sub)`」管理 API,HIEDU 在已知 IdP `user.Name`/`sub` 时写入,减少首次 SSO 对 claim 的依赖;无则依赖 I4 claim 接管 |
| **P1 产品** | Portal「打开 agentui」 | 深链到 `https://<agentui>/api/bff/auth/sso/authorize/<provider>?returnTo=/`(或登录页渠道);**不**附带 `imt_*`;依赖用户已有 IdP 会话则接近静默 |
| **P1 IdP client** | `ia-agentui` 配置达标 | `redirectUris`=BFF 回调;`isShared=false`;`tokenFormat=JWT-Custom` + TokenFields 含 `Cas`;`enableSigninSession=true`(静默/跨应用前提) |
| **P2 运维** | 推送失败可见 | `api_push` 缺 url/secret 转 manual 时告警;开通失败不得假装「已可登录 agentui」 |
| **明确不做** | 向用户/Portal 返回 `imt_*` | 与已接受方向冲突 |

#### agentui 需完善

| 优先级 | 项 | 说明 |
|---|---|---|
| **P0 向导(W1/W2)** | 企业双模式选型 | **已实施**(§8)。SelectType 首卡「企业版（SSO模式）」/次卡「企业版（非SSO模式）」;`optionId`+`setupProfile`;SSO 卡强制配置面 |
| **P0 向导安全(W3/W4)** | §9 S1/S2/Q1 | **本仓已落地**(safeFetch + charset + Switch import)。公网仍须部署 `SSRF_ALLOW_PRIVATE_IP=false` |
| **P1 向导加固** | §9 S3–S5 / Q2–Q4 | bootstrap CSRF/一次性 token;TRUST_PROXY 部署纪律;切卡 effect 竞态;i18n 沉淀;`getOptionFor*` 按 profile |
| **P0 部署** | 解除 L-10 | 目标路径首装走 **「企业版（SSO模式）」** → enterprise 后端可达 + `API_SERVER_KEY` + envSnippet 含 `BFF_SSO_*`;密码-only 部署走「非SSO模式」卡;粘贴 snippet 前按手册 §5 核对 |
| **P0 SSO 运行时** | 打开 BFF-as-RP | `BFF_SSO_ENABLED=true`,`BFF_SSO_STATE_SECRET`,`BFF_PUBLIC_ORIGIN`;建议 `BFF_SSO_SILENT_RELOGIN=true`(SSO 模式卡 Done 页引导复制) |
| **P0 验收** | 真网冒烟 | 向导选 SSO 模式卡 → 渠道可见 → SSO → `/auth/me` 持 `imt_token`;另验非 SSO 卡无渠道/仅密码;覆盖「已开通未绑定」「claim 接管」「未开通」三类 |
| **P1 UX** | 支持开通后深链落地 | 已有 `returnTo`/`sanitizeReturnTo` + authorize/relogin;补产品入口文档或登录页「统一认证」主按钮突出;可选:`?sso=<provider>` 自动开授权减少二次点击 |
| **P1 错误可理解** | `member_not_provisioned` 引导 | 文案已有「联系管理员」;可链到开通状态说明(勿暗示用户自助改 token) |
| **P2 可选 S2S 代签** | 仅 BFF 内部 | 若产品要「已登录运维代建会话」:BFF 持密钥调 team 签发 → **只** `Set-Cookie`;路由不对 HIEDU/浏览器暴露 token 正文;默认仍优先 SSO exchange |
| **P2 观测** | 登录审计/指标 | provider、错误码、是否 claim 接管(无原始 code/token);便于与 team/HIEDU 对账失败联查 |
| **已具备(勿重复造)** | OIDC RP、PKCE/state、exchange 客户端、静默 relogin、`imt_token` Cookie | 代码主路径已通;完善重心在**向导双卡接线、配置、深链与联调** — **不**为 SSO 新增 authMode / 协议分叉 |

#### 推荐落地顺序(跨仓)

0. **双栈契约**(T1–T3):源码侧 **已齐**(team `origin/main`);下一步 = **现网滚版** + 契约 CI 门禁常绿。  
0b. **向导双模式**(W1–W2):本仓**已实施**。  
0c. **向导安全加固**(W3–W4 / §9 S1/S2/Q1):本仓**已落地**;公网部署 checklist 含 `SSRF_ALLOW_PRIVATE_IP=false`(S5 TRUST_PROXY)。  
1. **部署基线**:D1–D5——目标路径用 **SSO 模式卡** 首装 + 滚到含 exchange 的 team + IdP client + provider 白名单;注明 **flavor**=rust\|python。  
2. **身份口径**:I2 裁定 `cas`↔`member_external_id`;双栈启用 `member_id_claim`;HIEDU 开通写对键(I1/I4)。  
3. **存量**:I3 对账作业或接受「首次 SSO claim 接管」窗口。  
4. **体验**:P1 Portal 深链 + agentui 渠道/自动 authorize;静默留给二次访问(P2)。  
5. **可选**:S1 仅当有明确 S2S 场景再做,且永不经 HIEDU 向浏览器发 `imt_*`。

#### 与「功能债」边界

T4.2 / Phase B / D1 模型 flag 等**不在本目标路径关键路径上**;它们不替代上表 D/I/P/T/**W**。本路径关闭的标志是:**在 Rust 与 Python 两种 enterprise 后端上**,均可经向导 **「企业版（SSO模式）」** 首装后 **HIEDU 开通用户 → agentui SSO(含深链)→ 稳定拿到 `imt_token`**,失败可归因到上表某一 ID。

### 1.5 方案评审(双版本强制约束)

#### 评审结论

| 维度 | 裁决 |
|---|---|
| 目标路径(HIEDU 开通/对账 + agentui SSO 现换 `imt_*`) | **维持**;不采纳 HIEDU 向浏览器分发 `imt_*` |
| intellect-team 实现面 | **Rust Gateway 与 Python adapter 必须实现同一 HTTP 契约**;新部署可默认 Rust,但不能把 Python 留在「永久半残」 |
| agentui | 继续单一 BFF 客户端(已调 `members/oauth/exchange`);**不**为 flavor 分叉两套登录协议;向导以 **`setupProfile` 双企业卡**区分 SSO/非 SSO 首装,**不**新增 authMode;可用向导 `flavor` 做能力提示/门禁,而非改兑换语义 |
| 文档校正 | spec-014「P1 Implemented」相对 **当前 main** 过时;以本节省证为准 |

#### 取证摘要(2026-11-23,`/workspace/intellect-team`)

| 能力 | Rust `main` HEAD | Python `adapter.py` / `members_oauth.py` | agentui BFF 期望 |
|---|---|---|---|
| `POST /api/members/oauth/exchange` | **源码已恢复**(`origin/main`,含防丢回归);现网滚版待确认 | **源码已实现**(`agent/sso_exchange.py` + adapter) | **主路径**(非 passthrough 时) |
| 公开 `GET /api/members/oauth/providers` + `client_id` | **源码已含 `client_id`**;现网响应待滚版验证 | members 公开面已对齐(随 exchange 批次) | 构造 authorize 需要 `client_id` |
| `POST /api/oauth/exchange-id-token` | **有**(D2;`resolve_or_create_oauth_member` **默认建号**;嵌套 error) | **无** | 仅 IdP passthrough 可选 |
| `member_id_claim` / JIT 缺省关 | 随 exchange 一并丢失 | 仅旧 `auto_provision` + `auto_provision_id_claim`(email_local\|sub) | 推荐 `cas` + 缺省关 JIT |
| 密码 login/register/`members/{id}/token` | 有 | 有 | 密码与可选 S2S |
| HIEDU 组织同步 API | 有 `hiedu_sync_api`(团队/项目成员收敛) | 需核对待对齐程度 | 开通≠发 `imt_*` |

#### 评审意见(必须吸收)

1. **单一契约、双栈实现**:把 `contracts/sso-exchange.ts`(及 Rust 侧等价)定为跨语言验收源;Python 不得另搞一套 path/字段;Rust 恢复时以该契约 + 已丢失提交为补丁基线,并加「路由注册快照」测试防止再被大合并抹掉。  
2. **禁止用 D2 `exchange-id-token` 冒充主 SSO**:其默认 JIT、错误信封、`user_jwt` 前置与 spec-014 冲突,作为主路径会放大 I5 身份分裂;passthrough 保持可选且双栈一致或显式降级。  
3. **HIEDU 开通与双栈存储**:开通写 member/外部键必须在目标 flavor 的存储中可见;若 HIEDU push 只打 Rust 实例,Python 存量集群须有对等开通通道或迁移到 Rust。  
4. **agentui 不引入协议分叉**:010 双版本兜底里的 SSE/models 分叉可以按需;登录兑换协议 **不分叉**——缺 endpoint 时向导/启动应 fail-closed 提示升级 team,而不是静默改走不安全旁路。  
5. **发布门禁**:标注「支持 agentui 企业 SSO」的 team 版本号,须 **Rust+Python 契约测试同绿**;仅 Rust 绿不得宣称双栈就绪。  
6. **回归根因记入运维**:D2(simon→main)合并丢 exchange 说明大功能合并缺少契约冒烟;`members_routes()` 应对 critical SSO 路由做编译期或测试期清单断言。

#### 双栈验收矩阵(最小)

| # | 用例 | Rust | Python |
|---|---|---|---|
| DV-01 | exchange 正常 → `imt_*` + flat `{error,message}` 错误面 | 必过 | 必过 |
| DV-02 | JIT 关 + 无绑定 → 403 `member_not_provisioned` | 必过 | 必过 |
| DV-03 | `member_id_claim=cas` 接管既有 member | 必过 | 必过 |
| DV-04 | providers 含非空 `client_id`(启用渠道) | 必过 | 必过 |
| DV-05 | `redirect_uri` 不在白名单 → 400 | 必过 | 必过 |
| DV-06 | agentui BFF mock 上游分别模拟两栈 → cookie 写入一致 | 必过 | 必过 |

---

## 2. 端到端流程(企业版)

```text
Browser
  │
  ▼
agentui SPA  (/login)
  │  一律打 /api/bff/auth/*
  ▼
BFF (Hono)
  │  authMode = intellect-enterprise
  ├─ 密码:POST /api/members/login  ──────────────► intellect-team
  │                                                 签发 imt_* → Set-Cookie
  │                                                 (不经过 intellect-auth)
  │
  └─ SSO(intellect-auth 作 IdP)
        │
        ├─【推荐】BFF 作 OIDC RP(BFF_SSO_ENABLED)
        │     authorize → intellect-auth
        │     redirect_uri = getSsoRedirectUri(ssoConfig)
        │     callback → BFF
        │       ├ IdP passthrough 开:BFF 用 code 换 id_token
        │       │   → POST team /api/oauth/exchange-id-token → imt_*
        │       └ 关:POST team /api/members/oauth/exchange(code…) → imt_*
        │
        └─【兼容】网关 OAuth 跳转(SSO 开关关时仍可能走此路)
              redirect_uri = resolveOAuthRedirectUri
                (env BFF_OAUTH_REDIRECT_URI 或推导 …/api/bff/auth/oauth/callback)
              → team /api/oauth/login/{provider}?redirect_uri=…
              → IdP → 回调 BFF → team callback 带回 member token
```

### 2.1 代码锚点

| 能力 | 位置 |
|---|---|
| 密码 / me / logout | `bff/src/routes/auth.ts` → intellect-team `/api/members/*` |
| SSO RP + exchange | `auth.ts` + `bff/src/services/sso-exchange.ts`(`/api/members/oauth/exchange`、`/api/oauth/exchange-id-token`) |
| 兼容路径回调(F-CB-01) | `resolveOAuthRedirectUri` / `BFF_OAUTH_REDIRECT_URI` |
| RP 路径回调 | `getSsoRedirectUri`(与上者**不是**同一配置项) |
| 会话守卫 | `imt_token` + `requireValidImtSession`(企业/IMT flag 开启时;`社区模式直通`) |
| 出站可选 | `bff/src/services/idp-outbound-auth.ts` |

### 2.2 渠道列表双源

| 条件 | BFF 上游 |
|---|---|
| `BFF_SSO_ENABLED` 且 enterprise | `GET /api/members/oauth/providers`(公开,不持 API_SERVER_KEY) |
| enterprise 但 SSO 关 | `GET /api/oauth/providers`(经 `enterpriseFetch`,可能仍依赖服务密钥) |

过滤口径仍含 `enabled` + `usage` 含 `login`(兼容路径);SSO 公开端点字段以 Gateway 契约为准。

### 2.3 用户可见口径

- 手册:`docs/bff-sso-login-manual.md`
- 规格:`specs/014-sso-token-exchange/spec.md`

---

## 3. 阻塞分层

### 3.1 A — 协议 / agentui 代码(大体不阻塞;*team 双栈除外*)

| 项 | 状态 |
|---|---|
| 企业密码登录 → imt cookie | 已实现 + 单测 |
| BFF 作 OIDC RP + PKCE/state | agentui 侧已落地 |
| BFF 调用 `members/oauth/exchange` | 客户端已接;**上游 Rust 现网缺失 / Python 未实现**(§1.5 T1/T2) |
| 兼容路径显式 `redirect_uri` | 已修(F-CB-01) |
| 企业态会话校验 | `requireValidImtSession`(flag 开) |
| 社区密码/注册 | `authMode=intellect-community`(或旧别名 rag)透传 RAG |

### 3.2 B — 仍会卡住「走 intellect-auth SSO」的阻塞(运维 / 数据)

| ID / 现象 | 含义 | 影响 |
|---|---|---|
| **L-10**(取证 2026-11-21;可能已变) | 生产曾 `needsSetup:true`、`backendCount:0`、非 enterprise | 无企业后端则无 team SSO/密码企业面;须向导首装 |
| **渠道模板态(F-A3-01)** | providers 缺 `usage`/`enabled`/`client_id` | channels 空 → 无 SSO 按钮 |
| **L-01** | IdP 凭据不可自动化 | 真网闭环仅人工 |
| **L-09** | 无 kubeconfig | 挡生产改 env / 首装运维 |
| IdP redirectUris | 须匹配 **RP 或兼容路径各自的** 回调 URL | 配错则拒回调 |
| `member_not_provisioned` 等 | team 无 member / 无 `(provider_id,sub)` 绑定且 JIT 关 | **HIEDU 仅注册用户的典型失败**(详 §1.2) |

### 3.3 C — 明确不在本链路

| 项 | 说明 |
|---|---|
| T4.2 / L-T42-01 | 联网密钥存储 |
| Phase B / L-PHASEB-01 | 画布 SSE |
| D1 模型管理 flag | 登录之后 |
| SLO | v1 不做 |
| 跨应用共用 JWT | 非目标 |
| Back-channel logout | 相邻能力,非登录阻塞 |

---

## 4. 场景对照

| 场景 | 是否还有阻塞? |
|---|---|
| agentui「SSO/密码 → 调 team → cookie」 | **BFF 不阻塞**;team exchange **双栈阻塞**(T1/T2) |
| 生产点「统一认证」一键进站 | **仍阻塞**(T1/T2 + L-10 / 渠道 / 白名单 / L-01) |
| 企业密码登录 | 企业后端配好时一般不阻塞;未首装则不可用 |
| 社区登录 | `authMode=intellect-community`;**不走** intellect-auth→team |
| **仅 HIEDU/IdP 注册、未对账/未 JIT** | **不能**经 agentui 进 team(`member_not_provisioned`) |
| HIEDU 已同步 member + claim/`sub` 绑定完成 | SSO 可进;密码仍走 team 本地口令 |
| **注册时经 HIEDU 代取 `imt_*`** | **现状无此能力**;加用户侧分发**不推荐**(§1.3) |

---

## 5. 建议排查顺序(人工联调)

1. `wizard/status`:是否仍 `needsSetup`(L-10;取证日见上)。  
2. 首装是否走了向导 **「企业版（SSO模式）」**(W1);租户是否 **`authMode=intellect-enterprise`**,enterprise backend 可达。  
3. 确认 **`BFF_SSO_ENABLED`**:开 → 查 `members/oauth/providers`;关(非 SSO 模式卡或未贴 env)→ 查密码登录 / 兼容 `oauth/providers`。  
4. 回调白名单:RP → SSO redirect;兼容路径 → `BFF_OAUTH_REDIRECT_URI` / `/api/bff/auth/oauth/callback`。  
5. 真 IdP 账号走 SSO;看 exchange / `member_not_provisioned` 日志。  
6. 成功后 `/auth/me` + `/agents/*` 持有效 `imt_token`。

### 5.1 关键旋钮

| Env / 开关 | 作用 |
|---|---|
| `BFF_SSO_ENABLED` + `BFF_SSO_STATE_SECRET` | BFF-as-RP |
| IdP passthrough 相关 | callback 走 id_token exchange + 出站 JWT |
| `BFF_OAUTH_REDIRECT_URI` | **兼容**网关 OAuth 回调(非 RP 专用) |

---

## 6. 一句话

交换与会话机制在 agentui/BFF 侧已就绪;卡住点是生产首装与 auth/team 侧 provider·回调·成员配置。社区规范名是 **`intellect-community`**,不是把 `authMode` 写成 `intellect-rag`。  
**HIEDU/intellect-auth 注册用户不能直接进 intellect-team**:须企业态 + SSO(或 team 本地密码),并完成 member 存在与 `(provider_id,sub)` 对账(或受控 JIT / `member_id_claim` 接管)。  
**HIEDU 亦不代发 `imt_*`**:签发只在 team;应补开通/对账 + agentui SSO 现取,而不是让 HIEDU 向用户分发 member token。  
**目标路径阻塞**见 §1.4–§1.5:先 **双栈契约**(T1–T3)与本仓 **向导双模式**(W1–W2,首卡「企业版（SSO模式）」),再部署/对账/深链;team 须 Rust+Python 同契约就绪,agentui **不**为 SSO 新增 authMode、不分叉登录兑换协议。
