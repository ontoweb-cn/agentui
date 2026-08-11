# Cognitive Wargame Agent 前端开发文档

> **文档编号**：CW-FE-AGENT-001 | **版本**：v1.1 | **日期**：2026-08-10
> **适用范围**：agentui 仓库 `src/features/cognitive-wargame/` 插件下的 Agent 管理模块（G-16）
> **文档定位**：基于已落地实现梳理 Agent 前端开发约定，供后续维护、二次开发与跨团队协作参考
> **v1.1 主要变更**（技术评审修复）：
> - 修正 §3.4 关系路由数量描述（前端 api.ts 实现 9/11 条，未封装单条关系查询与更新）
> - 修正 §7.2 GraphView 集成状态描述（设计计划声称已完成但实际代码未集成，标注冲突）
> - 修正 §11.5 场景引用端点与 register_agent 功能描述（区分 link_scenario_agent 与 register_agent）
> - 补充 §5.1 status 类型与 DB schema 不一致说明（DB 允许 inactive，链路未暴露）
> - 修正 §6.3 Store 错误处理描述（区分 try/catch + throw 双重处理与自然抛出两种模式）
> - 补充 §7.1.2 表单字段限制说明（仅 5 字段，avatar/attributes/status 不可编辑）
> - 补充 §7.1.2 parent_agent_id 前端未做格式校验说明
> - 修正 §3.3 / §11.2 "斜杠非连字符"表述歧义
> - 修正 §1.2 "不缓存主数据"表述为"不持久化"
> - 补充 §9 i18n 跨命名空间复用说明（approval.all 跨模块耦合）
> - 补充 §7.3 AgentTypePage 用 status.archived 表示 !is_active 的语义错误
> - 补充 §10.2 端到端验证脚本（seed_society_agents.py / migrate_agents_to_table.py）
> - 补充 §7.1.2 空字符串提交显式清空字段（发送 null）说明
> - 调整依赖文档列表：移除 skills-api-reference.md（非直接依赖）
> **依赖文档**（cognitive-wargame 仓库）：
> - [agent-features-overview.md](file:///Users/simon/project/cognitive-wargame/docs/agent-features-overview.md)（Agent 与推演 / Skills / 管理功能总览）
> - [agent-table-redesign-plan.md](file:///Users/simon/project/cognitive-wargame/docs/agent-table-redesign-plan.md)（双层 Agent 表改造实施计划，§12 前端 UI 方案）
> - [intellect-agent-registry-design-requirement.md](file:///Users/simon/project/cognitive-wargame/docs/intellect-agent-registry-design-requirement.md)（通用 Agent 注册表设计需求，§5.2 路由契约）
> - [intellect-team-gateway-integration-requirements.md](file:///Users/simon/project/cognitive-wargame/docs/intellect-team-gateway-integration-requirements.md)（GATEWAY 外部依赖对接需求，GATEWAY-3）
>
> **同仓库相关文档**（非直接依赖，供参考）：
> - [skills-api-reference.md](file:///Users/simon/project/cognitive-wargame/docs/skills-api-reference.md)（Skills 资源 API 参考，与本模块无直接交互）
> **关联实现**（agentui 仓库）：
> - [src/features/cognitive-wargame/api.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/api.ts)
> - [src/features/cognitive-wargame/store.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/store.ts)
> - [src/features/cognitive-wargame/pages/AgentListPage.tsx](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentListPage.tsx)
> - [src/features/cognitive-wargame/pages/AgentDetailPage.tsx](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentDetailPage.tsx)
> - [src/features/cognitive-wargame/pages/AgentTypePage.tsx](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentTypePage.tsx)

---

## 0. 目录

1. [整体定位](#一整体定位)
2. [调用链路与架构](#二调用链路与架构)
3. [接口契约](#三接口契约)
4. [前端模块结构](#四前端模块结构)
5. [类型定义](#五类型定义)
6. [状态管理（Store）](#六状态管理store)
7. [页面实现](#七页面实现)
8. [错误处理与边界](#八错误处理与边界)
9. [国际化（i18n）](#九国际化i18n)
10. [测试与验证](#十测试与验证)
11. [开发约定与注意事项](#十一开发约定与注意事项)

---

## 一、整体定位

### 1.1 模块范围

本模块属于 `cognitive-wargame` 插件下的 **Agent 注册表管理**（任务编号 **G-16**），负责在 agentui 前端提供 Agent 身份、组织关系、类型字典的可视化管理能力。

**包含能力**：

| 能力 | 实现页面 | 路由 |
|---|---|---|
| Agent 列表（过滤/搜索/创建/编辑/删除） | `AgentListPage.tsx` | `/cognitive-wargame/agents` |
| Agent 详情（基本信息/组织关系/扩展属性） | `AgentDetailPage.tsx` | `/cognitive-wargame/agents/:id` |
| Agent 类型字典（5 类种子数据展示） | `AgentTypePage.tsx` | `/cognitive-wargame/agent-types` |

**不包含能力**（由其他模块或后端脚本承担）：

- Agent 身份主数据持久化：由 intellect-team 侧 `intellect_agents` 表承担，前端仅通过代理透传 CRUD
- Agent 运行时状态（attitudes / emotional_state / war_anxiety / sir_state）：属于推演运行时数据，由 `wargame.agent_states` 表承担，前端经态势分析/回放页面查看
- Agent 批量录入与迁移：由 cognitive-wargame 侧脚本（`scripts/seed_named_agents.py` / `scripts/seed_society_agents.py` / `scripts/migrate_agents_to_table.py`）完成，不通过前端 UI
- 场景-Agent 引用绑定（`wargame.scenario_agent_refs`）：由想定详情页承担，不在本模块

### 1.2 设计原则

- **平台无关**：前端字段对齐 `intellect_agents` 通用表，不耦合认知域业务字段（如 stance / narrative_valence），便于未来迁移到其他 Agent 平台
- **代理透传**：前端不持久化主数据到本地存储（localStorage），运行时仅在 Zustand store 内存缓存；所有 CRUD 经 cognitive-wargame wargamesrv 代理到 intellect-gateway，保证数据一致性
- **复用既有组件**：优先复用 `@/components/ui/*` shadcn/ui 基础组件与插件内 `GraphView`，不引入新依赖
- **最小化状态**：仅维护列表、当前选中、关系列表、类型字典等必要状态，避免与 TanStack Query 重复

---

## 二、调用链路与架构

### 2.1 整体调用链路

```
┌─────────────────────────────────────────────────────────────────┐
│  agentui SPA (React)                                             │
│  src/features/cognitive-wargame/                                 │
│   └ pages/AgentListPage.tsx                                      │
│      └ useWargameStore (Zustand)                                 │
│         └ api.ts (axios, baseURL /api/v1/wargame)                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP（Vite proxy / Nginx 反代）
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  cognitive-wargame wargamesrv (FastAPI, :9385)                 │
│  wargamesrv/apps/restful_apis/agents_api.py                    │
│  - 11 条代理路由（prefix /api/v1/wargame/agents）                │
│  - 认证透传 + tenant_id 一致性校验                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ httpx + Bearer token
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  intellect-gateway (Rust, :8642)                                 │
│  /v1/intellect/agents*  （11 条原生 Rust handler 路由）           │
│  - RBAC：写操作需 Admin/Owner，Profile 模式 bypass               │
│  - tenant_id 来自 Bearer token 的 AuthContext                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 进程内调用（sqlx + PgPool）
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  PostgreSQL                                                      │
│  public.intellect_agents / intellect_agent_types /               │
│         intellect_agent_relations                                │
└─────────────────────────────────────────────────────────────────┘
```

> **端口对应**：wargamesrv `:9385`（FastAPI，cognitive-wargame 仓库），intellect-gateway `:8642`（Rust，intellect-team 仓库）。前端开发时通过 Vite proxy 将 `/api/v1/wargame` 代理到 wargamesrv `:9385`，wargamesrv 再用 httpx 转发到 gateway `:8642`。

### 2.2 前端分层架构

```
┌─ Pages（React 组件，路由层）
│   ├─ AgentListPage.tsx        列表 + 过滤 + 创建/编辑/删除 Dialog
│   ├─ AgentDetailPage.tsx      详情 + 关系管理 + 属性展示
│   └─ AgentTypePage.tsx        类型字典只读展示
│
├─ Store（Zustand，状态层）
│   └─ useWargameStore          统一管理 agents/currentAgent/agentRelations/agentTypes
│                                + fetchAgents/loadAgent/createAgent/updateAgent/deleteAgent
│                                + loadAgentRelations/createAgentRelation/deleteAgentRelation
│                                + fetchAgentTypes
│
├─ API（axios 客户端，数据层）
│   └─ api.ts                   createWargameClient + unwrap()
│       └─ getAgents/getAgent/createAgent/updateAgent/deleteAgent
│       └─ getAgentRelations/createAgentRelation/deleteAgentRelation
│       └─ getAgentTypes
│
└─ Components（UI 复用层）
    ├─ @/components/ui/*         shadcn/ui（Button/Card/Table/Dialog/Tabs/Input/Label/Select/Badge/Spin）
    ├─ @/components/empty        EmptyCard 空状态
    └─ ./components/GraphView    @antv/g6 关系图（Agent 节点绿色 #10b981）
```

### 2.3 关键依赖关系

| 依赖项 | 版本 | 用途 |
|---|---|---|
| React | 18 | 函数组件 + Hooks |
| React Router | 7 | `useNavigate` / `useParams` 懒加载路由 |
| Zustand | 5 | 客户端状态管理 |
| axios | 1.x | HTTP 客户端 |
| i18next | 23+ | 国际化 |
| @antv/g6 | 5 | 关系图渲染（GraphView 复用） |
| shadcn/ui | 内置 | 基础组件库 |

---

## 三、接口契约

> **来源**：cognitive-wargame [intellect-agent-registry-design-requirement.md §5.2.2](file:///Users/simon/project/cognitive-wargame/docs/intellect-agent-registry-design-requirement.md) 与 [agents_api.py](file:///Users/simon/project/cognitive-wargame/wargamesrv/apps/restful_apis/agents_api.py)。
> **共 11 条路由**，前缀 `/api/v1/wargame/agents`，由 wargamesrv 代理到 gateway `/v1/intellect/agents*`。

### 3.1 通用约定

| 项 | 说明 |
|---|---|
| Base URL | `/api/v1/wargame`（由 Vite proxy 代理到 wargamesrv :9385） |
| 认证 | `Authorization: Bearer <token>`（从 `localStorage[Authorization]` 读取，由请求拦截器自动注入） |
| Content-Type | `application/json` |
| 响应格式 | JSON（gateway 直接返回 Tool 的 dict 结果，不使用 `{code, data, message}` 包装；前端 `unwrap()` 自动兼容两种形态） |
| 超时 | 300000ms（5 分钟，沿用 wargameClient 配置） |
| `agent_id` 格式 | `^[a-z0-9][a-z0-9_-]{0,127}$`（前端 + wargamesrv + gateway 三层校验） |
| `relation_id` 格式 | `^[A-Za-z0-9_-]{1,128}$`（gateway 生成 `rel-{uuid}` 形式） |

### 3.2 Agent CRUD（5 条）

#### 3.2.1 查询 Agent 列表

```
GET /api/v1/wargame/agents
```

**Query 参数**

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `agent_type` | string | 否 | — | 类型过滤：individual/admin_organ/political_party/news_media/mass |
| `status` | string | 否 | — | 状态过滤：active/archived |
| `parent_agent_id` | string | 否 | — | 按父 Agent 过滤 |
| `limit` | int | 否 | 20 | 1~100（wargamesrv 强制约束） |
| `offset` | int | 否 | 0 | 分页偏移 |

**响应**

```typescript
{
  agents: Agent[];   // Agent 结构见 §5.1
  total: number;
  limit: number;
  offset: number;
}
```

**错误码**

| HTTP | 含义 |
|---|---|
| 400 | `parent_agent_id` 格式非法 |
| 503 | wargamesrv → gateway 不可达 |

#### 3.2.2 查询 Agent 详情

```
GET /api/v1/wargame/agents/{agent_id}
```

**响应**：`Agent` 对象（含 `attributes` JSONB 字段）。

**错误码**：404 不存在 / 400 ID 格式非法 / 503 网关不可达。

#### 3.2.3 创建 Agent

```
POST /api/v1/wargame/agents
```

**请求体**

```typescript
{
  agent_id: string;        // 必填，唯一，格式 ^[a-z0-9][a-z0-9_-]{0,127}$
  name: string;            // 必填，≤256 字符
  agent_type: 'individual' | 'admin_organ' | 'political_party' | 'news_media' | 'mass';
  parent_agent_id?: string;  // 可选，父 Agent ID
  bio?: string;              // 可选，简介 ≤4096 字符
  avatar?: string;           // 可选，头像 URL ≤1024 字符
  attributes?: Record<string, unknown>;  // 可选，通用扩展属性 JSONB
}
```

**响应**：201 + `Agent` 对象。

**请求体序列化**：wargamesrv 使用 `model_dump(exclude_none=True)`（[agents_api.py L270](file:///Users/simon/project/cognitive-wargame/wargamesrv/apps/restful_apis/agents_api.py)），即 `None` 值字段不会发送到 gateway。前端 `createAgent` 传入 `undefined` 时 axios 会自动忽略，行为一致。

**tenant 一致性校验**：wargamesrv 会校验回包 `tenant_id` 与 `INTELLECT_TENANT_ID` 一致，不一致返回 500（防止 `GATEWAY_API_TOKEN` 绑定的 tenant 与 intellect-team 实例不一致导致数据隔离问题）。

#### 3.2.4 更新 Agent

```
PUT /api/v1/wargame/agents/{agent_id}
```

**请求体**（字段缺省表示不更新；`null` 显式清空）

```typescript
{
  name?: string;
  agent_type?: 'individual' | 'admin_organ' | 'political_party' | 'news_media' | 'mass';
  parent_agent_id?: string | null;  // null 显式清空
  bio?: string | null;
  avatar?: string | null;
  attributes?: Record<string, unknown>;
  status?: 'active' | 'archived';
}
```

**响应**：200 + 更新后的 `Agent` 对象。

#### 3.2.5 删除 Agent

```
DELETE /api/v1/wargame/agents/{agent_id}?hard={bool}
```

| Query | 类型 | 默认 | 说明 |
|---|---|---|---|
| `hard` | bool | false | `true` 硬删除；默认软删除（`status=archived`） |

**响应**：`{ deleted: boolean }`。

### 3.3 Agent 类型字典（1 条）

```
GET /api/v1/wargame/agents/types?active={bool}
```

> **路由注意**：前端请求路径为 `/api/v1/wargame/agents/types`（wargamesrv 侧嵌套路由），wargamesrv 代理到 gateway `/v1/intellect/agent-types`。注意 gateway 路径用 `/` 分段为 `intellect/agent-types`，**非**用 `-` 拼成单段 `intellect-agent-types`（参见 [agents_api.py L303-304](file:///Users/simon/project/cognitive-wargame/wargamesrv/apps/restful_apis/agents_api.py)）。

**Query 参数**

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `active` | bool | true | 仅返回启用项 |

**响应**（两种形态，前端 store 已兼容）

```typescript
// 形态 1：数组
AgentType[]

// 形态 2：对象包装
{ types: AgentType[] }
```

**5 类种子数据**：`individual`（个人）/ `admin_organ`（行政机关）/ `political_party`（政党）/ `news_media`（新闻媒体）/ `mass`（群众）。

### 3.4 Agent 关系管理（5 条）

> **实现状态说明**：wargamesrv 侧完整实现 5 条路由（对齐 gateway 11 条总数中的 5 条关系路由），但前端 [api.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/api.ts) 仅封装 **3 条**（§3.4.1 列表、§3.4.2 建立、§3.4.5 删除）。**§3.4.3 单条详情**与 **§3.4.4 更新关系**当前未在前端封装，仅作为契约保留，如需使用需扩展 `api.ts`。

#### 3.4.1 查询关系列表

```
GET /api/v1/wargame/agents/{agent_id}/relations?direction={string}
```

| Query | 类型 | 默认 | 说明 |
|---|---|---|---|
| `direction` | string | `outgoing` | `outgoing` / `incoming` / `both` |

**响应**

```typescript
{
  relations: AgentRelation[];
  total: number;
}
```

#### 3.4.2 建立关系

```
POST /api/v1/wargame/agents/{agent_id}/relations
```

**请求体**

```typescript
{
  source_agent_id: string;  // 必须等于 path 的 {agent_id}，否则 gateway 返回 422
  target_agent_id: string;
  relation_type: 'employed_by' | 'spokesperson_of' | 'member_of' | 'subsidiary_of' | 'belongs_to';
  valid_from?: string;  // ISO8601 日期
  valid_to?: string;
  attributes?: Record<string, unknown>;
}
```

**关系语义**

| 关系类型 | 语义 |
|---|---|
| `employed_by` | source 受雇于 target（记者→媒体） |
| `spokesperson_of` | source 是 target 的发言人 |
| `member_of` | source 是 target 的成员（党员→政党） |
| `subsidiary_of` | source 是 target 的下属机构 |
| `belongs_to` | 通用归属（兜底） |

**响应**：201 + `AgentRelation` 对象。

#### 3.4.3 查询关系详情

> **前端未实现**：[api.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/api.ts) 未封装 `getAgentRelation`，当前页面通过列表接口获取所有关系，无需单条查询。如需使用可直接调用 `client.get(`/agents/${agentId}/relations/${relationId}`)`。

```
GET /api/v1/wargame/agents/{agent_id}/relations/{relation_id}
```

**响应**：`AgentRelation` 对象。

#### 3.4.4 更新关系

> **前端未实现**：[api.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/api.ts) 未封装 `updateAgentRelation`，当前页面不支持编辑关系有效期与 attributes。如需使用需扩展 `api.ts` 新增 `updateAgentRelation` 方法。

```
PUT /api/v1/wargame/agents/{agent_id}/relations/{relation_id}
```

**请求体**：`{ valid_from?, valid_to?, attributes? }`（均可 `null` 显式清空）。

#### 3.4.5 删除关系

```
DELETE /api/v1/wargame/agents/{agent_id}/relations/{relation_id}
```

**响应**：`{ deleted: boolean }`。

### 3.5 错误码汇总

| HTTP | 场景 | 前端处理 |
|---|---|---|
| 400 | `agent_id` / `relation_id` 格式非法 | 表单提交前用正则拦截，避免发请求 |
| 401 | token 失效 | 由 axios 拦截器统一跳登录（沿用 wargameClient） |
| 403 | RBAC 不足（写操作需 Admin/Owner） | 提示用户权限不足 |
| 404 | Agent / 关系不存在 | 列表自动刷新，详情页提示"不存在"并返回列表 |
| 409 | 关系三元组唯一约束冲突 | 提示"关系已存在" |
| 422 | `source_agent_id` 与 path `agent_id` 不一致 | 表单提交前校验 |
| 500 | tenant_id 不一致 / 内部错误 | 提示联系管理员校对 `GATEWAY_API_TOKEN` |
| 503 | wargamesrv → gateway 不可达 | 提示"Agent 服务不可达，请稍后重试" |

---

## 四、前端模块结构

### 4.1 目录布局

```
src/features/cognitive-wargame/
├── api.ts                       # axios 客户端 + 类型定义 + api 对象
├── store.ts                     # Zustand store（含 Agent 相关 state/actions）
├── routes.ts                    # 路由配置（Agents/AgentDetail/AgentTypes）
├── manifest.ts                  # 插件清单（含 agents 导航项）
├── components/
│   ├── GraphView.tsx            # @antv/g6 关系图（复用，Agent 节点绿色）
│   ├── MetricsChart.tsx
│   └── section-menu.tsx
├── hooks/
│   └── use-sse-events.ts        # SSE 事件订阅（含 agent.acted 事件）
├── locales/
│   ├── zh.ts                    # cognitiveWargame.agents.* 中文词条
│   └── en.ts                    # 英文对称翻译
└── pages/
    ├── AgentListPage.tsx        # 列表页
    ├── AgentDetailPage.tsx      # 详情页
    └── AgentTypePage.tsx        # 类型字典页
```

### 4.2 路由配置

路由路径常量集中定义在 [routes.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/routes.ts)，使用 `LazyRouteConfig` 形式懒加载：

```typescript
export const WargameRoutes = {
  // ...
  Agents: '/cognitive-wargame/agents',
  AgentDetail: '/cognitive-wargame/agents/:id',
  AgentTypes: '/cognitive-wargame/agent-types',
} as const;

export const WargamePath = {
  agentDetail: (id: string) => `/cognitive-wargame/agents/${id}`,
  agentTypes: () => '/cognitive-wargame/agent-types',
};

// 路由配置数组
{ path: WargameRoutes.Agents,      Component: () => import('./pages/AgentListPage') },
{ path: WargameRoutes.AgentDetail, Component: () => import('./pages/AgentDetailPage') },
{ path: WargameRoutes.AgentTypes,  Component: () => import('./pages/AgentTypePage') },
```

### 4.3 导航项

在 [manifest.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/manifest.ts) 的 `nav` 数组中，Agent 项位于 Scenarios 之后、Rounds 之前：

```typescript
{
  path: WargameRoutes.Agents,
  labelKey: 'cognitiveWargame.nav.agents',
  pathMap: [WargameRoutes.Agents, WargameRoutes.AgentDetail, WargameRoutes.AgentTypes],
  testId: 'nav-cw-agents',
},
```

`pathMap` 包含三个路径，确保在列表页、详情页、类型字典页任一页面时导航项都能高亮。

---

## 五、类型定义

类型集中定义在 [api.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/api.ts) 顶部，与后端 `intellect_agents` / `intellect_agent_relations` / `intellect_agent_types` 表结构对齐。

### 5.1 Agent（对应 `intellect_agents` 表）

```typescript
export interface Agent {
  agent_id: string;
  name: string;
  agent_type:
    | 'individual'
    | 'admin_organ'
    | 'political_party'
    | 'news_media'
    | 'mass';
  parent_agent_id?: string | null;
  bio?: string | null;
  avatar?: string | null;
  attributes?: Record<string, unknown>;
  status?: 'active' | 'archived';
  tenant_id?: string;
  created_at?: string;
  updated_at?: string;
}
```

**字段约定**（与 [intellect-agent-registry-design-requirement.md §2.2](file:///Users/simon/project/cognitive-wargame/docs/intellect-agent-registry-design-requirement.md) 对齐）：

| 字段 | 说明 | 示例 |
|---|---|---|
| `agent_id` | 全局唯一，命名规则 `<scope>_<entity>[_<seq>]` | `us_president_trump` / `cn_cctv` / `mass_east_0042` |
| `agent_type` | 5 类种子之一 | `individual` |
| `parent_agent_id` | 简化的 1:1 归属（可选） | 某发言人 → 机关 |
| `attributes` | JSONB 通用扩展属性（非业务字段） | `{ "role": "总统", "country": "US" }` |

> **注意**：`attributes` 仅承载**平台无关**通用属性（occupation / region / channel_type 等）。认知域业务字段（stance_on_unification / narrative_valence / cognitive_attrs 等）由 cognitive-wargame 自建表 `wargame.agents` 承担，**不在此接口暴露**。

> **status 字段一致性风险**：前端类型 `status?: 'active' | 'archived'`（2 值），wargamesrv [agents_api.py L65](file:///Users/simon/project/cognitive-wargame/wargamesrv/apps/restful_apis/agents_api.py) `AgentStatusLiteral = Literal["active", "archived"]`（2 值），但 DB schema（[intellect-agent-registry-design-requirement.md §2.2](file:///Users/simon/project/cognitive-wargame/docs/intellect-agent-registry-design-requirement.md)）允许 3 值：`CHECK (status IN ('active','inactive','archived'))`。`inactive` 状态当前在链路中未暴露，若 gateway 直接写入 `inactive`，前端无法正确显示（会 fallback 到 defaultValue）。如需支持需同步扩展前端类型 + wargamesrv Literal + i18n 词条 `agents.status.inactive`。

### 5.2 AgentRelation（对应 `intellect_agent_relations` 表）

```typescript
export interface AgentRelation {
  relation_id: string;
  source_agent_id: string;
  target_agent_id: string;
  relation_type:
    | 'employed_by'
    | 'spokesperson_of'
    | 'member_of'
    | 'subsidiary_of'
    | 'belongs_to';
  valid_from?: string | null;
  valid_to?: string | null;
  attributes?: Record<string, unknown>;
  created_at?: string;
}
```

### 5.3 AgentType（对应 `intellect_agent_types` 表）

```typescript
export interface AgentType {
  type_code: string;
  type_name: string;
  parent_type_code?: string | null;
  description?: string | null;
  sort_order: number;
  is_active: boolean;
}
```

### 5.4 列表响应类型

```typescript
export interface AgentList {
  agents: Agent[];
  total: number;
  limit: number;
  offset: number;
}

export interface AgentRelationList {
  relations: AgentRelation[];
  total: number;
}
```

---

## 六、状态管理（Store）

状态由 [store.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/store.ts) 的 `useWargameStore` 统一管理，采用 Zustand `create` 模式。Agent 相关 state 与 actions 注入到既有 wargame store 中。

### 6.1 State 字段

```typescript
interface WargameState {
  // ...既有字段（scenarios / currentScenario / loading / sseConnected 等）

  // Agent 相关
  agents: Agent[];                  // 列表
  currentAgent: Agent | null;       // 当前选中的 Agent 详情
  agentRelations: AgentRelation[];  // 当前 Agent 的关系列表
  agentTypes: AgentType[];          // 类型字典
  agentsLoading: boolean;           // 列表加载态
  typesLoading: boolean;            // 类型字典加载态
}
```

### 6.2 Actions

| Action | 签名 | 说明 |
|---|---|---|
| `fetchAgents` | `(params?: { agent_type?; status? }) => Promise<void>` | 拉取列表，自动 `limit: 100` |
| `loadAgent` | `(agentId: string) => Promise<void>` | 加载单个详情，写入 `currentAgent` |
| `createAgent` | `(data) => Promise<void>` | 创建后自动刷新列表 |
| `updateAgent` | `(agentId, data) => Promise<void>` | 更新后自动重新加载详情 |
| `deleteAgent` | `(agentId, hard?) => Promise<void>` | 删除后自动刷新列表 |
| `loadAgentRelations` | `(agentId) => Promise<void>` | 加载关系列表（direction: both） |
| `createAgentRelation` | `(agentId, data) => Promise<void>` | 建立关系后自动刷新关系列表；失败时 `throw err` |
| `deleteAgentRelation` | `(agentId, relationId) => Promise<void>` | 删除关系后自动刷新；失败时 `throw err` |
| `fetchAgentTypes` | `() => Promise<void>` | 拉取类型字典，兼容数组与 `{types}` 两种形态 |

### 6.3 状态流转约定

- **列表过滤变化** → 组件 `useEffect` 监听 `typeFilter` / `statusFilter` → 调 `fetchAgents({ agent_type, status })`
- **创建/编辑提交** → 调 `createAgent` / `updateAgent` → 成功后关闭 Dialog，store 自动刷新；失败时保留 Dialog，错误由页面组件的 `try/catch` 捕获并写入本地 `error` state
- **删除** → `confirm()` 二次确认 → 调 `deleteAgent` → store 自动刷新列表
- **关系建立/删除** → store 内部自动 `api.getAgentRelations(agentId, 'both')` 刷新 `agentRelations`，避免页面手动 refetch
- **错误传递**（两种模式，需区分）：

| Action | try/catch | error 写入 `state.error` | throw err | 页面处理 |
|---|---|---|---|---|
| `fetchAgents` | ✅ | ✅ | ❌ | 监听 `state.error` 或本地 `setError` |
| `loadAgent` | ✅ | ✅ | ❌ | 同上 |
| `createAgent` | ❌ | ❌ | 自然抛出 | 页面 `try/catch` 捕获，写入本地 `error` |
| `updateAgent` | ❌ | ❌ | 自然抛出 | 同上 |
| `deleteAgent` | ❌ | ❌ | 自然抛出 | 同上 |
| `loadAgentRelations` | ✅ | ✅ | ❌ | 监听 `state.error` |
| `createAgentRelation` | ✅ | ✅ | ✅ throw err | **双重处理**：store 写 `state.error` + 页面 `try/catch` 写本地 `error` |
| `deleteAgentRelation` | ✅ | ✅ | ✅ throw err | 同上 |

> **潜在问题**：`createAgentRelation` / `deleteAgentRelation` 同时执行 `set({ error })` 与 `throw err`，导致错误被双重处理。页面 `setError` 会覆盖 store 的 `error`（但两者生命周期不同：store `error` 是全局，页面 `error` 是组件局部）。建议后续重构为统一一种模式（推荐：action 仅 throw，由页面统一处理），避免混淆。

### 6.4 与 TanStack Query 的边界

本模块**未使用** TanStack Query，原因：

1. Agent 数据低频变更，无实时性要求
2. 列表过滤参数简单，无需 Query 的 `queryKey` 复杂缓存
3. 详情页通过路由参数加载，store 内 `currentAgent` 已足够

如未来需要多视图共享 Agent 数据或引入乐观更新，可迁移到 TanStack Query，store 退化为写操作触发器。

---

## 七、页面实现

### 7.1 AgentListPage（列表页）

**文件**：[AgentListPage.tsx](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentListPage.tsx)

**职责**：Agent 列表展示、过滤、搜索、创建/编辑/删除入口。

#### 7.1.1 页面布局

```
┌─ flex flex-col gap-4 p-6 ─────────────────────────────────────┐
│ [标题: Agent 管理] [新建 Agent] [刷新]                          │
│ error 提示（如有）                                              │
│ ┌─ Card ───────────────────────────────────────────────────┐  │
│ │ CardTitle: Agent 管理 (count)                            │  │
│ │ [类型过滤 Select] [状态过滤 Select] [搜索框 Input]        │  │
│ │ ┌─ Spin ──────────────────────────────────────────────┐  │  │
│ │ │ Table: agentId | name | typeBadge | statusBadge |   │  │  │
│ │ │       updatedAt | actions[查看/编辑/删除]            │  │  │
│ │ │ EmptyCard（空时）                                    │  │  │
│ │ └────────────────────────────────────────────────────┘  │  │
│ └─────────────────────────────────────────────────────────┘  │
│ Dialog: 创建/编辑表单                                          │
└──────────────────────────────────────────────────────────────┘
```

#### 7.1.2 关键实现

**常量定义**

```typescript
const TYPE_OPTIONS = ['', 'individual', 'admin_organ', 'political_party', 'news_media', 'mass'] as const;
const STATUS_OPTIONS = ['', 'active', 'archived'] as const;
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/;
```

**过滤联动**

```typescript
const load = useCallback(async () => {
  await fetchAgents({
    agent_type: typeFilter || undefined,
    status: statusFilter || undefined,
  });
}, [fetchAgents, typeFilter, statusFilter]);

useEffect(() => { load(); }, [load]);
```

**搜索过滤**（前端内存过滤，不走后端）

```typescript
const filtered = search
  ? agents.filter((a) =>
      a.agent_id.toLowerCase().includes(search.toLowerCase()) ||
      a.name.toLowerCase().includes(search.toLowerCase()))
  : agents;
```

**表单字段限制**

当前表单仅支持 5 个字段（[AgentListPage.tsx L46](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentListPage.tsx)）：

```typescript
const [form, setForm] = useState({
  agent_id: '', name: '', agent_type: 'individual', bio: '', parent_agent_id: ''
});
```

**缺失字段**（类型定义中有但表单未暴露）：

| 字段 | 当前状态 | 修改方式 |
|---|---|---|
| `avatar` | 不可编辑 | 需扩展表单或通过 API 直接操作 |
| `attributes` | 不可编辑 | 详情页"扩展属性" Tab 仅只读展示，无法编辑 |
| `status` | 不可编辑 | 无法通过表单切换 active/archived，需扩展表单或通过 API |

**表单提交校验**

```typescript
if (!form.agent_id || !form.name) {
  setError(t('cognitiveWargame.agents.form.requiredFields'));
  return;
}
if (!editing && !AGENT_ID_RE.test(form.agent_id)) {
  setError(t('cognitiveWargame.agents.form.agentIdFormat'));
  return;
}
```

> **注意**：当前表单**仅校验 `agent_id` 格式**，未校验 `parent_agent_id`。若用户输入非法 `parent_agent_id`（如含路径分隔符），前端不会拦截，由 wargamesrv [agents_api.py L137-140](file:///Users/simon/project/cognitive-wargame/wargamesrv/apps/restful_apis/agents_api.py) `_validate_optional_agent_id` 兜底返回 400。建议前端补全校验，避免无谓请求。

**空字符串提交显式清空字段**

编辑模式下，用户清空 `bio` 或 `parent_agent_id` 输入框后提交，前端会发送 `null` 显式清空字段（[AgentListPage.tsx L103-108](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentListPage.tsx)）：

```typescript
await updateAgent(editing.agent_id, {
  name: form.name,
  agent_type: form.agent_type as Agent['agent_type'],
  bio: form.bio || null,           // 空字符串 → null（显式清空）
  parent_agent_id: form.parent_agent_id || null,  // 空字符串 → null（显式清空）
});
```

此行为符合 wargamesrv `UpdateAgentRequest` 的 `null` 显式清空语义（[agents_api.py L215-229](file:///Users/simon/project/cognitive-wargame/wargamesrv/apps/restful_apis/agents_api.py)）。

**行操作**

| 操作 | 行为 |
|---|---|
| 查看详情 | `navigate(WargamePath.agentDetail(a.agent_id))` |
| 编辑 | `openEdit(a)` 打开 Dialog，预填表单，`agent_id` 字段禁用 |
| 删除 | `confirm()` 二次确认 → `deleteAgent(a.agent_id)` |

### 7.2 AgentDetailPage（详情页）

**文件**：[AgentDetailPage.tsx](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentDetailPage.tsx)

**职责**：展示 Agent 基本信息、组织关系、扩展属性，支持添加/删除关系。

#### 7.2.1 页面布局

```
┌─ flex flex-col gap-4 p-6 ─────────────────────────────────────┐
│ [← 返回列表] [Agent 名称] [typeBadge] [删除按钮]                │
│ error 提示（如有）                                              │
│ ┌─ Spin ───────────────────────────────────────────────────┐ │
│ │ Tabs: [基本信息] [组织关系 (count)] [扩展属性]            │ │
│ │ ┌─ TabContent ────────────────────────────────────────┐  │ │
│ │ │ 基本信息: dl grid (agentId/name/type/status/parent/bio) │
│ │ │ 组织关系: Table + [添加关系 Dialog]                  │  │ │
│ │ │ 扩展属性: <pre> JSON.stringify(attributes)          │  │ │
│ │ └─────────────────────────────────────────────────────┘  │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

#### 7.2.2 关键实现

**路由参数获取**

```typescript
const { id } = useParams<{ id: string }>();
const navigate = useNavigate();
```

**数据加载**

```typescript
const load = useCallback(async () => {
  if (!id) return;
  await loadAgent(id);
  await loadAgentRelations(id);
}, [id, loadAgent, loadAgentRelations]);

useEffect(() => { load(); }, [load]);
```

**关系列表展示**（同时展示出向与入向关系）

```typescript
const { agentRelations } = useWargameStore();
// store 内 loadAgentRelations 调用 api.getAgentRelations(agentId, 'both')

{agentRelations.map((rel) => {
  const isSource = rel.source_agent_id === id;
  const otherId = isSource ? rel.target_agent_id : rel.source_agent_id;
  // 渲染关系类型 Badge + 对端 agent_id + 删除按钮
})}
```

**添加关系 Dialog**

```typescript
const RELATION_TYPES = ['employed_by', 'spokesperson_of', 'member_of', 'subsidiary_of', 'belongs_to'] as const;

const submitRelation = async () => {
  if (!id || !relForm.target_agent_id) return;
  await createAgentRelation(id, {
    source_agent_id: id,  // 必须等于 path 的 id
    target_agent_id: relForm.target_agent_id,
    relation_type: relForm.relation_type,
  });
  // store 内部已自动刷新 agentRelations
};
```

**扩展属性展示**（只读 JSON）

```tsx
<pre className="overflow-auto rounded bg-bg-secondary p-4 text-sm">
  {JSON.stringify(currentAgent?.attributes ?? {}, null, 2)}
</pre>
```

> **GraphView 集成状态**：当前详情页**未集成** GraphView 关系图（[AgentDetailPage.tsx](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentDetailPage.tsx) 全文未 import GraphView）。
>
> **与设计文档冲突**：[agent-table-redesign-plan.md §12.10 L953](file:///Users/simon/project/cognitive-wargame/docs/agent-table-redesign-plan.md) 标注"Agent 关系图（复用 GraphView） | **已完成 ✅** | AgentDetailPage 内集成 GraphView"，但实际代码未实现。后续开发者请以代码为准，设计文档此条标注已过期。
>
> **如需可视化**：可复用 [GraphView.tsx](file:///Users/simon/project/agentui/src/features/cognitive-wargame/components/GraphView.tsx)，传入 `entities`（当前 agent + 关联 agent）与 `relations`（agentRelations 转 KGRelation 格式）。GraphView 节点颜色规则中 `agent` 子串匹配绿色 `#10b981`，无需额外配置。

### 7.3 AgentTypePage（类型字典页）

**文件**：[AgentTypePage.tsx](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentTypePage.tsx)

**职责**：只读展示 `intellect_agent_types` 表的 5 类种子数据。

#### 7.3.1 页面布局

```
┌─ flex flex-col gap-4 p-6 ─────────────────────────────────────┐
│ [标题: 类型字典] [刷新]                                         │
│ ┌─ Card ──────────────────────────────────────────────────┐  │
│ │ CardTitle: 类型字典 (count)                              │  │
│ │ ┌─ Spin ──────────────────────────────────────────────┐  │  │
│ │ │ Table: type_code | type_name | parentType | sortOrder |  │
│ │ │       isActiveBadge                                  │  │
│ │ │ EmptyCard（空时）                                     │  │
│ │ └────────────────────────────────────────────────────┘  │  │
│ └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

#### 7.3.2 关键实现

**只读展示**：当前未提供新增/编辑/删除能力（类型字典为平台级基础数据，由 intellect-team 侧迁移文件种子化）。

```typescript
const { agentTypes, typesLoading, fetchAgentTypes } = useWargameStore();

useEffect(() => {
  fetchAgentTypes();
}, [fetchAgentTypes]);
```

**响应兼容**（store 内处理）

```typescript
const data = await api.getAgentTypes();
const types = Array.isArray(data) ? data : (data as { types: AgentType[] }).types ?? [];
set({ agentTypes: types, typesLoading: false });
```

> **语义错误（待修复）**：[AgentTypePage.tsx L60](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentTypePage.tsx) 用 `agents.status.archived`（"已归档"）翻译 `is_active=false`：
>
> ```tsx
> {ty.is_active ? t('cognitiveWargame.agents.status.active') : t('cognitiveWargame.agents.status.archived')}
> ```
>
> 类型字典的"未启用"（`is_active=false`）与 Agent 的"已归档"（`status=archived`）是不同概念，语义不匹配。建议新增 `cognitiveWargame.agents.types.inactive` 词条（如"未启用"），并替换此处的翻译 key。

---

## 八、错误处理与边界

### 8.1 错误展示策略

| 场景 | 处理方式 |
|---|---|
| 列表加载失败 | 页面顶部 `<p className="text-sm text-text-error">{error}</p>` |
| 表单提交失败 | Dialog 内展示错误，保留 Dialog 不关闭 |
| 详情页加载失败 | 页面顶部展示错误 |
| 关系操作失败 | 页面顶部展示错误，关系列表保持原状 |

### 8.2 空状态

使用 `@/components/empty` 的 `EmptyCard` 组件：

```tsx
{filtered.length === 0 ? (
  <EmptyCard title={t('cognitiveWargame.agents.empty')} className="w-full" />
) : (
  <Table>...</Table>
)}
```

### 8.3 加载状态

使用 `@/components/ui/spin` 的 `Spin` 组件包裹表格：

```tsx
<Spin spinning={agentsLoading}>
  {filtered.length === 0 ? <EmptyCard /> : <Table>...</Table>}
</Spin>
```

### 8.4 二次确认

删除操作使用浏览器原生 `confirm()`：

```typescript
if (!confirm(t('cognitiveWargame.agents.deleteConfirm'))) return;
```

> **后续优化**：可替换为 `@/components/ui/alert-dialog` 的 AlertDialog，统一交互风格。

### 8.5 格式校验

**前端校验**（仅校验 `agent_id`，避免无谓请求）：

```typescript
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/;

if (!editing && !AGENT_ID_RE.test(form.agent_id)) {
  setError(t('cognitiveWargame.agents.form.agentIdFormat'));
  return;
}
```

> **前端校验缺口**：`parent_agent_id` **未做前端格式校验**，仅靠后端兜底。建议前端用同一 `AGENT_ID_RE` 补全校验，避免发无效请求。

**后端三层校验**（兜底）：

1. wargamesrv `agents_api.py` 的 `_validate_agent_id()` / `_validate_optional_agent_id()` → 400
2. wargamesrv Pydantic `Field(..., max_length=128)` → 422
3. intellect-gateway `agent_store.rs` → 400/422

---

## 九、国际化（i18n）

### 9.1 命名空间

所有 Agent 相关词条挂在 `cognitiveWargame.agents.*` 命名空间下，词条文件位于：

- [locales/zh.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/locales/zh.ts)
- [locales/en.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/locales/en.ts)

由 `manifest.ts` 的 `i18n.lazy` 懒加载，合并进 `translation` 命名空间。

### 9.2 词条结构

```typescript
cognitiveWargame: {
  nav: {
    agents: 'Agent 管理',
  },
  agents: {
    title: 'Agent 管理',
    subtitle: '管理推演参与方（个人/机构/政党/媒体/群众）',
    list: {
      filterType: '按类型过滤',
      filterStatus: '按状态过滤',
      create: '新建 Agent',
      refresh: '刷新',
      searchPlaceholder: '搜索 agent_id/名称',
    },
    table: {
      agentId: 'Agent ID',
      name: '名称',
      type: '类型',
      status: '状态',
      updatedAt: '更新时间',
      actions: '操作',
    },
    type: {
      individual: '个人',
      admin_organ: '行政机关',
      political_party: '政党',
      news_media: '新闻媒体',
      mass: '群众',
    },
    status: {
      active: '启用',
      archived: '已归档',
    },
    form: {
      createTitle: '新建 Agent',
      editTitle: '编辑 Agent',
      agentId: 'Agent ID',
      name: '名称',
      type: '类型',
      bio: '简介',
      parent: '父 Agent',
      attributes: '扩展属性 (JSON)',
      submit: '保存',
      cancel: '取消',
      requiredFields: 'Agent ID 与名称为必填项',
      agentIdFormat: 'Agent ID 格式：[a-z0-9][a-z0-9_-]{0,127}',
      agentIdPlaceholder: '如 cn_mfa 或 blue_us_rnc',
      parentPlaceholder: '父 Agent ID（可选）',
    },
    detail: {
      back: '返回列表',
      basicInfo: '基本信息',
      noRelations: '暂无关系',
      relations: '组织关系',
      attrs: '扩展属性',
      edit: '编辑',
      delete: '删除',
      addRelation: '添加关系',
    },
    relation: {
      source: '源 Agent',
      target: '目标 Agent',
      type: '关系类型',
      employed_by: '受雇于',
      spokesperson_of: '发言人',
      member_of: '成员',
      subsidiary_of: '下属机构',
      belongs_to: '属于',
    },
    types: {
      title: '类型字典',
      typeCode: '类型代码',
      typeName: '类型名称',
      parentType: '父类型',
      sortOrder: '排序',
      isActive: '启用',
    },
    empty: '暂无 Agent，点击「新建 Agent」创建',
    deleteConfirm: '确认删除此 Agent？',
  },
}
```

### 9.3 词条使用约定

- 页面中通过 `t('cognitiveWargame.agents.xxx')` 访问
- 枚举值翻译通过 `t(`cognitiveWargame.agents.type.${ty}`)` 动态拼接
- 缺失词条用 `defaultValue` 兜底：`t('cognitiveWargame.common.viewDetail', { defaultValue: '查看详情' })`

### 9.4 跨命名空间复用（待优化）

当前页面多处复用 `cognitiveWargame.common.*` 与 `cognitiveWargame.approval.*` 命名空间词条：

| 使用位置 | 复用的 key | 来源命名空间 | 说明 |
|---|---|---|---|
| [AgentListPage L180, L193](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentListPage.tsx) | `approval.all`（"全部"） | approval | **跨模块耦合**，若 approval 模块删除或重命名此 key，Agent 页面会 fallback 到 defaultValue |
| [AgentListPage L236](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentListPage.tsx) | `common.viewDetail` | common | 合理复用 |
| [AgentDetailPage L161](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentDetailPage.tsx) | `common.actions` | common | 合理复用 |
| [AgentDetailPage L174](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentDetailPage.tsx) | `common.delete` | common | 合理复用 |
| [AgentTypePage L30, L41](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentTypePage.tsx) | `common.refresh`、`common.empty` | common | 合理复用 |

> **问题**：
> 1. `cognitiveWargame.approval.all` 被复用于 Agent 过滤器"全部"选项，是跨模块耦合。`cognitiveWargame.agents` 命名空间**缺少** `list.all` key。
> 2. 建议新增 `cognitiveWargame.agents.list.all`（"全部"），替换 `approval.all` 的跨模块引用，解除耦合。

---

## 十、测试与验证

### 10.1 手动验证清单

| 场景 | 验证步骤 | 预期结果 |
|---|---|---|
| 列表加载 | 进入 `/cognitive-wargame/agents` | 显示 Agent 列表，加载态正确 |
| 类型过滤 | 选择 `individual` | 列表仅显示个人类型 Agent |
| 状态过滤 | 选择 `archived` | 列表仅显示已归档 Agent |
| 搜索 | 输入 `trump` | 列表实时过滤匹配项 |
| 创建 Agent | 点击"新建 Agent"，填写表单 | 创建成功，列表自动刷新 |
| 创建校验 | 输入非法 `agent_id`（如 `Trump!`） | 表单提示格式错误，不发请求 |
| 编辑 Agent | 点击行"编辑" | Dialog 预填数据，`agent_id` 禁用 |
| 删除 Agent | 点击行"删除"，确认 | 删除成功，列表刷新 |
| 查看详情 | 点击行"查看详情" | 跳转到 `/cognitive-wargame/agents/:id` |
| 详情-关系 | 切换到"组织关系" Tab | 显示关系列表，可添加/删除 |
| 添加关系 | 填写 target_agent_id + relation_type | 关系建立成功，列表刷新 |
| 类型字典 | 进入 `/cognitive-wargame/agent-types` | 显示 5 类种子数据 |
| 网关不可达 | 停止 intellect-gateway，刷新列表 | 提示"Agent 服务不可达" |

### 10.2 端到端验证

参考 cognitive-wargame 侧的端到端验证脚本：

- `scripts/seed_named_agents.py`：录入 56 个命名实体（含组织关系），用于前端列表展示验证
- `scripts/seed_society_agents.py`：录入 society-east/west/center 各 200 条 + society-test 20 条群众 Agent，用于大规模列表性能验证
- `scripts/migrate_agents_to_table.py`：迁移脚本，将旧数据迁移到双层 Agent 表结构
- `scripts/clean_agents_via_gateway.py`：通过 gateway API 清理 agents，验证缓存一致性

### 10.3 单元测试建议

当前模块未编写单元测试，建议补充以下测试：

| 测试对象 | 测试点 |
|---|---|
| `api.ts` unwrap 函数 | 兼容 `{code, data}` 包装与裸数据 |
| `store.ts` fetchAgents | 正确写入 `agents` 与 `agentsLoading` |
| `store.ts` createAgent | 成功后自动调 `fetchAgents` 刷新 |
| `store.ts` createAgentRelation | 成功后自动刷新 `agentRelations`；失败时 throw |
| `store.ts` fetchAgentTypes | 兼容数组与 `{types}` 两种响应形态 |
| `AgentListPage` | 过滤变化触发 fetchAgents；搜索过滤正确 |
| `AgentDetailPage` | `id` 变化触发 load；关系方向正确解析 |

---

## 十一、开发约定与注意事项

### 11.1 硬约束（来自项目记忆）

- **实现位置**：所有 Agent 相关代码必须在 `src/features/cognitive-wargame/` 下，不得散落到 `src/pages/` 或其他 feature
- **UI 组件**：优先复用 `@/components/ui/*` shadcn/ui 组件，不引入 antd / mui 等其他 UI 库
- **状态管理**：使用 Zustand，不引入 Redux / MobX
- **HTTP 客户端**：使用 `api.ts` 中的 `wargameClient`（独立 axios 实例），**不**复用 BFF 的 `restAPIv1`（`/api/bff/proxy/v1`），避免拦截器耦合
- **i18n 命名空间**：统一挂在 `cognitiveWargame.agents.*` 下

### 11.2 接口对接注意事项

1. **响应包装兼容**：gateway 直接返回 Tool 的 dict 结果（裸数据），不使用 `{code, data, message}` 包装。`unwrap()` 函数会自动检测并兼容两种形态，新增接口务必通过 `unwrap()` 处理。

2. **`agent_id` 格式校验**：三处校验（前端 / wargamesrv / gateway），前端必须用 `AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/` 拦截，避免发无效请求。

3. **`relation_id` 形态**：gateway 生成 `rel-{uuid}` 形式（约 36 字符），前端 `AgentRelation.relation_id` 类型为 `string`（非 number）。

4. **`direction` 参数**：查询关系列表时默认 `both`（store 内 `loadAgentRelations` 已设置），同时展示出向与入向关系。

5. **`source_agent_id` 一致性**：建立关系时 body 的 `source_agent_id` 必须等于 path 的 `agent_id`，否则 gateway 返回 422。前端 `submitRelation` 中已硬编码 `source_agent_id: id`。

6. **类型字典路径**：前端请求 `/api/v1/wargame/agents/types`（wargamesrv 嵌套路由），wargamesrv 代理到 gateway `/v1/intellect/agent-types`（**斜杠**，非连字符 `agent-types`）。

7. **`tenant_id` 一致性**：创建/更新成功后，wargamesrv 会校验回包 `tenant_id` 与 `INTELLECT_TENANT_ID` 一致，不一致返回 500。前端遇到 500 时应提示"联系管理员校对 `GATEWAY_API_TOKEN`"。

### 11.3 安全注意事项

- **认证 token**：从 `localStorage[Authorization]` 读取，由 `wargameClient` 请求拦截器自动注入 `Authorization` header
- **路径注入防护**：`agent_id` / `relation_id` 经正则白名单校验，拒绝含路径分隔符 / 查询符 / 点号遍历的值
- **SSE 认证**：EventSource 不支持自定义 Header，通过 `?token=` 查询参数传递（见 `api.eventStreamUrl`）
- **XSS 风险**：`localStorage` 存 token 有 XSS 风险，生产环境应改用 httpOnly cookie 或 GATEWAY 签发 SSE 专用短期 token（见 [intellect-team-gateway-integration-requirements.md §二](file:///Users/simon/project/cognitive-wargame/docs/intellect-team-gateway-integration-requirements.md)）

### 11.4 性能注意事项

- **列表分页**：`fetchAgents` 默认 `limit: 100`，对于大规模群众 Agent（如 3000 条）需配合 `offset` 分页加载，或后端按 `agent_type=mass` 过滤
- **关系图渲染**：GraphView 基于 @antv/g6 v5 力导向布局，节点数 > 500 时性能下降，建议仅在详情页展示单 Agent 的关系子图
- **SSE 事件流**：`agent.acted` 事件在推演期间高频触发，前端 `use-sse-events.ts` 已实现指数退避重连，但需注意事件回调避免重计算

### 11.5 与 cognitive-wargame 后端的协作约定

- **接口契约变更**：intellect-gateway 路由契约见 [intellect-agent-registry-design-requirement.md §5.2.2](file:///Users/simon/project/cognitive-wargame/docs/intellect-agent-registry-design-requirement.md)，如后端新增/修改路由，前端 `api.ts` 需同步更新
- **字段扩展**：`Agent.attributes` JSONB 字段可扩展通用属性，但**不应**承载认知域业务字段（stance / narrative_valence 等），后者由 `wargame.agents.cognitive_attrs` 承担
- **命名实体录入与认知域 Agent 创建**（需区分两个概念）：
  - **前端创建 Agent**：通过 `POST /api/v1/wargame/agents` 仅写入 `intellect_agents` 平台层主表，**不自动写入** `wargame.agents` 认知域映射表
  - **`register_agent` action**：cognitive-wargame state_store 内部 action（[agent-table-redesign-plan.md §B1 L188](file:///Users/simon/project/cognitive-wargame/docs/agent-table-redesign-plan.md)），先通过 HTTP 调 intellect-gateway 创建 `intellect_agents` 记录，再写 `wargame.agents`，保证两表一致。**此 action 当前无对应 HTTP 端点**，仅由后端脚本（如 `seed_named_agents.py`）通过 state_store_tool 调用
  - **`link_scenario_agent` action**：建立场景-Agent 引用绑定（写 `wargame.scenario_agent_refs` 表），对应 HTTP 端点 `POST /api/v1/wargame/scenarios/:id/agents/:aid`（[agents_api.py L11-13](file:///Users/simon/project/cognitive-wargame/wargamesrv/apps/restful_apis/agents_api.py) 说明此端点走 state_store action，不属 Agent 代理范围）。**此端点功能是场景引用绑定，不是创建 Agent**
  - **结论**：前端目前**无法直接创建认知域 Agent**（`wargame.agents` 记录）。如需支持，需后端新增暴露 `register_agent` 的 HTTP 端点，或扩展前端调用场景引用端点（前提是 Agent 已存在于 `wargame.agents`）

### 11.6 后续优化方向

| 优化项 | 优先级 | 说明 |
|---|---|---|
| 关系图可视化集成 | P1 | 详情页"组织关系" Tab 集成 GraphView，复用 KG 页组件（注：设计计划声称已完成但实际未实现，见 §7.2） |
| 父 Agent 选择器 | P1 | 创建/编辑表单的 `parent_agent_id` 改为 Select 组件，从 Agent 列表选择 |
| 目标 Agent 选择器 | P1 | 添加关系 Dialog 的 `target_agent_id` 改为 Select 组件 |
| parent_agent_id 前端校验 | P1 | 用 `AGENT_ID_RE` 补全 `parent_agent_id` 前端格式校验，避免无谓请求（见 §8.5） |
| i18n 跨模块解耦 | P1 | 新增 `cognitiveWargame.agents.list.all` 词条，替换 `approval.all` 跨模块引用（见 §9.4） |
| AgentTypePage 语义修复 | P1 | 新增 `cognitiveWargame.agents.types.inactive` 词条，替换 `status.archived` 误用（见 §7.3） |
| Store 错误处理统一 | P2 | 统一 `createAgentRelation` / `deleteAgentRelation` 的错误处理模式，避免双重处理（见 §6.3） |
| status 类型一致性 | P2 | 若需支持 `inactive` 状态，同步扩展前端类型 + wargamesrv Literal + i18n（见 §5.1） |
| 关系单条查询与更新 | P2 | 补全 `api.ts` 的 `getAgentRelation` / `updateAgentRelation` 封装（见 §3.4.3 / §3.4.4） |
| 表单字段扩展 | P2 | 表单补全 `avatar` / `attributes` / `status` 字段编辑能力（见 §7.1.2） |
| 分页支持 | P2 | 列表支持 `offset` 分页，应对大规模群众 Agent |
| 属性 JSON 编辑器 | P2 | 详情页扩展属性改用 `@/components/json-edit` 组件，支持校验 |
| 批量操作 | P2 | 列表支持多选 + 批量删除/归档 |
| 场景引用管理 | P2 | 在想定详情页增加"参与 Agent"管理入口，调用 `/scenarios/:id/agents` 端点 |
| 认知域 Agent 创建端点 | P2 | 后端新增暴露 `register_agent` 的 HTTP 端点，前端封装创建 `wargame.agents` 记录（见 §11.5） |
| `agent.acted` 实时活动流 | P3 | 订阅 SSE 事件，在详情页展示 Agent 实时行为 |
| 单元测试补充 | P2 | 见 §10.3 测试建议 |

---

## 附录 A：关键文件索引

| 关注点 | 文件 |
|---|---|
| 前端 API 客户端 + 类型定义 | [src/features/cognitive-wargame/api.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/api.ts) |
| 前端 Zustand store | [src/features/cognitive-wargame/store.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/store.ts) |
| 前端路由配置 | [src/features/cognitive-wargame/routes.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/routes.ts) |
| 前端插件清单（导航） | [src/features/cognitive-wargame/manifest.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/manifest.ts) |
| 列表页实现 | [src/features/cognitive-wargame/pages/AgentListPage.tsx](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentListPage.tsx) |
| 详情页实现 | [src/features/cognitive-wargame/pages/AgentDetailPage.tsx](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentDetailPage.tsx) |
| 类型字典页实现 | [src/features/cognitive-wargame/pages/AgentTypePage.tsx](file:///Users/simon/project/agentui/src/features/cognitive-wargame/pages/AgentTypePage.tsx) |
| 关系图组件（复用） | [src/features/cognitive-wargame/components/GraphView.tsx](file:///Users/simon/project/agentui/src/features/cognitive-wargame/components/GraphView.tsx) |
| SSE 事件订阅 hook | [src/features/cognitive-wargame/hooks/use-sse-events.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/hooks/use-sse-events.ts) |
| 中文词条 | [src/features/cognitive-wargame/locales/zh.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/locales/zh.ts) |
| 英文词条 | [src/features/cognitive-wargame/locales/en.ts](file:///Users/simon/project/agentui/src/features/cognitive-wargame/locales/en.ts) |
| 后端代理路由（cognitive-wargame） | [wargamesrv/apps/restful_apis/agents_api.py](file:///Users/simon/project/cognitive-wargame/wargamesrv/apps/restful_apis/agents_api.py) |
| 后端 HTTP 端点（intellect-team） | [intellect-gateway/src/platform/agent_registry_api.rs](file:///Users/simon/project/intellect-team/intellect-gateway/src/platform/agent_registry_api.rs) |
| 后端 Rust Store | [intellect-storage/src/agent_store.rs](file:///Users/simon/project/intellect-team/intellect-storage/src/agent_store.rs) |
| 后端迁移文件 | [intellect-storage/migrations/20260808000001_agents.sql](file:///Users/simon/project/intellect-team/intellect-storage/migrations/20260808000001_agents.sql) |

## 附录 B：cognitive-wargame 相关文档索引

| 关注点 | 文档 | 与本模块关系 |
|---|---|---|
| Agent 功能梳理（推演 / Skills / 管理） | [agent-features-overview.md](file:///Users/simon/project/cognitive-wargame/docs/agent-features-overview.md) | 直接依赖 |
| 双层 Agent 表改造实施计划 | [agent-table-redesign-plan.md](file:///Users/simon/project/cognitive-wargame/docs/agent-table-redesign-plan.md) | 直接依赖 |
| 通用 Agent 注册表设计需求 | [intellect-agent-registry-design-requirement.md](file:///Users/simon/project/cognitive-wargame/docs/intellect-agent-registry-design-requirement.md) | 直接依赖 |
| GATEWAY 外部依赖对接需求 | [intellect-team-gateway-integration-requirements.md](file:///Users/simon/project/cognitive-wargame/docs/intellect-team-gateway-integration-requirements.md) | 直接依赖 |
| Agent 与数据库分析 | [agents-and-database-analysis.md](file:///Users/simon/project/cognitive-wargame/docs/agents-and-database-analysis.md) | 参考 |
| 认知推演总体设计 | [cognitive-wargaming-intellect-design.md](file:///Users/simon/project/cognitive-wargame/docs/cognitive-wargaming-intellect-design.md) | 参考 |
| Skills 资源 API 参考 | [skills-api-reference.md](file:///Users/simon/project/cognitive-wargame/docs/skills-api-reference.md) | **非直接依赖**（Skills 在 api.ts 是独立 section） |
| Skills 资源 API 设计 | [skills-resources-api-design.md](file:///Users/simon/project/cognitive-wargame/docs/skills-resources-api-design.md) | **非直接依赖** |
