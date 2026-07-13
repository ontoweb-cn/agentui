# Feature Specification: Team/Project Management (P5)

**Feature Branch**: `007-team-project-management`

**Created**: 2026-06-26

**Status**: Planning

**Input**: P3 企业版 Adapter 完成后的多租户管理层

**Prerequisites**:
- [P3 已完成](../004-intellect-enterprise-adapter/spec.md) — IntellectEnterpriseAdapter + AdapterRegistry 就绪
- [P4b 已完成](../005-bff-auth-default-tenant/spec.md) — BFF 认证路由 + 缺省 TenantID=0 就绪
- intellect-team P4 Team/Project CRUD HTTP API 就绪

## User Scenarios & Testing

### User Story 1 - Team 管理 (Priority: P1) 🎯 MVP

运维通过 Admin 页面创建/编辑/删除 Team,每个 Team 对应 intellect-team 侧的一个 team 实例。BffTenant 绑定真实 team_id 后,替换缺省 TenantID=0,启用实例内 Team/Project 数据隔离(真正租户隔离通过多实例:不同 intellectBackendId)。

**Why this priority**: P4b 使用缺省 TenantID=0(所有企业版用户共享全局空间),无法实现实例内 Team 级数据隔离。P5 上线 Team 管理后,每个 BffTenant 绑定真实 team_id,intellect-team 按 team_id 实现实例内数据隔离(真正租户隔离通过多实例:不同 BffTenant 绑定不同 intellectBackendId)。

**Independent Test**: Admin 页面创建 Team → BffTenant 绑定 team_id → 用户登录后,Agent 列表和会话数据按 team_id 实现实例内隔离。

**Acceptance Scenarios**:

1. **Given** intellect-team Team CRUD API 就绪, **When** 运维通过 Admin 页面创建 Team(slug/display_name), **Then** BFF 调 intellect-team POST /api/teams 创建,返回 team_id(created_by 由 BFF 从 AuthSession.memberId 自动注入)
2. **Given** Team 已创建, **When** 运维尝试编辑 Team, **Then** 返回不支持(intellect-team 未实现 PUT/PATCH,BFF 不暴露更新路由)
3. **Given** Team 未被 BffTenant 绑定, **When** 运维删除 Team, **Then** BFF 调 intellect-team DELETE /api/teams/{ref} 软删除(enabled=0)
4. **Given** Team 已被 BffTenant 绑定, **When** 运维尝试删除, **Then** 返回 409 冲突(先解绑)
5. **Given** BffTenant 已绑定 team_id, **When** 用户发起 Agent/Session 请求, **Then** TenantContext 携带真实 intellectTeamId,X-Intellect-Team 头注入到 intellect-team 请求
6. **Given** BffTenant.intellectTenantId === "0", **When** 用户发起请求, **Then** 行为与 P4b 一致(不注入 X-Intellect-Team 头,向后兼容)

---

### User Story 2 - Project 管理 (Priority: P2)

运维在 Team 下创建/编辑/删除 Project。每个 Project 对应 intellect-team 侧的一个 project 实例。BffTenant 可选绑定 project_id。

**Why this priority**: Project 是 Team 下的二级隔离单元。P5 先交付 Team(P1),Project 作为可选增强。

**Independent Test**: Admin 页面在 Team 下创建 Project → BffTenant 绑定 project_id → 用户请求时 X-Intellect-Project 头注入。

**Acceptance Scenarios**:

1. **Given** Team 已创建, **When** 运维创建 Project(name/description + team_ref), **Then** BFF 调 intellect-team POST /api/projects 创建(独立路径, body 携带 team_ref 关联 Team)
2. **Given** Project 已创建, **When** 运维删除 Project, **Then** BFF 调 intellect-team DELETE /api/projects/{ref}(软删除 status='archived',intellect-team 未实现 PUT/PATCH 更新)
3. **Given** BffTenant 已绑定 team_id + project_id, **When** 用户请求, **Then** TenantContext 同时携带 intellectTeamId + intellectProjectId
4. **Given** BffTenant 未绑定 project_id, **When** 用户请求, **Then** 仅注入 X-Intellect-Team(不注入 X-Intellect-Project)

---

### User Story 3 - Tenant 绑定管理 (Priority: P3)

运维通过 Admin 页面管理 BffTenant ↔ Team/Project 绑定关系。支持修改绑定、解绑、查看当前绑定状态。

**Why this priority**: US1/US2 创建 Team/Project,US3 管理绑定关系,形成完整闭环。

**Independent Test**: Admin 页面查看 BffTenant 列表 → 编辑绑定 → 选择 Team + 可选 Project → 保存 → 请求时自动注入对应头。

**Acceptance Scenarios**:

1. **Given** Admin 页面 Tenant 列表, **When** 运维点击 "编辑绑定", **Then** 显示 Team 下拉框(从 intellect-team 获取) + Project 下拉框(选 Team 后加载)
2. **Given** 运维选择 Team + Project, **When** 保存绑定, **Then** TenantStore 更新 intellectTenantId + intellectProjectId
3. **Given** 运维解绑(设为 "0"), **When** 保存, **Then** TenantStore 恢复缺省 TenantID=0
4. **Given** Team 已绑定到其他 Tenant, **When** 运维尝试重复绑定, **Then** 允许(多 Tenant 可共享同一 Team)

---

### Edge Cases

- **intellect-team Team API 不可用**: BFF 返回 502,Admin 页面显示 "intellect-team 不可达"
- **Team 下有活跃会话**: 删除 Team 前需确认(intellect-team 侧可能级联删除或拒绝)
- **从 TenantID=0 迁移到真实 team_id**: 已有会话数据在全局空间,切换后新会话在 team 空间,旧数据不可见(intellect-team 侧行为)
- **并发绑定修改**: last-write-wins(P2 简化策略)
- **Project 跨 Team**: Project 隶属于 Team,不能跨 Team 绑定

## Requirements

### Functional Requirements

- **FR-001**: BFF MUST 实现 Team CRUD 路由(POST/GET/DELETE `/api/bff/admin/teams[/:ref]`),调 intellect-team `/api/teams/*`(intellect-team 未实现 PUT/PATCH,BFF 不暴露更新路由;DELETE 为软删除 enabled=0)
- **FR-002**: BFF MUST 实现 Project CRUD 路由(POST/GET/DELETE `/api/bff/admin/projects[/:ref]`),调 intellect-team `/api/projects/*`(独立路径非嵌套,通过 body `team_ref` 关联 Team;intellect-team 未实现 PUT/PATCH,BFF 不暴露更新路由)
- **FR-003**: BFF MUST 实现 Tenant 绑定路由(PUT `/api/bff/admin/tenants/:id/binding`),更新 TenantStore 的 intellectTenantId + intellectProjectId
- **FR-004**: BFF MUST 在 TenantContext 中间件中,当 intellectTenantId !== "0" 时注入 X-Intellect-Team 头(已有逻辑,P5 确认)
- **FR-005**: BFF MUST 在 TenantContext 中间件中,当 intellectProjectId 存在时注入 X-Intellect-Project 头
- **FR-006**: 前端 MUST 实现 Team 管理页面(/admin/teams),展示 Team 列表 + CRUD 表单
- **FR-007**: 前端 MUST 实现 Project 管理页面(/admin/projects),通过 team_ref 字段关联 Team(独立路径非嵌套)
- **FR-008**: 前端 MUST 实现 Tenant 绑定编辑(/admin/tenants/:id/binding),Team/Project 下拉选择
- **FR-009**: Team/Project CRUD 路由 MUST 受 authMiddleware 保护
- **FR-010**: Tenant 绑定路由 MUST 受 authMiddleware 保护
- **FR-011**: BFF MUST 在删除 Team 前检查是否有 BffTenant 绑定(绑定则 409)
- **FR-012**: BffTenant.intellectTenantId === "0" 时 MUST 保持 P4b 行为(不注入 X-Intellect-Team 头,向后兼容)

### Key Entities

- **Team**: intellect-team 侧的 team 实例(id/slug/display_name/enabled/created_at,字段对齐 intellect-team plugins/platforms/api_server/adapter.py)
- **Project**: intellect-team 侧的 project 实例(id/slug/display_name/team_ref/repo_url/status/created_at,通过 team_ref 关联 Team,DELETE 软删除 status='archived')
- **BffTenant.intellectTenantId**: 绑定的 team_id,值 "0" 表示缺省(不注入头)
- **BffTenant.intellectProjectId**: 可选绑定的 project_id

## Success Criteria

- **SC-001**: 运维通过 Admin 页面创建 Team,绑定到 BffTenant 后,用户请求时 X-Intellect-Team 头正确注入
- **SC-002**: 从 TenantID=0 迁移到真实 team_id 后,新会话数据按 team_id 实现实例内隔离
- **SC-003**: TenantID=0 模式 100% 不回归(向后兼容)
- **SC-004**: Team/Project CRUD + Tenant 绑定 Admin 页面可用
- **SC-005**: BFF Team/Project 路由单元测试覆盖率 ≥ 80%
- **SC-006**: TypeScript 编译零错误(BFF + 前端)
- **SC-007**: P0-P4b 现有 211+ 测试 100% 不回归

## Assumptions

- **intellect-team P4 API 就绪**: Team/Project CRUD 端点由 intellect-team 团队实现(P5 依赖)
- **intellect-team API 端点格式**(已对齐实际契约 2026-06-26):
  - Team: `POST/GET /api/teams` + `GET/DELETE /api/teams/{ref}`(ref 可为 slug 或 id;DELETE 软删除 enabled=0;**未实现 PUT/PATCH**)
  - Project: `POST/GET /api/projects` + `GET/DELETE /api/projects/{ref}`(**独立路径非嵌套**,通过 body `team_ref` 关联 Team;DELETE 软删除 status='archived';**未实现 PUT/PATCH**)
  - 列表响应格式: `{data: [...]}`(无分页)
  - `created_by` 字段由 BFF 从 AuthSession.memberId 自动注入
- **BffTenant 字段已存在**: intellectTenantId/intellectProjectId 在 P0 TenantStore 中已定义
- **Admin 页面复用 P2 布局**: Team/Project 管理页面复用现有 Admin 页面布局和组件
- **多 Tenant 共享 Team**: 允许多个 BffTenant 绑定同一 Team(intellect-team 侧不做限制)
- **Project 可选**: BffTenant 可以只绑定 Team 不绑定 Project(intellect-team 用全局 project)
