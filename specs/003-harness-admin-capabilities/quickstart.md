# Quickstart: Multi-Harness P2 — Harness Admin 管理端 + 前端能力探测

**Feature**: [003-harness-admin-capabilities](./)
**Date**: 2026-06-26

## 概述

本指南提供 P2 功能的端到端验证场景。每个场景证明一个 User Story 或 Success Criterion 达成。验证顺序按依赖关系编排。

## 前置条件

1. **P0/P1 已完成**:BFF 反向代理 + HarnessStore + AdapterRegistry + IntellectRagAdapter + TenantContext 就位
2. **环境变量就位**:`HARNESS_INTELLECT_RAG_ADMIN_TOKEN`(Intellect RAG admin token)
3. **配置文件就位**:
   - `bff/data/harness-backends.json` — 含至少一个 intellect-rag 后端
   - `bff/data/bff-tenants.json` — 含至少一个绑定该后端的 tenant
4. **BFF 运行中**:`cd bff && npm run dev`(端口 9390)
5. **前端运行中**:`npm run dev`(端口 9391,Vite proxy 转发 /api/bff 到 BFF)
6. **91 个 P0/P1 测试通过**:`cd bff && npm test`

## 验证场景

### 场景 1: AdapterRegistry.invalidate 单元测试 (SC-007)

**目标**: invalidate 正确清空缓存,下次 getAdapterForTenant 创建新实例。

**命令**:
```bash
cd bff && npx vitest run src/services/adapter-registry.test.ts
```

**预期结果**:
- 所有测试通过(含 P1 的 13 个 + P2 新增 invalidate 测试)
- 覆盖:`invalidate()` 清空整个缓存、`invalidate(backendId)` 移除单条目、invalidate 后 getAdapterForTenant 创建新实例(`!==` 旧实例)

---

### 场景 2: HarnessStore.listConfigs 单元测试 (SC-007)

**目标**: listConfigs 返回所有配置(含未就绪),不含 adminToken 明文。

**命令**:
```bash
cd bff && npx vitest run src/services/harness-store.test.ts
```

**预期结果**:
- 所有测试通过(含 P0 的 19 个 + P2 新增 listConfigs 测试)
- 覆盖:listConfigs 返回所有配置、未就绪后端也在列表、响应不含 `"adminToken":` 字段

---

### 场景 3: harness-admin 路由单元测试 (SC-007, SC-008)

**目标**: CRUD 路由正确校验、持久化、热加载、返回不含 token 明文。

**命令**:
```bash
cd bff && npx vitest run src/routes/harness-admin.test.ts
```

**预期结果**:
- 所有测试通过
- 覆盖:
  - GET 列表返回 HarnessBackendWithStatus[](含 ready 字段)
  - POST 新增(校验 id kebab-case / endpoint URL / adminTokenEnvVar 格式,合法的持久化 + 热加载)
  - PUT 编辑(id 只读,校验格式)
  - DELETE(被绑定的 409,未绑定的成功)
  - 响应不含 `"adminToken":` 字段(Token Security,SC-006)
  - id 重复 409,id 不存在 404

---

### 场景 4: capabilities 路由单元测试 (SC-007)

**目标**: 按 tenant 返回绑定后端能力,错误场景正确处理。

**命令**:
```bash
cd bff && npx vitest run src/routes/capabilities.test.ts
```

**预期结果**:
- 所有测试通过
- 覆盖:
  - 合法 tenant 返回 CapabilitiesResponse(backendId/backendName/backendType/capabilities)
  - tenant 不存在 404
  - 缺失 X-Tenant-Id 400
  - Registry 未就绪 503

---

### 场景 5: TypeScript 编译 + 全部测试 (SC-009, SC-010)

**目标**: P0/P1/P2 代码编译通过,所有测试通过(零回归)。

**命令**:
```bash
cd bff && npm run type-check && npm test
cd .. && npx tsc --noEmit -p tsconfig.json
```

**预期结果**:
- BFF type-check 0 错误
- BFF 测试全部通过(91 P0/P1 + P2 新增)
- 前端 type-check 0 错误

---

### 场景 6: Admin 列表 API 冒烟测试 (SC-001)

**目标**: BFF 运行时 GET 列表返回正确数据。

**命令**:
```bash
curl -s -H "Authorization: Bearer test" http://localhost:9390/admin/harness-backends | python3 -m json.tool
```

**预期结果**:
- 返回 `{code: 0, data: [{id, name, type, endpoint, adminTokenEnvVar, capabilities, ready, ...}]}`
- ready 字段反映 env token 就绪状态
- 不含 `adminToken` 明文字段

---

### 场景 7: Admin 新增/编辑/删除冒烟测试 (SC-001, SC-002, SC-003)

**目标**: CRUD 端到端验证(含热加载 + 缓存失效)。

**命令**:
```bash
# 新增
curl -s -X POST -H "Authorization: Bearer test" -H "Content-Type: application/json" \
  -d '{"id":"intellect-rag-test","name":"Test","type":"intellect-rag","endpoint":"http://localhost:9380","adminTokenEnvVar":"HARNESS_INTELLECT_RAG_ADMIN_TOKEN","capabilities":{"canvas":true,"knowledgeBase":true,"memory":true,"mcp":false,"multiTenant":false,"modelManagement":false}}' \
  http://localhost:9390/admin/harness-backends

# 编辑(改 name)
curl -s -X PUT -H "Authorization: Bearer test" -H "Content-Type: application/json" \
  -d '{"name":"Test Updated","type":"intellect-rag","endpoint":"http://localhost:9380","adminTokenEnvVar":"HARNESS_INTELLECT_RAG_ADMIN_TOKEN","capabilities":{"canvas":true,"knowledgeBase":true,"memory":true,"mcp":false,"multiTenant":false,"modelManagement":false}}' \
  http://localhost:9390/admin/harness-backends/intellect-rag-test

# 删除(未绑定,应成功)
curl -s -X DELETE -H "Authorization: Bearer test" http://localhost:9390/admin/harness-backends/intellect-rag-test

# 删除被绑定的(应 409)
curl -s -X DELETE -H "Authorization: Bearer test" http://localhost:9390/admin/harness-backends/intellect-rag-default
```

**预期结果**:
- 新增返回 200 + 新建配置,列表 GET 能查到
- 编辑返回 200 + 更新后配置,name 已变
- 删除未绑定的返回 200,列表不再包含
- 删除被绑定的返回 409,提示"后端已被 tenant X 绑定"

---

### 场景 8: capabilities API 冒烟测试 (SC-004)

**目标**: 按 tenant 返回绑定后端能力。

**命令**:
```bash
curl -s -H "Authorization: Bearer test" -H "X-Tenant-Id: tenant-smoke-test" -H "X-User-Id: user-1" \
  http://localhost:9390/capabilities | python3 -m json.tool
```

**预期结果**:
- 返回 `{code: 0, data: {backendId, backendName, backendType, capabilities}}`
- capabilities 反映 tenant 绑定后端的真实能力(canvas=true for intellect-rag)

---

### 场景 9: 前端 useHarnessCapabilities 冒烟测试 (SC-004, SC-005)

**目标**: 前端启动时查询能力,按能力条件渲染;切换 tenant 重新查询。

**步骤**:
1. 启动前端 `npm run dev`,登录
2. 打开浏览器 DevTools Network,观察 `GET /api/bff/capabilities` 请求
3. 确认返回 capabilities,画布入口按 canvas 字段显示/隐藏
4. 切换 tenant(若有多个),观察 Network 重新发起 capabilities 请求,UI 调整

**预期结果**:
- 启动时发起 capabilities 请求,返回 200
- canvas=true 显示画布入口,canvas=false 隐藏
- 切换 tenant 后 ≤ 1 秒重新查询,UI 调整

---

### 场景 10: Admin 页面 UI 冒烟测试 (SC-001, SC-008)

**目标**: Admin 页面 CRUD 操作可视化验证。

**步骤**:
1. 访问 `/admin/harness-backends`
2. 确认后端列表表格展示(id/name/type/endpoint/capabilities 摘要/状态/操作)
3. 点"新增",填表(id 非法格式测试校验),提交合法数据,列表刷新
4. 点"编辑",改 capabilities,提交,列表刷新
5. 点"删除"被绑定的后端,确认提示冲突
6. 点"删除"未绑定的后端,确认移除

**预期结果**:
- 列表正确展示所有后端 + ready 状态
- 表单校验(id kebab-case / endpoint URL / adminTokenEnvVar 格式)即时反馈
- CRUD 操作成功后列表刷新
- 删除被绑定后端显示冲突提示

---

## 验收清单

执行完所有场景后,确认以下 Success Criteria 达成:

- [ ] SC-001: 场景 7 通过(CRUD ≤ 2 秒,热加载生效)
- [ ] SC-002: 场景 7 通过(编辑后 capabilities 立即更新)
- [ ] SC-003: 场景 7 通过(删除绑定 409,未绑定成功)
- [ ] SC-004: 场景 8/9 通过(capabilities 按 tenant 返回,条件渲染)
- [ ] SC-005: 场景 9 通过(切换 tenant ≤ 1 秒重新查询)
- [ ] SC-006: 场景 3/6 通过(响应不含 adminToken 明文)
- [ ] SC-007: 场景 1-4 通过(覆盖率 ≥ 80%)
- [ ] SC-008: 场景 10 通过(前端 + BFF 双层校验)
- [ ] SC-009: 场景 5 通过(91 P0/P1 测试不回归)
- [ ] SC-010: 场景 5 通过(tsc + vitest 零错误)

## 故障排查

- **Admin API 401**:检查 Authorization header
- **capabilities 400**:检查 X-Tenant-Id / X-User-Id header
- **capabilities 404**:检查 tenant 是否在 bff-tenants.json
- **capabilities 503**:检查 HARNESS_INTELLECT_RAG_ADMIN_TOKEN 是否设置(Registry 未就绪)
- **删除 409**:检查 tenant 是否绑定该后端(bff-tenants.json 的 intellectBackendId/canvasBackendId)
- **热加载不生效**:确认 HarnessStore.load() 在 saveConfig 后被调用,AdapterRegistry.invalidate 被调用
