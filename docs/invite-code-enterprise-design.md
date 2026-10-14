# 企业模式邀请码功能 — 设计与实施方案（agentui × intellect-team）

> **Status**: 方案定稿（2026-10-14，经评审修订）。覆盖密码注册 / OAuth 注册 /
> 邀请码管理三条链路的现状、缺口与实施项。服务端实现规格（intellect-team 侧
> 细节）见该仓 `docs/invite-code-api-spec.md`，两文档互为引用。
> 关联：`bff/src/routes/auth.ts`（注册/OAuth 转发）、`src/pages/login-next`（表单）。

## §0 动手前预检（两项，各几分钟，决定方案边界）

| # | 预检 | 方法 | 不过则 |
|---|---|---|---|
| P1 | 部署网关是否启用了 api_server 平台（`/api/members/*` 路由在线） | 对企业后端 endpoint 探 `POST /api/members/register`（空 body）→ 期望 400 `display_name...required`；**404 = 平台未启用** | 本方案挂起，先解决网关平台配置 |
| P2 | intellect WebUI（独立仓库）是否已有邀请码管理面板 | 查该仓 invite 相关 UI/路由 | 若已有：§4-3.3 改为对接现有面板，agentui 不重复建设 |

## §1 背景与目标

企业模式（INTELLECT-ENTERPRISE）当前注册**无条件开放**（仅 IP 限流）。
目标：注册策略可配置（`open | invite` 双模），邀请码全生命周期
（生成 / 分发 / 兑换 / 撤销 / 审计）跨两项目闭环；缺省 `open` 向后兼容，
存量部署零迁移。

## §2 现状矩阵（评审修订版）

| 链路 | 环节 | 现状 | 依据 |
|---|---|---|---|
| A 密码注册 | 前端表单 | ✅ 输入框+i18n+zod | `src/pages/login-next/index.tsx:169` |
| | agentui BFF 透传 | ✅ trim/缺省不下发；400 含 invite 时转译文案 | `bff/src/routes/auth.ts:436,453` |
| | **intellect-team 服务端** | ❌ handler 只读 4 字段，invite_code **静默丢弃**，注册无条件放行 | api_server `adapter.py:2041` |
| | 数据层 | ✅ 校验/兑换/审计齐备但此链路未用 | `agent/membership.py:1698` |
| B OAuth 注册 | 数据层 resolve | ✅ 支持 invite 兑换+绑定 | `agent/members_oauth.py:1281` |
| | **HTTP 侧** | ❌ **整段未接线**：callback 不做成员解析（"gated separately"），state 不携带 invite；`resolve_oauth_member` 的 invite 分支仅 CLI 调用 | adapter.py:2001,2023；`intellect_cli/main.py:8172` |
| | agentui BFF | ⚠️ 只提取上游 state 做 CSRF（auth.ts:734），不透传 invite；前端回调回填仅表单层面 | `index.tsx:462` |
| C 邀请码管理 | 数据层+RBAC | ✅ `member:invite` 权限（owner/admin）+ 审计 | `membership.py:1621,281` |
| | 生成入口 | ⚠️ 仅 CLI（`intellect_cli/main.py:6948`） | |
| | HTTP 管理 API / agentui UI | ❌ 均不存在（adapter.py 对 invite 零引用） | |

**横切问题**（设计时必须处理，见 §3 决策）：

- 唯一策略开关 `members.enabled`（`membership.py:248`），无注册模式配置；
- `redeem_invite` 非事务：validate→create→标记 三步间并发可产出一码双号
  （第二个 UPDATE 匹配 0 行但 member 已建，成孤儿账号）；
- `create_member` 的 platform 实参三路漂移：`cli`/`web`/`webui`；
- OAuth 兑换把 `reserved_member_id` 当 login_name（`members_oauth.py:1321`），
  与密码路径语义（reserved 仅作 member_id）冲突，疑似缺陷；
- 邀请码**无撤销**能力（membership 层无 revoke_invite）；
- 审批队列（`create_registration_pending`，`membership.py:2212`）与邀请码
  正交——准入语义需设计分叉（§3 D1）；
- BFF 单测（`auth.test.ts:642`）mock 上游返回 400 "Missing invite code"——
  该响应形态真实上游不存在，**契约测试钉错对象**。

## §3 设计决策

| # | 决策 | 内容 |
|---|---|---|
| D1 | 注册策略配置 | intellect-team `members.registration.mode: open \| invite`，缺省 `open`；**与审批队列（await_local_approval）本期互斥**——审批配置（`local_requires_approval`）在 intellect-webui 仓、本仓启动期读不到该组合，故在共有数据层**使用时 fail-fast**（2026-10-15 评审维持；invite 模式下 `oauth.auto_provision` 同理 fail-closed）——"邀请码+审批"双重门槛语义难解释，组合模式留待需求驱动 |
| D2 | 事务化兑换 | **新写** `redeem_invite_atomic(code, *, login_name, password, email, platform)`：单事务内 validate + create_member + 标记 accepted（受影响行数判定并发赢家），**不复用** `redeem_invite`（竞态 + platform=cli 硬编码） |
| D3 | platform 归一 | 密码注册一律 `web`，OAuth 注册一律 `webui`；兑换接口显式收 platform 参数 |
| D4 | 保留 ID 语义修正 | `reserved_member_id` 仅作 member_id（两条路径统一）；OAuth 路径 login_name 独立生成（invite 邮箱局部名优先，兜底 `user-<hash>`），修正 `members_oauth.py:1321` |
| D5 | email 策略 | invite 带限定邮箱时必须与注册 email 一致（不一致 400 `invite_email_mismatch`）；为空则采用注册者提供值 |
| D6 | 结构化错误契约 | 400 + `code=invite_required/invite_invalid/invite_used/invite_expired/invite_email_mismatch`；BFF 按 code 转译文案（现有 `/invite/i` 正则分支退役） |
| D7 | 撤销 | 新增 DB 层 `revoke_invite(code, actor)`：仅未兑换可撤，已用/不存在返回明确态；写审计；过期沿用查询时判定，不加后台任务 |
| D8 | OAuth 接线 | `/api/oauth/login` 接受 invite_code（query）写入 state；callback 成员解析接线后按 D2/D5 兑换。**BFF 侧仅做参数透传，硬依赖本项先行**（BFF 不构造 state） |

## §4 实施项（依赖序，勿并行撞墙）

### Phase 0 — 预检（§0）

### Phase 1 — intellect-team 服务端（核心闸门，详规见该仓 spec 文档）

| # | 项 | 验收标准 |
|---|---|---|
| 1.1 | 配置 `members.registration.mode` + 使用时校验（含 D1 互斥，见 §3 D1 裁定） | 双模切换生效；非法组合（invite+审批/auto_provision）使用时被拒 |
| 1.2 | DB：`redeem_invite_atomic` + `revoke_invite`（D2/D7） | 并发双兑恰一成功；撤销语义正确；审计落行 |
| 1.3 | register handler 消费 invite_code（D2/D3/D5/D6） | invite 模式四态 + open 模式忽略；错误码结构化 |
| 1.4 | OAuth state 携带 invite + callback 接线（D8/D4） | 带码 OAuth 注册端到端建号并绑定身份 |
| 1.5 | 管理 API：`POST/GET /api/members/invites`（`_check_auth` + `member:invite`）；列表**全量返回 + 可选 status 过滤，不引分页**（面板量级小，2026-10-14 定版） | 非 admin 403；生成/列表/撤销可用；审计内建 |

### Phase 2 — intellect-team 测试矩阵

`tests/gateway/test_api_server_members_auth.py` 扩展：invite 五态
（缺失/无效/已用/过期/邮箱不符）、**同码并发 2 请求恰 1 成功**、撤销后兑换、
open 模式忽略 invite、OAuth 带码端到端、RBAC 403、保留 ID 语义。

### Phase 3 — agentui 侧

| # | 项 | 依赖 | 验收标准 |
|---|---|---|---|
| 3.1 | BFF 测试契约修正：改为断言结构化 `code`（D6），退役正则分支 | 1.3 | 单测与真实契约一致 |
| 3.2 | BFF OAuth authorize 透传 invite_code 到上游 `/api/oauth/login`（D8） | 1.4 | 带码跳 OAuth → 回调注册成功 |
| 3.3 | admin 用户管理页：邀请码生成/列表/撤销 UI（调 1.5 API）；**代理鉴权（2026-10-15 P0 修订）：BFF 转发登录用户 `imt_*` token，不注入 apiServerKey——网关侧 invites 管理已摘 profile bypass** | 1.5 | owner/admin 可自助发码；P2 若已有面板则改对接 |

### Phase 4 — 联调验收

双模注册、并发兑换、撤销、OAuth 全链路（agentui 前端→BFF→网关→建号）、
BFF 文案激活、审计记录核对。

## §5 风险与回滚

| 风险 | 缓解 |
|---|---|
| mode 缺省 open，存量部署不受影响 | 回滚 = 配置改回 open，无数据迁移 |
| 部署网关未启 api_server 平台 | §0 P1 预检兜底 |
| 与 intellect WebUI 面板重复建设 | §0 P2 预检兜底 |
| `member_invites` 存量数据兼容 | 仅加列/索引级变更（如需），DDL 由既有机制管理 |

## §6 工作量预估

Phase 1 约 2–3 人日（1.4 OAuth 接线最重）；Phase 3 约 1 人日；
Phase 2/4 各 0.5 人日。关键路径：1.2 → 1.3 → 2 → 联调。
