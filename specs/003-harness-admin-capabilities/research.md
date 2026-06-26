# Research: Multi-Harness P2 — Harness Admin 管理端 + 前端能力探测

**Feature**: [003-harness-admin-capabilities](./)
**Date**: 2026-06-26
**Status**: Complete

## 概述

P2 无 NEEDS CLARIFICATION(plan.md 已确认所有前置条件满足)。本 research 记录关键设计决策与 P0/P1 基础设施复用情况,为 data-model.md 和 contracts/ 提供依据。

---

## R1. AdapterRegistry 缓存失效设计

### Decision

AdapterRegistry 新增 `invalidate(backendId?: string)` 方法:不传参时清空整个 adapterCache,传 backendId 时只移除该条目。后端 CRUD 后调用 invalidate,下次 `getAdapterForTenant` 创建新 Adapter 实例(用新配置)。

### Rationale

- P1 的 adapterCache 是 `Map<backendId, IHarnessAdapter>`,private,需暴露 invalidate
- 编辑后端配置后,旧 Adapter 实例持有旧 baseUrl/adminToken/capabilities,必须失效
- 删除后端后,缓存条目也应清理(虽然 HarnessStore.get() 返回 undefined 会触发 BackendNotConfiguredError,但清理缓存避免内存泄漏)
- 新增后端无需 invalidate(新 backendId 无缓存条目),但为简化调用方逻辑,CRUD 统一调 invalidate

### Alternatives Considered

1. **TTL 自动过期**:❌ 拒绝。配置变更需立即生效,TTL 有延迟窗口
2. **每次 getAdapterForTenant 都创建新实例**:❌ 拒绝。违反 P1 的"实例复用避免连接泄漏"设计
3. **只 invalidate 被编辑的 backendId**:✅ 部分采纳。invalidate 支持单 backendId 和全清两种模式,调用方按需选择

---

## R2. 后端就绪状态(ready)判定

### Decision

`ready` 字段由 HarnessStore.list() 判定:若 list() 包含该 backendId 则 ready=true,否则 ready=false(env token 缺失被 P0 跳过的后端不在 list 中)。

### Rationale

- P0 HarnessStore.load() 行为:env token 缺失的后端被跳过并告警,不加入内存 list
- 因此 `list().find(b => b.id === id)` 返回 undefined 即表示未就绪
- CRUD API 返回 HarnessBackendConfig(来自 JSON 文件,含所有配置)+ ready 状态(来自 list() 判定),前端据此展示状态

### 数据来源

- HarnessBackendConfig 列表:直接读 JSON 文件(或 HarnessStore 维护的 configs 数组,P0 已加载)
- ready 状态:HarnessStore.list() 返回的 HarnessBackend[](仅含 env token 就绪的)

**问题**:HarnessStore 当前只有 list()(返回就绪的)和 get(id)(返回就绪的),没有"返回所有配置(含未就绪)"的方法。P2 需扩展 HarnessStore 新增 `listConfigs(): HarnessBackendConfig[]` 返回所有配置(含未就绪),用于 Admin 列表展示。

---

## R3. 删除后端的绑定校验

### Decision

删除后端前,遍历 TenantStore.listTenants() 检查是否有 tenant 的 intellectBackendId 或 canvasBackendId 等于该 backendId。有绑定则返回 409,无绑定才允许删除。

### Rationale

- Constitution Principle V:tenant 绑定关系是 BFF 维护的核心数据
- 删除被绑定的后端会导致 tenant 的 AdapterRegistry.getAdapterForTenant() 抛 BackendNotConfiguredError,前端功能受损
- 强制先解绑再删除,保证数据一致性

### Alternatives Considered

1. **级联删除(自动解绑)**:❌ 拒绝。静默修改 tenant 绑定会导致运维困惑,显式提示更安全
2. **只校验 intellectBackendId,忽略 canvasBackendId**:❌ 拒绝。canvas 绑定同样依赖该后端,删除会破坏画布功能

---

## R4. 并发编辑策略(last-write-wins)

### Decision

P2 用 last-write-wins:两个运维同时编辑同一后端,后提交的覆盖先提交的,不报冲突。BFF 不实现乐观锁(version 字段)或悲观锁。

### Rationale

- P2 是单实例 BFF,并发编辑概率低(运维操作,非用户高频操作)
- 乐观锁需在 HarnessBackendConfig 增加 version 字段,P0 schema 无此字段,改动大
- last-write-wins 简单可靠,符合 YAGNI(Constitution Principle VII)
- P4+ 多实例部署时再评估乐观锁需求

### Alternatives Considered

1. **乐观锁(version 字段)**:❌ 拒绝。YAGNI,P2 单实例无并发问题
2. **悲观锁(编辑时锁定)**:❌ 拒绝。运维场景无需强一致,过度工程
3. **last-write-wins + 提示"配置已更新"**:✅ 采纳。后提交者覆盖前者,前端刷新看到最新配置

---

## R5. 前端 useHarnessCapabilities 实现策略

### Decision

用 TanStack Query(项目已用)实现 `useHarnessCapabilities` hook:`useQuery({ queryKey: ['harness-capabilities', tenantId], queryFn: () => fetch('/api/bff/capabilities', {headers: {X-Tenant-Id, X-User-Id}}) })`。tenantId 变化时 queryKey 变化,自动重新查询。

### Rationale

- 项目已用 TanStack Query(见 src/services/ 模式),无需引入新依赖
- TanStack Query 自动管理 loading/error/data 状态,缓存/重试
- queryKey 含 tenantId,切换 tenant 自动失效旧查询,重新获取新 tenant 的能力

### 缓存策略

- staleTime: 0(默认,每次 mount 重新查询,保证最新能力)
- 不设 cacheTime(默认 5 分钟,卸载后保留缓存,快速切回)
- 提供手动 `refetch`(运维修改后端后用户可手动刷新)

### 条件渲染

- canvas=false → 隐藏画布入口(路由配置 + 菜单组件条件渲染)
- knowledgeBase=false → 隐藏知识库菜单
- multiTenant=false → 隐藏 Team/Project 管理入口(P3 企业版才有)
- 所有 capabilities 为 false → 显示"该后端无可用能力"提示

---

## R6. Admin 路由鉴权与租户隔离

### Decision

- harness-admin 路由(`/api/bff/admin/harness-backends`):仅 authMiddleware,不需 tenantContextMiddleware(运维操作,非租户隔离)
- capabilities 路由(`/api/bff/capabilities`):authMiddleware + tenantContextMiddleware(按 tenant 返回能力)

### Rationale

- Admin 操作是全局性的(管理所有后端配置),不应限制 tenant
- capabilities 是 tenant-scoped(每个 tenant 绑定不同后端,能力不同),必须按 tenant 返回
- 与 P1 的 bff-agents 路由一致(Agent 原生路由需 tenantContextMiddleware,因为按 tenant 选 Adapter)

### 权限限制

P2 不实现细粒度权限(所有登录用户可访问 Admin 页面)。P4+ 评估 admin role 限制(需 Intellect RAG Admin 提供角色 API)。

---

## R7. 校验规则汇总

### Decision

P2 在 BFF + 前端双层校验:

| 字段 | 规则 | 正则 |
|------|------|------|
| id | kebab-case | `^[a-z0-9]+(-[a-z0-9]+)*$` |
| name | 非空 | `^.+$` |
| type | 枚举 | `intellect-rag\|intellect-enterprise` |
| endpoint | 合法 URL | `^https?://.+` |
| adminTokenEnvVar | 合法环境变量名 | `^[A-Z_][A-Z0-9_]*$` |
| capabilities | 对象,各字段 boolean | 类型校验 |

### Rationale

- 前端校验提供即时反馈,减少无效请求
- BFF 校验是安全防线(前端可绕过),保证数据一致性
- 双层校验符合常见 Web 应用实践

---

## 总结

P2 无 NEEDS CLARIFICATION,所有设计决策基于 P0/P1 已有基础设施 + 合理默认。关键扩展点:AdapterRegistry.invalidate、HarnessStore.listConfigs。下一步:生成 data-model.md 定义 DTO + 校验规则,生成 contracts/ 定义 Admin API + capabilities API 契约。
