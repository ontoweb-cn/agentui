# RAG → Gateway 迁移方案技术评审

> **评审对象**: 前序两轮分析（RAG 直连接口清单 + Admin 迁移评估/Gateway 对端映射/技术风险）
> **评审日期**: 2026-08-14
> **评审范围**: `authMode=intellect-enterprise` 下，将 RAG 管理接口迁移到 Intellect Gateway 的可行性、接口清单、风险
> **代码基线**: `6ec951c`（2026-08-13 拉取）

---

## 一、评审方法

1. 重新核验关键源码事实（Constitution v1.2.0、spec-008、adapter-registry、proxy.ts、http-client.ts、membership-resolver.ts）
2. 对前序分析的每个核心论断进行证伪/证实
3. 标注发现的偏差、遗漏、过度简化
4. 给出修正后的结论

**评审结论总览**：前序分析方向正确，但存在 **4 处需修正**、**3 处需补充**、**2 处过度简化**。修正后结论不变（Admin 维持现状，非 Admin 可迁移但工作量大），但风险刻画和分类更精确。

---

## 二、评审发现

### 2.1 需修正的论断

#### F1: Canvas 域迁移范围被高估（过度简化）

**前序论断**：Canvas 全域 ~22 个接口列为迁移候选，需修改 Constitution Principle III。

**评审修正**：根据 [Constitution v1.2.0 边界澄清](file:///Users/simon/project/agentui/.specify/memory/constitution.md) 与 [spec-008/spec.md](file:///Users/simon/project/agentui/specs/008-explicit-canvas-service/spec.md)：

- Principle III 的 "画布功能" 指**画布引擎能力**（Canvas DSL 编辑、节点组件库、RAG 引用结构）
- Canvas Workflow SSE 传输协议属 Principle IV 范畴，**已在迁移**
- spec-008 R5.2 已将 canvas agent 执行（rerun/debug）标记迁移到 Gateway `/v1/runs + dsl_run`

**修正后的 Canvas 分类**：

| 子类 | 接口示例 | 迁移性 |
|------|---------|--------|
| **存储 CRUD**（Principle III 硬绑定） | `GET/POST/PUT/DELETE /api/v1/agents`、`/templates`、`/tags`、`/versions`、`/webhook/*`、`/upload`、`/attachments/*` | ❌ 不可迁移，需修改 Constitution |
| **执行类**（Principle IV，已迁移/迁移中） | `POST /api/v1/agents/rerun` → `POST /v1/runs`、`POST /api/v1/tasks/{taskId}/cancel` → `POST /v1/runs/{run_id}/stop` | ✅ 已迁移 |
| **辅助查询**（语义模糊，需个案评估，详见 §2.1.1） | `GET /api/v1/agents/{id}/logs/{messageId}`、`GET /api/v1/canvas/input_elements`、`GET /api/v1/canvas/{id}/sessions` | ⚠️ 个案评估后：均不纳入本次 Gateway 迁移范围 |

**影响**：Canvas 域真正需要讨论的接口从 ~22 个降为 ~15 个（存储类），且明确受 Constitution 约束，不应简单列入"迁移候选"。

#### 2.1.1 辅助查询类接口个案评估（F1 细化）

核对 [api.ts:294-311](file:///Users/simon/project/agentui/src/utils/api.ts#L294-L311) 与 [canvas-service.ts:170-178](file:///Users/simon/project/agentui/bff/src/services/canvas-service.ts#L170-L178)，发现三个辅助查询接口的当前路由路径不一致，且 spec-008 存在迁移遗漏：

| 接口 | 前端当前路径 | BFF 路由 | 是否 RAG 直连 |
|------|------------|---------|--------------|
| `trace`（logs/{mid}） | `bffCanvas/${id}/logs/${mid}` | canvas.ts → CanvasService | ❌ 否（已走 IntellectRagAdapter） |
| `getInputElements` | `restAPIv1/canvas/input_elements` | **proxy.ts catch-all** | ✅ 是 |
| `fetchAgentLogs`（canvas/{id}/sessions） | `restAPIv1/canvas/${id}/sessions` | **proxy.ts catch-all** | ✅ 是 |

**个案评估结论**：

| 接口 | 迁移到 Gateway | 迁移到 bffCanvas | 本次 Gateway 迁移范围 |
|------|---------------|-----------------|---------------------|
| `trace` | ❌ 不可（Principle III + 数据归属 RAG；且 Gateway `/v1/runs/{id}/events` 是实时流，与事后查询语义不同） | ✅ 已迁移 | ❌ 不在范围（已走 adapter） |
| `getInputElements` | ❌ 不可（Principle III，属"节点组件库"） | ⚠️ 应迁移（spec-008 US1 遗漏） | ❌ 不在范围（Principle III） |
| `fetchAgentLogs` | ⚠️ 待 canvas 存储迁移后评估（当前 canvas 存储走 RAG，关联关系必须在 RAG 侧查询） | ⚠️ 应迁移（spec-008 US1 遗漏） | ❌ 当前不在范围 |

**关键发现**：
1. `trace` 已通过 CanvasService 走 IntellectRagAdapter，**不是 proxy.ts catch-all 直连**，前序将其列入"辅助查询需评估"会误导，应明确标注"已正确路由，无需迁移"。
2. `input_elements` 和 `canvas/{id}/sessions` 是 **spec-008 US1 的迁移遗漏**（应迁到 bffCanvas 而非 Gateway），不属于本次 Gateway 迁移范围。建议单独发起 spec-008 收尾任务。
3. **Canvas 域真正需要讨论的 Gateway 迁移接口数 = 0**：所有 Canvas 相关接口要么受 Principle III 约束（不迁移），要么已迁移（执行类），要么是 spec-008 遗漏（应迁到 bffCanvas 而非 Gateway）。

---

#### F2: Gateway 需新增接口数量统计不够精确

**前序论断**：Gateway 需新增 ~108 个 endpoint。

**评审修正**：前序统计把所有 RAG `/api/v1/*` 机械映射到 Gateway `/api/*`，未区分两类本质不同的接口：

| 类别 | 含义 | 迁移意义 |
|------|------|---------|
| **A. Gateway 原生实现** | Gateway 自己有数据模型和业务逻辑（如 members/teams/projects/sessions/runs） | ✅ 有意义，减少 RAG 依赖 |
| **B. Gateway 代理 RAG** | Gateway 即使新增路由，底层仍需调用 RAG（如向量检索、embedding、知识图谱） | ⚠️ 意义有限，只是多一跳 |

**修正后的分类统计**：

| 功能域 | A 类（Gateway 原生，有意义） | B 类（Gateway 代理 RAG，意义有限） |
|--------|---------------------------|----------------------------------|
| 用户与租户 | 2（users/me, users/me/models） | 0 |
| 模型 | 1（models/default） | 0 |
| 知识库 CRUD | ~7（datasets CRUD + metadata） | ~10（embedding/check, graph, search, index, ingestions） |
| 文档与 Chunk | ~6（documents CRUD） | ~7（chunks, thumbnails, ingest） |
| 文件管理 | 3 | 0 |
| 记忆 | 7 | 0 |
| MCP | 6 | 0 |
| 搜索 | 8 | 0 |
| 技能 | 6 | 0 |
| 数据流 | 0 | 5（深度依赖 RAG 执行） |
| 数据源与渠道 | 9 | 0 |
| 聊天辅助 | 0 | 5（audio/mindmap/recommendation 深度依赖 RAG） |
| 系统配置 | 2（version, config） | 2（tokens, langfuse） |
| Canvas 存储类 | 0 | ~15（受 Principle III 约束，不迁移） |
| Canvas 执行类 | ~2（已迁移，spec-008 R5.2） | 0 |
| Canvas 辅助查询类 | 0（详见 §2.1.1） | 3（trace 已走 adapter；input_elements/sessions 为 spec-008 遗漏，应迁 bffCanvas） |
| **合计** | **~57** | **~59** |

**影响**：真正值得迁移的是 ~57 个 A 类接口；~44 个 B 类接口迁移后 Gateway 仍需反代 RAG，应优先推动 RAG 团队把这些能力暴露为标准接口，或保持现状。

---

#### F3: 身份模型风险的描述不够精确

**前序论断**：RAG 通过 header 解析身份，Gateway 通过 token 解析，存在"身份模型双 ID 体系"风险。

**评审修正**：核对 [intellect-enterprise-adapter http-client.ts:316-344](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-enterprise/http-client.ts#L316-L344) 与 [proxy.ts:81-92](file:///Users/simon/project/agentui/bff/src/routes/proxy.ts#L81-L92)，**两者身份注入机制一致**（都注入 `X-Intellect-User/Team/Project`）。真正差异是**鉴权凭证**：

| 维度 | RAG 直连（proxy.ts） | Gateway（http-client.ts） |
|------|---------------------|--------------------------|
| Authorization | `imt_` sessionToken（优先）> 动态 admin JWT > 静态 env token | `API_SERVER_KEY`（部署级静态密钥） |
| 身份 header | `X-Intellect-User/Team/Project/Tenant` | `X-Intellect-User/Team/Project/Session-Id/Session-Key` |
| 401 处理 | 降级返回 `{code:0, data:null}` | 抛 `IntellectBackendError` |

**修正后的风险**：迁移后鉴权从"用户会话 token（imt_）"变为"部署级 API_SERVER_KEY"，**用户身份粒度丢失**。RAG 直连时 imt_ token 让 RAG 知道"哪个用户在操作"，Gateway 用 API_SERVER_KEY 则是"BFF 服务账号在操作"。需通过 `X-Intellect-User` header 补偿，但 RAG 侧是否信任该 header 取决于 RAG 实现。

---

#### F4: Admin 迁移评估的论证理由需修正

**前序论断**：RAG Admin 是"RAG 进程内状态"，Gateway 无法替代。

**评审修正**：这个论断对**服务/沙箱/版本**类接口成立，但对**用户管理**类接口不成立：

| Admin 子类 | 是否可迁移到 Gateway | 理由 |
|-----------|---------------------|------|
| 用户管理（`admin/users/*`） | ⚠️ 理论可迁移 | Gateway 有 `members` 表，但 HTTP API 仅实现 `/api/members/me`（只读），需 Gateway 新增 member CRUD |
| 用户资源视图（`admin/users/{username}/datasets`、`/agents`） | ❌ 不可迁移 | 返回的是 RAG 数据，Gateway 无此数据 |
| 服务管理（`admin/services/*`） | ❌ 不可迁移 | RAG 进程内服务状态 |
| 系统版本（`admin/version`） | ❌ 不可迁移 | RAG 进程版本 |
| 沙箱配置（`admin/sandbox/*`） | ❌ 不可迁移 | RAG 运行时配置 |

**修正后的结论**：考虑到用户已明确"Admin管理除外"，且 Admin 中真正可迁移的仅用户管理（需 Gateway 大量新增），**维持 Admin 走 RAG 的结论正确**，但论证理由应修正为"用户管理理论可迁移但成本高，其余接口是 RAG 进程特有状态"。

---

### 2.2 需补充的遗漏

#### S1: capabilities 探测机制应作为迁移前置条件

**遗漏**：前序分析提到 `GET /v1/capabilities` 可探测，但未作为迁移策略的核心。

**补充**：[intellect-admin-api-guide.md 第十节](file:///Users/simon/project/agentui/docs/intellect-admin-api-guide.md) 已设计 `admin_api` 能力声明字段。迁移应要求 Gateway 在 `/v1/capabilities` 响应中增加 `rag_management_api` 字段：

```json
{
  "rag_management_api": {
    "version": "1.0",
    "datasets": true,
    "documents": true,
    "memories": true,
    "mcp": true,
    "searches": true,
    "skills": true,
    "files": true,
    "connectors": true,
    "chat_channels": true
  }
}
```

BFF 探测后再决定路由，避免对旧版本 Gateway 发起无效请求。这是**迁移的前置条件**，非可选项。

---

#### S2: 数据一致性风险未充分评估

**遗漏**：前序分析未评估"部分迁移"场景下的数据一致性。

**补充**：若 KB 列表走 Gateway、KB 详情走 RAG（或反之），可能出现：
- Gateway 与 RAG 数据不同步（ replication lag）
- 字段差异（Gateway 归一化后字段名与 RAG 原生不同）

**建议**：同一功能域必须**整体迁移**（如 datasets 域所有接口一起迁），不可拆分。前序的 P0→P3 分批方案需补充"功能域内不可拆分"约束。

---

#### S3: 性能与可观测性影响未评估

**遗漏**：前序分析未评估迁移对延迟和可观测性的影响。

**补充**：
- **延迟**：Gateway → RAG 的额外一跳增加 ~5-20ms（B 类接口）；A 类接口若 Gateway 原生实现则可能更快
- **可观测性**：当前 [proxy.ts:149](file:///Users/simon/project/agentui/bff/src/routes/proxy.ts#L149) 有统一日志（method/path/status/耗时）；迁移到分散的显式路由后，需确保各路由文件保持同等日志级别，否则可观测性下降

---

### 2.3 过度简化的论断

#### O1: "前端零改动"论断需限定条件

**前序论断**：前端零改动，只要 BFF 路由路径不变。

**评审修正**：这个论断对**路由路径**成立（[api.ts](file:///Users/simon/project/agentui/src/utils/api.ts) 用 BFF 前缀），但对**响应字段**不成立：

- 若 Gateway 返回字段与 RAG 不同（如 `name` vs `display_name`），BFF 必须做字段映射，否则前端解析失败
- 前序 F3（身份模型）提到的字段差异同样适用

**修正**：前端路由零改动成立，但 BFF 必须承担字段映射责任，否则前端会受影响。

---

#### O2: catch-all 改显式路由的工作量被低估

**前序论断**：需逐个显式实现路由，工作量从"改 1 个文件"变为"改 ~15 个路由文件"。

**评审修正**：实际工作量更大：
- 不仅要新增路由文件，还要为每个接口实现字段映射、错误转换、401 降级
- 参考 [bff-agents.ts](file:///Users/simon/project/agentui/bff/src/routes/bff-agents.ts) 已迁移的 Agent/Session 路由，每个接口约需 20-40 行 BFF 代码
- ~57 个 A 类接口 × 30 行 ≈ 1700 行新代码，且需配套测试

---

## 三、修正后的结论

### 3.1 Admin 迁移（维持原结论，修正论证）

| 评估项 | 结论 |
|--------|------|
| 用户管理（`admin/users/*`） | ⚠️ 理论可迁移，但 Gateway 需新增 member CRUD HTTP API，成本高 |
| 用户资源视图 | ❌ 不可迁移，返回 RAG 数据 |
| 服务/沙箱/版本 | ❌ 不可迁移，RAG 进程特有状态 |
| **整体结论** | 维持现状（与用户"Admin管理除外"要求一致） |

### 3.2 非 Admin 迁移（细化分类）

| 类别 | 接口数 | 迁移建议 |
|------|--------|---------|
| **A 类：Gateway 原生实现** | ~57 | ✅ 值得迁移，按 P0→P3 分批 |
| **B 类：Gateway 代理 RAG** | ~44 | ⚠️ 意义有限，优先推动 RAG 标准化或保持现状 |
| **Canvas 存储类** | ~15 | ❌ 受 Constitution Principle III 约束，不迁移 |
| **Canvas 执行类** | ~2 | ✅ 已迁移（spec-008 R5.2） |
| **Canvas 辅助查询类** | 3 | ❌ 不纳入本次 Gateway 迁移（详见 §2.1.1：trace 已走 adapter；input_elements/sessions 为 spec-008 遗漏，应迁 bffCanvas） |

### 3.3 迁移前置条件（新增）

1. Gateway `/v1/capabilities` 增加 `rag_management_api` 能力声明
2. BFF 实现 capabilities 探测，按探测结果路由（兼容旧版 Gateway）
3. 确认 Gateway 侧 `X-Intellect-User` header 的信任模型（是否需要签名）

### 3.4 迁移约束（新增/强化）

1. **功能域内不可拆分**：同一功能域所有接口必须整体迁移（数据一致性）
2. **字段映射责任在 BFF**：Gateway 返回字段与 RAG 不同时，BFF 必须归一化
3. **401 降级必须保留**：[proxy.ts:152-156](file:///Users/simon/project/agentui/bff/src/routes/proxy.ts#L152-L156) 的 `{code:0, data:null}` 降级是企业版特有兼容行为，迁移后必须保持
4. **multipart 支持需扩展**：[http-client.ts:209](file:///Users/simon/project/agentui/bff/src/services/adapters/intellect-enterprise/http-client.ts#L209) 当前只支持 JSON body，文档上传等接口需扩展
5. **可观测性保持**：各显式路由文件必须保持与 proxy.ts 同等的日志级别

### 3.5 修正后的风险矩阵

| 风险 | 严重度 | 修正说明 |
|------|--------|---------|
| Constitution Principle III（Canvas 存储类） | 🔴 高 | 范围从 ~22 缩小到 ~15（存储类），辅助查询类 3 个经 §2.1.1 个案评估后不纳入本次迁移 |
| spec-008 US1 迁移遗漏 | 🟡 中 | **新增**：`getInputElements`、`fetchAgentLogs` 仍寄生在 proxy.ts catch-all，应迁到 bffCanvas（非本次 Gateway 迁移范围，建议单独收尾） |
| 鉴权凭证差异（sessionToken → API_SERVER_KEY） | 🔴 高 | 修正：非"解析机制差异"，而是"用户身份粒度丢失" |
| 401 降级语义破坏 | 🔴 高 | 补充：企业版特有兼容行为 |
| multipart 文件上传 | 🟡 中高 | 不变 |
| SSE 流式响应 | 🟡 中高 | 不变 |
| 数据一致性（部分迁移） | 🟡 中 | **新增**：功能域内不可拆分 |
| Gateway 代理 RAG 的额外延迟 | 🟢 低 | **新增**：B 类接口 ~5-20ms |
| 字段映射导致前端解析失败 | 🟡 中 | **新增**：BFF 必须承担字段归一化 |
| catch-all 改显式路由工作量 | 🟡 中 | 上调：~1700 行新代码 + 测试 |
| 可观测性下降 | 🟢 低 | **新增**：需保持日志级别 |

---

## 四、评审建议

### 4.1 对前序分析的总体评价

- **方向正确**：识别了 3 处 RAG 直连调用点（catch-all 代理、Canvas adapter、rag-token-provider），分类清晰
- **清单完整**：接口清单覆盖全面，前端零改动论断对路由路径成立
- **需改进**：Canvas 域迁移范围高估、Gateway 新增接口数未区分 A/B 类、身份模型风险描述不精确

### 4.2 下一步建议

1. **优先与 Intellect 团队对齐**：确认 Gateway 是否计划原生实现 A 类接口（~57 个），还是仅做代理。这决定迁移的根本意义。
2. **P0 批次细化**：从 A 类中选取"用户与租户域"（2 个接口）+ "系统配置域"（2 个接口）作为首批，验证迁移模式。
3. **Canvas 单独评估**：Canvas 存储类 ~15 个接口受 Constitution 约束，需单独发起 Constitution 修订评审，不纳入本次迁移范围。辅助查询类 3 个接口经 §2.1.1 评估后均不纳入本次迁移。
4. **spec-008 收尾（独立任务）**：`getInputElements`、`fetchAgentLogs` 仍寄生在 proxy.ts catch-all，应迁到 bffCanvas。这是 spec-008 US1 的遗漏，与本次 Gateway 迁移正交，建议单独发起。
5. **B 类接口暂缓**：~44 个 B 类接口待 RAG 团队标准化接口后再评估。

---

## 五、评审签字

- **评审人**：AI Assistant（基于源码核验）
- **代码基线**：`6ec951c`
- **评审状态**：完成，待用户确认
- **后续动作**：用户确认后，可进入 P0 批次迁移方案设计
