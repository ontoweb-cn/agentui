# Quickstart: Intellect Enterprise Adapter (P3)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-06-26

## 前置条件

1. **intellect-team 运行**(localhost:8642):
   - 配置 `API_SERVER_KEY` 环境变量
   - 创建至少一个 Team(记录 team_id)
   - 启用 `/api/sessions/*` 端点

2. **BFF 环境变量**(`bff/.env`):
   ```bash
   HARNESS_INTELLECT_ENTERPRISE_ADMIN_TOKEN=<your API_SERVER_KEY>
   ```

3. **P0/P1/P2 基础设施就绪**:
   - HarnessStore / TenantStore / AdapterRegistry 已初始化
   - P2 Admin 页面可访问 `/admin/harness-backends`

4. **BffTenant 已绑定企业版后端**:
   - `bff/data/bff-tenants.json` 含一条 tenant,`intellectBackendId` 指向企业版后端
   - `intellectTenantId` 设置为 intellect-team 的 team_id

## 场景 1:新增企业版后端(P2 Admin)

**步骤**:
1. 打开 `http://localhost:5173/admin/harness-backends`
2. 点击"新增后端"
3. 填写:
   - id: `intellect-enterprise-default`
   - name: `Intellect Enterprise Default`
   - type: `intellect-enterprise`
   - endpoint: `http://localhost:8642`
   - adminTokenEnvVar: `HARNESS_INTELLECT_ENTERPRISE_ADMIN_TOKEN`
   - capabilities: canvas=false, knowledgeBase=false, memory=true, mcp=true, multiTenant=true, modelManagement=false
4. 提交

**预期**: 列表新增一行,ready=true(若 intellect-team 可达)

**验证**: `curl http://localhost:9390/api/bff/admin/harness-backends -H "Authorization: Bearer test"`

---

## 场景 2:能力探测(US1)

**步骤**:
```bash
curl http://localhost:9390/api/bff/capabilities \
  -H "Authorization: Bearer test" \
  -H "X-Tenant-Id: <tenant-id>" \
  -H "X-User-Id: <user-id>"
```

**预期**: 返回
```json
{
  "code": 0,
  "data": {
    "backendId": "intellect-enterprise-default",
    "backendType": "intellect-enterprise",
    "capabilities": {
      "canvas": false,
      "multiTenant": true,
      "memory": true
    }
  }
}
```

**验收**: SC-001(BFF 启动 5s 内完成探测)、SC-002(前端 1s 内条件渲染)

---

## 场景 3:Agent 列表(US1)

**步骤**:
```bash
curl http://localhost:9390/api/bff/agents \
  -H "Authorization: Bearer test" \
  -H "X-Tenant-Id: <tenant-id>" \
  -H "X-User-Id: <user-id>"
```

**预期**: 返回 intellect-team `/v1/models` 解析后的 Agent 列表

**容错**: 若 intellect-team 不可达,返回空数组 `[]`(不抛异常)

---

## 场景 4:会话创建(US2)

**步骤**:
```bash
curl -X POST http://localhost:9390/api/bff/agents/<agentId>/sessions \
  -H "Authorization: Bearer test" \
  -H "X-Tenant-Id: <tenant-id>" \
  -H "X-User-Id: <user-id>" \
  -H "Content-Type: application/json" \
  -d '{"title": "测试会话"}'
```

**预期**: 返回 `{ sessionId, title }`

**验证**: `curl http://localhost:9390/api/bff/agents/<agentId>/sessions/<sessionId> -H ...` 返回会话元数据

---

## 场景 5:历史消息(US2)

**步骤**:
```bash
curl http://localhost:9390/api/bff/agents/<agentId>/sessions/<sessionId>/messages \
  -H "Authorization: Bearer test" \
  -H "X-Tenant-Id: <tenant-id>" \
  -H "X-User-Id: <user-id>"
```

**预期**: 新建会话返回空数组 `[]`;对话后返回消息列表

**容错**: session 不存在(404)返回空数组 + console.warn

---

## 场景 6:流式对话(US3,核心)

**步骤**:
```bash
curl -X POST http://localhost:9390/api/bff/agents/<agentId>/sessions/<sessionId>/chat/stream \
  -H "Authorization: Bearer test" \
  -H "X-Tenant-Id: <tenant-id>" \
  -H "X-User-Id: <user-id>" \
  -H "Content-Type: application/json" \
  -d '{"message": "你好,请介绍一下你自己"}' \
  --no-buffer
```

**预期**: 收到 SSE 流,事件类型:
- `assistant.delta` → 文本增量
- `tool.progress`(_thinking)→ reasoning 增量
- `run.completed` → usage + done
- `done` → 流关闭

**验收**: SC-003(首字节 < 2s)、SC-004(reasoning 与 delta 正确区分)

---

## 场景 7:Team/Project 组织隔离头注入验证(US3)

**步骤**: 在 intellect-team 侧开启请求日志,执行场景 6

**预期**: intellect-team 收到的请求头含:
```
Authorization: Bearer <API_SERVER_KEY>
X-Intellect-Team: <team_id>
X-Intellect-Project: <project_id>(若 BffTenant 配置了)
```

**验收**: FR-004(Team/Project 组织隔离头注入)

---

## 场景 8:错误处理

**子场景 8a — intellect-team 不可达**:
- 停止 intellect-team
- 调用场景 2/3 → capabilities 降级返回默认,listAgents 返回空数组
- 调用场景 6 → SSE 流产出 `{type:'error', message:'...'} 后关闭

**子场景 8b — session 不存在**:
- 调用 `GET /api/bff/agents/<agentId>/sessions/nonexistent/messages`
- 预期:返回空数组 `[]` + BFF console.warn

**子场景 8c — API_SERVER_KEY 缺失**:
- 删除 `HARNESS_INTELLECT_ENTERPRISE_ADMIN_TOKEN` env
- 重启 BFF
- 调用场景 3 → 返回空数组,healthCheck=false

---

## 场景 9:回归验证

**步骤**:
```bash
cd bff && npm test
cd .. && npx tsc --noEmit -p tsconfig.json
```

**预期**:
- BFF 测试全过(P0 49 + P1 53 + P2 23 + P3 新增)
- 前端 TypeScript 零错误

**验收**: SC-007(不回归)、SC-008(路由层零改动)

---

## 场景 10:前端集成验证

**步骤**:
1. 启动前端 `npm run dev`
2. 切换租户到企业版后端绑定的 tenant
3. 观察菜单:画布入口应隐藏(canvas=false)
4. 进入对话页,选择企业版 Agent
5. 发送消息,观察流式渲染

**预期**: 与 Intellect RAG 体验一致,reasoning 与 delta 正确区分

**验收**: SC-002(条件渲染)、SC-004(渲染正确)
