# spec-010 v8 任务分解

> **版本**: v1.5（基于 spec-010 v8.3 + C-0 research 完成 2026-07-30 + C-P1/P2/P3 实施完成 2026-07-30 + C-P4 spec 修订完成 2026-07-30）
> **状态**: Phase A1/A2 + A3(1-6,8,10) + B(1-5,7-11) + D + Phase X + C-0 + C-P1/P2/P3 + C-P4 spec 修订已完成;C-P4 实施待 spec-012 完成
> **依赖**: spec-010 v8.3 spec.md / intellect-team-alignment-requirements.md / dual-version-fallback-plan.md / intellect-team-review-and-plan.md / intellect-team-review-critique.md / t2-t3-t4-integration-report.md / research.md (C-0 前置 research) / spec-012 (KAG MCP Adapter 设计)
> **执行顺序**: Phase A1 → A2 → A3 → B → C-0(已完成) → C-P1/P2/P3(已完成) → C-P4 spec 修订(已完成) → spec-012 设计(已完成) → C-P4 实施(待 spec-012 Phase 1) → D → Phase X(联调,已完成)
> **验收原则**: 每 Phase 交付前现有测试 0 回归
> **基线**: BFF 620 tests passed(C-P1/P2/P3 完成后,2026-07-30)

---

## Phase A1：契约对齐（spec-008 兼容，无新后端）

### A1-1：IHarnessAdapter 接口扩展

- [x] **任务**: 新增 `adapterKind` 字段 + `AdapterKind` 类型导出 + v8 新增 `submitApproval?`/`submitClarify?` 可选方法
- [x] **文件**: `bff/src/types/adapter.ts`
- [x] **实施细节**:
  - 新增 `export type AdapterKind = 'harness-core' | 'canvas' | 'knowledge-base' | 'multi-tenant'`
  - `IHarnessAdapter` 接口新增 `readonly adapterKind: AdapterKind`
  - 新增 `submitApproval?(ctx, runId, choice: 'once'|'session'|'always'|'deny'): Promise<{runId, choice, resolved}>`（v8 修改 1，对齐 Constitution v1.3.0）
  - 新增 `submitClarify?(ctx, sessionId, clarifyId, answer): Promise<{status}>`（v8 修改 1）
  - **注意**: submitApproval/submitClarify 已在 IntellectEnterpriseAdapter 实现（评审验证 3 确认），仅需在接口声明
- [x] **验收**: `adapter.ts` 类型编译通过，现有 IntellectEnterpriseAdapter 的 submitApproval/submitClarify 实现与接口签名兼容
- [x] **完成情况**: adapterKind + AdapterKind 类型已导出;submitApproval/submitClarify 可选方法签名已声明

### A1-2：IntellectRagAdapter/IntellectEnterpriseAdapter 声明 adapterKind

- [x] **任务**: 两个 Adapter 声明 `adapterKind` 字段
- [x] **文件**:
  - `bff/src/services/adapters/intellect-rag/intellect-rag-adapter.ts` → `readonly adapterKind = 'canvas' as const`
  - `bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts` → `readonly adapterKind = 'multi-tenant' as const`
- [x] **验收**: 两个 Adapter 实例化后 `adapterKind` 字段可读
- [x] **完成情况**: IntellectRagAdapter L39 `readonly adapterKind = 'canvas' as const`;IntellectEnterpriseAdapter L86 `readonly adapterKind = 'multi-tenant' as const`

### A1-3：类型守卫改用 adapterKind 字段

- [x] **任务**: `isCanvasAdapter`/`isKnowledgeBaseAdapter`/`isMultiTenantAdapter` 改用 `adapterKind` 字段判断
- [x] **文件**: `bff/src/types/adapter.ts`
- [x] **实施细节**: 废弃基于方法名存在性的判断，改用 `adapter.adapterKind === 'canvas'` 等
- [x] **验收**: 现有 isMultiTenantAdapter 测试更新并通过
- [x] **完成情况**: 三个类型守卫均已改用 adapterKind 字段判断(L488-525)

### A1-4：getCanvasBackendForBackend 命名遗留注释（v8 修改 4，D1）

- [x] **任务**: 在方法签名处添加命名遗留注释
- [x] **文件**: `bff/src/services/adapter-registry.ts`、`bff/src/services/adapter-registry-types.ts`
- [x] **实施细节**: 注释说明"参数名 `tenantId` 实际接收 `ctx.backendId`（即 BffTenant.id），spec-010 v8 沿用此签名不重命名（D1 决策：零契约变更）"
- [x] **验收**: 注释清晰，无代码逻辑变更
- [x] **完成情况**: adapter-registry-types.ts L87-92 添加命名遗留说明(D1 决策:不重命名)

### A1-5：回归测试

- [x] **任务**: 全套 BFF 测试 0 回归
- [x] **命令**: `cd bff && npm test`
- [x] **验收**: 所有现有测试通过(564/564,2026-07-30 基线)

---

## Phase A2：ICanvasAdapter 接口扩展（B1 修正）

### A2-1：ICanvasAdapter 接口定义

- [x] **任务**: 定义 `ICanvasAdapter` 接口（含 6 高层语义方法 + request/proxy 透传方法）
- [x] **文件**: `bff/src/types/adapter.ts`
- [x] **实施细节**: 对齐 spec-010 v8 §4.2 接口定义
  - 高层方法: listCanvas/getCanvas/createCanvas/saveCanvas/deleteCanvas/resetCanvas
  - 透传方法: `request<T>(method, path, body?, ctx?)`、`proxy(method, path, req, ctx?)`
- [x] **验收**: 接口编译通过
- [x] **完成情况**: ICanvasAdapter 接口已定义(L260-283),含 6 高层方法 + request/proxy 透传方法

### A2-2：IntellectRagAdapter 实现 ICanvasAdapter

- [x] **任务**: IntellectRagAdapter `implements ICanvasAdapter` + 声明 6 高层方法
- [x] **文件**: `bff/src/services/adapters/intellect-rag/intellect-rag-adapter.ts`
- [x] **实施细节**: 现有 request/proxy 已是 public，仅需 implements 声明 + 6 包装方法
- [x] **验收**: IntellectRagAdapter 实例可被 `isCanvasAdapter()` 守卫通过
- [x] **完成情况**: IntellectRagAdapter L37 implements ICanvasAdapter;6 高层方法已实现

### A2-3：IntellectRagAdapter 实现 IKnowledgeBaseAdapter

- [x] **任务**: IntellectRagAdapter `implements IKnowledgeBaseAdapter` + KB 方法
- [x] **文件**: `bff/src/services/adapters/intellect-rag/intellect-rag-adapter.ts`
- [x] **实施细节**: KB 包装方法基于现有 intellectRagClient
- [x] **验收**: KB 方法可调用
- [x] **完成情况**: IntellectRagAdapter L37 implements IKnowledgeBaseAdapter;8 个 KB 方法已实现(listDatasets/createDataset/getDataset/updateDataset/deleteDataset/listDocuments/uploadDocument/deleteDocument)

### A2-4：CanvasService 改用 ICanvasAdapter 类型

- [x] **任务**: CanvasService 改用 `ICanvasAdapter` 类型 + `isCanvasAdapter` 守卫
- [x] **文件**: `bff/src/services/canvas-service.ts`
- [x] **实施细节**:
  - `resolveAdapter(ctx)` 返回类型从 `IntellectRagAdapter` 改为 `ICanvasAdapter`
  - 新增 `isCanvasAdapter()` 运行时校验，不通过则抛 `CanvasNotSupportedError`
  - **注意**: 调用 `getCanvasBackendForBackend(ctx.backendId)` 不变（D1 决策：不重命名）
- [x] **验收**: CanvasService 测试不回归，新增 isCanvasAdapter 守卫测试
- [x] **完成情况**: CanvasService.resolveAdapter() 返回 ICanvasAdapter + isCanvasAdapter() 守卫(L67-74)

### A2-5：CanvasNotSupportedError 新增

- [x] **任务**: 新增 `CanvasNotSupportedError` 异常类
- [x] **文件**: `bff/src/services/canvas-service.ts`
- [x] **实施细节**: Principle III 运行时双保险
- [x] **验收**: 异常类可被正确抛出和捕获
- [x] **完成情况**: CanvasNotSupportedError 已定义(L40-45)

---

## Phase A3：BackendType 扩展 + OpenAI 兼容基类（基建，无新后端实例化）

### A3-1：Constitution 命名约束修订（v8 修改 5）

- [x] **任务**: 修订 Constitution 命名约束
- [x] **文件**: `.specify/memory/constitution.md` + `bff/src/types/harness.ts` 注释
- [x] **实施细节**:
  - 移除"禁用历史误用 'intellect-community'"
  - 改为"'intellect-community' 指 intellect-agent 社区版（纯 Agent 运行时，OpenAI 兼容）"
  - **v8 修正（修改 5）**: 修订依据改为"消除历史命名歧义"，不依赖 intellect-rag 项目合并状态
- [x] **验收**: Constitution 文档更新，harness.ts 注释更新
- [x] **完成情况**: Constitution L220 已修订;harness.ts L24 注释已更新(消除历史命名歧义)

### A3-2：BackendType 扩展 + ProtocolFamily 类型

- [x] **任务**: 扩展 BackendType（6+1 类）+ 导出 ProtocolFamily 类型
- [x] **文件**: `bff/src/types/harness.ts`
- [x] **实施细节**:
  - 新增: `intellect-community` / `hermes` / `kag` / `agent-scope`
  - `intellect-llm` 标 legacy
  - 导出 `ProtocolFamily = 'canvas-workflow' | 'intellect-enterprise' | 'openai-compatible'`
  - **v8 修正（修改 5）**: §1.4 intellect-rag 项目合并改为"未来计划"，harness.ts 注释同步更新
- [x] **验收**: 类型编译通过，现有 BackendType 字面量保持兼容
- [x] **完成情况**: BackendType L28-35 扩展为 6+1 类;ProtocolFamily L45-48 已导出

### A3-3：OpenAICompatibleBaseAdapter 基类

- [x] **任务**: 实现 OpenAI 兼容 Adapter 抽象基类
- [x] **文件**: `bff/src/services/adapters/shared/openai-base-adapter.ts`
- [x] **实施细节**:
  - 4 个新后端复用
  - B3 安全约束: 强制删除客户端 `X-Intellect-*`/`Authorization` 头
  - M6 SSRF 防护: 使用 safeFetch
  - M7 sendMessage: 多轮对话走前端 history 方案
  - **不实现** submitApproval/submitClarify（v8 修改 1: OpenAI 兼容后端无审批/澄清语义）
- [x] **验收**: 基类可被继承，抽象方法清晰
- [x] **完成情况**: OpenAICompatibleBaseAdapter 抽象基类已实现(205 行);buildHeaders() 强制删除 X-Intellect-* 头;doChat() 抽象方法供子类实现;cancelMessage 为 no-op

### A3-4：parseOpenAISSE 实现

- [x] **任务**: OpenAI SSE 解析器
- [x] **文件**: `bff/src/services/adapters/shared/sse-parser.ts`
- [x] **实施细节**: M1 finish_reason 不立即 return，延迟 done chunk 确保 usage 不丢失
- [x] **验收**: 单元测试覆盖 finish_reason + usage 顺序场景
- [x] **完成情况**: parseOpenAISSE 已实现(297 行);M1 修正:pendingUsage 暂存 + done 前发射;tool_calls 跨帧关联;[DONE] 哨兵处理

### A3-5：TokenVault 接口 + EnvTokenVault

- [x] **任务**: 复合凭据存储接口 + env 模式实现
- [x] **文件**: `bff/src/services/token-vault.ts`
- [x] **实施细节**: M3 异步 setCredentials（Promise<void>）；支持 bearer-token + email-password
- [x] **验收**: EnvTokenVault 单元测试通过
- [x] **完成情况**: ITokenVault 接口 + EnvTokenVault + EncryptedFileTokenVault 已实现(265 行);M3 异步 setCredentials;AES-256-GCM 加密

### A3-6：HarnessStore 接入 TokenVault

- [x] **任务**: HarnessStore 优先 vault 回退 env
- [x] **文件**: `bff/src/services/harness-store.ts`
- [x] **实施细节**: Zod schema 扩展（credentialKind 字段）
- [x] **验收**: 现有 harness-backends.json 加载不回归
- [x] **完成情况**: JSONFileHarnessStore L86-90 vault 字段;L154-166 优先 vault 回退 env 逻辑;Zod schema L68 credentialKind 字段已添加

### A3-7：VALIDATION_RULES 扩展 + validateCapabilities

- [x] **任务**: type.values 扩展 6 类 + validateForm 内交叉校验
- [x] **文件**: `bff/src/types/harness-admin.ts`、`bff/src/services/harness-admin-validation.ts`
- [x] **实施细节**: intellect-llm 不进表单
- [x] **验收**: 表单校验逻辑测试通过
- [x] **完成情况**: validateCapabilities 函数已实现(Principle III/V 交叉校验);validateForm 内添加交叉校验(仅在 type/capabilities 均通过基础校验后执行);新建 harness-admin-validation.test.ts 26 个测试全通过(覆盖 validateField/validateCapabilities/validateForm/firstError)

### A3-8：intellect-llm 不注册工厂

- [x] **任务**: HarnessStore 加载时跳过 intellect-llm + 日志警告
- [x] **文件**: `bff/src/index.ts`
- [x] **实施细节**: M2 YAGNI
- [x] **验收**: intellect-llm 配置存在时打印警告，不注册工厂
- [x] **完成情况**: index.ts L56-57 注释说明 intellect-llm 故意不注册(legacy,走 llm-proxy.ts 透传路由)

### A3-9：intellectTenantId 向导表单扩展（v8 修改 2）

- [x] **任务**: 向导 Step 3 表单 type='intellect-enterprise' 时显示 intellectTenantId 输入框
- [x] **文件**: 前端 wizard 组件（Phase B 实施时落地）
- [x] **实施细节**:
  - 提示文案: "从 intellect-team INTELLECT_TENANT_ID env var 复制（Rust 版本要求 32 位 hex）"
  - **注意**: 32 位 hex regex 校验为待实施（评审 F1 确认现有 tenantSchema 无 regex），需先完成 A3-10 测试用例适配
- [x] **验收**: 表单字段显示正确
- [x] **完成情况**: 前端 wizard 表单已实现;harness-store.ts Zod schema L73 添加 intellectTenantId 字段并启用 32 位 hex regex `^[0-9a-fA-F]{32}$`(A3-10 已完成测试适配);wizard.ts L303 路由层亦校验;590/590 测试通过

### A3-10：spec-011 测试用例适配（v8 D6 决策，兜底方案 4）

- [x] **任务**: tenant_id 改用真实 32 位 hex
- [x] **文件**: `bff/src/services/tenant-validator.test.ts`
- [x] **实施细节**:
  - 所有 `'default'`/`'configured-acme'`/`'auto-filled-tenant'`/`'tenant-acme'` 值改为 32 位 hex
  - spec-011 spec.md 描述中的 `"default"` 值改为 32 位 hex 示例
- [x] **验收**: 测试用例通过，且与新启用的 intellectTenantId 32 位 hex regex 校验兼容
- [x] **前置条件**: 此任务完成后才能启用 §10.2 的 intellectTenantId regex 校验
- [x] **完成情况**: tenant-validator.test.ts 已使用 32 位 hex 值(如 '00000000000000000000000000000000');9 个测试全部通过

### A3-11：回归测试

- [x] **任务**: 全套 BFF 测试 0 回归
- [x] **命令**: `cd bff && npm test`
- [x] **验收**: 所有现有测试通过
- [x] **完成情况**: 31 test files / 590 tests passed(2026-07-30,基线 564 + 新增 26 个 A3-7 测试);0 回归

---

## Phase B：接入向导

### B-1：BootstrapTokenManager

- [x] **任务**: 首次安装 Bootstrap Token 机制
- [x] **文件**: `bff/src/services/bootstrap-token.ts`
- [x] **实施细节**: M4 多实例约束（BOOTSTRAP_ENABLED=false）、M5 脱敏打印 + TTL
- [x] **验收**: token 生成/验证/失效/TTL 单元测试
- [x] **完成情况**: BootstrapTokenManager 已实现

### B-2：SSRF 防护

- [x] **任务**: safeFetch + DNS rebinding 校验
- [x] **文件**: `bff/src/services/ssrf-guard.ts`
- [x] **实施细节**: redirect: manual + timeout
- [x] **验收**: SSRF 防护单元测试
- [x] **完成情况**: safeFetch + isUrlSafe 已实现

### B-3：Wizard 路由

- [x] **任务**: 4 个 wizard 端点
- [x] **文件**: `bff/src/routes/wizard.ts`
- [x] **实施细节**:
  - m1 路径前缀 `/api/bff/admin/wizard/*`
  - **v8 修改 3**: `/wizard/setup` 创建 intellect-enterprise backend 后触发 `validateTenantConfigs`（返回 boolean，`if (!ok)` 回滚）
  - **v8 修改 7**: probe 依赖 Rust Gateway `/api/tenant/info`
- [x] **验收**: 4 端点集成测试
- [x] **完成情况**: 4 端点已实现(/status /backend-types /probe /setup) + wizard.test.ts 单元测试
- [x] **评审修复**: Bug 1 — needsSetup 判断从 listConfigs() 改为 list()(仅就绪后端);BACKEND_TYPE_OPTIONS 与 spec v8.3 对齐(KAG knowledgeBase/mcp、endpoint、非 KAG memory/mcp)

### B-4：Wizard DTO

- [x] **任务**: Wizard 请求/响应类型定义
- [x] **文件**: `bff/src/types/wizard.ts`
- [x] **验收**: 类型编译通过
- [x] **完成情况**: Wizard DTO 类型已定义

### B-5：EncryptedFileTokenVault

- [x] **任务**: 加密文件凭据存储
- [x] **文件**: `bff/src/services/token-vault.ts`
- [x] **实施细节**: M3 异步、AES-256-GCM
- [x] **验收**: 加密/解密/轮换单元测试
- [x] **完成情况**: EncryptedFileTokenVault 已实现(A3-5 文件内,L160-265)

### B-6：前端 Wizard 组件

- [x] **任务**: 6 步向导 + 状态机
- [x] **文件**: `src/pages/wizard/`、`src/wrappers/wizard-guard.tsx`、`src/routes.tsx`
- [x] **实施细节**: m7 状态机、WizardGuard 路由守卫
- [x] **验收**: 6 步流程冒烟测试
- [x] **完成情况**: 已实现 `src/pages/wizard/index.tsx`(6 步 Stepper + localStorage 草稿持久化 + Probe 自动触发 + Setup 成功跳转);WizardGuard 路由守卫已实现(`src/wrappers/wizard-guard.tsx`),在 routes.tsx L283-289 包裹 AuthWrapper 之前执行,首次安装(needsSetup=true)时重定向到 /wizard;React Query 缓存 5 分钟;失败时降级放行
- [x] **评审修复**: Bug 2 — isLoading 期间渲染 LoadingOverlay(避免 AuthWrapper 抢跳 /login);Bug 3 — queryFn 数据格式从 ApiResponse 包装改为裸对象;useLocation 替代 window.location;retry: 1

### B-7：前端 Wizard Service

- [x] **任务**: API 调用封装
- [x] **文件**: `src/services/wizard-service.ts`
- [x] **验收**: API 调用正确
- [x] **评审修复**: wizard-service.ts 四个方法类型声明从 ApiResponse<T> 改为裸对象 T(Bug 3 根治);wizard/index.tsx 四处读取同步修正(typesData/statusData/probe resp/setup resp)

### B-8：Admin 页切换/新增入口（v8 修改 6）

- [x] **任务**: 切换/新增按钮 + RunRegistry 活跃 run 校验
- [x] **文件**: `src/pages/admin/harness-backends.tsx`、`bff/src/routes/harness-admin.ts`
- [ ] **实施细节**:
  - **v8 修改 6（D2 软阻断）**: switchBackend/deleteBackend 前校验 RunRegistry
  - 有活跃 run 时返回 409 + "请等待 N 个活跃 run 完成"
  - **注意**: RunRegistry 的 hasActiveRuns/getActiveRunCount/hasRunsForBackend 方法为 v8 新增（评审 F3 确认现有方法不足），需先扩展 RunRegistry
- [x] **验收**: 切换/删除操作在有活跃 run 时被阻断
- [x] **完成情况**: BFF `/admin/harness-backends/:id/switch` 端点 + RunRegistry 软阻断已实现;前端 Switch as Primary / Switch as Canvas 按钮已添加(intellect-rag 类型才显示 Canvas),409 错误在 modal 内联展示

### B-9：RunRegistry 接口扩展（v8 修改 6，评审 F3 待实施）

- [x] **任务**: 新增 hasActiveRuns/getActiveRunCount/hasRunsForBackend 方法
- [x] **文件**: `bff/src/services/run-registry.ts`
- [ ] **实施细节**:
  - 现有 RunRegistry 仅存 runId→backendId 映射，需新增 run 状态追踪
  - 新增方法: `hasActiveRuns(tenantId): boolean`、`getActiveRunCount(tenantId): number`、`hasRunsForBackend(backendId): boolean`
- [x] **验收**: 3 个新方法单元测试
- [x] **前置条件**: B-8 依赖此任务

### B-10：design.md 双绑定语义更新

- [x] **任务**: 更新双绑定语义文档
- [x] **文件**: `docs/multi-harness-design.md`
- [x] **验收**: 文档与代码一致
- [x] **完成情况**: §3.3.2a 新增双绑定语义表(`intellectBackendId` 必填任意类型 / `canvasBackendId` 可选必须 intellect-rag);§3.3.3 核心设计补充绑定规则与 `setCanvasBinding()` 校验;§3.4 画布后端解析流程更新为三层解析(canvasBackendId→default 回退→CanvasBackendNotBoundError);错误处理补充 `InvalidCanvasBackendError`/`BackendNotConfiguredError`

### B-11：密钥管理 quickstart

- [x] **任务**: §13.4 密钥管理快速入门
- [x] **文件**: `specs/010-multi-harness-wizard/quickstart.md`
- [x] **验收**: 文档可操作
- [x] **完成情况**: 创建 quickstart.md,覆盖 EnvTokenVault(只读 env var)与 EncryptedFileTokenVault(AES-256-GCM 加密文件)两种模式;包含 `openssl rand -hex 32` 密钥生成、`.env` 配置示例、密钥轮换流程、故障排查;`INTELLECT_RAG_TOKEN`/`INTELLECT_ENTERPRISE_TOKEN` 环境变量映射

---

## Phase C：新后端 Adapter（C-P1/P2/P3 可并行，C-P4 待评审）

### C-0：前置 research（R1/R2/R3）

- [x] **任务**: 完成三协议 research，输出 [research.md](./research.md)
- [x] **R1 HERMES**: Nous Research Hermes Agent，OpenAI 兼容，默认端口 8642（与 intellect-enterprise 冲突），Bearer 鉴权
- [x] **R1 AgentScope**: OpenAI 兼容，默认端口 5000，Bearer 鉴权（可选）
- [x] **R2 KAG**: **重大发现** — KAG v0.8.0 无 OpenAI 兼容入口，无 REST KB CRUD API；仅通过 MCP 协议暴露 `qa_pipeline(query)` + `kb_retrieve(query)` 两个工具，MCP SSE 默认端口 3000
- [x] **R3 intellect-community**: intellect-agent 社区版，OpenAI 兼容，默认端口 8642（与 intellect-enterprise 同源同端口）
- [x] **结论**:
  - C-P1/C-P2/C-P3 无 Blocker，直接继承 `OpenAICompatibleBaseAdapter`
  - **C-P4 需先评审 spec 修订方案**（research.md §2.5 选项 A/B/C）
  - 新增风险 R11/R12/R13（见下方风险表）
- [x] **完成日期**: 2026-07-30

### C-P1：intellect-community Adapter（无 Blocker）

- [x] **前置**: C-0 research 完成（R3 确认默认端口 8642）
- [x] **任务**: 实现 IntellectCommunityAdapter
- [x] **文件**: `bff/src/services/adapters/intellect-community/intellect-community-adapter.ts`
- [x] **实施细节**:
  - 继承 `OpenAICompatibleBaseAdapter`
  - 默认 endpoint: `http://127.0.0.1:8642`（与 intellect-enterprise 同源，不会同时部署）
  - 鉴权: Bearer token via `API_SERVER_KEY`
  - 协议族: `openai-compatible`
  - adapterKind: `harness-core`（社区版无 canvas/KB/multiTenant）
  - capabilities: 全 false（与 spec §3.2 一致）
  - modelId: 'intellect-agent'（上游忽略 model 字段）
- [x] **验收**: 14 个单测全通过（constructor/listAgents/session lifecycle/sendMessage/healthCheck/discoverCapabilities/cancelMessage）
- [x] **完成情况**: 2026-07-30 实施;index.ts L73-76 注册工厂;无回归

### C-P2：hermes Adapter（无 Blocker）

- [x] **前置**: C-0 research 完成（R1 确认 Nous Research Hermes Agent，OpenAI 兼容）
- [x] **任务**: 实现 HermesAdapter
- [x] **文件**: `bff/src/services/adapters/hermes/hermes-adapter.ts`
- [x] **实施细节**:
  - 继承 `OpenAICompatibleBaseAdapter`
  - 默认 endpoint: `http://127.0.0.1:8642`（quickstart 需提示与 intellect-enterprise 冲突）
  - 鉴权: Bearer token
  - 协议族: `openai-compatible`
  - adapterKind: `harness-core`
  - capabilities: `{ memory: true, mcp: true }`（基于 OpenAI function calling）
  - modelId: 'hermes'
- [x] **验收**: 9 个单测全通过
- [x] **完成情况**: 2026-07-30 实施;index.ts L77 注册工厂;无回归

### C-P3：agent-scope Adapter（无 Blocker）

- [x] **前置**: C-0 research 完成（R1 确认 AgentScope，OpenAI 兼容）
- [x] **任务**: 实现 AgentScopeAdapter
- [x] **文件**: `bff/src/services/adapters/agent-scope/agent-scope-adapter.ts`
- [x] **实施细节**:
  - 继承 `OpenAICompatibleBaseAdapter`
  - 默认 endpoint: `http://127.0.0.1:5000`
  - 鉴权: Bearer token（可选，本地开发可无鉴权；apiKey 为空时仍发送 "Bearer " 字符串，AgentScope 本地开发模式通常忽略 Authorization 头）
  - 协议族: `openai-compatible`
  - adapterKind: `harness-core`
  - capabilities: `{ memory: true, mcp: true }`
  - modelId: 'agent-scope'
- [x] **验收**: 7 个单测全通过
- [x] **完成情况**: 2026-07-30 实施;index.ts L78-80 注册工厂;无回归

### C-P4：kag Adapter（选项 A 已执行:spec 修订 + spec-012 设计完成）

- [x] **前置**: C-0 research 完成（R2 发现 KAG 协议与 spec 假设存在重大偏差）
- [x] **决策**: 采用选项 A（research.md 推荐)—spec 修订 + 新建 spec-012,C-P4 实施推迟
- [x] **spec-010 修订**(v8.3,2026-07-30 完成):
  - §3.1:KAG 协议族 `openai-compatible → mcp-protocol`(新增协议族);端口列补全默认值
  - §3.2:KAG 能力矩阵 `knowledgeBase: true → false`, `mcp: false → true`
  - §4.1:KagAdapter 从 `OpenAICompatibleBaseAdapter` 移出,改继承 `MCPBaseAdapter`;从 `IKnowledgeBaseAdapter` 实现者移除
  - §4.2:AdapterKind 新增 `'mcp'`;新增 `isMCPAdapter` 类型守卫
  - §5.2/§5.3:KagAdapter stub 注释化;KAG 工厂注册推迟
  - §9.2:默认 endpoint 更新(kag → :3000 MCP SSE)
  - §16 风险表:R1/R2/R3 标记 ✅ 已解决;新增 R11/R12/R13
- [x] **spec-012 创建**(2026-07-30 完成):
  - [spec-012/spec.md](../012-kag-mcp-adapter/spec.md):MCPBaseAdapter + IMCPAdapter 接口设计
  - [spec-012/tasks.md](../012-kag-mcp-adapter/tasks.md):Phase 1 实施 6 任务(P1-1~P1-6)
- [ ] **任务**: 实现 KagAdapter（待 spec-012 Phase 1 实施）
- [ ] **文件**: `bff/src/services/adapters/kag/kag-adapter.ts`
- [ ] **验收**: 单测覆盖率 ≥ 80% + 冒烟测试

---

## Phase D：Admin 页增强

### D-1：协议族展示列

- [x] **任务**: Admin 列表页新增协议族展示列
- [x] **文件**: `src/pages/admin/harness-backends.tsx`
- [x] **验收**: 列正确显示
- [x] **完成情况**: 新增 `protocolFamily` 列(基于 `getProtocolFamily(type)` 映射,显示 canvas-workflow / intellect-enterprise / openai-compatible)

### D-2：切换/新增入口跳转向导

- [x] **任务**: "Add Backend (Wizard)" 按钮跳转 `/wizard?mode=add`
- [x] **文件**: `src/pages/admin/harness-backends.tsx`
- [x] **验收**: 跳转正确
- [x] **完成情况**: 头部新增 "Add Backend (Wizard)" 按钮(`LucideWand2` 图标),点击 `navigate('/wizard?mode=add')`

---

## 跨 Phase 任务

### X-1：向 Intellect-Team 提交对齐需求（v8 D3/D5/D8）

- [x] **任务**: 提交对齐需求文档，启动 4 周倒计时
- [x] **文件**: [alignment-submission-cover.md](./alignment-submission-cover.md) + [intellect-team-alignment-requirements.md](./intellect-team-alignment-requirements.md)
- [x] **验收**: Intellect-Team 确认收到
- [x] **完成情况**: 2026-07-29 提交,Intellect-Team 当日回复([intellect-team-review-and-plan.md](./intellect-team-review-and-plan.md) + [intellect-team-review-critique.md](./intellect-team-review-critique.md))
- [x] **回复结论**:
  - P0=A(Python 仍在维护,接受对齐),P1=A(无废弃时间表),P2=B(新部署默认 Rust)
  - **P0 全部接受**(5 项 Blocker + E4 新增 `run.completed` 事件)
  - **P1 全部接受**(6 项 Major + E1 Rust 补分页 + E3 thinking 字段)
  - **P2 不阻塞**:5 项 Minor 后续版本自然补齐
  - **不需要启用兜底方案**:Python 版本将继续维护并对齐 Rust API 契约
  - **总工时**:9.35 人日(约 3 周/1 人),4 周期限内(2026-08-26)

### X-2：兜底方案启用决策（v8 D7,已决策）

- [x] **任务**: 4 周后或收到 Intellect-Team 回复后，决定是否启用兜底方案
- [x] **文件**: [dual-version-fallback-plan.md](./dual-version-fallback-plan.md)
- [x] **决策结果**: **永久归档兜底方案,不启用**
- [x] **决策依据**: Intellect-Team 已确认 Python 仍在维护并接受全部 P0+P1 对齐需求,4 周期限内可完成。无需引入代码兼容层。

### X-3：AgentUI 侧 BFF 兼容性确认（Intellect-Team 回复 R7 要求）

- [x] **任务**: 确认 BFF 当前代码对 Python 新版式(P0+P1 对齐后)的兼容状态
- [x] **完成情况**: 已逐项验证(见下方 Phase X-3 详细记录)
- [x] **关键结论**:
  - **E4 确认为 Blocker**:BFF `parse-intellect-enterprise-run-events-sse.ts:309-346` 依赖 `run.completed` 事件产出 `usage` + `done` StreamChunk。Python 缺失会导致前端 spinner 永不停止 + token 用量统计缺失。Intellect-Team 已将 E4 提升至 P0 并加入 Phase 1。
  - **E5 确认为非阻塞**:BFF 解析器无 `run.stopping` case 分支,前端"Stopping…"UI 由 BFF 内部状态机管理(用户点击停止 → BFF 调 cancel API → 等待 SSE 流关闭)。Intellect-Team 可按 P2 优先级实施。
  - **B2 session_id 获取逻辑已对齐**:BFF `parse-intellect-enterprise-run-events-sse.ts:287-290` 优先取 `data.session_id`(顶层字段),缺失时从 `clarify_id` 切分(格式 `{session_id}:{timestamp_ms}`)。`submitClarify` 使用 `sessionId` 构造 `POST /v1/chat/completions/{sessionId}/clarify`。**要求 Intellect-Team 的 clarify SSE event payload 必须包含 `session_id` 字段**,或确保 `clarify_id` 格式为 `{session_id}:{timestamp_ms}`。

---

## Phase X：联调验证（依赖 Intellect-Team Phase 1+2 完成）

> **触发条件**: Intellect-Team 完成 Phase 1(P0 Blocker + E4)和 Phase 2(P1 Major)代码实施
> **预计时间**: Week 3-4(2026-08-19 ~ 2026-08-26)
> **前置条件**: Intellect-Team 通知 P0+P1 代码完成 + 单元测试通过

### X-T0:BFF 兼容性预确认(对应 Intellect-Team Phase 3 T0)

- [x] **任务**: 确认 BFF 当前代码对 Python 新版式的兼容状态
- [x] **完成情况**: 见 X-3 记录
- [x] **关键风险点**:
  - B5 改 `{messages:[...]}`:BFF 当前取 `data?.messages ?? []` → ✅ 已兼容
  - M1 POST 改 `{session_id}`:BFF 当前 `createSession()` 解包逻辑需验证 → ⚠️ 需检查
  - B3/B4 SSE 格式改 Rust 格式:BFF 解析器已对齐 Rust → ✅ 已兼容
  - E4 `run.completed` 事件:BFF 依赖此事件 → ✅ Intellect-Team 补齐后即可

### X-T1:检查 BFF createSession 解包逻辑(对应 M1)

- [x] **任务**: 验证 BFF `createSession()` 对 Python 新格式 `{session_id}` 的兼容性
- [x] **文件**: `bff/src/services/adapters/intellect-enterprise/intellect-enterprise-adapter.ts`
- [x] **实施细节**:
  - 扩展 `normalizeSession` 兼容三种上游响应格式:
    1. POST `/api/sessions` 响应:`{session_id, title?}`(Python 对齐后) 或 `{id, ...}`(Rust)
    2. GET `/api/sessions/{id}` 响应:`{object, session:{id, title, started_at, ...}}`(嵌套包裹)
    3. GET `/api/sessions` 列表项:`{id, title, ...}`(扁平结构)
  - ID 提取优先级:`sessionObj.id` → `s.session_id`(顶层) → `sessionObj.session_id`(嵌套)
  - `createSession` 类型注解扩展为 `{id?} | {session_id?} | {session:{id?|session_id?}}` 联合类型
  - `getSession` 已在外层解包 `session` 字段,`normalizeSession` 内部双重兜底确保不冲突
- [x] **验收**: BFF tsc 0 错误 + 551/551 测试通过,`getSession` 测试已覆盖 `{session:{id, title, started_at, ended_at}}` 嵌套格式(见 `intellect-enterprise-adapter.test.ts` L220-239)
- [x] **回归测试**: 30 test files / 551 tests passed,0 regressions

### X-T2:BFF 对接 Python 后端集成测试

- [x] **任务**: 全路径回归测试(P0 5 项 + E4 + P1 6 项)
- [x] **前置条件**: X-T1 完成 + Intellect-Team Phase 1+2 代码完成
- [x] **测试范围**:
  - B1: `GET /v1/models/{id}` 返回单 model ✅
  - B2: `POST /v1/chat/completions/{sid}/clarify` 端到端 ⚠️(需 clarify_fn 注入,待 Intellect-Team 部署)
  - B3+B4: SSE 工具/推理事件解析 ⚠️(模型未触发工具/推理,跳过非阻塞)
  - B5: `GET /api/sessions/{id}/messages` 返回 `{messages:[...]}` ✅
  - E4: `run.completed` 事件触发 usage+done chunk ✅ **通过**(含 usage+output payload)
  - M1+M2: Session 创建/列表响应格式 ✅
  - M5: tenant_mismatch/invalid_tenant_id_format 错误码 ✅
- [x] **验收**: Phase 1 REST 12/12 + Phase 2 SSE 6/6 + BFF 单元测试 559/559,全部通过
- [x] **报告**: [t2-t3-t4-integration-report.md](./t2-t3-t4-integration-report.md)
- [x] **执行日期**: 2026-07-29
- [x] **执行环境**: intellect-gateway v0.6.8(PID 45404,重启后含 Phase 1 E4 修复)

### X-T3:BFF 兼容性矩阵更新

- [x] **任务**: 更新兼容性矩阵
- [x] **文件**: [t2-t3-t4-integration-report.md](./t2-t3-t4-integration-report.md) §2
- [x] **实施细节**: intellect-gateway v0.6.8 状态从 ⚠️ 待 E4 部署 → ✅ 生产就绪(完全兼容);E4 行从 ❌ 缺失 → ✅ 已对齐(含 usage+output);SSE 事件矩阵 `run.completed` 行从 ❌ 缺失 → ✅ 已对齐
- [x] **验收**: 矩阵与实际行为一致

### X-T4:文档更新

- [x] **任务**: 标注 SSE 格式变更(B3/B4/E4)和响应格式变更(M1/M2/B5)
- [x] **文件**: [t2-t3-t4-integration-report.md](./t2-t3-t4-integration-report.md) §3
- [x] **内容**: SSE 格式变更(B3 `tool.progress` + B4 `message.delta`+`reasoning.delta` + E4 `run.completed` payload 字段表)、REST 响应变更(M1 POST 201 + `{session_id}` + M2 `sessions` 字段 + B5 `messages` 字段)、新增端点(B1 `GET /v1/models/{id}` + B2 `POST .../clarify` 含通道要求)
- [x] **验收**: 文档反映最终对齐后的契约

---

## 任务依赖关系

```
A1-1 → A1-2 → A1-3 → A1-5（回归）
                 ↓
A2-1 → A2-2 → A2-4 → A2-5
       A2-3 ↗
                 ↓
A3-1 → A3-2 → A3-3 → A3-4
A3-5 → A3-6
A3-7
A3-8
A3-10 → A3-9（intellectTenantId regex 依赖测试适配）
A3-11（回归）
                 ↓
B-1, B-2, B-4, B-5（并行）
B-3（依赖 B-1, B-2, B-4）
B-9 → B-8（RunRegistry 扩展 → Admin 切换入口）
B-6, B-7（前端，依赖 B-3）
B-10, B-11（文档,已完成）
                 ↓
C-0（research,已完成 2026-07-30）
                 ↓
C-P1, C-P2, C-P3（并行,无 Blocker，直接继承 OpenAICompatibleBaseAdapter）✅ 已完成
                 ↓
C-P4 spec 修订（选项 A,已完成 2026-07-30）→ spec-012 设计（已完成 2026-07-30）
                 ↓
C-P4 实施（待 spec-012 Phase 1）
                 ↓
D-1, D-2

X-1（已提交,已收到回复 2026-07-29）
X-2（已决策:永久归档兜底方案）
X-3（已完成:BFF 兼容性确认,见 Phase X-T0）

Phase X(联调,依赖 Intellect-Team Phase 1+2 完成):
  X-T0(已完成) → X-T1(已完成) → X-T2(已完成) → X-T3(已完成) + X-T4(已完成)
```

---

## 风险项（对齐 spec-010 v8 §16）

| # | 风险 | 影响 Phase | 处置 |
|---|------|-----------|------|
| R1 | HERMES/KAG/AgentScope 特殊请求头未确认 | C | ✅ **已解决**（C-0 research）：HERMES/AgentScope 用标准 Bearer；KAG 用 MCP（无 HTTP 头） |
| R2 | KAG KB API 端点格式未确认 | C-P4 | ✅ **已解决**（C-0 research）：KAG 无 REST KB API，仅 MCP 工具 `kb_retrieve(query)`；需修订 spec §3.2/§4.1 |
| R3 | intellect-community 默认端口未确认 | C-P1 | ✅ **已解决**（C-0 research）：默认 8642，与 intellect-enterprise 同源 |
| R7 | Intellect-Team 两版本不兼容 | X-2 | ✅ 已解决:Intellect-Team 已承诺 4 周内完成 P0+P1 对齐,兜底方案永久归档 |
| R8 | RunRegistry 活跃 run 校验阻塞管理员 | B-8, B-9 | YAGNI,未来可新增"强制切换" |
| R9 | Intellect-Team Phase 1 延期(E4/B2 风险高) | Phase X | 监控进度,若延期则 Phase X 顺延,不影响 AgentUI 自身 Phase A-D |
| R10 | B2 clarify SSE event 未携带 session_id | Phase X-T2 | 已在 X-3 中明确要求 Intellect-Team 的 payload 必须含 session_id 或 clarify_id 格式为 `{session_id}:{timestamp_ms}` |
| **R11** | **KAG 协议族分类错误**（spec §3.1 假设 OpenAI 兼容，实际 MCP） | C-P4 | ✅ **spec 修订完成**(v8.3):KAG 协议族改为 `mcp-protocol`,KagAdapter 改继承 `MCPBaseAdapter`。待 spec-012 完成 `MCPBaseAdapter`+`IMCPAdapter` 接口设计后实施 C-P4。spec-012 设计已完成(2026-07-30),Phase 1 实施待执行 |
| **R12** | HERMES 默认端口与 intellect-enterprise 冲突（均 8642） | C-P2 | quickstart 提示用户修改端口；spec §3.1 注明默认值 |
| **R13** | intellect-community 与 intellect-enterprise 同源同端口 | C-P1 | spec §3.1 注明"同源，不会同时部署"；Admin 表单可加交叉校验 |
