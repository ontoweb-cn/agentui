# Data Model: Multi-Harness P2 — Harness Admin 管理端 + 前端能力探测

**Feature**: [003-harness-admin-capabilities](./)
**Date**: 2026-06-26
**Status**: Draft

## 概述

P2 在 P0/P1 已有类型体系(HarnessBackendConfig、HarnessBackend、HarnessCapabilities、BffTenant)基础上,新增 DTO(HarnessBackendWithStatus、CapabilitiesResponse、HarnessBackendForm)、扩展 AdapterRegistry(invalidate)和 HarnessStore(listConfigs)、定义校验规则。P0/P1 已定义的类型不重复,仅记录 P2 新增/调整部分。

---

## 实体 1: HarnessBackendWithStatus (新增 DTO)

**角色**: Admin 列表 API 返回的后端配置 + 就绪状态,用于前端展示。

**Constitution 引用**: Token Security(不含 adminToken 明文,只含 adminTokenEnvVar 引用)。

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | 是 | 后端唯一标识(kebab-case) |
| `name` | `string` | 是 | 人类可读名称 |
| `type` | `BackendType` | 是 | `'intellect-rag'` 或 `'intellect-enterprise'` |
| `endpoint` | `string` | 是 | 后端 HTTP 端点 URL |
| `adminTokenEnvVar` | `string` | 是 | admin token 环境变量名 |
| `capabilities` | `HarnessCapabilities` | 是 | 能力声明 |
| `defaultForTenant` | `boolean` | 否 | 是否作为新 tenant 默认主后端 |
| `ready` | `boolean` | 是 | **P2 新增**:就绪状态(env token 是否设置) |

### 关系

- 继承自 P0 `HarnessBackendConfig`,增加 `ready` 字段
- `ready` 由 HarnessStore.list() 判定:在 list 中 true,不在 false

---

## 实体 2: CapabilitiesResponse (新增 DTO)

**角色**: `GET /api/bff/capabilities` 返回的能力探测响应。

**Constitution 引用**: Principle II(经 AdapterRegistry 获取)、Principle V(按 tenant 返回)。

### 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `backendId` | `string` | 是 | 当前 tenant 绑定的后端 ID |
| `backendName` | `string` | 是 | 后端名称 |
| `backendType` | `BackendType` | 是 | 后端类型 |
| `capabilities` | `HarnessCapabilities` | 是 | 能力声明 |

### 行为

- tenant 不存在 → 404
- tenant 绑定的 backendId 不存在(配置不一致)→ 500
- AdapterRegistry 未就绪 → 503

---

## 实体 3: HarnessBackendForm (新增前端类型)

**角色**: Admin 页面新增/编辑表单提交的数据结构。

### 字段

| 字段 | 类型 | 必填 | 校验规则 |
|------|------|------|---------|
| `id` | `string` | 是(新增必填,编辑只读) | kebab-case `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `name` | `string` | 是 | 非空 |
| `type` | `'intellect-rag' \| 'intellect-enterprise'` | 是 | 枚举 |
| `endpoint` | `string` | 是 | URL `^https?://.+` |
| `adminTokenEnvVar` | `string` | 是 | 环境变量名 `^[A-Z_][A-Z0-9_]*$` |
| `capabilities` | `HarnessCapabilities` | 是 | 对象,各字段 boolean |
| `defaultForTenant` | `boolean` | 否 | 默认 false |

### 校验时机

- 前端:表单提交前(Ant Design Form rules)
- BFF:路由处理时(新增/编辑 API 入口)

---

## 实体 4: AdapterRegistry 扩展 (P1 → P2)

**角色**: 新增 `invalidate` 方法,支持后端配置变更后失效缓存。

**Constitution 引用**: Principle II(配置变更后 Adapter 必须用新配置)。

### 新增方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `invalidate` | `(backendId?: string) => void` | 不传参清空整个 adapterCache;传 backendId 只移除该条目 |

### 行为

- `invalidate()`:adapterCache.clear()
- `invalidate(backendId)`:adapterCache.delete(backendId)
- 下次 `getAdapterForTenant` / `getAdapterForBackend` 创建新实例(用最新 HarnessBackend 配置)

### 调用时机

- 新增后端:无需 invalidate(新 backendId 无缓存),但为统一可调 `invalidate(newId)`(no-op)
- 编辑后端:`invalidate(backendId)`(旧实例失效)
- 删除后端:`invalidate(backendId)`(清理缓存)

---

## 实体 5: HarnessStore 扩展 (P0 → P2)

**角色**: 新增 `listConfigs` 方法,返回所有配置(含未就绪),用于 Admin 列表。

**Constitution 引用**: Token Security(返回 Config 不含 token)。

### 新增方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `listConfigs` | `() => HarnessBackendConfig[]` | 返回所有配置(含 env token 未就绪的),不含 adminToken 明文 |

### 与 list() 的区别

| 方法 | 返回 | 含未就绪 | 含 adminToken |
|------|------|---------|--------------|
| `list()` (P0) | `HarnessBackend[]` | ❌ 否(仅就绪) | ✅ 是(运行时内存) |
| `listConfigs()` (P2 新增) | `HarnessBackendConfig[]` | ✅ 是(所有配置) | ❌ 否(只有 envVar 引用) |

### 实现

P0 的 JSONFileHarnessStore 已在 load() 时读取 JSON 到内存(configs 数组),listConfigs 直接返回该数组。若 P0 未维护 configs 数组,P2 需补充(读取 JSON 文件内容)。

---

## 实体 6: BFF harness-admin 路由 (新增)

**角色**: 后端配置 CRUD API。

**Constitution 引用**: Principle I(BFF-Mediated)、Token Security。

### 路由清单

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/api/bff/admin/harness-backends` | 返回所有后端配置 + ready 状态 | authMiddleware |
| POST | `/api/bff/admin/harness-backends` | 新增后端(校验 id 唯一/格式) | authMiddleware |
| PUT | `/api/bff/admin/harness-backends/:id` | 编辑后端(id 只读) | authMiddleware |
| DELETE | `/api/bff/admin/harness-backends/:id` | 删除后端(校验未绑定) | authMiddleware |

### 请求/响应

- **GET 列表**:无 body,响应 `{code: 0, data: HarnessBackendWithStatus[]}`
- **POST 新增**:body `HarnessBackendForm`,响应 `{code: 0, data: HarnessBackendWithStatus}` 或 `{code: 409, message: "id 已存在"}`
- **PUT 编辑**:body `HarnessBackendForm`(id 忽略,用路径参数),响应同 POST
- **DELETE**:无 body,响应 `{code: 0, message: "ok"}` 或 `{code: 409, message: "后端已被 tenant X 绑定"}`

### 错误码

| 状态码 | 场景 |
|--------|------|
| 400 | 校验失败(id/endpoint/adminTokenEnvVar 格式错误) |
| 401 | 未授权(无 Authorization) |
| 404 | 编辑/删除的后端 id 不存在 |
| 409 | id 重复(新增)/ 后端被 tenant 绑定(删除) |
| 500 | HarnessStore.saveConfig/load 失败 |

---

## 实体 7: BFF capabilities 路由 (新增)

**角色**: 能力探测 API,按 tenant 返回绑定后端的能力。

**Constitution 引用**: Principle II(经 AdapterRegistry)、Principle V(按 tenant)。

### 路由清单

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/api/bff/capabilities` | 返回当前 tenant 绑定后端的能力 | authMiddleware + tenantContextMiddleware |

### 请求/响应

- **请求**:header `X-Tenant-Id` + `X-User-Id`(tenantContextMiddleware 注入)
- **响应**:`{code: 0, data: CapabilitiesResponse}`

### 错误码

| 状态码 | 场景 |
|--------|------|
| 400 | 缺失 X-Tenant-Id / X-User-Id |
| 401 | 未授权 |
| 404 | tenant 不存在 |
| 500 | tenant 绑定的 backendId 不存在(配置不一致) |
| 503 | AdapterRegistry 未就绪 |

---

## 实体 8: 前端 useHarnessCapabilities hook (新增)

**角色**: React hook,查询当前 tenant 绑定后端的能力,供条件渲染。

### 签名

```typescript
function useHarnessCapabilities(tenantId: string | undefined): {
  data?: CapabilitiesResponse;
  isLoading: boolean;
  error?: Error;
  refetch: () => void;
};
```

### 实现

- 用 TanStack Query:`useQuery({ queryKey: ['harness-capabilities', tenantId], queryFn, enabled: !!tenantId })`
- tenantId 变化 → queryKey 变化 → 自动重新查询
- 提供 refetch 供手动刷新

### 条件渲染规则

| capability | false 时行为 |
|------------|-------------|
| `canvas` | 隐藏画布入口(路由 + 菜单) |
| `knowledgeBase` | 隐藏知识库菜单 |
| `memory` | 隐藏对话历史/总结入口 |
| `mcp` | 隐藏 MCP 工具管理 |
| `multiTenant` | 隐藏 Team/Project 管理(P3) |
| `modelManagement` | 隐藏模型管理 UI |

---

## 校验规则汇总

| 字段 | 正则 | 错误消息 |
|------|------|---------|
| id | `^[a-z0-9]+(-[a-z0-9]+)*$` | "id 必须是 kebab-case(如 intellect-rag-default)" |
| name | 非空 | "name 不能为空" |
| type | `intellect-rag\|intellect-enterprise` | "type 必须是 intellect-rag 或 intellect-enterprise" |
| endpoint | `^https?://.+` | "endpoint 必须是合法 URL(http:// 或 https://)" |
| adminTokenEnvVar | `^[A-Z_][A-Z0-9_]*$` | "adminTokenEnvVar 必须是合法环境变量名(大写字母+下划线)" |

---

## 状态转换

### 后端配置状态机

```
[新增表单] --POST--> [校验] --pass--> [saveConfig] --success--> [load 热加载] --> [invalidate 缓存] --> [就绪/未就绪]
                |
                +--fail(校验/冲突)--> [返回错误,不持久化]
```

### AdapterRegistry 缓存状态机

```
[空] --getAdapterForTenant--> [创建实例缓存] --invalidate(backendId)--> [空] --getAdapterForTenant--> [创建新实例]
```

---

## 验证规则

1. **HarnessBackendWithStatus**:ready 字段与 HarnessStore.list() 一致(在 list 中 true)
2. **AdapterRegistry.invalidate**:调用后 adapterCache 为空(或不含该 backendId),下次 getAdapterForTenant 创建新实例
3. **HarnessStore.listConfigs**:返回所有配置(含 env token 缺失的),不含 adminToken 明文
4. **删除绑定校验**:被 tenant 绑定的后端删除返回 409,未绑定的删除成功
5. **Token Security**:任何 API 响应 JSON 不含 `"adminToken":` 字段(自动化测试)
6. **校验规则**:非法 id/endpoint/adminTokenEnvVar 返回 400,合法的通过

---

## 与 P0/P1 类型的关系

| P0/P1 类型 | P2 操作 | 说明 |
|-----------|---------|------|
| `HarnessBackendConfig` | 不变 | P2 CRUD 返回此类型 + ready 字段 |
| `HarnessBackend` | 不变 | P2 不直接暴露(含 token) |
| `HarnessCapabilities` | 不变 | P2 capabilities API 返回此类型 |
| `BffTenant` | 不变 | P2 删除校验遍历此类型 |
| `HarnessStore` | 扩展 | 新增 listConfigs() |
| `AdapterRegistry` | 扩展 | 新增 invalidate() |
| `TenantStore` | 不变 | P2 用 listTenants() 校验绑定 |
