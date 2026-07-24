# AgentUI 前端适配 — 身份同步与模型配置迁移影响分析

> **日期**: 2026-07-24
> **关联**: intellect-rag-app `docs/identity-database-technical-review.md` v3.0
> **变更范围**: P0-1、方案 A、Phase 1-3 模型配置迁移

---

## 1. 执行摘要

### 1.1 后台变更概述

| 变更 | 对前端影响 |
|------|:---:|
| **P0-1**: BFF 注入 `X-Intellect-User` header | 🟢 透明，无需变更 |
| **方案 A**: 被动成员关系同步（team/project 共享生效） | 🟡 前端可暴露 team/project KB 共享 UI |
| **Phase 2**: 模型选择源从 RAG `tenant` 表移至 TEAM API | 🟢 BFF 代理透明 |
| **Phase 3**: RAG `tenant` 表删除模型 FK 字段 | 🔴 `addTenantParams()` 需适配 |

### 1.2 优先级概览

| 优先级 | 数量 | 说明 |
|:------:|:----:|------|
| 🔴 P0 | 1 | Phase 3 后 `addTenantParams` 引用已删除列 → 需移除 |
| 🟡 P1 | 3 | KB 共享 UI、team/project 过滤、上下文选择器 |
| 🟢 P2 | 3 | 遗留端点迁移、模型管理 UI、admin 面板 |

---

## 2. P0 — 必须修改

### 2.1 🔴 `addTenantParams` 功能需移除

**文件**: `src/utils/llm-util.ts:85-144`

**问题**: `addTenantParams` 函数将 `tenant_llm_id`、`tenant_embd_id` 等 FK 字段注入 API 请求。Phase 3 的 Migration 006 将从 `tenant` 表删除这些列。迁移后这些参数将被 RAG 后端忽略或报错。

**当前代码**:
```typescript
// llm-util.ts:80-83 — 映射 Model 参数 → tenant FK 列名
const modelParamMap = {
  llm_id: 'tenant_llm_id',
  embd_id: 'tenant_embd_id',
  asr_id: 'tenant_asr_id',
  tts_id: 'tenant_tts_id',
  img2txt_id: 'tenant_img2txt_id',
  rerank_id: 'tenant_rerank_id',
};

// llm-util.ts:86-95 — API 白名单（路径已过期）
const API_WHITELIST = [
  '/api/v1/users/me/models',
  '/api/v1/chats',
  '/v1/canvas/set',
  '/v1/canvas/setting',
  '/api/v1/searches/',
  '/api/v1/memories',
  '/api/v1/datasets',
  '/v1/dataflow/set',
];
```

**问题分析**:

1. **白名单路径过期**: API 调用已迁移至 `/api/bff/proxy/v1/...`，但白名单仍使用旧 `/api/v1/...` 路径。`isUrlInWhitelist()` 永远返回 `false`，`addTenantParams` **已静默失效**。

2. **Phase 3 后彻底无用**: Migration 006 删除 `tenant.tenant_llm_id` 等列后，即使传送这些参数也会被忽略。模型选择已由 TEAM API 提供。

**建议变更**:

```typescript
// Phase 3: addTenantParams 不再需要。模型选择来自 TEAM API。
// 保留函数签名但返回原始数据（向后兼容），待 Phase 3 上线后移除调用方。
export function addTenantParams(data: any, url?: string): any {
  // Phase 3: tenant FK columns dropped — model selection is now via TEAM API.
  // This function is retained as a no-op for backward compatibility.
  // TODO: remove all callers and this function after Phase 3 deployment.
  return data;
}
```

**影响范围**: `addTenantParams` 在以下文件中被调用：
- `src/utils/api.ts` — `request()` 拦截器（line ~200）
- 需确认实际调用方数量

**部署顺序**: Phase 3 Migration 006 执行前，AgentUI 应先部署此变更（no-op 不影响功能）。

---

## 3. P1 — 建议修改

### 3.1 🟡 KB 创建/编辑增加 project 可见性

**文件**: `src/pages/dataset/dataset-setting/permission-form-field.tsx`
**关联**: `src/constants/permission.ts`

**现状**: `PermissionRole` 枚举仅有 `me` 和 `team` 两个值。

```typescript
// permission.ts — 当前
export enum PermissionRole {
  me = 'me',
  team = 'team',
}
```

**建议**: 增加 `project` 选项。

```typescript
export enum PermissionRole {
  me = 'me',
  team = 'team',
  project = 'project',
}
```

**后端支持**: 方案 A 已使 team/project 共享生效（`before_request` hook 同步成员关系）。`build_ownership_fields` 支持 `visibility=project`。

**UI 行为**:
- 选择 `team` 时，同 team 成员可访问（当前已支持，但成员关系表为空 → 方案 A 修复）
- 选择 `project` 时，同 project 成员可访问（方案 A 同步 project_membership）

**注意**: 如果用户无 project 上下文（`X-Intellect-Project` header 为空），`project` 选项应禁用或隐藏。

### 3.2 🟡 KB 列表按 team/project 过滤

**文件**: `src/pages/datasets/use-select-owners.ts`

**现状**: 所有者过滤仅按 `tenant_id` 分组。

**建议**: 增加 `team_id` 和 `project_id` 维度，让用户可筛选"我创建的"、"team 共享的"、"project 共享的"KB。

**后端支持**: `list_datasets` 已支持 `X-Intellect-Team`/`X-Intellect-Project` header 过滤（`dataset_api.py:415-416`）。

### 3.3 🟡 Team/Project 上下文选择器

**文件**: `src/layouts/components/header.tsx`（或新增组件）

**现状**: 无用户侧 team/project 切换器。`X-Intellect-Team`/`X-Intellect-Project` 由 BFF 根据 `BffTenant` 配置静态注入。

**建议**: 如果用户属于多个 team，增加上下文选择器：
1. 调用 BFF API 获取用户所属的 team/project 列表
2. 选择后通过 header 或 cookie 传递当前上下文
3. BFF 根据选择注入对应的 `X-Intellect-Team`/`X-Intellect-Project`

**注意**: 这需要 BFF 侧配合——BFF 需要支持用户动态选择 team/project 上下文，而非仅从 `BffTenant` 配置读取。这是一个需要跨团队协调的功能。

---

## 4. P2 — 可选优化

### 4.1 🟢 遗留 `webAPI` 端点迁移

**文件**: `src/utils/api.ts`

**现状**: 4 个端点仍使用 `webAPI`（`/v1/...`）直连 RAG：

```typescript
setMeta: `${webAPI}/document/set_meta`,           // line 219
getInputElements: `${webAPI}/canvas/input_elements`, // line 281
fetchAgentLogs: `${webAPI}/canvas/${canvasId}/sessions`, // line 296
dataflow CRUD: `${webAPI}/dataflow/...`,            // lines 353-357
```

**建议**: 迁移至 `restAPIv1`（`/api/bff/proxy/v1/...`），统一走 BFF 代理。

**影响**: 这些端点将开始携带 BFF 注入的 `X-Intellect-*` header（P0-1），使数据流追踪和审计更完整。

### 4.2 🟢 模型管理 UI 适配 TEAM API

**文件**: `src/pages/user-setting/setting-model/index.tsx`

**现状**: 模型管理通过 BFF 代理到 RAG 的 `/api/v1/providers`。Phase 2 后模型选择源在 TEAM，但由于 BFF 代理透明，**UI 暂不需改动**。

**Phase 3 后可选**: 直接调 TEAM admin API（`/api/tenants/{tid}/model-config`）管理默认模型选择，跳过 RAG 代理。这需要：
1. BFF 新增代理路由或前端直连 TEAM admin API
2. 新增 UI 页面展示租户当前默认模型配置

### 4.3 🟢 Admin 面板增加模型配置页

**文件**: `src/pages/admin/`（新增）

**现状**: Admin 面板有 Teams/Projects/Tenant Bindings 页面，但无模型配置管理。

**建议**: 新增 `/admin/tenant-model-config` 页面：
- 选择 Tenant → 查看/编辑各 task_type 的默认模型
- 调用 TEAM API: `GET/PUT /api/tenants/{tid}/model-config`

---

## 5. 无需变更

| 项目 | 原因 |
|------|------|
| P0-1（`X-Intellect-User` header） | BFF 中间件自动注入，前端无感 |
| 方案 A（被动同步） | `before_request` hook 透明执行 |
| API 代理路径 | `restAPIv1` 已设为 `/api/bff/proxy/v1` |
| Auth 流程 | cookie 模式 + BFF token→member_id 解析 |
| 模型配置读取 | `ModelConfigClient` 在 RAG 侧透明切换 TEAM/本地 |

---

## 6. 部署顺序

```
1. AgentUI: addTenantParams → no-op (P0)
2. TEAM: Phase 2 API 部署
3. RAG: verify_model_config_migration.py
4. RAG: Migration 006 DROP COLUMN
5. AgentUI (可选): P1/P2 功能增强
```

---

## 附录：相关文件索引

| 文件 | 说明 |
|------|------|
| `src/utils/llm-util.ts:80-144` | `addTenantParams` + `modelParamMap` + `API_WHITELIST` |
| `src/utils/api.ts:1-4` | `webAPI` vs `restAPIv1` 常量 |
| `src/constants/permission.ts` | `PermissionRole` 枚举（`me`/`team`） |
| `src/pages/dataset/dataset-setting/permission-form-field.tsx` | KB 可见性选择器 |
| `src/pages/datasets/use-select-owners.ts` | KB 列表所有者过滤 |
| `src/pages/user-setting/setting-model/index.tsx` | 模型管理页面 |
| `src/pages/admin/` | Admin 面板 |
