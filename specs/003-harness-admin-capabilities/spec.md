# Feature Specification: Multi-Harness P2 — Harness Admin 管理端 + 前端能力探测

**Feature Branch**: `003-harness-admin-capabilities`

**Created**: 2026-06-26

**Status**: Draft

**Input**: User description: "P2 实施:实现 Harness Admin 管理端(BFF 后端配置 CRUD + 能力探测端点)与前端能力探测(useHarnessCapabilities hook + Admin 页面 + 条件渲染),让运维可在线配置后端,前端按能力条件渲染 UI。"

**Prerequisites**:
- [P1 已完成](../002-multi-harness-p1/spec.md) — AdapterRegistry + IntellectRagAdapter + TenantContext 就位
- [Constitution v1.2.0](../../.specify/memory/constitution.md) — Principle I/II/VII + Token Security 约束
- [research.md](../002-multi-harness-p1/research.md) — P1 已确认 JSON 文件 + env 注入的存储模型

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 运维在线管理后端配置 (Priority: P2) 🎯 MVP

运维人员通过 Admin 页面 CRUD 后端配置(新增/编辑/删除 Intellect RAG / Intellect 企业版后端),无需重启 BFF。配置持久化到 JSON 文件,token 通过环境变量引用(不落盘明文)。新增后端时页面提示用户设置对应环境变量。

**Why this priority**: Constitution Principle II 要求"加后端不改路由",但 P0/P1 的后端配置只能通过手动编辑 JSON + 重启 BFF 完成,运维效率低且易错。P2 提供在线管理能力,是 P3 多后端切换的前置(运维需先能配置企业版后端,才能让 AdapterRegistry 选择它)。

**Independent Test**: 运维登录 Admin 页面,新增一个 intellect-rag 后端(填入 id/name/endpoint/adminTokenEnvVar/capabilities),提交后 BFF HarnessStore 热加载该配置,前端能力探测立即反映新后端能力。删除后端后,AdapterRegistry 不再返回该后端(已绑定 tenant 的后端禁止删除,提示先解绑)。

**Acceptance Scenarios**:

1. **Given** 运维已登录 Admin 页面, **When** 提交新增后端表单(id/name/endpoint/type/adminTokenEnvVar/capabilities), **Then** BFF 调 `HarnessStore.saveConfig()` 持久化到 JSON,返回新建配置(不含 token 明文),HarnessStore 热加载该后端
2. **Given** 后端列表已有配置, **When** 运维编辑某后端的 endpoint 或 capabilities, **Then** JSON 更新,HarnessStore 重新加载,AdapterRegistry 缓存的旧 Adapter 实例失效(下次请求创建新实例)
3. **Given** 某后端已被 tenant 绑定, **When** 运维尝试删除该后端, **Then** BFF 返回 409 冲突错误,提示"该后端已被 tenant X 绑定,请先解绑",不执行删除
4. **Given** 后端未被任何 tenant 绑定, **When** 运维删除该后端, **Then** JSON 移除该条目,HarnessStore 重新加载,列表不再包含该后端
5. **Given** 新增后端时 adminTokenEnvVar 指向的环境变量未设置, **When** HarnessStore 加载, **Then** 跳过该后端并告警(P0 已有行为),Admin 页面显示该后端状态为"未就绪(env token 缺失)"
6. **Given** 运维提交的 id 已存在, **When** 新增/编辑, **Then** 返回 409 冲突,提示 id 重复

---

### User Story 2 - 前端能力探测与条件渲染 (Priority: P2)

前端启动时通过 `useHarnessCapabilities` hook 查询当前 tenant 绑定后端的能力(capabilities),按能力条件渲染 UI。例如:后端无 canvas 能力时隐藏画布入口,无 knowledgeBase 能力时隐藏知识库菜单。

**Why this priority**: Constitution Principle II Layer 2 要求"按 capability 声明可选",前端需感知后端能力才能正确条件渲染。P3 企业版(无 canvas)接入后,前端若不探测能力会展示企业版用户无法使用的画布入口,体验差。P2 先建立能力探测基础设施,P3 直接复用。

**Independent Test**: 前端启动,`useHarnessCapabilities` 调 `GET /api/bff/capabilities`(带 X-Tenant-Id),BFF 通过 AdapterRegistry 获取 tenant 绑定后端的 capabilities 返回。前端据返回值条件渲染:canvas=true 显示画布入口,false 隐藏。切换 tenant(不同后端)后,能力探测重新查询,UI 自动调整。

**Acceptance Scenarios**:

1. **Given** tenant 绑定 intellect-rag 后端(canvas=true), **When** 前端 `useHarnessCapabilities` 查询, **Then** 返回 `{canvas: true, knowledgeBase: true, multiTenant: false, ...}`,画布入口显示
2. **Given** tenant 绑定 intellect-enterprise 后端(canvas=false,P3 场景), **When** 前端查询, **Then** 返回 `{canvas: false, ...}`,画布入口隐藏
3. **Given** tenant 不存在或未绑定后端, **When** 前端查询, **Then** 返回 404/400 明确错误,前端降级显示"未配置后端"提示
4. **Given** AdapterRegistry 未就绪(Store 未加载), **When** 前端查询, **Then** 返回 503,前端显示"服务初始化中"提示
5. **Given** 前端已获取能力, **When** tenant 切换(不同后端), **Then** `useHarnessCapabilities` 重新查询,UI 按新能力条件渲染
6. **Given** 后端 capabilities 变更(运维通过 US1 编辑), **When** 前端刷新能力探测, **Then** 返回新 capabilities,UI 调整

---

### User Story 3 - Admin 页面 UI (Priority: P2)

实现 Harness Admin 页面,展示后端列表(id/name/type/endpoint/capabilities/状态),提供新增/编辑/删除表单。表单含 id/name/type(select: intellect-rag/intellect-enterprise)/endpoint/adminTokenEnvVar/capabilities(checkbox 组)。状态列显示"就绪/未就绪(env token 缺失)"。

**Why this priority**: US1 的 CRUD 需要可视化界面,纯 API 不便运维操作。Admin 页面是 US1 的前端承载,P2 一次性交付完整的运维体验。

**Independent Test**: 运维访问 `/admin/harness-backends`,看到后端列表表格,点"新增"弹出表单,填写后提交,列表刷新显示新后端。点"编辑"修改 capabilities,提交后列表更新。点"删除"确认后移除(被绑定的后端删除按钮禁用或提示)。

**Acceptance Scenarios**:

1. **Given** 运维访问 Admin 页面, **When** 页面加载, **Then** 显示后端列表表格(id/name/type/endpoint/capabilities 摘要/状态/操作)
2. **Given** 后端列表非空, **When** 运维点"新增", **Then** 弹出表单(id/name/type/endpoint/adminTokenEnvVar/capabilities checkbox),提交后列表刷新
3. **Given** 后端列表某条目, **When** 运维点"编辑", **Then** 弹出预填表单,id 只读(不允许改 id),其他字段可编辑,提交后列表刷新
4. **Given** 后端未被 tenant 绑定, **When** 运维点"删除"并确认, **Then** 列表移除该条目
5. **Given** 后端已被 tenant 绑定, **When** 运维点"删除", **Then** 提示"该后端已被 tenant X 绑定,请先解绑",不执行删除
6. **Given** 新增/编辑表单提交失败(校验错误/冲突), **When** BFF 返回错误, **Then** 表单显示错误消息,不关闭弹窗
7. **Given** 后端 env token 缺失, **When** 列表展示, **Then** 状态列显示"未就绪(env token 缺失)"警告标识

---

### Edge Cases

- **并发编辑同一后端**:两人同时编辑,BFF 用乐观锁或 last-write-wins(P2 用 last-write-wins,简化),后者覆盖前者,提示"配置已更新"
- **新增后端时 env 变量名含特殊字符**:校验 adminTokenEnvVar 为合法环境变量名(`^[A-Z_][A-Z0-9_]*$`),拒绝非法字符
- **删除最后一个后端**:允许删除,但 tenant 未绑定后端时能力探测返回错误(US2 场景 3)
- **capabilities 全 false**:允许,前端按全 false 条件渲染(隐藏所有功能入口),提示"该后端无可用能力"
- **endpoint 格式错误**:校验 endpoint 为合法 URL(`http://` 或 `https://` 开头),拒绝非法格式
- **id 含空格/特殊字符**:校验 id 为 kebab-case(`^[a-z0-9]+(-[a-z0-9]+)*$`),拒绝非法格式
- **BFF 重启后配置丢失**:JSON 文件持久化,P0 已保证重启后配置恢复;P2 的 saveConfig 写回 JSON,重启不丢
- **前端能力探测缓存过期**:`useHarnessCapabilities` 默认不缓存(每次 mount 查询),提供手动 refresh;切换 tenant 自动重新查询

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: BFF MUST 实现 `GET /api/bff/admin/harness-backends` 返回所有后端配置列表(不含 token 明文,含就绪状态)
- **FR-002**: BFF MUST 实现 `POST /api/bff/admin/harness-backends` 新增后端配置,校验 id 唯一/kebab-case/endpoint URL/adminTokenEnvVar 格式,持久化到 JSON,触发 HarnessStore 热加载
- **FR-003**: BFF MUST 实现 `PUT /api/bff/admin/harness-backends/:id` 编辑后端配置(id 只读不可改),持久化 + 热加载,失效 AdapterRegistry 缓存
- **FR-004**: BFF MUST 实现 `DELETE /api/bff/admin/harness-backends/:id` 删除后端配置,校验未被 tenant 绑定(绑定则 409),持久化 + 热加载
- **FR-005**: BFF MUST 在后端 CRUD 后调用 `HarnessStore.saveConfig()` 持久化,并重新 `load()` 热加载
- **FR-006**: BFF MUST 实现 `GET /api/bff/capabilities` 返回当前 tenant(X-Tenant-Id)绑定后端的 capabilities,经 AdapterRegistry 获取
- **FR-007**: BFF MUST 在 AdapterRegistry 缓存的 Adapter 实例在后端配置变更后失效(下次 `getAdapterForTenant` 创建新实例)
- **FR-008**: BFF MUST 校验 adminTokenEnvVar 为合法环境变量名(`^[A-Z_][A-Z0-9_]*$`),拒绝非法格式
- **FR-009**: BFF MUST 校验 endpoint 为合法 URL(http/https),拒绝非法格式
- **FR-010**: BFF MUST 校验 id 为 kebab-case(`^[a-z0-9]+(-[a-z0-9]+)*$`),拒绝非法格式
- **FR-011**: BFF MUST 返回后端就绪状态(基于 HarnessStore.list() 是否包含该后端,env token 缺失的后端不在 list 中)
- **FR-012**: 前端 MUST 实现 `useHarnessCapabilities` hook,调 `GET /api/bff/capabilities`,返回 capabilities 或错误状态
- **FR-013**: 前端 MUST 在 `useHarnessCapabilities` 返回 canvas=false 时隐藏画布入口,knowledgeBase=false 隐藏知识库菜单
- **FR-014**: 前端 MUST 实现 Admin 页面 `/admin/harness-backends`,展示后端列表 + 新增/编辑/删除表单
- **FR-015**: 前端 Admin 页面 MUST 在删除被绑定后端时显示冲突提示,不执行删除
- **FR-016**: 前端 Admin 页面 MUST 显示后端就绪状态(就绪/未就绪 env token 缺失)
- **FR-017**: BFF harness-admin 路由 MUST 受 authMiddleware 保护(需 Authorization header),与现有 admin 路由一致
- **FR-018**: BFF capabilities 路由 MUST 受 authMiddleware + tenantContextMiddleware 保护(需 Authorization + X-Tenant-Id/X-User-Id)
- **FR-019**: BFF MUST 不在 any API 响应中返回 adminToken 明文(Constitution Token Security)
- **FR-020**: 前端 `useHarnessCapabilities` MUST 在 tenant 切换时重新查询,不使用旧 tenant 的 capabilities

### Key Entities *(include if feature involves data)*

- **HarnessBackendConfig**: P0 已定义,持久化到 `bff/data/harness-backends.json`,含 id/name/type/endpoint/adminTokenEnvVar/capabilities。P2 新增 CRUD API 暴露
- **HarnessBackendWithStatus**: P2 新增 DTO,在 HarnessBackendConfig 基础上增加 `ready: boolean` 字段(env token 是否就绪),用于 Admin 列表展示
- **CapabilitiesResponse**: P2 新增 DTO,`GET /api/bff/capabilities` 返回 `{ backendId, backendName, capabilities: HarnessCapabilities }`
- **HarnessBackendForm**: P2 新增前端表单类型,含 id/name/type/endpoint/adminTokenEnvVar/capabilities 字段,用于新增/编辑提交

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 运维通过 Admin 页面新增后端,提交后 ≤ 2 秒内列表刷新显示新后端,前端能力探测立即反映新能力
- **SC-002**: 运维编辑后端 capabilities,提交后 ≤ 2 秒内 AdapterRegistry 返回新 capabilities(旧 Adapter 缓存失效)
- **SC-003**: 删除被 tenant 绑定的后端返回 409,删除未绑定的后端成功且列表立即更新
- **SC-004**: 前端 `useHarnessCapabilities` 在 tenant 绑定 canvas=true 后端时显示画布入口,canvas=false 隐藏
- **SC-005**: 前端切换 tenant 后,`useHarnessCapabilities` 重新查询,UI 按新后端能力条件渲染(≤ 1 秒)
- **SC-006**: 任何 API 响应不含 adminToken 明文(Constitution Token Security,自动化测试验证)
- **SC-007**: BFF harness-admin + capabilities 路由单元测试覆盖率 ≥ 80%(Constitution Principle VII)
- **SC-008**: Admin 页面表单校验(id kebab-case / endpoint URL / adminTokenEnvVar 格式)在前端 + BFF 双层校验,非法输入不提交
- **SC-009**: P0/P1 功能 100% 不回归(91 个现有测试通过 + P0 透传 + P1 Agent 原生路由冒烟通过)
- **SC-010**: TypeScript 编译通过(BFF + 前端),Vitest 全部通过

## Assumptions

- HarnessStore.saveConfig() 已在 P0 实现(写回 JSON),P2 直接调用
- HarnessStore.load() 支持重复调用(热加载),P0 实现
- AdapterRegistry 的 adapterCache 需新增 invalidate(backendId) 方法,P2 扩展
- 后端就绪状态:HarnessStore.list() 只返回 env token 就绪的后端(P0 行为),P2 据此判断 ready
- Admin 页面路由 `/admin/harness-backends` 复用现有 Admin 布局(P0 已有 `/admin` 路由结构)
- 前端 `useHarnessCapabilities` 用 TanStack Query(项目已用)管理请求/缓存
- 并发编辑用 last-write-wins(P2 简化),P4+ 评估乐观锁需求
- capabilities 路由复用 P1 的 TenantContext 中间件(X-Tenant-Id/X-User-Id)
- harness-admin 路由不需要 TenantContext(运维操作,非租户隔离),仅需 authMiddleware
- 前端 Admin 页面权限:P2 不实现细粒度权限(所有登录用户可访问),P4+ 评估 admin role 限制
- 后端 CRUD 触发 HarnessStore 热加载是同步操作(load 是 async,P2 await 后返回响应)
