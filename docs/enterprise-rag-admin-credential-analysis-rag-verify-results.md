# intellect-rag-app 侧验证结果（V1–V5 回填）

> **日期**: 2026-08-14
> **验证人**: 对照本机源码取证（`/home/admin/workspace/intellect-rag-app` 应用层 + `/home/admin/workspace/intellect-rag` 数据层 + `/home/admin/workspace/intellect-team` 网关侧）
> **对应清单**: [rag-verify-checklist](./enterprise-rag-admin-credential-analysis-rag-verify-checklist.md)
> **结论摘要**: V1 **FAIL（阻塞）**；V2 / V4 / V5 **PASS**（V5 附带 BFF 侧路径 bug）；V3 **PASS**（含一处「改进 2 实际生效函数与文档不符」的认知修正）。

---

## V1（阻塞）— `ensure_team_user` 角色映射：TEAM admin/owner **不会**自动成为 RAG 管理员

**结论：FAIL。** `ensure_team_user` 硬编码 `role='member'`，被动同步也不携带角色，TEAM 的 admin/owner 与 member 在 RAG 里同样被落成 `member`。

证据链：

1. `intellect-rag/api/db/services/user_service.py:146`
   ```python
   # upsert tenant_membership（幂等,role='member'）
   TenantMembershipService.ensure(tenant_id, member_id, role="member")
   ```
2. `TenantMembershipService.ensure`（同文件 `:363`）用 `INSERT IGNORE` / `ON CONFLICT (tenant_id, member_id) DO NOTHING`，只「确保存在」，**不覆盖已存在行的 role**（`:370-372` 注释明示）。
3. 被动同步 `sync_membership.py` 的 `_upsert_memberships`（`:315`）同样写 `role='member'`，且 `:253-269` 注释明说「X-Intellect-* header **不携带 role**，只能靠 source of truth 或显式 RBAC 修正」。
4. 唯一例外：**全新租户**（零 `tenant_membership` 行）的第一个成员被 seed 为 `'owner'`（`sync_membership.py:277-294`）——这与 TEAM 角色无关，纯按「谁先到」。

**对方案 A 的影响**：切 imt_ 后，TEAM admin/owner 在 RAG 里 `tenant_membership.role='member'`，无法通过 `_is_tenant_admin`（要求 `owner`/`admin`，见 V2）。画布/KB 管理、tenant 管理会对 TEAM 管理员 403。**这是授权侧的硬阻塞，BFF 开关不能在此问题解决前开启。**

**需补的动作**（RAG/team 侧）：建立 TEAM 角色 → `tenant_membership.role` 的同步通道（当前 header 无 role，被动同步无法完成）。可选路径：intellect-team 的 RAG 插件在写 membership 时携带 role，或 RAG 侧新增受信 role 同步端点。

---

## V2（通过）— `is_superuser`/UUID 接口清点：业务端点已改 role 判断

**结论：PASS。** 企业版会触达的 API 应用层端点已无 `is_superuser`/UUID 权限门控。

- `api/apps/restful_apis/` 内 `is_superuser` 仅出现在 `user_api.py` 的**响应序列化**（`:241`/`:352`/`:548`，返回/写入 `"is_superuser": False`），无一处作为权限门控。
- `tenant_api.py` 已按 spec 011 改进 3 落地 `_get_member_role_in_tenant`（`:41`）+ `_is_tenant_admin`（`:66`），`user_list`/`create`/`rm` 三处均改为 `_is_tenant_admin`。
- `is_superuser` 作为权限门控只存在于 `admin/server/`（RAG 原生 admin，端口 9381，**独立服务器、不在 BFF 代理路径**）。

无需额外清点 backlog。注意 V1 失败使得 `_is_tenant_admin` 在 imt_ 路径下**判不到 admin**，这是角色来源问题（V1），不是接口判断方式问题（V2 已正确）。

---

## V3（通过）— 解析路径覆盖面：集中式，但「改进 2」实际载体与文档不符

**结论：PASS（覆盖面 OK），含一处认知修正。**

imt_ 身份解析在 rag-app 侧是**集中式**的，覆盖所有 `@login_required` 端点，不存在「画布走、KB 不走」的分叉：

1. `_load_user`（`current_user` 解析器，`api/apps/__init__.py:333-365`）：识别 `imt_` token + `X-Intellect-User` header → 首次访问 `ensure_team_user` → `current_user.id = member_id`。
2. `sync_membership_on_request`（`before_request` hook，`api/apps/__init__.py` 注册）：每请求按 header upsert membership。
3. `get_subject_context_from_request`（`api/utils/api_utils.py:244`，经 `add_tenant_id_to_kwargs` 注入）：给声明 `subject_context` 的 handler（`dataset_api.py` 等）构造 `SubjectContext`，`subject_id` 取自 `X-Intellect-User`。

**认知修正**：spec 011 改进 2 的 `SubjectContext.from_intellect_team_session`（`api/identity/context.py:222`）**在 rag-app 的请求路径上未被调用**（仅测试引用）。它实际在 intellect-team 侧插件被调用（`intellect-team/plugins/rag/intellect-rag/__init__.py:161`、`plugins/dsl/intellect-dsl/tools.py:315`）。rag-app 内的实际载体是 `get_subject_context_from_request → SubjectContext.from_parts`。这不是覆盖缺口，但 spec 011「改进 2 让 RAG 三路径一致」的**实际生效函数**与文档描述不一致，后续文档需更正。

---

## V4（通过）— 首次访问建 membership：公共路径 + 幂等

**结论：PASS。**

- `ensure_team_user` 在 `_load_user`（`current_user` 解析器）中，imt_ 首次访问且用户记录不存在时调用（`api/apps/__init__.py:358`；`RAG_SERVICE_TOKEN` 路径同款 `:305`）。
- 幂等：user 表 `ON DUPLICATE KEY UPDATE` / `ON CONFLICT (id) DO UPDATE`（`user_service.py:74-100`）；tenant_membership `INSERT IGNORE` / `DO NOTHING`（`:384-395`）。
- 公共路径：任何访问 `current_user` 的端点都经 `_load_user`。

---

## V5（通过 + BFF 侧 bug）— 健康端点匿名，但 BFF 打错了路径

**结论：健康端点匿名，但 BFF `healthCheck` 打的路径不对。**

- RAG 匿名健康端点是 **`/api/v1/system/healthz`**（`system_api.py:230`，无 `@login_required`，且在 `api/apps/__init__.py:591` 的 `public_prefixes` 白名单内）。`/api/v1/system/ping`、`/api/v1/system/version` 同为匿名。
- **根 `/health` 在 RAG 源码中不存在**（全仓 grep 无命中）。
- BFF `IntellectRagAdapter.healthCheck` 打的是 `{endpoint}/health`（`bff/src/services/adapters/intellect-rag/intellect-rag-adapter.ts:204`）——**路径错误**，既不是匿名端点，也可能直接 404。

**需修**（BFF 侧）：`healthCheck` 改为打 `/api/v1/system/healthz`（匿名、无 JWT）。这与分析文档 §7「healthCheck 改直打 /health」的假设不同——正确目标不是 `/health`，而是 `/api/v1/system/healthz`。

---

## 汇总表

| # | 结论 | 证据（file:line） | 后续动作 |
|---|---|---|---|
| V1 | **FAIL（阻塞）** | `user_service.py:146`、`sync_membership.py:315/253-269` | TEAM 角色 → `tenant_membership.role` 同步通道（team 侧插件或 RAG 受信端点） |
| V2 | PASS | `tenant_api.py:66-80`、`user_api.py:241/352/548` | 无 |
| V3 | PASS（含认知修正） | `api/apps/__init__.py:333-365`、`api_utils.py:244` | 更正 spec 011「改进 2」生效函数描述 |
| V4 | PASS | `api/apps/__init__.py:358`、`user_service.py:74-100` | 无 |
| V5 | PASS + BFF bug | `system_api.py:230`、`adapter.ts:204` | BFF `healthCheck` 改打 `/api/v1/system/healthz` |

## 安全观察（附带）

`sync_membership.py:277-294`：全新租户的**第一个成员**被 seed 为 `owner`，与 TEAM 角色无关。注释称这是「fresh tenant 需要 owner」的有意设计，且「已有租户绝不自动提升」。但该行为意味着：若一个租户在 RAG 侧尚未有任何 membership，最先访问的任意 TEAM member（无论其真实角色）会拿到 `owner`。若租户初始化时序不可控，这构成一个角色提升面，建议在开启 imt_ 前由部署侧确认租户 seeding 时序。
