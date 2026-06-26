# Feature Specification: Multi-Harness P0 — BFF 接入点 + Adapter 骨架

**Feature Branch**: `001-multi-harness-p0`

**Created**: 2026-06-26

**Status**: Draft

**Input**: User description: "针对 multi-harness-design.md 的 P0 阶段(含 P0-前置)制定实施范围:建立 BFF 反向代理接入点 + Adapter 抽象层骨架 + 后端配置存储层,为 P1 Intellect RAG Adapter 重构和 P3 Intellect 企业版 Adapter 对接提供契约与基础设施。"

**Upstream References**:
- Design doc: [docs/multi-harness-design.md](file:///Users/simon/project/agentui/docs/multi-harness-design.md) §10.1 P0-前置 & P0,§十二 前端 API 迁移策略
- Constitution: [.specify/memory/constitution.md](file:///Users/simon/project/agentui/.specify/memory/constitution.md) v1.1.0

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 前端 API 流量经 BFF(透明反向代理)(Priority: P1)

作为 BFF 开发者,我希望前端所有对后端的调用都经过 BFF 透明反向代理,以便我能在 BFF 层观测全部 API 流量、统一鉴权、并为后续 P1 按域替换为 Adapter 路由提供接入点,同时前端业务代码无任何改动。

**Why this priority**: Constitution Principle I(BFF-Mediated Frontend)是 NON-NEGOTIABLE 前置。没有 BFF 接入点,P1 重构的 Adapter 无法被前端消费,整个多 Harness 方案无法启动。此 story 是 P0 的硬前置。

**Independent Test**: 切换前端 API 路径常量后,跑一遍冒烟用例(登录→Agent→Session→流式对话→画布→知识库 CRUD),全部行为与切换前一致;改回常量可瞬时回滚。

**Acceptance Scenarios**:

1. **Given** 前端 API 路径常量已切换到 BFF 代理前缀,**When** 用户执行登录、查询 Agent 列表、创建会话、发起流式对话,**Then** 所有请求经 BFF 转发到后端,响应内容与直连后端完全一致
2. **Given** BFF 代理已挂载,**When** BFF authMiddleware 校验请求,**Then** 所有代理请求都经过鉴权(未授权请求返回 401,不透传到后端)
3. **Given** 流式对话请求经 BFF 代理,**When** 后端返回 SSE 流,**Then** BFF 正确透传流式响应(不缓冲、不截断、不转 JSON),前端流式体验与直连一致
4. **Given** 代理引入故障,**When** 前端切换 API 常量回直连路径,**Then** 所有功能瞬时恢复,无需 BFF 配合
5. **Given** BFF 代理运行中,**When** 查看 BFF 日志,**Then** 能看到每条请求的 method/path/status/耗时,为 P1 重构提供观察面

---

### User Story 2 - Adapter 抽象层契约定义(Priority: P2)

作为 P1/P3 Adapter 实现者,我希望有一份明确的 `IHarnessAdapter` 接口契约和数据模型定义,以便我实现 `IntellectRagAdapter` 和 `IntellectEnterpriseAdapter` 时有统一的类型签名、能力声明格式、流式 chunk 格式,且不需关心对方后端的差异。

**Why this priority**: Constitution Principle II(Adapter Abstraction)和 Principle IV(SSE Dual-Protocol)要求两个 Adapter 共用契约。契约不定义,P1 和 P3 无法并行,且易出现类型不兼容。

**Independent Test**: 契约文件单独编译通过;用契约类型写一个 mock adapter 能通过类型检查;契约中的 `StreamChunk` 能表达两后端的所有事件类型(增量/思考链/用量/结束/错误)。

**Acceptance Scenarios**:

1. **Given** Adapter 契约已定义,**When** P1 实现 `IntellectRagAdapter`,**Then** 它能实现 `IHarnessAdapter` 接口所有必选方法,无需修改契约
2. **Given** Adapter 契约已定义,**When** P3 实现 `IntellectEnterpriseAdapter`,**Then** 它能实现 `IHarnessAdapter` + `IMultiTenantAdapter` 扩展接口,无需修改契约
3. **Given** 两个后端 SSE 协议不同,**When** 解析器产出 `StreamChunk`,**Then** `StreamChunk` 的 `type` 字段能表达 Intellect RAG(delta/done)和 Intellect 企业版(delta/reasoning/tool_start/tool_complete/tool_progress/usage/done)的所有事件,无需扩展枚举(Constitution Principle IV v1.1.0)
4. **Given** 后端能力不同,**When** `HarnessCapabilities` 声明画布/知识库/多租户等能力,**Then** 前端 `useHarnessCapabilities` 能据此条件渲染,且 BFF 能据此选择走 Adapter 还是透传
5. **Given** 多租户上下文,**When** `TenantContext` 携带 tenantId/intellectTeamId/intellectProjectId,**Then** Adapter 能据此注入 `X-Intellect-Team` / `X-Intellect-Project` 多租户头(Constitution Principle V v1.1.0),路由层不需感知

---

### User Story 3 - 后端配置与租户绑定存储(Priority: P3)

作为 BFF 运维和 P2 Admin 页面实现者,我希望有一个后端配置存储和租户绑定存储,以便 BFF 启动时能加载已声明的 Harness 后端(含 token 安全注入),且 BFF Tenant 能绑定到具体后端实例,为 P2 Admin 页面 CRUD 和 P1 Adapter Registry 选择提供数据基础。

**Why this priority**: Constitution Principle V(Tenant Isolation)要求 BFF 维护独立 Tenant 实体;`AdapterRegistry.getAdapterForTenant()` 依赖此存储。无存储层,P1 的 Registry 无从查询绑定关系。

**Independent Test**: 启动 BFF,从 JSON + 环境变量加载默认配置,`HarnessStore.list()` 返回完整后端对象(含 token);`TenantStore.setHarnessBinding()` 写入后 `getHarnessBinding()` 能读出;TypeScript 编译通过;不挂载任何新路由(现有功能不受影响)。

**Acceptance Scenarios**:

1. **Given** 默认配置 JSON 文件存在且环境变量已设置,**When** BFF 启动,**Then** `HarnessStore` 加载所有后端,token 从环境变量读取(不从 JSON),未设置环境变量的后端被跳过并告警
2. **Given** `HarnessStore` 已加载,**When** 调用 `list()`,**Then** 返回完整 `HarnessBackend` 对象数组(含 token 明文,仅存内存)
3. **Given** JSON 文件不含 token 明文,**When** 提交到版本控制,**Then** 无敏感信息泄露(只含 `adminTokenEnvVar` 引用)
4. **Given** BFF Tenant 已创建,**When** 调用 `TenantStore.setHarnessBinding(tenantId, backendId)`,**Then** 绑定关系持久化(JSON 或内存);`getHarnessBinding(tenantId)` 能读出 backendId
5. **Given** 一个 BFF Tenant 已绑定 Intellect 企业版后端且额外绑定 Intellect RAG 后端(用于画布),**When** 查询其绑定,**Then** 能区分"主后端"和"画布后端"两种绑定关系
6. **Given** 存储层已就绪,**When** 现有 BFF 路由(agent/session/admin)运行,**Then** 行为完全不变(存储层不挂载路由,只是基础设施)

---

### Edge Cases

- **代理路径冲突**:BFF 已有 `/api/agent` `/api/session` `/api/admin` 路由,代理前缀 `/api/bff/proxy/v1/*` 必须避开,不能让代理吞掉现有 BFF 原生路由
- **SSE 中断**:代理透传 SSE 时,若前端断开,BFF 必须正确取消到后端的上游请求,不能泄漏连接
- **大请求体**:知识库文档上传可能有大 body,代理必须透传 body 不限大小(或与后端一致的限制)
- **查询参数**:部分 Intellect RAG API 用 query string 传过滤参数,代理必须完整透传 query
- **CORS**:前端经 BFF 后,CORS 头由 BFF 统一处理,不能依赖后端 CORS
- **环境变量缺失**:P0 默认配置 JSON 引用的 `HARNESS_*_ADMIN_TOKEN` 未设置时,BFF 不能崩溃,只能告警并跳过该后端
- **JSON 配置文件不存在**:`bff/data/harness-backends.json` 首次启动不存在时,`HarnessStore.load()` 返回空数组,不报错(允许无后端启动)
- **重复后端 ID**:JSON 中出现重复 ID 时,后写入的覆盖先写入的,并告警
- **Tenant 绑定不存在的 backendId**:`getHarnessBinding` 返回的 backendId 在 `HarnessStore` 中不存在时,`AdapterRegistry.getAdapterForTenant` 抛出明确错误(不返回 undefined)

## Requirements *(mandatory)*

### Functional Requirements

#### P0-前置(BFF 反向代理)

- **FR-001**: BFF MUST 提供透明反向代理路由,把 `/api/bff/proxy/v1/*` 的所有 HTTP method(GET/POST/PUT/DELETE/PATCH)透传到 Intellect RAG `/api/v1/*`
- **FR-002**: 代理 MUST 透传请求 method、path、query string、headers(含 Authorization)、body,不修改不丢失
- **FR-003**: 代理 MUST 正确透传 SSE 流式响应(不缓冲、不转 JSON、Content-Type 保持 `text/event-stream`),支持客户端中途断开取消上游
- **FR-004**: 代理路由 MUST 受 BFF authMiddleware 保护(未授权返回 401,不透传)
- **FR-005**: 前端 API 路径常量切换 MUST 是单点改动(一个常量),不改动任何业务代码
- **FR-006**: Vite 开发代理 MUST 同时支持新旧两条路径(`/api/v1` 直连 + `/api/bff` 经 BFF),允许瞬时回滚
- **FR-007**: 代理 MUST 记录每条请求的 method/path/status/耗时到 BFF 日志,为 P1 重构提供观察面

#### P0(Adapter 契约)

- **FR-010**: BFF MUST 定义 `IHarnessAdapter` 接口,包含 Agent(listAgents/getAgent)、Session(createSession/listSessions/getSession/deleteSession)、Message 流式(sendMessage/cancelMessage)、Health(healthCheck/discoverCapabilities)四组方法
- **FR-011**: BFF MUST 定义 `IMultiTenantAdapter` 扩展接口,包含 Team CRUD + 成员管理、Project CRUD + 成员管理(供 Intellect 企业版 Adapter 实现)
- **FR-012**: BFF MUST 定义 `TenantContext` 类型,携带 tenantId/userId/intellectTeamId/intellectProjectId(可选 intellectSessionId/intellectSessionKey),用于 Adapter 注入 `X-Intellect-Team` / `X-Intellect-Project` 等多租户头(Constitution Principle V v1.1.0)
- **FR-013**: BFF MUST 定义 `HarnessCapabilities` 类型,声明 canvas/knowledgeBase/memory/mcp/multiTenant/modelManagement 六个能力 flag
- **FR-014**: BFF MUST 定义 `StreamChunk` 类型,`type` 枚举为 `delta|reasoning|tool_start|tool_complete|tool_progress|usage|done|error`(8 值),覆盖两后端所有事件(详见 Constitution Principle IV v1.1.0)
- **FR-015**: BFF MUST 定义 `AgentSummary`、`Session`、`Team`、`Project`、`TeamMember`、`ProjectMember` 数据模型(供 Adapter 方法签名使用)
- **FR-016**: 契约文件 MUST 在不依赖任何具体 Adapter 实现的情况下独立编译通过

#### P0(存储层)

- **FR-020**: BFF MUST 实现 `HarnessStore`,从 JSON 文件加载后端配置,从环境变量加载 token,内存合并为完整 `HarnessBackend` 对象
- **FR-021**: JSON 文件 MUST NOT 存储 token 明文,只存 `adminTokenEnvVar` 引用;token 明文仅存在于运行时内存
- **FR-022**: `HarnessStore` MUST 支持 `list()`、`get(id)`、`saveConfig(config)`、`load()` 四个方法
- **FR-023**: `HarnessStore` MUST 在环境变量缺失时跳过该后端并告警,不抛异常中断启动
- **FR-024**: BFF MUST 实现 `TenantStore`,维护 BFF Tenant 实体和 Tenant↔Backend 绑定关系
- **FR-025**: `TenantStore` MUST 支持 `createTenant`、`getTenant`、`listTenants`、`setHarnessBinding`、`getHarnessBinding`、`setCanvasBinding`、`getCanvasBinding` 方法
- **FR-026**: 一个 BFF Tenant MUST 支持绑定一个主后端(任意类型)+ 可选一个画布后端(必须是 Intellect RAG 类型)
- **FR-027**: BFF 启动时 MUST 创建默认配置文件 `bff/data/harness-backends.json`,包含一个默认 Intellect RAG 后端条目(端点 `localhost:9380`,token env var `HARNESS_INTELLECT_RAG_ADMIN_TOKEN`)
- **FR-028**: `.env.example` MUST 新增 `HARNESS_INTELLECT_RAG_ADMIN_TOKEN`、`HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY`、`VITE_BFF_BASE` 三个变量样例(Constitution Principle VIII v1.1.0:P0-P3 企业版鉴权统一用 `API_SERVER_KEY`,不引入 `imt_p_*` 项目级 token)

### Key Entities *(include if feature involves data)*

- **HarnessBackend**: 一个 Harness 后端实例,含 id/name/type/endpoint/capabilities/status/adminTokenEnvVar(配置层)+ adminToken(运行时)
- **BffTenant**: BFF 维护的租户实体,含 id/name/createdAt/updatedAt,绑定到一个 Intellect 企业版 Tenant 实例
- **TenantBackendBinding**: 租户与后端的绑定关系,区分"主后端"和"画布后端"两种角色
- **IHarnessAdapter**: Adapter 契约接口,所有后端必选实现核心层
- **IMultiTenantAdapter**: 多租户扩展契约,仅 Intellect 企业版实现
- **TenantContext**: 请求上下文,携带租户/用户/Intellect 侧 team/project 标识
- **HarnessCapabilities**: 后端能力声明,前端据此条件渲染
- **StreamChunk**: BFF 统一流式输出格式,两后端解析后产出

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 前端 API 路径常量切换后,所有现有功能(登录/Agent/Session/流式对话/画布/知识库/Admin)100% 行为不变,冒烟用例全部通过
- **SC-002**: BFF 代理透传 SSE 流式对话,前端感知的"首字延迟"与直连后端相比增加不超过 50ms(本地环境)
- **SC-003**: BFF 日志能 100% 记录经代理的请求(method/path/status/耗时),P1 重构前有完整观察面
- **SC-004**: Adapter 契约文件独立编译通过,用契约写一个 mock adapter 能通过类型检查(零类型不兼容)
- **SC-005**: `StreamChunk` 类型枚举(8 个 type 值)能 100% 表达 Intellect RAG 和 Intellect 企业版两后端的所有 SSE 事件,无需 P3 时回头扩展枚举
- **SC-006**: BFF 启动时 `HarnessStore` 能加载默认配置,`list()` 返回 1 个默认 Intellect RAG 后端,token 从环境变量读取
- **SC-007**: JSON 配置文件提交到版本控制,扫描确认零 token 明文泄露
- **SC-008**: 一个 BFF Tenant 能同时绑定主后端 + 画布后端,`getHarnessBinding` 和 `getCanvasBinding` 分别返回正确 backendId
- **SC-009**: P0 完成后,现有 BFF 路由(agent/session/admin/health)行为 100% 不变,无回归
- **SC-010**: TypeScript 编译零错误,`bff/` 目录 `tsc --noEmit` 通过

## Assumptions

- **目标用户是开发者与后续 phase**,P0 不直接服务终端用户,User Story 中的"用户"指 BFF 开发者/P1 实现者/Admin 管理员
- **Intellect RAG 后端可达**:P0-前置默认配置假设 Intellect RAG 运行在 `localhost:9380`,环境由开发者本地启动
- **前端业务代码零改动**:"零改动"指业务逻辑零改动,API 路径常量改动(一行)不计入,这是 Constitution Principle I 明确的例外
- **环境变量管理**:开发者本地通过 `.env` 文件管理环境变量,生产环境通过部署平台注入,P0 不涉及生产部署
- **现有 BFF 路由保留**:P0 不删除/不改写现有 `agent.ts`/`session.ts`/`admin.ts`/`health.ts` 路由,只在 `index.ts` 新增挂载代理路由
- **Intellect 企业版后端暂不可达**:P0 不要求 Intellect 企业版(:8642)实际运行,默认配置只含 Intellect RAG;企业版后端条目在 P3 实施时通过 Admin 页面新增
- **回滚策略**:P0-前置的回滚机制是"前端 API 常量改回 `/api/v1`",BFF 代理路由保留不影响;P0 存储层的回滚是"删除新文件",不涉及现有路由
- **依赖 Constitution**:本 spec 不重复 Constitution 已锁定的技术决策(命名/目录/SSE 双协议/Token 安全),只声明 WHAT,技术细节由 Constitution + design doc 提供
- **P0 范围严格边界**:P0 不实现 IntellectRagAdapter / IntellectEnterpriseAdapter / Adapter Registry / 任何新路由(除代理)/ 任何前端 Admin 页面 / useHarnessCapabilities hook —— 这些分别属于 P1/P2/P3
