# AgentUI 多 Harness 后端支持设计方案

> 本文档描述 AgentUI 支持不同 Agent Harness 后端的架构设计与实施方案。
> 配套文档：
> - [Intellect Admin API 接口指南](file:///Users/simon/workspace/agentui/docs/intellect-admin-api-guide.md)（交付 Intellect 团队）
> - [Vite 架构文档第十六章](file:///Users/simon/workspace/agentui/docs/vite-architecture.md)（BFF 整体架构）

## 一、背景与目标

### 1.1 背景

AgentUI 当前与 Intellect 深度耦合，需支持多种 Agent Harness 后端：

| 后端 | 协议 | 项目地址 | 说明 |
|------|------|---------|------|
| Intellect | OpenAI 兼容 REST + SSE | `~/workspace/intellect` | 画布编排 + 知识库 |
| Intellect 企业版 | OpenAI 兼容 REST + SSE | `~/workspace/intellect-team` | 多租户 Team/Project + 编码 Agent |
| Intellect 社区版 | ACP（stdio JSON-RPC） | `~/workspace/intellect-agent` | 单用户，未来扩展 OpenAPI |
| Hermes | ACP | `~/workspace/hermes-agent` | 同 Intellect 同源 |
| OpenClaw | 待确认 | - | - |

### 1.2 本期范围

先对接 **Intellect + Intellect 企业版**，社区版/Hermes/OpenClaw 延后。

### 1.3 目标

1. AgentUI 前端业务代码零改动，只改 API 路径常量 + 新增 Admin 页面
2. BFF 通过 Adapter 层屏蔽后端差异
3. 画布硬绑定 Intellect（复用 Intellect 画布引擎）
4. 多租户通过 BFF 独立模型（BFF 维护 Tenant 实体，绑定到 Intellect 实例）
5. SSE 流式以 Intellect OpenAI 兼容格式为基础

## 二、方案选择：BFF 适配器层（方案 A）

### 2.1 候选方案对比

| 维度 | A. BFF适配器 | B. ACP优先 | C. 前端主导 | D. 微前端 |
|------|------------|-----------|------------|---------|
| 前端改动 | 极小 | 中（换SDK） | 大 | 大 |
| BFF 改动 | 大 | 中 | 极小 | 极小 |
| Intellect 改动 | 无 | 大(建桥) | 无 | 无 |
| 画布编排保留 | ✅ | ❌ | ✅ | ✅ |
| 多租户扩展性 | ✅ | ✅ | ✅ | ✅ |
| 新后端接入成本 | 中(写Adapter) | 低(原生ACP) | 高(写前端service) | 高(写子应用) |
| 长期维护 | 中 | 低 | 高 | 高 |
| 与现有架构一致 | ✅ | 部分 | ❌ | 部分 |

### 2.2 选择方案 A 的理由

1. **保护 Intellect 画布编排**——这是 AgentUI 最有价值的差异化能力，方案 B 会丢失
2. **前端零业务改动**——符合"BFF 生长"方向，前端只改 API 常量
3. **ACP 后端共享一个 Adapter**——Intellect/Hermes/OpenClaw 用同一 `AcpAdapter`，边际成本低
4. **渐进式迁移**——可先做 Intellect Adapter（包装现有逻辑），再加 ACP Adapter
5. **能力探测**——前端通过 `/api/bff/capabilities` 一次性获取后端能力，条件渲染页面

### 2.3 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│  AgentUI 前端（最小改动）                                         │
│  ├── 业务页面（Agent/Session/Canvas，不变）                       │
│  ├── Admin: Harness 后端管理（新增）                              │
│  ├── Admin: 租户/Team/Project 管理（新增）                        │
│  └── useHarnessCapabilities()（新增，条件渲染）                   │
└──────────────────────────────────────────────────────────────────┘
                              ↓ /api/bff/*
┌──────────────────────────────────────────────────────────────────┐
│  BFF (:3001)                                                     │
│  ├── routes/admin.ts（已有：whitelist/roles/resources）           │
│  ├── routes/harness-admin.ts（新增：后端配置管理）                │
│  ├── routes/tenant.ts（新增：租户管理，轻量）                     │
│  ├── routes/team.ts（新增：透传 Intellect Team CRUD）             │
│  ├── routes/project.ts（新增：透传 Intellect Project CRUD）       │
│  ├── routes/agent.ts（重构：调用 Adapter）                        │
│  ├── routes/session.ts（重构：调用 Adapter）                      │
│  ├── routes/canvas.ts（新增：硬绑定 Intellect）                     │
│  │                                                                │
│  ├── services/adapters/                                          │
│  │   ├── types.ts（IHarnessAdapter 接口）                        │
│  │   ├── registry.ts                                             │
│  │   ├── intellect/（IntellectCommunityAdapter）                              │
│  │   └── intellect/（IntellectEnterpriseAdapter）                │
│  │                                                                │
│  ├── services/harness-store.ts（后端配置 + token 存储）           │
│  └── services/tenant-store.ts（BFF 多租户模型）                  │
└──────────────────────────────────────────────────────────────────┘
              ↓                              ↓
┌─────────────────────────┐    ┌─────────────────────────────────┐
│  Intellect (:9380)        │    │  Intellect 企业版 (:8642)       │
│  ├── Agent/Canvas/Dataset│   │  ├── /v1/chat/completions       │
│  └── 画布引擎（唯一）   │    │  ├── /v1/capabilities           │
│                         │    │  ├── /api/sessions              │
│                         │    │  └── /api/teams（需新增）       │
│                         │    │  └── /api/projects（需新增）    │
└─────────────────────────┘    └─────────────────────────────────┘
```

### 2.4 方案要点

1. **BFF 定义 `IHarnessAdapter` 接口**，每个后端实现一个 Adapter
2. **前端零业务改动**，只改 API 路径常量 + 新增 Admin 页面
3. **SSE 流式格式统一**：Intellect 和 Intellect 企业版都是 OpenAI 兼容格式，共用解析器
4. **画布硬绑定 Intellect**：画布是 Intellect 专属能力，不经过 Adapter Registry 选择
5. **多租户通过 BFF 独立模型**：BFF 维护 Tenant 实体，绑定到 Intellect 实例

## 三、关键决策

### 3.1 统一 Schema 范围：三层架构

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: 核心层（Core Schema）                      │
│  所有后端必须实现，取交集                             │
│  → Agent/Session/Message 流式/会话 CRUD              │
├─────────────────────────────────────────────────────┤
│  Layer 2: 扩展层（Extension Schema）                 │
│  通过 capability flags 声明，可选实现                 │
│  → 画布编排/知识库/记忆/MCP/多租户                    │
├─────────────────────────────────────────────────────┤
│  Layer 3: 透传层（Passthrough）                      │
│  后端专有功能，不纳入统一 schema                      │
│  → BFF 透传到后端原生 API，前端用后端原生格式         │
└─────────────────────────────────────────────────────┘
```

**建议理由**：
- 核心层保证"任何后端都能跑基础对话"，降低接入门槛
- 扩展层让强能力后端的功能不被削足适履
- 透传层避免 BFF 成为"全功能代理"的复杂度爆炸

### 3.2 Intellect ACP 实现分析

| 维度 | ACP 实现 | BFF 对接适用性 |
|------|---------|--------------|
| **传输层** | stdio JSON-RPC（`acp.run_agent()` + stdout 传输） | ❌ BFF 是 HTTP 服务，无法直接 spawn 子进程通信 |
| **部署模型** | 编辑器本地集成（Zed/Claude Code 等） | ❌ 适合 IDE 场景，不适合 Web BFF 场景 |
| **会话生命周期** | `initialize/authenticate/new_session/prompt/load_session/cancel/fork_session/list_sessions` | ✅ 语义完整，可作为接口契约参考 |
| **流式协议** | `session/update` 通知（`user_message_chunk/agent_message_chunk/agent_thought_chunk/usage_update/plan`） | ⚠️ 语义丰富但格式是 JSON-RPC notification，非 SSE |
| **多租户** | 无（ACP 是单用户 stdio 协议） | ❌ 企业版多租户需另寻入口 |

**结论**：ACP 的**接口语义**可作为 BFF 统一接口的设计参考，但**传输协议**不适合 BFF 直接对接。

**替代方案**：Intellect 企业版已实现 **OpenAI 兼容 API Server**（`plugins/platforms/api_server/adapter.py`，端口 8642），这才是 BFF 应该对接的入口。

### 3.3 多租户数据隔离：BFF 维护独立模型

Intellect 企业版的数据模型为 **Member → Team → Project** 三层（无 Tenant 实体）。BFF 侧的 Tenant 是逻辑概念，对应一个 Intellect 实例部署：

```
BFF Tenant（BFF 维护，轻量）
  │  └─ 绑定到一个 Intellect 实例（通过 HarnessBackend 配置）
  │
  ├─ Team（Intellect 侧管理，通过 BFF 透传 CRUD）
  │   └─ Project（Intellect 侧管理，属于 Team）
  │
  └─ Member（Intellect 侧管理）
```

**核心设计**：
- BFF Tenant 只存储绑定关系（`tenantId → backendId`）
- Team/Project/Member 数据不复制到 BFF，通过 Intellect HTTP API 透传管理
- 一个 BFF Tenant 可绑定多个后端（Intellect + Intellect），画布走 Intellect，Team/Project 走 Intellect

### 3.4 画布：复用 Intellect 画布引擎

**架构调整**：画布不再是"扩展层可选能力"，而是**Intellect 专属能力，Intellect 企业版通过 BFF 调用 Intellect 画布**。

```
┌─────────────────────────────────────────────────────┐
│  AgentUI 前端                                        │
│  └── 画布编辑器（不变，调用 /api/bff/canvas/*）      │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│  BFF                                                 │
│  └── CanvasService                                   │
│      ├── 始终路由到 Intellect Adapter                  │
│      └── 不经过 Intellect Adapter                    │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│  Intellect（画布引擎唯一提供者）                       │
│  └── /api/v1/agents/* (canvas CRUD + 执行)           │
└─────────────────────────────────────────────────────┘
```

**实现方式**：
- BFF 的画布路由**硬绑定到 Intellect Adapter**，不通过 Adapter Registry 选择
- 前端画布页面不受 `capabilities.canvas` 影响（因为画布永远走 Intellect）
- Intellect 企业版用户若需画布，BFF Tenant 必须同时绑定一个 Intellect 后端

**Canvas IR 不需要**：因为画布只走 Intellect，直接用 Intellect 原生格式，无需中间表示。

### 3.5 会话流式：Intellect SSE 为基础，逐步合集

**阶段 1（P1-P2）**：以 Intellect OpenAI 兼容 SSE 为基础

```typescript
// BFF 统一输出格式（基于 Intellect）
interface StreamChunk {
  type: 'delta' | 'done' | 'error';
  content?: string;        // delta 文本
  role?: 'assistant';
  finishReason?: 'stop' | 'length' | 'cancelled';
  error?: { code: string; message: string };
}
```

**阶段 2（P3+）**：扩展为 SSE 事件合集

```typescript
// 合集格式（兼容 Intellect WebUI 事件类型）
interface StreamChunk {
  type:
    | 'delta'              // 文本增量（Intellect + Intellect）
    | 'reasoning'          // 思考链（Intellect，Intellect 无）
    | 'tool_start'         // 工具开始（Intellect，Intellect 无）
    | 'tool_complete'      // 工具完成（Intellect，Intellect 无）
    | 'usage'              // 用量（Intellect metering，Intellect 无）
    | 'approval'           // 审批请求（Intellect）
    | 'done'
    | 'error';
  content?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  usage?: { promptTokens: number; completionTokens: number };
}
```

**BFF 转换策略**：
- Intellect Adapter：`data: {choices:[{delta:{content}}]}` → `StreamChunk{type:'delta',content}`
- Intellect Adapter：`event: token\ndata:{text}` → `StreamChunk{type:'delta',content}`；`event: reasoning` → `StreamChunk{type:'reasoning'}`

### 3.6 后端配置：Admin 管理端

复用 BFF Admin 模块，新增"Harness 后端管理"页面：
- **后端列表**：查看所有已注册 Harness 后端
- **新增后端**：填写类型/端点/认证，自动探测能力
- **能力探测**：调用后端健康检查 + 能力发现，回填 capabilities
- **租户绑定**：将后端绑定到 BFF 租户

## 四、Token 安全存储策略

### 4.1 设计原则

1. **P0-P3 先行**：本期不引入加密存储复杂度，使用环境变量 + JSON 文件存储
2. **环境变量优先**：敏感的 admin token 通过环境变量注入，不落盘到 JSON
3. **JSON 文件存储非敏感配置**：后端端点、类型、能力声明等存 JSON
4. **未来演进**：预留加密存储接口，P4+ 可平滑升级

### 4.2 存储分层

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: 环境变量（.env，不入库）                       │
│  ├── HARNESS_INTELLECT_COMMUNITY_ADMIN_TOKEN=intellect-xxx            │
│  ├── HARNESS_INTELLECT_ADMIN_TOKEN=imt_xxx              │
│  └── HARNESS_TOKEN_ENCRYPTION_KEY=（P4+ 启用）          │
├─────────────────────────────────────────────────────────┤
│  Layer 2: JSON 文件（bff/data/harness-backends.json）    │
│  ├── 后端 ID、名称、类型、端点                           │
│  ├── 能力声明（capabilities）                            │
│  ├── 状态（active/disabled）                             │
│  └── token 引用（envVarName，不存明文）                  │
├─────────────────────────────────────────────────────────┤
│  Layer 3: 运行时内存（启动时加载）                       │
│  ├── 从环境变量读取 token 明文                           │
│  ├── 与 JSON 配置合并为完整 HarnessBackend 对象          │
│  └── 仅存在于进程内存，不写回磁盘                        │
└─────────────────────────────────────────────────────────┘
```

### 4.3 数据模型

```typescript
// bff/src/services/harness-store.ts

// JSON 文件中存储的配置（不含 token 明文）
interface HarnessBackendConfig {
  id: string;
  name: string;
  type: 'intellect-community' | 'intellect-enterprise';
  endpoint: string;
  capabilities: HarnessCapabilities;
  status: 'active' | 'disabled';
  // token 通过环境变量引用，不存明文
  adminTokenEnvVar: string;        // 如 'HARNESS_INTELLECT_ADMIN_TOKEN'
  projectTokenEnvVar?: string;     // 可选，项目级 token 环境变量名
  createdAt: string;
  updatedAt: string;
}

// 运行时内存中的完整对象（含 token 明文，不落盘）
interface HarnessBackend extends HarnessBackendConfig {
  adminToken: string;              // 从环境变量读取的明文
  projectToken?: string;
}
```

### 4.4 加载流程

```typescript
// bff/src/services/harness-store.ts

class HarnessStore {
  private backends: Map<string, HarnessBackend> = new Map();

  load(): void {
    const configs = this.loadConfigs();  // 读 JSON 文件
    for (const config of configs) {
      const adminToken = process.env[config.adminTokenEnvVar];
      if (!adminToken) {
        console.warn(`[harness-store] 环境变量 ${config.adminTokenEnvVar} 未设置，跳过后端 ${config.name}`);
        continue;
      }
      const projectToken = config.projectTokenEnvVar
        ? process.env[config.projectTokenEnvVar]
        : undefined;
      this.backends.set(config.id, {
        ...config,
        adminToken,
        projectToken,
      });
    }
  }

  get(id: string): HarnessBackend | undefined {
    return this.backends.get(id);
  }

  list(): HarnessBackend[] {
    return Array.from(this.backends.values());
  }

  private loadConfigs(): HarnessBackendConfig[] {
    // 读 bff/data/harness-backends.json
    if (!existsSync(CONFIG_FILE)) return [];
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  }

  // Admin 页面通过此方法增删后端配置（不含 token 明文）
  saveConfig(config: HarnessBackendConfig): void {
    const configs = this.loadConfigs().filter(c => c.id !== config.id);
    configs.push(config);
    writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
    // 重新加载到内存
    this.load();
  }
}
```

### 4.5 环境变量示例

```bash
# .env（已加入 .gitignore）
HARNESS_INTELLECT_COMMUNITY_ADMIN_TOKEN=intellect-xxxxxxxxxxxxxxxx
HARNESS_INTELLECT_ADMIN_TOKEN=imt_xxxxxxxxxxxxxxxxxx
HARNESS_INTELLECT_PROJECT_TOKEN=imt_p_xxxxxxxxxxxxxxx
```

### 4.6 Admin 页面交互

Admin 页面新增后端时：
1. 用户填写名称、类型、端点
2. 系统生成环境变量名（如 `HARNESS_INTELLECT_ADMIN_TOKEN`）
3. JSON 文件存储配置（含 `adminTokenEnvVar` 字段，不含 token 明文）
4. 页面提示用户将 token 添加到 `.env` 文件
5. 重启 BFF 后生效

### 4.7 未来演进（P4+）

```typescript
// 预留接口，未来切换到加密存储
interface TokenVault {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

// 实现 1：环境变量（P0-P3）
class EnvTokenVault implements TokenVault {
  get(key: string) { return process.env[key]; }
  set(key: string, value: string) { throw new Error('Env vault is read-only'); }
}

// 实现 2：加密文件（P4+，使用 AES-256-GCM）
class EncryptedFileTokenVault implements TokenVault {
  constructor(private encryptionKey: string) {}
  get(key: string) { /* 解密读取 */ }
  set(key: string, value: string) { /* 加密写入 */ }
}
```

## 五、Adapter 接口定义

### 5.1 核心层接口（Layer 1，所有后端必选）

```typescript
// bff/src/services/adapters/types.ts

export interface IHarnessAdapter {
  readonly backendId: string;
  readonly backendType: 'intellect-community' | 'intellect-enterprise';
  readonly capabilities: HarnessCapabilities;

  // Agent
  listAgents(ctx: TenantContext): Promise<AgentSummary[]>;
  getAgent(ctx: TenantContext, agentId: string): Promise<AgentDetail>;

  // Session
  createSession(ctx: TenantContext, agentId: string, opts?: SessionOptions): Promise<Session>;
  listSessions(ctx: TenantContext, agentId?: string): Promise<Session[]>;
  getSession(ctx: TenantContext, sessionId: string): Promise<Session>;
  deleteSession(ctx: TenantContext, sessionId: string): Promise<void>;

  // Message streaming（OpenAI 兼容 SSE，Intellect 和 Intellect 共用）
  sendMessage(ctx: TenantContext, sessionId: string, message: string, opts?: SendOptions): AsyncIterable<StreamChunk>;
  cancelMessage(ctx: TenantContext, sessionId: string): Promise<void>;

  // Health & capability
  healthCheck(): Promise<boolean>;
  discoverCapabilities(): Promise<HarnessCapabilities>;
}
```

### 5.2 扩展层接口（Layer 2，Intellect 企业版独有）

```typescript
export interface IMultiTenantAdapter {
  // Team CRUD（透传 Intellect）
  listTeams(ctx: TenantContext): Promise<Team[]>;
  createTeam(ctx: TenantContext, slug: string, displayName: string): Promise<Team>;
  getTeam(ctx: TenantContext, teamSlug: string): Promise<Team>;
  updateTeam(ctx: TenantContext, teamSlug: string, updates: Partial<Team>): Promise<Team>;
  archiveTeam(ctx: TenantContext, teamSlug: string): Promise<void>;

  // Team 成员管理
  listTeamMembers(ctx: TenantContext, teamSlug: string): Promise<TeamMember[]>;
  addTeamMember(ctx: TenantContext, teamSlug: string, memberId: string, role: string): Promise<TeamMember>;
  removeTeamMember(ctx: TenantContext, teamSlug: string, memberId: string): Promise<void>;
  setTeamMemberRole(ctx: TenantContext, teamSlug: string, memberId: string, role: string): Promise<void>;

  // Project CRUD（透传 Intellect，Project 属于 Team）
  listProjects(ctx: TenantContext, teamSlug: string): Promise<Project[]>;
  createProject(ctx: TenantContext, teamSlug: string, data: CreateProjectInput): Promise<Project>;
  getProject(ctx: TenantContext, teamSlug: string, projectSlug: string): Promise<Project>;
  updateProject(ctx: TenantContext, projectSlug: string, updates: Partial<Project>): Promise<Project>;
  archiveProject(ctx: TenantContext, projectSlug: string): Promise<void>;

  // Project 成员管理
  listProjectMembers(ctx: TenantContext, projectSlug: string): Promise<ProjectMember[]>;
  addProjectMember(ctx: TenantContext, projectSlug: string, memberId: string, role: string): Promise<void>;
  removeProjectMember(ctx: TenantContext, projectSlug: string, memberId: string): Promise<void>;
}
```

### 5.3 租户上下文与能力声明

```typescript
// ── 租户上下文 ──
export interface TenantContext {
  tenantId: string;                    // BFF 租户 ID
  userId: string;                      // BFF 用户 ID
  // Intellect 侧的上下文（BFF 根据 tenant 绑定关系填充）
  intellectTeamSlug?: string;          // X-Intellect-Team 头
  intellectProjectSlug?: string;       // X-Intellect-Project 头
}

// ── 能力声明 ──
export interface HarnessCapabilities {
  canvas: boolean;        // Intellect only（画布永远走 Intellect）
  knowledgeBase: boolean; // Intellect only
  memory: boolean;
  mcp: boolean;
  multiTenant: boolean;   // Intellect 企业版（Team/Project）
  modelManagement: boolean;
}

// ── 流式 chunk（OpenAI 兼容，两个后端共用）──
export interface StreamChunk {
  type: 'delta' | 'done' | 'error';
  content?: string;
  role?: 'assistant';
  finishReason?: 'stop' | 'length' | 'cancelled';
  error?: { code: string; message: string };
}
```

## 六、Adapter 实现要点

### 6.1 Adapter 注册与选择

```typescript
// bff/src/services/adapters/registry.ts

class AdapterRegistry {
  private adapters = new Map<string, IHarnessAdapter>();  // backendId → adapter

  async register(backend: HarnessBackend): Promise<void> {
    const adapter = await this.createAdapter(backend);
    await adapter.healthCheck();
    this.adapters.set(backend.id, adapter);
  }

  getAdapter(backendId: string): IHarnessAdapter {
    const adapter = this.adapters.get(backendId);
    if (!adapter) throw new Error(`Backend ${backendId} not registered`);
    return adapter;
  }

  // 根据租户绑定选择 adapter
  getAdapterForTenant(tenantId: string): IHarnessAdapter {
    const binding = tenantStore.getHarnessBinding(tenantId);
    return this.getAdapter(binding.backendId);
  }

  private async createAdapter(backend: HarnessBackend): Promise<IHarnessAdapter> {
    switch (backend.type) {
      case 'intellect-community':
        return new IntellectCommunityAdapter(backend);
      case 'intellect-enterprise':
        return new IntellectEnterpriseAdapter(backend);
      default:
        throw new Error(`Unknown backend type: ${backend.type}`);
    }
  }
}
```

### 6.2 OpenAI 兼容 SSE 解析器（共用）

```typescript
// bff/src/services/adapters/shared/openai-sse.ts

// Intellect 和 Intellect 企业版共用，因为都是 OpenAI 兼容 SSE 格式
async function* parseOpenAISSE(response: Response): AsyncIterable<StreamChunk> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        yield { type: 'done' };
        return;
      }
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) {
        yield { type: 'delta', content: delta.content };
      }
      if (parsed.choices?.[0]?.finish_reason) {
        yield { type: 'done', finishReason: parsed.choices[0].finish_reason };
      }
    }
  }
}
```

### 6.3 Intellect 企业版 Adapter（多租户头注入）

```typescript
// bff/src/services/adapters/intellect/adapter.ts

export class IntellectEnterpriseAdapter implements IHarnessAdapter, IMultiTenantAdapter {
  readonly backendType = 'intellect-enterprise' as const;

  constructor(
    private backend: HarnessBackend,
    private client: IntellectClient,
  ) {}

  async listAgents(ctx: TenantContext): Promise<AgentSummary[]> {
    // Intellect 用 /v1/models 暴露可用 agent
    const models = await this.client.get('/v1/models', this.buildHeaders(ctx));
    return models.data.map((m: any) => ({
      id: m.id,
      name: m.id,
      description: m.description || '',
    }));
  }

  async *sendMessage(ctx: TenantContext, sessionId: string, message: string): AsyncIterable<StreamChunk> {
    // Intellect SSE 格式与 Intellect 一致（OpenAI 兼容），直接透传
    const response = await this.client.postStream(
      `/api/sessions/${sessionId}/chat/stream`,
      { message },
      this.buildHeaders(ctx),
    );
    yield* parseOpenAISSE(response);  // 共用解析器
  }

  // ── 私有方法：构建请求头 ──

  private buildHeaders(ctx: TenantContext): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.backend.adminToken}`,
    };
    if (ctx.intellectTeamSlug) {
      headers['X-Intellect-Team'] = ctx.intellectTeamSlug;
    }
    if (ctx.intellectProjectSlug) {
      headers['X-Intellect-Project'] = ctx.intellectProjectSlug;
    }
    return headers;
  }

  // ── 能力发现 ──

  async discoverCapabilities(): Promise<HarnessCapabilities> {
    return {
      canvas: false,              // 画布走 Intellect
      knowledgeBase: false,
      memory: true,
      mcp: true,
      multiTenant: true,          // Intellect 企业版核心能力
      modelManagement: true,
    };
  }
}
```

### 6.4 画布服务（硬绑定 Intellect）

```typescript
// bff/src/services/canvas-service.ts

export class CanvasService {
  constructor(private intellectAdapter: IntellectCommunityAdapter) {}

  // 画布操作永远走 Intellect，不经过 Adapter Registry
  async listCanvas(ctx: TenantContext): Promise<Canvas[]> {
    return this.intellectAdapter.listCanvas(ctx);
  }

  async saveCanvas(ctx: TenantContext, agentId: string, canvas: Canvas): Promise<void> {
    return this.intellectAdapter.saveCanvas(ctx, agentId, canvas);
  }

  async *executeCanvas(ctx: TenantContext, canvasId: string, input: unknown): AsyncIterable<StreamChunk> {
    yield* this.intellectAdapter.executeCanvas(ctx, canvasId, input);
  }
}
```

## 七、BFF 多租户绑定模型

```typescript
// bff/src/services/harness-store.ts

// BFF 租户（轻量，只存绑定关系）
interface BffTenant {
  id: string;
  name: string;                    // "Acme Corp"
  createdAt: string;
  updatedAt: string;
}

// 租户与后端的绑定（一个租户可绑定多个后端）
interface TenantBackendBinding {
  tenantId: string;
  backendId: string;
  backendType: 'intellect-community' | 'intellect-enterprise';
  // Intellect 侧
  intellectTenantId?: string;
  // Intellect 侧（admin token 用于管理操作）
  intellectAdminToken?: string;    // imt_* admin/owner token
  // 用途标记
  roles: ('canvas' | 'knowledge' | 'chat' | 'coding')[];
  isDefault: boolean;
}

// Harness 后端配置（Admin 管理端配置）
interface HarnessBackend {
  id: string;
  name: string;
  type: 'intellect-community' | 'intellect-enterprise';
  endpoint: string;                // http://localhost:9380 / http://localhost:8642
  adminToken?: string;             // Intellect admin member token
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}
```

## 八、BFF 目录结构

```
bff/src/
├── index.ts
├── middleware/
│   └── auth.ts
├── routes/
│   ├── admin.ts              # 已有：whitelist/roles/resources
│   ├── harness-admin.ts      # 新增：Harness 后端管理
│   ├── tenant.ts             # 新增：租户管理（轻量）
│   ├── team.ts               # 新增：透传 Intellect Team CRUD
│   ├── project.ts            # 新增：透传 Intellect Project CRUD
│   ├── agent.ts              # 重构：调用 Adapter
│   ├── session.ts            # 重构：调用 Adapter
│   └── canvas.ts             # 新增：硬绑定 Intellect
├── services/
│   ├── admin-store.ts        # 已有
│   ├── harness-store.ts      # 新增：后端配置 + token 存储
│   ├── tenant-store.ts       # 新增：BFF 多租户模型
│   ├── canvas-service.ts     # 新增：画布路由到 Intellect
│   └── adapters/             # 新增：适配器层
│       ├── types.ts          # IHarnessAdapter 接口定义
│       ├── registry.ts       # Adapter 注册与选择
│       ├── shared/
│       │   └── openai-sse.ts # OpenAI 兼容 SSE 解析器（共用）
│       ├── intellect/
│       │   ├── adapter.ts    # IntellectCommunityAdapter
│       │   ├── client.ts     # Intellect HTTP 客户端
│       │   └── stream.ts     # SSE 流式转换
│       └── intellect/
│           ├── adapter.ts    # IntellectEnterpriseAdapter
│           ├── client.ts     # Intellect HTTP 客户端
│           ├── stream.ts     # SSE 流式转换
│           └── admin.ts      # Team/Project 透传
└── utils/
    └── sse.ts                # SSE 流式工具
```

## 九、前端改动清单

### 9.1 API 路径迁移（`src/utils/api.ts`）

```typescript
// 新增 harness 相关路径
const bffHarness = '/api/bff/harness';

export const api = {
  // ... 现有路径

  // Harness 后端管理（Admin）
  harnessListBackends: `${bffHarnessAdmin}/backends`,
  harnessCreateBackend: `${bffHarnessAdmin}/backends`,
  harnessGetBackend: (id: string) => `${bffHarnessAdmin}/backends/${id}`,
  harnessUpdateBackend: (id: string) => `${bffHarnessAdmin}/backends/${id}`,
  harnessDeleteBackend: (id: string) => `${bffHarnessAdmin}/backends/${id}`,
  harnessProbeBackend: `${bffHarnessAdmin}/backends/probe`,  // 能力探测

  // 能力查询（前端条件渲染用）
  harnessGetCapabilities: `${bff}/capabilities`,

  // 多租户（BFF 独立模型）
  tenantList: `${bff}/tenants`,
  tenantCreate: `${bff}/tenants`,
  teamList: (tenantId: string) => `${bff}/tenants/${tenantId}/teams`,
  projectList: (tenantId: string, teamId: string) =>
    `${bff}/tenants/${tenantId}/teams/${teamId}/projects`,
};
```

### 9.2 能力探测 Hook

```typescript
// src/hooks/useHarnessCapabilities.ts

// 启动时查询一次，前端按能力条件渲染
function useHarnessCapabilities(): HarnessCapabilities | null {
  const [caps, setCaps] = useState<HarnessCapabilities | null>(null);
  useEffect(() => {
    fetch('/api/bff/capabilities').then(r => r.json()).then(setCaps);
  }, []);
  return caps;
}

// 使用示例
function AgentPage() {
  const caps = useHarnessCapabilities();
  return (
    <>
      {caps?.canvas && <CanvasEditor />}        {/* Intellect + Intellect 企业版 */}
      {caps?.knowledgeBase && <DatasetPage />}  {/* Intellect only */}
      {caps?.multiTeam && <TeamSwitcher />}     {/* Intellect 企业版 */}
    </>
  );
}
```

### 9.3 新增 Admin 页面

- `src/pages/admin/harness-backends.tsx`：Harness 后端管理
- `src/pages/admin/tenants.tsx`：租户/团队/项目管理

## 十、实施路线

### 10.1 P0-P3 细化（本期范围）

#### P0：接口定义 + 存储层

**目标**：建立 Adapter 抽象层骨架，不改变现有功能。

| 任务 | 文件 | 说明 |
|------|------|------|
| 定义 Adapter 接口 | `bff/src/services/adapters/types.ts` | `IHarnessAdapter`、`IMultiTenantAdapter`、`TenantContext`、`HarnessCapabilities`、`StreamChunk` |
| 定义数据模型 | `bff/src/services/adapters/types.ts` | `AgentSummary`、`Session`、`Team`、`Project`、`TeamMember`、`ProjectMember` |
| 实现 HarnessStore | `bff/src/services/harness-store.ts` | JSON 配置 + 环境变量 token 加载 |
| 实现 TenantStore | `bff/src/services/tenant-store.ts` | BFF 租户模型（轻量，只存绑定关系） |
| 创建默认配置 | `bff/data/harness-backends.json` | 默认 Intellect 后端配置 |
| 更新 .env.example | `.env.example` | 新增 `HARNESS_*_ADMIN_TOKEN` 变量 |

**验收标准**：
- BFF 启动时能从 JSON + 环境变量加载后端配置
- TypeScript 编译通过
- 不影响现有功能（现有路由行为不变）

#### P1：Intellect Adapter + 重构现有 BFF

**目标**：将现有 BFF 对 Intellect 的直连逻辑重构为通过 IntellectCommunityAdapter，前端无感知。

| 任务 | 文件 | 说明 |
|------|------|------|
| 实现 OpenAI SSE 解析器 | `bff/src/services/adapters/shared/openai-sse.ts` | 共用的 SSE 流式解析 |
| 实现 Intellect HTTP 客户端 | `bff/src/services/adapters/intellect/client.ts` | 封装 Intellect REST 调用 |
| 实现 IntellectCommunityAdapter | `bff/src/services/adapters/intellect/adapter.ts` | 实现 `IHarnessAdapter` 接口 |
| 实现 Adapter Registry | `bff/src/services/adapters/registry.ts` | Adapter 注册与按租户选择 |
| 重构 agent 路由 | `bff/src/routes/agent.ts` | 改为调用 `registry.getAdapterForTenant()` |
| 重构 session 路由 | `bff/src/routes/session.ts` | 改为调用 adapter |

**验收标准**：
- 现有 Agent/Session CRUD 行为不变
- SSE 流式行为不变
- 前端无任何改动
- 现有 BFF 测试通过

#### P2：Harness Admin + 前端能力探测

**目标**：Admin 管理端可配置后端，前端可探测能力条件渲染。

| 任务 | 文件 | 说明 |
|------|------|------|
| 实现 harness-admin 路由 | `bff/src/routes/harness-admin.ts` | 后端配置 CRUD（不含 token 明文） |
| 实现能力探测端点 | `bff/src/routes/capabilities.ts` | `GET /api/bff/capabilities` 返回当前后端能力 |
| 注册新路由 | `bff/src/index.ts` | 挂载 harness-admin + capabilities 路由 |
| 新增前端 API 路径 | `src/utils/api.ts` | harness 管理相关路径 |
| 实现 useHarnessCapabilities | `src/hooks/useHarnessCapabilities.ts` | 启动时查询能力，条件渲染 |
| 新增 Admin 页面 | `src/pages/admin/harness-backends.tsx` | 后端列表/新增/编辑/删除 |

**验收标准**：
- Admin 页面可 CRUD 后端配置
- 新增后端时提示用户设置环境变量
- 前端可通过 `useHarnessCapabilities` 获取能力
- 页面按能力条件渲染（如无画布的后端隐藏画布入口）

#### P3：Intellect 企业版 Adapter（核心层）

**目标**：BFF 可对接 Intellect 企业版，基础对话功能可用。

| 任务 | 文件 | 说明 |
|------|------|------|
| 实现 Intellect HTTP 客户端 | `bff/src/services/adapters/intellect/client.ts` | 封装 Intellect REST 调用（含多租户头注入） |
| 实现 IntellectEnterpriseAdapter | `bff/src/services/adapters/intellect/adapter.ts` | 实现核心层 `IHarnessAdapter` |
| 对接 `/v1/models` | `intellect/adapter.ts` | `listAgents()` 调用 `/v1/models` |
| 对接 `/api/sessions` | `intellect/adapter.ts` | 会话 CRUD |
| 对接 `/v1/chat/completions` | `intellect/adapter.ts` | SSE 流式对话（复用 openai-sse 解析器） |
| 对接 `/v1/capabilities` | `intellect/adapter.ts` | `discoverCapabilities()` |
| 注册 Intellect Adapter | `bff/src/services/adapters/registry.ts` | 支持 `intellect-enterprise` 类型 |
| 集成测试 | 手动 curl | 验证 Agent 列表、会话创建、流式对话 |

**外部依赖**：无（核心层只用到 Intellect 已有的 `/v1/*` 和 `/api/sessions/*`）

**验收标准**：
- BFF 可连接 Intellect 企业版 :8642
- `listAgents()` 返回 Intellect 模型列表
- `createSession()` 创建会话成功
- `sendMessage()` 流式返回正常
- `healthCheck()` 和 `discoverCapabilities()` 正常
- 多租户头 `X-Intellect-Team`/`X-Intellect-Project` 正确注入

### 10.2 后续阶段（P4-P7，依赖外部条件）

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **P4** | Intellect 侧新增 Team/Project CRUD HTTP API | Intellect 团队（参考 [Intellect Admin API 接口指南](file:///Users/simon/workspace/agentui/docs/intellect-admin-api-guide.md)） |
| **P5** | BFF 多租户层（Team/Project 透传）+ 前端 Admin 页面 | P3 + P4 |
| **P6** | 画布服务（硬绑定 Intellect） | P1 |
| **P7** | SSE 事件扩展（runs/skills，可选） | P3 |

## 十一、涉及文件清单

| 文件 | 阶段 | 操作 |
|------|------|------|
| `bff/src/services/adapters/types.ts` | P0 | 新建 |
| `bff/src/services/harness-store.ts` | P0 | 新建 |
| `bff/src/services/tenant-store.ts` | P0 | 新建 |
| `bff/data/harness-backends.json` | P0 | 新建（默认配置） |
| `.env.example` | P0 | 修改 |
| `bff/src/services/adapters/shared/openai-sse.ts` | P1 | 新建 |
| `bff/src/services/adapters/intellect/client.ts` | P1 | 新建 |
| `bff/src/services/adapters/intellect/adapter.ts` | P1 | 新建 |
| `bff/src/services/adapters/registry.ts` | P1 | 新建 |
| `bff/src/routes/agent.ts` | P1 | 重构 |
| `bff/src/routes/session.ts` | P1 | 重构 |
| `bff/src/routes/harness-admin.ts` | P2 | 新建 |
| `bff/src/routes/capabilities.ts` | P2 | 新建 |
| `bff/src/index.ts` | P2 | 修改（注册路由） |
| `src/utils/api.ts` | P2 | 修改（新增路径） |
| `src/hooks/useHarnessCapabilities.ts` | P2 | 新建 |
| `src/pages/admin/harness-backends.tsx` | P2 | 新建 |
| `bff/src/services/adapters/intellect/client.ts` | P3 | 新建 |
| `bff/src/services/adapters/intellect/adapter.ts` | P3 | 新建 |
| `docs/intellect-admin-api-guide.md` | 已完成 | 新建（Intellect 侧 API 指南） |
| `docs/multi-harness-design.md` | 已完成 | 新建（本文档） |

## 十二、Intellect 企业版关键发现

### 12.1 已实现能力

通过分析 `~/workspace/intellect-team`，确认企业版已实现：

| 能力 | 端点 | 说明 |
|------|------|------|
| Chat Completions（SSE 流式） | `POST /v1/chat/completions` | OpenAI 兼容格式 |
| Responses API | `POST /v1/responses` | OpenAI Responses API |
| 模型列表 | `GET /v1/models` | OpenAI 兼容 |
| 能力发现 | `GET /v1/capabilities` | 内置能力声明 |
| 会话 CRUD | `GET/POST/PATCH/DELETE /api/sessions` | 会话管理 |
| 会话消息 | `GET /api/sessions/{id}/messages` | 消息历史 |
| 会话流式聊天 | `POST /api/sessions/{id}/chat/stream` | SSE 流式 |
| 会话 Fork | `POST /api/sessions/{id}/fork` | 会话分叉 |
| Runs（异步任务） | `POST /v1/runs` + `GET /v1/runs/{id}/events` | 异步执行 |
| Skills | `GET /v1/skills` | 技能列表 |
| 多租户头 | `X-Intellect-Team` / `X-Intellect-Project` | HTTP Header 传递 |

### 12.2 数据模型

Intellect 企业版数据模型为 **Member → Team → Project** 三层（无 Tenant 实体）：

| 表 | 主键 | 关键字段 | 说明 |
|----|------|---------|------|
| `members` | id (TEXT) | display_name, login_name, email, role(owner/admin/member/viewer), enabled | 成员 |
| `teams` | id (TEXT) | slug (UNIQUE), display_name, created_by, enabled | 团队 |
| `team_memberships` | id | team_id, member_id, role — UNIQUE(team_id, member_id) | 成员↔团队多对多 |
| `projects` | id (TEXT) | slug, display_name, team_id, owner_member_id, repo_url, default_branch — UNIQUE(team_id, slug) | 项目（属于一个 Team） |
| `project_memberships` | id | project_id, member_id, role — UNIQUE(project_id, member_id) | 成员↔项目多对多 |
| `project_teams` | id | project_id, team_id, role — UNIQUE(project_id, team_id) | 项目↔团队多对多（可选） |
| `member_api_tokens` | id | member_id, token_hash, scope_type(member/project), scope_id | API token（imt_* / imt_p_*） |

### 12.3 缺失能力

Team/Project/Member 的 **HTTP API 路由层**未实现（DB 方法已存在于 `MembershipStore`，需新增 HTTP 路由）。

详细接口规范见 [Intellect Admin API 接口指南](file:///Users/simon/workspace/agentui/docs/intellect-admin-api-guide.md)。

## 附录：相关文档

- [Intellect Admin API 接口指南](file:///Users/simon/workspace/agentui/docs/intellect-admin-api-guide.md) — Intellect 侧 Team/Project/Member HTTP API 规范
- [Vite 架构文档第十六章](file:///Users/simon/workspace/agentui/docs/vite-architecture.md) — BFF 整体架构（含本章内容的集成位置）
- [Canvas 机制文档](file:///Users/simon/workspace/agentui/docs/canvas-mechanism.md) — Intellect 画布引擎说明
