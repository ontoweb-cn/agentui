# intellect-rag-app 侧验证清单（方案 A 授权前置）

> **日期**: 2026-08-14
> **交付对象**: intellect-rag-app 仓维护者（本文档从 AgentUI BFF 仓发出，RAG 源码不在本仓）
> **用途**: 方案 A（企业版用户路径只认 `imt_`、禁 RAG 超管降级）的 **授权正确性前置核对**。BFF 侧的认证改造可独立推进，但「挂上 `imt_` 后用户能正确访问、TEAM admin 能正确管理」取决于本清单的 5 个结论。
> **上游依赖**: [enterprise-rag-admin-credential-analysis.md](./enterprise-rag-admin-credential-analysis.md)（方案 A，§9 待核对项）、[specs/011-team-rag-tenant-consistency/spec.md](../specs/011-team-rag-tenant-consistency/spec.md)（已落地的 RAG 侧改动）
> **回传方式**: 每项按「期望结论 / 实际结论 / 证据（文件:行或测试名）」回填；阻塞项（V1、V2、V4）需给出明确 yes/no。
> **已回填**: 2026-08-14 已对照本机源码取证，结果见 [rag-verify-results](./enterprise-rag-admin-credential-analysis-rag-verify-results.md)。结论：V1 FAIL（阻塞）、V2/V4/V5 PASS、V3 PASS（含认知修正）。

---

## 0. 背景：BFF 侧已经假设了什么

方案 A 实施后，企业版已登录请求会带着 `imt_`（TEAM member token）直接打到 intellect-rag，RAG 走 `from_intellect_team_session` 路径，`current_user.id == member_id`。BFF **不再**为这些请求注入 RAG 超管 JWT。

因此 RAG 侧必须已经满足三条隐含假设，本清单逐条验证：

1. **TEAM 的 `admin`/`owner` 在 RAG 里被正确落成管理员角色**，而不是一律 `member`。否则 TEAM admin 用 `imt_` 访问画布/KB/tenant 管理会 403，比现在（超管兜底成功）更糟。
2. **所有 BFF 会代理的 RAG 接口都走 `imt_` 解析路径**，没有「漏网接口」仍按 `current_user.id`（RAG UUID）做权限判断。
3. **`imt_` 首次访问会创建 membership**，否则查 `tenant_membership` 会落空。

> spec 011 已落地的 RAG 侧改动（改进 2 / 3 / 6）见附录 A。本清单验证的是这些改动**之上**仍悬而未决的问题，不是重复验收 011。

---

## V1. `ensure_team_user` 的角色映射（阻塞项，最高优先级）

**问题**：`ensure_team_user` 把 TEAM member 写入 `tenant_membership` 时，`role` 字段是如何决定的？是否把 TEAM 的 `admin`/`owner` 落成 `tenant_membership.role = 'admin'/'owner'`，还是**一律写成 `'member'`**？

**为什么重要**：
- spec 011 §8 数据流图写的是 `role=member`，但这是示意图，不是已证实行为。
- 若实际一律 `member`，则 TEAM 的 admin/owner 在 RAG 里仍是普通成员——画布/KB 管理接口、tenant 管理接口（011 改进 3 改成的 `_is_tenant_admin`）都会 403。
- 这会直接决定方案 A 能否在不破坏企业版管理功能的前提下落地。

**验证位置**：
- `ensure_team_user` 的定义与调用点。spec 011 指向 `intellect-rag-app/api/apps/__init__.py:269`（首次访问创建 membership 的调用）。
- `tenant_membership` 表结构与 `role` 列的允许取值（`owner` / `admin` / `member`）。
- TEAM member 的 role 信息来源：imt_ token 的 claims，还是 BFF 注入的 `X-Intellect-User` / 某个 header，还是 RAG 反向调 intellect-team 查询。

**验证方法**：
1. 读 `ensure_team_user` 源码，确认 `role` 参数来源与默认值。
2. 用一名 TEAM `admin` 用户走一遍 `imt_` 首次访问，查 `tenant_membership` 表中该 member 的 `role` 实际值。

**判定标准（期望结论）**：
- ✅ 通过：TEAM `admin`/`owner` → `tenant_membership.role` 为 `'admin'`/`'owner'`（或至少是可被 `_is_tenant_admin` 认作管理员的值）。
- ⚠️ 部分通过：能取到 role，但 `owner` 未被当作管理员（需 BFF 侧统一 owner/admin 语义，见分析 §6.1）。
- ❌ 失败：一律 `member`。→ **阻塞方案 A 的授权侧**，需 RAG 侧补角色同步，或 BFF 侧另建授权通道。

**需回传**：role 的准确取值规则 + 实际验证结果（含 TEAM admin 与 owner 两种角色的落库值）。

---

## V2. 仍只认 `is_superuser` / RAG UUID 的接口清点（阻塞项）

**问题**：RAG 侧是否还有接口用 `current_user.is_superuser` 或 `current_user.id == <RAG UUID>` 做权限判断，而**不认 `tenant_membership.role`**？

**为什么重要**：
- `imt_` 路径下 `current_user.id == member_id`（不是 RAG UUID），`is_superuser` 通常为 False（社区版用户仅有 `is_superuser` 布尔标记、无 role 字段，见 `docs/cognitive-wargame-admin-operations-dev-plan.md:25`）。
- 这些接口在 `imt_` 路径下会 **静默拒绝 TEAM admin**，即使用户本该有权。011 改进 3 只修了 `tenant_api.py` 三处，其余接口未覆盖。

**验证位置**：全仓 grep 以下模式，重点在 `api/apps/restful_apis/`、`api/utils/`、`api/identity/`：
- `is_superuser`
- `current_user.id ==` / `current_user.id !=`
- `current_user.id in`（与 tenant_id 或 UUID 的比较）

**验证方法**：
1. grep 并逐条核对每个命中点：它走的是 `imt_` 路径还是 admin JWT 路径？判断依据是 UUID 还是 role？
2. 结合 BFF 实际代理的端点范围（见附录 B），确认这些接口是否会被企业版用户经 `/proxy/*` 或 `/canvas/*`/`/agents/*` 触达。

**判定标准（期望结论）**：
- ✅ 通过：所有会被企业版用户触达的管理接口都已改为 `tenant_membership.role` 判断（或等价机制）。
- ⚠️ 部分通过：存在 `is_superuser`/UUID 判断，但**仅**用于 RAG 原生 admin 后台（独立鉴权、不经 BFF 代理），不阻塞企业版。
- ❌ 失败：存在企业版会触达的接口仍只认 `is_superuser`/UUID。→ 列出清单，作为方案 A 的授权补齐 backlog。

**需回传**：命中清单（文件:行 + 接口 + 当前判断方式 + 是否被 BFF 代理触达），以及「哪些必须改、哪些可留」的结论。

### 改造方向（清点后如何处置 `is_superuser` 判断）

**关键语义区分**——不要把 `is_superuser` 和 `tenant_membership.role` 混为一谈：

| 维度 | `is_superuser` | `tenant_membership.role` |
|---|---|---|
| 语义 | 全局/系统级标志（Django 式） | 租户内角色 |
| 数据源 | 社区版 RAG 原生 `User` | 企业版 TEAM member 投影 |
| gate 的端点 | 平台运维 `/api/v1/admin/*`（users/services/sandbox/version） | 业务端点（画布/KB/tenant 管理） |

**结论：不能把 `owner`/`admin` 直接判断为 `is_superuser`，但应识别为「租户管理员」。** 三种做法（按推荐度）：

1. ✅ **推荐**：业务接口改查 `tenant_membership.role`（等价于 011 改进 3 的 `_is_tenant_admin` 模式），**不碰 `is_superuser`**。`is_superuser` 继续留给 RAG 原生 admin 后台（独立鉴权、不经 BFF 代理），二者井水不犯河水。
2. ⚠️ **临时兼容**（遗留接口短期改不动时）：用 effective 谓词做「或」判断，**限定 `tenant_id`、不落库**：
   ```python
   def _is_tenant_admin_effective(current_user, tenant_id):
       if current_user.is_superuser:      # RAG 原生系统管理员
           return True
       return _get_member_role_in_tenant(current_user.id, tenant_id) in ('owner', 'admin')
   ```
3. ❌ **否决**：在 `ensure_team_user` 时把 owner/admin 的 `is_superuser` 落成 True。理由：① 把租户内最高角色升级为全局标志，跨租户/系统端点越权，违反租户隔离；② `imt_` 路径的 User 是 TEAM 投影，落库后 TEAM 侧降级无法反向同步，产生 stale superuser。

**方向性证据**：企业版里「superuser」已经被映射成了 `owner` 角色而非布尔标志（`docs/platform-admin-adapter-design.md:805-810`：`grantSuperuser` = `PUT /api/members/{id}/role { role: 'owner' }`）。即企业版授权是 **role 化**，不是 flag 化——RAG 侧应朝同一方向收敛，而非反方向把 role 写回 flag。

**随 V2 一并在 RAG 仓确认**：
1. `imt_` 路径下 `current_user.is_superuser` 的实际值；`ensure_team_user` 创建的用户对象是否持久化了该字段。
2. `is_superuser` 是否被当作**全局**标志（跨 tenant/系统端点），还是 RAG 部署模型里实为 instance-per-tenant（spec 011 非目标）——若后者成立，越权风险降低，但仍建议走做法 1 而非落布尔。

---

## V3. `from_intellect_team_session` 的覆盖面（阻塞项，验证范围）

**问题**：`imt_` 解析路径（`SubjectContext.from_intellect_team_session` 及其等价入口）是否覆盖了**所有** BFF 会代理到的 RAG 端点——画布（`/api/v1/agents`）、知识库（`/api/v1/datasets`）、tenant 管理（`/api/v1/tenants` 等）——还是只在部分入口生效？

**为什么重要**：
- 若某类接口（例如画布写入、KB 上传）不经过 `from_intellect_team_session`，即使 BFF 正确带上 `imt_`，RAG 也会退回 admin JWT / `current_user.id` 回退逻辑，双 ID 与越权面仍存在。
- 011 改进 2 只改了一个函数，但**该函数是否被所有请求入口调用**未经证实。

**验证位置**：
- `intellect-rag-app/api/identity/context.py`：`from_intellect_team_session` 与 `get_subject_context_from_request`（或等价入口）。
- 三个 tenant_id 解析路径：`api/utils/api_utils.py`（HTTP 主路径）、`api/utils/sync_membership.py`、`context.py`。

**验证方法**：
1. 找出所有构造 `SubjectContext` / `get_subject_context` 的调用点，确认每个入口在「存在 imt_ token」时都走 `from_intellect_team_session`。
2. 用一名企业版用户，分别对画布列表、KB 列表、tenant 管理三类端点打 `imt_` 请求，在 RAG 侧日志/断点确认命中的解析分支。

**判定标准（期望结论）**：
- ✅ 通过：三类端点（画布/KB/tenant）在 `imt_` 下都走 `from_intellect_team_session`，`tenant_id` 由 `X-Intellect-Tenant` header 决定。
- ⚠️ 部分通过：个别端点走 legacy 回退，但 `X-Intellect-Tenant` header 已能兜住 `tenant_id`（改进 4），仅影响 user_id 命名空间。
- ❌ 失败：某类端点完全不走 imt_ 解析。→ 列出，作为 BFF 挂 `authSessionMiddleware` 前必须补齐的缺口。

**需回传**：覆盖矩阵（端点类别 × 解析路径 × 是否读 `X-Intellect-Tenant`）。

---

## V4. 首次 `imt_` 访问是否保证 `ensure_team_user`（阻塞项）

**问题**：`imt_` 用户**首次**访问任一 RAG 接口时，是否保证调用 `ensure_team_user` 创建/更新 `tenant_membership`？spec 011 指向 `intellect-rag-app/api/apps/__init__.py:269`，需确认它是否在**所有 imt_ 请求**的公共路径上（而非仅部分路由）。

**为什么重要**：
- 011 改进 3 的 `_is_tenant_admin` 查 `tenant_membership`，若首次访问未建 membership，会拒绝访问（011 §9 风险 4 已提示）。
- 若 `ensure_team_user` 只在个别端点调用，首次访问画布可能建了、首次访问 tenant 管理可能没建，行为不一致。

**验证位置**：`intellect-rag-app/api/apps/__init__.py`（`ensure_team_user` 的挂载/调用链）。

**验证方法**：
1. 确认 `ensure_team_user` 是挂在 app 级中间件 / 请求前置，而非某个端点 handler 内。
2. 用**全新** member（RAG 侧无 `tenant_membership` 记录）首次打不同类端点，观察 membership 是否被创建，以及 role 值是否符合 V1 结论。

**判定标准（期望结论）**：
- ✅ 通过：任意 imt_ 请求首次访问都会触发 `ensure_team_user`，且幂等（重复访问不报错）。
- ❌ 失败：仅部分端点触发，或首次访问竞态下可能查不到 membership。→ 阻塞，需 RAG 侧补公共路径。

**需回传**：`ensure_team_user` 的实际挂载层级 + 是否幂等 + 全新 member 首次访问的实测结果。

---

## V5. `/health` 端点是否要求 JWT（非阻塞，影响探针）

**问题**：`IntellectRagAdapter.healthCheck` 打的 `GET {baseUrl}/health` 是否要求鉴权（JWT）？是否匿名可访问？

**为什么重要**：
- 方案 A 第 7 步想把 `healthCheck` 从 `fetchWithRagToken`（会注入超管 JWT）改成直打 `/health`，消除探针对超管身份的依赖。
- 若 `/health` 也要 JWT，去掉 `fetchWithRagToken` 会让就绪探针变红。

**验证位置**：RAG 的路由注册（`/health` handler）与鉴权中间件的挂载范围。

**验证方法**：直接 `curl` 未带任何 token 打 `/health`，观察是否 200。

**判定标准（期望结论）**：
- ✅ `/health` 匿名 → BFF 可直接改直打，无需机器身份。
- ⚠️ `/health` 要 JWT → 备选：BFF 自有 `/health` 不探上游鉴权，或保留机器身份（方案 C）。

**需回传**：`/health` 的鉴权要求 + 是否有其他匿名健康端点（如 `/api/v1/health`、`/healthz`）可替代。

---

## 验收输出汇总

| # | 验证项 | 阻塞方案 A? | 期望结论 | BFF 侧对应动作 |
|---|---|---|---|---|
| V1 | `ensure_team_user` 角色映射 | **是** | TEAM admin/owner 落成管理员 role | 若一律 member → 暂停授权侧，RAG 补角色同步 |
| V2 | `is_superuser`/UUID 接口清点 | **是** | 企业版触达接口已改 role 判断 | 未改的列入授权补齐 backlog |
| V3 | `from_intellect_team_session` 覆盖面 | **是** | 画布/KB/tenant 全覆盖 | 缺口补齐后才挂 session 中间件 |
| V4 | 首次访问建 membership | **是** | 公共路径 + 幂等 | 否则改进 3 会 403 |
| V5 | `/health` 是否匿名 | 否 | 匿名或给出替代端点 | 决定 healthCheck 改法 |

> 回传格式建议：按上表填「期望结论 / 实际结论 / 证据」，阻塞项给出 yes/no；V2 附命中清单，V3 附覆盖矩阵。

---

## 附录 A：spec 011 已落地的 RAG 侧改动（供对照，勿重复验收）

| 改进 | 位置 | 已落地行为 |
|---|---|---|
| 改进 2 (P0) | `intellect-rag-app/api/identity/context.py` | `from_intellect_team_session` 新增 `headers` 参数，解析优先级 `X-Intellect-Tenant` header > env > None |
| 改进 3 (P1) | `intellect-rag-app/api/apps/restful_apis/tenant_api.py` | 新增 `_get_member_role_in_tenant` / `_is_tenant_admin`，替换 `user_list`/`create`/`rm` 三处 UUID 判断 |
| 改进 6 (P0) | `intellect-team/plugins/platforms/api_server/adapter.py` | 新增公开端点 `GET /api/tenant/info`（本清单不涉及，供 BFF 启动校验用） |

---

## 附录 B：BFF 实际会代理到 RAG 的端点范围（V2/V3 核对用）

- **画布**：`/api/v1/agents` 及子路径（list/get/create/update/delete、sessions、upload、versions 等）——经 `/canvas/*`、`/agents/*` 和 `/proxy/v1/agents/*`。
- **知识库**：`/api/v1/datasets` 及子路径（list/create/documents/upload 等）——经 `/proxy/v1/datasets/*`。
- **tenant 管理**：`/api/v1/tenants/*`（user_list/create/rm）——经 `/proxy/v1/tenants/*`。
- **系统配置**：`/api/v1/system/config`（公开，不鉴权）。

> 完整代理映射见 `bff/src/routes/proxy.ts`（`/proxy/v1/*`）与 `bff/src/routes/canvas.ts`、`bff/src/routes/bff-agents.ts`。
