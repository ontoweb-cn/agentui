# Feature Specification: TEAM-RAG Tenant Consistency

**Feature Branch**: `011-team-rag-tenant-consistency`

**Created**: 2026-07-26

**Status**: Implemented

**Input**: 评审方案 B（确保 intellect-team 与 intellect-rag 租户一致）后发现的 5 个隐患，提出 6 项改进方案，确保 TEAM 和 RAG 的 tenant_id 严格一致。

## 1. 背景与问题

intellect-team（企业版 gateway）与 intellect-rag（RAG/画布引擎）共享同一套 tenant 模型，但实际部署中存在配置漂移和解析路径不一致风险：

1. **静态配置漂移**：`HarnessBackend.intellectTenantId`（BFF JSON 配置）与 intellect-team `INTELLECT_TENANT_ID` env var 需手动同步，无启动期校验。
2. **RAG 侧解析路径不一致**：intellect-rag 三个 tenant_id 解析入口优先级不同，部分路径不读 `X-Intellect-Tenant` header。
3. **硬编码 ID 检查**：RAG 侧 `tenant_api.py` 用 `current_user.id != tenant_id` 判断权限，imt_ 路径下 `current_user.id == member_id`，无法通过。
4. **双 ID 体系**：admin JWT 路径 `current_user.id` 是 RAG UUID，imt_ 路径是 TEAM member_id，同一个人在 `tenant_membership` 表中被当成两个 member。
5. **方案 B 未沉淀文档**：方案 B（sessionToken + intellectTenantId 注入）仅以代码注释为载体，缺乏整体设计文档。

## 2. 设计目标

**核心目标**：确保 TEAM 和 RAG 的 tenant_id 严格一致，消除配置漂移与解析路径分歧。

**非目标**：
- 不重构 intellect-team 的多租户模型（保持 Independent-DB + K8s instance-per-tenant）
- 不重构 intellect-rag 的 `tenant_membership` 表结构
- 不消除 admin JWT 兜底路径（保持向后兼容）

## 3. 改进方案

### 改进 1 (P0)：BFF 启动时校验 intellectTenantId

**目标**：阻断 BFF 静态配置与 TEAM env var 的漂移。

**实现**：
- 新增 `bff/src/services/tenant-validator.ts`，导出 `validateTenantConfigs(harnessStore)`。
- 在 `bff/src/index.ts` 的 stores 加载完成后、RAG token 预热之前调用。
- 调用 intellect-team `GET /api/tenant/info`（改进 6 新增的公开端点），比对返回的 `tenant_id` 与 `backend.intellectTenantId`。
- 校验结果：
  - **一致** → log OK
  - **不一致** → `process.exit(1)`（fail-fast，防止数据分裂）
  - **未配置 `intellectTenantId`** → 自动从 endpoint 拉取并写入运行时对象（不修改 JSON 文件），log WARN
  - **endpoint 不可达** → WARN 不阻塞启动（intellect-team 可能稍后启动）

**关键约束**：
- 仅校验 `type='intellect-enterprise'` 的 backend（RAG/LLM backend 无此字段）。
- 公开端点，请求不携带 Authorization。
- 5 秒超时，避免 BFF 启动卡死。

### 改进 2 (P0)：RAG `from_intellect_team_session` 读 header

**目标**：让 RAG 三个 tenant_id 解析路径优先级一致。

**实现**：
- 修改 `intellect-rag-app/api/identity/context.py` 的 `SubjectContext.from_intellect_team_session`。
- 新增 `headers: Mapping[str, str] | None = None` keyword-only 参数。
- 解析优先级：`X-Intellect-Tenant` header（大小写不敏感）> `INTELLECT_TENANT_ID` env > None。
- 保持"team_id/member_id 永不作为 tenant_id 回退"约束不变。

**向后兼容**：
- `headers` 默认 None，未传时走原 env var 逻辑。
- 现有调用方（仅测试文件）不传 headers，行为不变。

### 改进 3 (P1)：RAG `tenant_api.py` 改为角色判断

**目标**：让 imt_ 路径下 tenant 管理 API 也能通过权限检查。

**实现**：
- 在 `intellect-rag-app/api/apps/restful_apis/tenant_api.py` 新增两个辅助函数：
  - `_get_member_role_in_tenant(member_id, tenant_id)`：返回 `'owner' / 'admin' / 'member' / None`。
  - `_is_tenant_admin(current_user_obj, tenant_id)`：判断当前用户是否对 tenant 有管理员权限。
- 替换 3 处硬编码：
  - `user_list`、`create`：`if current_user.id != tenant_id:` → `if not _is_tenant_admin(current_user, tenant_id):`
  - `rm`：`if current_user.id != tenant_id and current_user.id != user_id:` → `if not _is_tenant_admin(current_user, tenant_id) and current_user.id != user_id:`（保留"用户移除自己"分支）。

**向后兼容**：
- `member_id == tenant_id` 仍返回 `'owner'`，admin JWT 路径行为不变。
- imt_ 路径下 `current_user.id == member_id`，查 `tenant_membership.role`，`owner/admin` 通过。

### 改进 4 (P1)：文档化 admin JWT 兜底路径

**目标**：明确 admin JWT 兜底时 tenant_id 由 header 决定，不由 JWT subject 决定。

**实现**：本 spec 文档第 4 节。

### 改进 5 (P2)：本 spec 文档

**目标**：沉淀方案 B 设计，避免 tribal knowledge 流失。

### 改进 6 (P0)：intellect-team 新增 `/api/tenant/info` 公开端点

**目标**：为改进 1 提供数据来源。

**实现**：
- 在 `intellect-team/plugins/platforms/api_server/adapter.py` 新增 handler `_handle_tenant_info`。
- 公开端点（不调用 `_check_auth`），返回当前实例的 `tenant_id`、`display_name`、`enabled`、`source`。
- `tenant_id` 来源：`INTELLECT_TENANT_ID` env var，未设置时返回 `"default"`。
- `source` 字段：`"env"` 或 `"default"`，便于排查配置来源。
- 不查 DB（adapter 无数据库访问途径），`display_name` 降级为 `tenant_id`，`enabled` 默认 true。

## 4. admin JWT 兜底路径文档化

### 4.1 何时走 admin JWT 兜底

当 `BackendContext.sessionToken` 为 undefined 时，BFF 走 admin JWT 兜底路径：
- RAG 版（authMode=intellect-rag）：始终走此路径。
- 企业版未登录（cookie 无效或缺失）：走此路径。
- 后台任务（无 request context）：走此路径。
- admin 后台（独立鉴权）：走此路径。

### 4.2 admin JWT 兜底时的 tenant_id 来源

**关键约束**：admin JWT 兜底时，`tenant_id` 由 `X-Intellect-Tenant` header 决定，**不由 JWT subject 决定**。

**实现路径**：
1. `HarnessBackend.intellectTenantId`（静态配置或启动时自动填充）→ `BackendContext.intellectTenantId`
2. `IntellectRagAdapter.buildHeaders` 注入 `X-Intellect-Tenant` header
3. `IntellectRagAdapter.proxy` 注入 `X-Intellect-Tenant` header（删除客户端伪造后注入）
4. intellect-rag `get_subject_context_from_request` 解析优先级：header > env > `current_user.id`（legacy 回退）
5. **header 存在时**，`SubjectContext.tenant_id == intellectTenantId`，不依赖 JWT subject

### 4.3 admin JWT 兜底时的 user_id 来源

admin JWT 路径下：
- `current_user.id` 是 RAG UUID（由 `init_superuser` 创建）
- 不等于 TEAM member_id（除非巧合）
- 这是"双 ID 体系"的根源

**消除双 ID 体系**：仅在 sessionToken 存在时（imt_ 路径）实现，admin JWT 路径下仍存在。但只要 `tenant_id` 由 header 决定（改进 4），双 ID 体系的影响仅限于 `tenant_membership.member_id` 列的命名空间，不影响 `tenant_id` 一致性。

## 5. User Scenarios & Testing

### US1 - BFF 启动时配置一致 (Priority: P0)

BFF 启动时调用 `/api/tenant/info`，返回的 `tenant_id` 与 `HarnessBackend.intellectTenantId` 一致，BFF 正常启动。

**Independent Test**：配置 `intellectTenantId: "default"` + intellect-team `INTELLECT_TENANT_ID=default` → 启动 BFF → 日志显示 `tenant_id OK`。

**Acceptance**：
1. 配置一致 → BFF 启动成功，log "tenant_id OK"
2. 配置不一致 → BFF `process.exit(1)`，log "FATAL: tenant_id MISMATCH"
3. 未配置 intellectTenantId → BFF 启动成功，自动填充，log WARN
4. intellect-team 不可达 → BFF 启动成功，log WARN

### US2 - RAG 解析路径一致 (Priority: P0)

BFF 通过 `X-Intellect-Tenant` header 注入 tenant_id，无论 RAG 走哪个解析路径，结果都一致。

**Independent Test**：BFF 注入 `X-Intellect-Tenant: default` → intellect-rag 三个解析路径都返回 `default`。

### US3 - imt_ 路径下 tenant 管理 API 可用 (Priority: P1)

企业版用户通过 imt_ token 访问 RAG tenant 管理 API，权限检查通过。

**Independent Test**：admin 用户用 imt_ token 调用 `GET /api/v1/tenants/{tenant_id}/users` → 返回 200，不返回 403。

## 6. 实施清单

| 改进 | 优先级 | 状态 | 实施位置 |
|------|--------|------|----------|
| 改进 1 | P0 | ✅ 完成 | `bff/src/services/tenant-validator.ts` + `bff/src/index.ts` |
| 改进 2 | P0 | ✅ 完成 | `intellect-rag-app/api/identity/context.py` |
| 改进 3 | P1 | ✅ 完成 | `intellect-rag-app/api/apps/restful_apis/tenant_api.py` |
| 改进 4 | P1 | ✅ 完成 | 本 spec 第 4 节 |
| 改进 5 | P2 | ✅ 完成 | 本 spec 文档 |
| 改进 6 | P0 | ✅ 完成 | `intellect-team/plugins/platforms/api_server/adapter.py` |

## 7. 测试覆盖

### BFF 侧

- `bff/src/services/tenant-validator.test.ts`：9 个测试，覆盖配置一致/不一致/未配置/不可达/非200/空tenant_id/无enterprise backend/多backend/尾部斜杠。

### RAG 侧

- `intellect-rag-app/api/identity/context.py` 的 `from_intellect_team_session` 已有 6 个测试（仅 intellect-rag-app 测试目录），未传 headers 时行为不变。
- `tenant_api.py` 的改造未新增测试（依赖 DB 集成测试，超出本 spec 范围）。

### 集成验证

**待执行**（未包含在本 spec 中）：
1. 重启 intellect-team、BFF、RAG 服务。
2. BFF 启动日志应显示 `tenant_id OK`。
3. 浏览器登录后，检查 `tenant_membership` 表中 `tenant_id` 与 intellect-team `INTELLECT_TENANT_ID` 一致。

## 8. 端到端数据流

```
intellect-team gateway
  └─ INTELLECT_TENANT_ID env var (实例级 tenant_id)
     │
     ├─ 改进 6: GET /api/tenant/info 公开端点返回
     │   ↓
     ├─ 改进 1: BFF 启动时拉取并校验 HarnessBackend.intellectTenantId
     │   ↓
     └─ BFF 注入 X-Intellect-Tenant header 到所有 RAG 请求
        ↓
     intellect-rag 三条解析路径都读 header
     ├─ api_utils.py (HTTP 主路径): header > env > current_user.id
     ├─ sync_membership.py: header > env > current_user.id
     └─ context.py from_intellect_team_session (改进 2): header > env > None
        ↓
     SubjectContext.tenant_id == intellect-team INTELLECT_TENANT_ID ✅

imt_ token 路径
  └─ current_user.id = TEAM member_id (经 ensure_team_user 创建)
     └─ tenant_membership(tenant_id=INTELLECT_TENANT_ID, member_id=member_id, role=member)
        └─ 改进 3: tenant_api.py 基于 tenant_membership.role 判断 ✅
```

## 9. 风险与限制

1. **改进 6 的降级方案**：intellect-team adapter 无数据库访问途径，`/api/tenant/info` 不查 DB，仅返回 env var。`display_name` 降级为 `tenant_id`，`enabled` 默认 true。不影响 BFF 启动校验的核心需求（比对 tenant_id 字符串）。

2. **改进 1 的 fail-fast 风险**：配置不一致时 BFF 直接退出，可能导致服务不可用。但这是有意为之——继续运行会导致 TEAM/RAG 数据分裂，更难修复。运维应通过监控告警及时发现配置漂移。

3. **改进 2 的向后兼容**：`from_intellect_team_session` 的 `headers` 参数默认 None，现有调用方不传 headers 时行为不变。但**未来调用方应优先传 headers**，以利用 header 注入路径。

4. **改进 3 的角色判断依赖**：`_is_tenant_admin` 查询 `tenant_membership` 表，如果 `ensure_team_user` 未及时创建 membership，会拒绝访问。需要保证 imt_ 首次访问时 `ensure_team_user` 被调用（已在 `intellect-rag-app/api/apps/__init__.py:269` 实现）。

## 10. 相关文档

- 方案 B 代码注释：`bff/src/types/tenant.ts`、`bff/src/types/harness.ts`、`bff/src/middleware/backend-context.ts`、`bff/src/services/rag-fetch.ts`、`bff/src/services/intellect-rag-client.ts`、`bff/src/services/adapters/intellect-rag/intellect-rag-adapter.ts`、`bff/src/routes/proxy.ts`
- intellect-team 租户模型：`intellect-team/intellect-storage/src/tenants.rs`、`intellect-team/intellect-gateway/src/config.rs`
- intellect-rag SubjectContext：`intellect-rag-app/api/identity/context.py`、`intellect-rag-app/api/utils/api_utils.py`、`intellect-rag-app/api/utils/sync_membership.py`
- 现有 spec：`specs/005-bff-auth-default-tenant/spec.md`（缺省 TenantID=0）、`specs/006-frontend-login-adaptation/auth-flow.md`（imt_ token 流程）
