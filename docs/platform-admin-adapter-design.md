# Harness 平台统一运维层（Platform Admin Adapter）设计方案

> 本文档是 [multi-harness-design.md](file:///Users/simon/workspace/agentui/docs/multi-harness-design.md) 的细化子方案，针对 users / services / sandbox / version 四个目前强耦合 Intellect Admin 的运维模块，抽象为 Harness 平台统一运维层，按 API 对接不同后端。
>
> 配套文档：
> - [multi-harness-design.md](file:///Users/simon/workspace/agentui/docs/multi-harness-design.md) — 总体多 Harness 方案
> - [intellect-admin-api-guide.md](file:///Users/simon/workspace/agentui/docs/intellect-admin-api-guide.md) — Intellect 侧 API 规范
> - [frontend-architecture.md](file:///Users/simon/workspace/agentui/docs/frontend-architecture.md) — 前端框架总体

---

## 一、背景与目标

### 1.1 现状

AgentUI 的 Admin 模块当前直连 Intellect RAG Admin（端口 9381），users / services / sandbox / version 四类运维接口与 Intellect RAG 强耦合：

| 模块 | 当前路径 | 数据源 | 问题 |
|------|---------|--------|------|
| users | `/api/v1/admin/users/*` | Intellect RAG Admin | 字段为 Intellect RAG 专有（`activate_status`、`is_superuser`、`access_token`），无法对接 Intellect 企业版 Member 模型 |
| services | `/api/v1/admin/services/*` | Intellect RAG Admin | 返回 Intellect RAG 内部 task manager 状态，与 Intellect 企业版 `/health/detailed` 语义不一致 |
| sandbox | `/api/v1/admin/sandbox/*` | Intellect RAG Admin | 调用 Intellect RAG `SandboxMgr`，Intellect 企业版用 codex_runtime/tool_executor，无对等 API |
| version | `/api/v1/admin/version` | Intellect RAG Admin | 返回 `get_intellect_version()`，Intellect 企业版用 `intellect_cli/_version.py` |

### 1.2 目标

1. **统一抽象**：在 BFF 定义 `IPlatformAdminAdapter` 接口，覆盖 users / services / sandbox / version 四个模块
2. **按 API 对接**：每个后端实现自己的 Adapter，BFF 屏蔽差异
3. **前端零业务改动**：仅改 `api.ts` 路径常量，业务页面与 service 接口签名保持
4. **能力声明**：通过 `HarnessCapabilities` 声明各模块是否可用，前端条件渲染
5. **渐进式迁移**：先迁移 version（最简单），最后迁移 sandbox（最复杂）

### 1.3 与 multi-harness-design.md 的关系

| 维度 | multi-harness-design | 本文档 |
|------|---------------------|--------|
| 抽象层 | `IHarnessAdapter`（核心层 Agent/Session/Message） | `IPlatformAdminAdapter`（运维层 users/services/sandbox/version） |
| 关注点 | 业务运行时 | 平台运维管理 |
| 后端依赖 | Agent 执行 + 流式 | 后端 admin/health/config 接口 |
| 必选性 | 所有后端必选 | 仅 version 必选，其他可选 |

两者**并列、互补**，共同构成 Harness 后端的完整 Adapter 体系：

```
IHarnessAdapter（业务运行时）
  ├─ Agent / Session / Message 流式
  └─ 多租户 Team/Project（Intellect 企业版扩展层）

IPlatformAdminAdapter（平台运维层）  ← 本文档
  ├─ IUserAdmin        用户管理
  ├─ IServiceAdmin     服务监控
  ├─ ISandboxAdmin     沙箱配置
  └─ IVersionAdmin     版本查询（必选）
```

---

## 二、关键决策

### 2.1 接口拆分：四个子接口 + 一个组合接口

采用**接口组合**而非单一大接口，便于后端按能力实现：

```typescript
interface IPlatformAdminAdapter {
  readonly backendId: string;
  readonly adminCapabilities: AdminCapabilities;

  // 必选：所有后端必须实现
  version(): IVersionAdmin;

  // 可选：按 capability 声明
  users?(): IUserAdmin;
  services?(): IServiceAdmin;
  sandbox?(): ISandboxAdmin;
}
```

**理由**：
- Intellect 企业版当前无 sandbox admin API，可只实现 version + users + services
- 未来其他后端可只实现 version
- 避免后端为不实现的方法返回 `not implement` 异常（与 Intellect RAG Admin 当前问题一致）

### 2.2 能力分级

| 能力 | 必选性 | Intellect RAG | Intellect 企业版 | 其他后端 |
|------|--------|--------------|-----------------|---------|
| version | **必选** | ✅ 已有 `/admin/version` | ⚠️ 需新增 `/api/version` | ⚠️ 需新增 |
| users | 可选 | ✅ 已有 `/admin/users/*` | ✅ 已有 `/api/members/*`（语义不同） | ❌ 单用户，不实现 |
| services | 可选 | ✅ 已有 `/admin/services/*` | ✅ 已有 `/health/detailed` | ❌ 单进程，不实现 |
| sandbox | 可选 | ✅ 已有 `/admin/sandbox/*` | ❌ 暂无 admin API（capability=false） | ❌ 不实现 |

### 2.3 统一 Schema：BFF 定义，前端消费

- BFF 定义四个模块的统一 Schema（TypeScript interface）
- 各 Adapter 负责将后端原生响应映射到统一 Schema
- 前端 service 与页面**只依赖统一 Schema**，不感知后端差异

### 2.4 鉴权：Admin Token 完整传递链

Admin 鉴权采用**前后端 Token 分离**策略：

| Token 类型 | 用途 | 存储 | 作用域 |
|-----------|------|------|-------|
| 前端 Admin Token | 识别前端用户身份 | localStorage | 控制前端页面路由/菜单 |
| BFF 环境变量 Token | BFF 对后端的操作权限 | 环境变量（不落盘） | 注入到后端请求头 |

**Token 传递流程**：

```
前端                     BFF                       Intellect 企业版
  │                       │                              │
  │  登录（获取 admin token）  │                              │
  │───────────────────────>│                              │
  │                       │  校验 token                   │
  │                       │─────────────────────────────>│
  │                       │                              │
  │  请求 /api/bff/admin/*  │                              │
  │  (Bearer: frontend_token)│                             │
  │───────────────────────>│                              │
  │                       │  BFF 用自己的环境变量 token    │
  │                       │  注入 Authorization 头        │
  │                       │─────────────────────────────>│
  │                       │                              │
  │  返回数据              │                              │
  │<───────────────────────│                              │
```

**实现要点**：
- 前端 admin token 用于识别前端用户身份（"我是谁"），控制前端页面路由/菜单
- BFF 从 `HarnessBackend.adminToken`（环境变量注入）获取 token，注入到后端请求头
- BFF `authMiddleware` 校验前端 token，验证用户身份后放行
- 多租户场景下，按 TenantContext 选择对应后端的 admin token（来自 `HarnessBackend.adminToken`）
- **两个 Token 完全解耦**，互不泄露

### 2.5 BFF 持久化策略

| 数据 | 存储 | 说明 |
|------|------|------|
| 用户/服务/沙箱配置 | **不持久化**，实时透传后端 | 避免数据一致性问题 |
| version | **不缓存**，每次实时查询 | 版本可能动态升级 |
| whitelist/roles/resources | 已有 JSON 持久化 | BFF 接管，与本文档无关 |

> users / services / sandbox / version 都是**只读或近实时**的运维数据，BFF 不持久化，只做协议转换。

### 2.6 Admin 权限与 RBAC

#### 2.6.1 权限层次

运维管理（Admin）涉及两个**完全独立**的权限层次：

| 层次 | 权限来源 | 控制范围 |
|------|---------|---------|
| **BFF Admin 权限** | BFF whitelist/roles/resources | 谁能访问 Admin 页面（用户管理/服务监控/沙箱配置/版本） |
| **后端 Member 权限** | Intellect 企业版 Member.role | Team/Project 级别的资源访问 |

**BFF Admin 权限（运维管理）**

| BFF 角色 | 可访问模块 |
|---------|----------|
| superadmin | users + services + sandbox + version |
| operator | services + version |
| user | version（只读） |

- BFF 维护独立的 admin 角色模型（whitelist/roles/resources）
- Admin token 存 localStorage，BFF authMiddleware 校验
- 与业务租户（Team/Project）权限完全解耦

**后端 Member 权限（Intellect 企业版）**

Intellect 企业版 Member 的 `role` 字段（owner/admin/member/viewer）控制 Team/Project 级别的资源访问，与 BFF Admin 权限**完全独立**。

#### 2.6.2 前端 Admin 页面权限判断

```
前端启动
    │
    ▼
GET /api/bff/capabilities
    │
    ├─── 后端可达 ──── 返回 adminCapabilities
    │                      │
    │                      ▼
    │              adminCapabilities.users = true/false
    │                      │
    │                      ▼
    │              users 菜单显示/隐藏
    │
    └─── 后端不可达 ── 显示"服务降级页"
```

#### 2.6.3 能力探测后的 UI 降级策略

| 场景 | 策略 | 具体行为 |
|------|------|---------|
| `capability = false` | **菜单隐藏** | 该菜单项完全不显示 |
| `capability = true` 但用户无 BFF 权限 | **按钮禁用 + tooltip** | 菜单显示，操作按钮禁用，提示"请联系管理员" |
| API 返回 403 | **错误提示** | Toast 弹窗"您没有权限执行此操作"，提供联系管理员入口 |
| 后端不可达 | **服务降级页** | 页面显示"服务暂时不可用"，提供刷新入口 |

**实现示例**：

```typescript
// Admin 菜单渲染
function AdminNavigation({ capabilities, userRole }) {
  return (
    <nav>
      {/* 能力=false，完全隐藏 */}
      {!capabilities.adminUsers && null}

      {/* 能力=true，检查BFF权限 */}
      {capabilities.adminUsers && (
        <NavLink>
          {userRole === 'superadmin'
            ? '用户管理'
            : <DisabledNavLink tooltip="请联系管理员">用户管理</DisabledNavLink>
          }
        </NavLink>
      )}

      {/* 能力=false，完全隐藏 */}
      {!capabilities.adminSandbox && null}
      {capabilities.adminSandbox && <NavLink>沙箱配置</NavLink>}

      {/* version 永远显示（只读） */}
      <NavLink>系统版本</NavLink>
    </nav>
  );
}

// API 403 处理
.catch(err => {
  if (err.response?.status === 403) {
    toast.error('您没有权限执行此操作，请联系管理员');
  }
});
```

---

## 三、Capability 扩展

### 3.1 扩展 HarnessCapabilities

在 [multi-harness-design.md §5.3](file:///Users/simon/workspace/agentui/docs/multi-harness-design.md) 已有 `HarnessCapabilities` 基础上扩展：

```typescript
// bff/src/services/adapters/types.ts

export interface HarnessCapabilities {
  // ── 已有（业务运行时能力）──
  canvas: boolean;
  knowledgeBase: boolean;
  memory: boolean;
  mcp: boolean;
  multiTenant: boolean;
  modelManagement: boolean;

  // ── 新增（平台运维能力）──
  adminUsers: boolean;        // 用户管理
  adminServices: boolean;     // 服务监控
  adminSandbox: boolean;      // 沙箱配置
  adminVersion: boolean;      // 版本查询（通常 true）
}

// 运维能力汇总（用于前端条件渲染 Admin 菜单）
export interface AdminCapabilities {
  users: boolean;
  services: boolean;
  sandbox: boolean;
  version: boolean;          // 永远 true（必选）
}
```

### 3.2 各后端能力声明

```typescript
// IntellectRagAdapter.discoverCapabilities()
async discoverCapabilities(): Promise<HarnessCapabilities> {
  return {
    canvas: true,
    knowledgeBase: true,
    memory: true,
    mcp: true,
    multiTenant: false,
    modelManagement: true,
    // 运维能力
    adminUsers: true,
    adminServices: true,
    adminSandbox: true,
    adminVersion: true,
  };
}

// IntellectEnterpriseAdapter.discoverCapabilities()
async discoverCapabilities(): Promise<HarnessCapabilities> {
  return {
    canvas: false,              // 画布走 Intellect RAG
    knowledgeBase: false,
    memory: true,
    mcp: true,
    multiTenant: true,
    modelManagement: true,
    // 运维能力
    adminUsers: true,           // /api/members/*
    adminServices: true,        // /health/detailed
    adminSandbox: false,        // 暂无 admin API
    adminVersion: true,         // 需 Intellect 企业版侧新增 /api/version
  };
}
```

### 3.3 前端能力探测

```typescript
// src/hooks/use-harness-capabilities.ts（新增）

export function useHarnessCapabilities() {
  return useQuery({
    queryKey: ['harness-capabilities'],
    queryFn: async () => {
      const res = await axios.get('/api/bff/capabilities');
      return res.data.data as {
        backendId: string;
        backendType: string;
        capabilities: HarnessCapabilities;
        adminCapabilities: AdminCapabilities;
      };
    },
    staleTime: 5 * 60 * 1000,  // 5 分钟缓存
  });
}

// Admin 菜单条件渲染
function AdminNavigation() {
  const { data } = useHarnessCapabilities();
  return (
    <nav>
      {data?.adminCapabilities.services && <NavLink to={Routes.AdminServices}>服务状态</NavLink>}
      {data?.adminCapabilities.users && <NavLink to={Routes.AdminUsers}>用户管理</NavLink>}
      {data?.adminCapabilities.sandbox && <NavLink to={Routes.AdminSandbox}>沙箱配置</NavLink>}
      {/* version 永远显示 */}
      <NavLink to={Routes.AdminVersion}>系统版本</NavLink>
    </nav>
  );
}
```

---

## 四、统一 Schema 定义

### 4.1 版本（Version）

```typescript
// bff/src/services/adapters/admin-schemas.ts

export interface PlatformVersion {
  version: string;              // "v0.15.1" / "0.16.0-dev"
  buildTime?: string;           // ISO 8601
  gitCommit?: string;           // 短哈希
  components: PlatformComponent[];  // 组件级版本
}

export interface PlatformComponent {
  name: string;                 // "intellect-community" / "intellect-agent" / "redis" / "postgres"
  version: string;
  status?: 'ok' | 'degraded' | 'down';
}
```

### 4.2 用户（User）

```typescript
export interface PlatformUser {
  id: string;                   // 后端原生 ID（Intellect RAG 用 email，Intellect 企业版用 member_id）
  email: string;                // 主邮箱
  displayName: string;          // 显示名
  status: 'active' | 'disabled' | 'pending';  // 统一状态枚举
  roles: string[];              // 角色名列表（统一用字符串）
  isSuperuser: boolean;         // 是否超级管理员
  createdAt: string;            // ISO 8601
  lastLoginAt?: string;
  // 后端原生字段（透传，前端不依赖）
  _raw?: Record<string, unknown>;
}

export interface PlatformUserDetail extends PlatformUser {
  // 用户资源汇总
  datasets: PlatformUserResource[];
  agents: PlatformUserResource[];
}

export interface PlatformUserResource {
  id: string;
  name: string;
  type: string;                 // "dataset" / "agent"
  createdAt?: string;
}

export interface CreateUserInput {
  email: string;
  password: string;
  displayName?: string;
  role?: string;                // 默认 "user"
}

export interface UpdateUserInput {
  status?: 'active' | 'disabled';
  password?: string;
  role?: string;
  isSuperuser?: boolean;
}
```

### 4.3 服务（Service）

```typescript
export interface PlatformService {
  id: string;                   // 服务标识
  name: string;                 // 显示名
  type: string;                 // "intellect-api" / "intellect-gateway" / "redis" / "postgres"
  status: 'running' | 'stopped' | 'degraded' | 'unknown';
  endpoints?: string[];         // 服务暴露的端点 URL
  version?: string;
  metrics?: PlatformServiceMetrics;
  lastHeartbeatAt?: string;
}

export interface PlatformServiceMetrics {
  uptimeSeconds?: number;
  cpuPercent?: number;
  memoryMb?: number;
  activeConnections?: number;
  requestsPerSecond?: number;
  // 后端特有指标放 _raw
  _raw?: Record<string, unknown>;
}

export interface PlatformServiceDetail extends PlatformService {
  components: PlatformService[];  // 子组件状态（如 Intellect 企业版的 platforms 列表）
  rawConfig?: Record<string, unknown>;
}
```

### 4.4 沙箱（Sandbox）

```typescript
export interface PlatformSandboxProvider {
  id: string;                   // "docker" / "firecracker" / "gvisor"
  name: string;                 // 显示名
  description?: string;
  isActive: boolean;
}

export interface PlatformSandboxProviderSchema {
  providerId: string;
  // JSON Schema 格式的配置项描述
  configSchema: Record<string, PlatformSandboxConfigField>;
}

export interface PlatformSandboxConfigField {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  title: string;
  description?: string;
  default?: unknown;
  required?: boolean;
  enum?: string[];
  items?: PlatformSandboxConfigField;  // type=array 时
  properties?: Record<string, PlatformSandboxConfigField>;  // type=object 时
}

export interface PlatformSandboxConfig {
  providerType: string;
  config: Record<string, unknown>;
  isActive: boolean;
}

export interface SandboxTestResult {
  success: boolean;
  message: string;
  details?: {
    exitCode: number;
    executionTimeMs: number;
    stdout: string;
    stderr: string;
  };
}
```

---

## 五、Adapter 接口定义

### 5.1 顶层接口

```typescript
// bff/src/services/adapters/admin-types.ts

export interface IPlatformAdminAdapter {
  readonly backendId: string;
  readonly backendType: 'intellect-community' | 'intellect-enterprise';
  readonly adminCapabilities: AdminCapabilities;

  // 必选
  version(): IVersionAdmin;

  // 可选（按 capability 声明）
  users?(): IUserAdmin;
  services?(): IServiceAdmin;
  sandbox?(): ISandboxAdmin;
}
```

### 5.2 IVersionAdmin（必选）

```typescript
export interface IVersionAdmin {
  getVersion(): Promise<PlatformVersion>;
}
```

### 5.3 IUserAdmin

```typescript
export interface IUserAdmin {
  listUsers(): Promise<PlatformUser[]>;
  getUser(userId: string): Promise<PlatformUserDetail>;
  createUser(input: CreateUserInput): Promise<PlatformUser>;
  updateUser(userId: string, input: UpdateUserInput): Promise<PlatformUser>;
  deleteUser(userId: string): Promise<void>;
  // 用户资源
  listUserDatasets(userId: string): Promise<PlatformUserResource[]>;
  listUserAgents(userId: string): Promise<PlatformUserResource[]>;
  // 超级管理员
  grantSuperuser(userId: string): Promise<void>;
  revokeSuperuser(userId: string): Promise<void>;
}
```

### 5.4 IServiceAdmin

```typescript
export interface IServiceAdmin {
  listServices(): Promise<PlatformService[]>;
  getService(serviceId: string): Promise<PlatformServiceDetail>;
  // 可选：服务操作（重启/停止），P2+ 再考虑
  restartService?(serviceId: string): Promise<void>;
}
```

### 5.5 ISandboxAdmin

```typescript
export interface ISandboxAdmin {
  listProviders(): Promise<PlatformSandboxProvider[]>;
  getProviderSchema(providerId: string): Promise<PlatformSandboxProviderSchema>;
  getConfig(): Promise<PlatformSandboxConfig>;
  setConfig(input: { providerType: string; config: Record<string, unknown>; setActive?: boolean }): Promise<PlatformSandboxConfig>;
  testConnection(input: { providerType: string; config: Record<string, unknown> }): Promise<SandboxTestResult>;
}
```

---

## 六、Adapter 实现要点

### 6.1 IntellectRagPlatformAdminAdapter

包装现有 Intellect RAG Admin 调用，做字段映射：

```typescript
// bff/src/services/adapters/intellect-rag/admin-adapter.ts

export class IntellectRagPlatformAdminAdapter implements IPlatformAdminAdapter {
  readonly backendType = 'intellect-rag' as const;
  readonly adminCapabilities: AdminCapabilities = {
    users: true, services: true, sandbox: true, version: true,
  };

  constructor(
    private backend: HarnessBackend,
    private client: IntellectAdminClient,  // 封装 9381 调用
  ) {}

  version(): IVersionAdmin {
    return {
      getVersion: async () => {
        const res = await this.client.get('/api/v1/admin/version');
        // Intellect RAG 返回 { version: "v0.16.0" }
        return {
          version: res.data.version,
          components: [{ name: 'intellect-rag', version: res.data.version, status: 'ok' }],
        };
      },
    };
  }

  users(): IUserAdmin {
    return {
      listUsers: async () => {
        const res = await this.client.get('/api/v1/admin/users');
        // Intellect RAG 字段 → 统一 Schema
        return res.data.map((u: any) => this.mapUser(u));
      },
      getUser: async (email) => {
        const [userRes, datasetsRes, agentsRes] = await Promise.all([
          this.client.get(`/api/v1/admin/users/${email}`),
          this.client.get(`/api/v1/admin/users/${email}/datasets`),
          this.client.get(`/api/v1/admin/users/${email}/agents`),
        ]);
        return {
          ...this.mapUser(userRes.data[0]),
          datasets: datasetsRes.data.map(this.mapResource),
          agents: agentsRes.data.map(this.mapResource),
        };
      },
      createUser: async (input) => {
        await this.client.post('/api/v1/admin/users', {
          username: input.email, password: input.password, role: input.role || 'user',
        });
        return this.mapUser({ email: input.email, /* ... */ });
      },
      // ... 其他方法类似
    };
  }

  services(): IServiceAdmin {
    return {
      listServices: async () => {
        const res = await this.client.get('/api/v1/admin/services');
        return res.data.map((s: any) => this.mapService(s));
      },
      getService: async (id) => {
        const res = await this.client.get(`/api/v1/admin/services/${id}`);
        return this.mapServiceDetail(res.data);
      },
    };
  }

  sandbox(): ISandboxAdmin {
    return {
      listProviders: async () => {
        const res = await this.client.get('/api/v1/admin/sandbox/providers');
        return res.data.map((p: any) => ({
          id: p.id, name: p.name, description: p.description,
          isActive: p.is_active ?? false,
        }));
      },
      getProviderSchema: async (id) => {
        const res = await this.client.get(`/api/v1/admin/sandbox/providers/${id}/schema`);
        return { providerId: id, configSchema: res.data };
      },
      getConfig: async () => {
        const res = await this.client.get('/api/v1/admin/sandbox/config');
        return {
          providerType: res.data.provider_type,
          config: res.data.config,
          isActive: true,
        };
      },
      setConfig: async (input) => {
        const res = await this.client.post('/api/v1/admin/sandbox/config', {
          provider_type: input.providerType,
          config: input.config,
          set_active: input.setActive ?? true,
        });
        return { providerType: res.data.provider_type, config: res.data.config, isActive: true };
      },
      testConnection: async (input) => {
        const res = await this.client.post('/api/v1/admin/sandbox/test', {
          provider_type: input.providerType, config: input.config,
        });
        return {
          success: res.data.success,
          message: res.data.message,
          details: res.data.details && {
            exitCode: res.data.details.exit_code,
            executionTimeMs: res.data.details.execution_time,
            stdout: res.data.details.stdout,
            stderr: res.data.details.stderr,
          },
        };
      },
    };
  }

  // ── 字段映射私有方法 ──
  private mapUser(raw: any): PlatformUser {
    return {
      id: raw.email,
      email: raw.email,
      displayName: raw.nickname || raw.email,
      status: raw.activate_status === 'on' ? 'active' : 'disabled',
      roles: raw.is_superuser ? ['admin'] : ['user'],
      isSuperuser: !!raw.is_superuser,
      createdAt: raw.create_date,
      lastLoginAt: raw.latest_login_time,
      _raw: raw,
    };
  }

  private mapService(raw: any): PlatformService {
    return {
      id: String(raw.id),
      name: raw.name,
      type: raw.service_type || 'intellect-community',
      status: raw.status === 'running' ? 'running' : 'unknown',
      version: raw.version,
      _raw: raw,
    };
  }

  // ... 其他映射方法
}
```

### 6.2 IntellectEnterprisePlatformAdminAdapter

```typescript
// bff/src/services/adapters/intellect-enterprise/admin-adapter.ts

export class IntellectEnterprisePlatformAdminAdapter implements IPlatformAdminAdapter {
  readonly backendType = 'intellect-enterprise' as const;
  readonly adminCapabilities: AdminCapabilities = {
    users: true, services: true,
    sandbox: false,  // Intellect 企业版暂无 sandbox admin API
    version: true,
  };

  constructor(
    private backend: HarnessBackend,
    private client: IntellectClient,  // 封装 8642 调用
  ) {}

  version(): IVersionAdmin {
    return {
      getVersion: async () => {
        // Intellect 企业版需新增 /api/version 端点（见 §8 Intellect 侧待办）
        // 或从 /v1/capabilities 推断
        const res = await this.client.get('/api/version');
        return {
          version: res.data.version,
          buildTime: res.data.build_time,
          gitCommit: res.data.git_commit,
          components: [
            { name: 'intellect-agent', version: res.data.version, status: 'ok' },
            ...res.data.components?.map((c: any) => ({
              name: c.name, version: c.version, status: c.status,
            })) || [],
          ],
        };
      },
    };
  }

  users(): IUserAdmin {
    return {
      // Intellect 企业版 Member 模型 → 统一 User Schema
      listUsers: async () => {
        const res = await this.client.get('/api/members', this.buildHeaders());
        return res.data.members.map((m: any) => this.mapMember(m));
      },
      getUser: async (memberId) => {
        const [memberRes, teamsRes] = await Promise.all([
          this.client.get(`/api/members/${memberId}`, this.buildHeaders()),
          this.client.get(`/api/members/${memberId}/teams`, this.buildHeaders()),
        ]);
        return {
          ...this.mapMember(memberRes.data),
          // Intellect 企业版用 team/role 维度替代 datasets/agents
          datasets: [],
          agents: teamsRes.data.teams.map((t: any) => ({
            id: t.slug, name: t.display_name, type: 'team',
          })),
        };
      },
      createUser: async (input) => {
        const res = await this.client.post('/api/members', {
          display_name: input.displayName || input.email,
          login_name: input.email,
          email: input.email,
        }, this.buildHeaders());
        return this.mapMember(res.data);
      },
      updateUser: async (memberId, input) => {
        if (input.status === 'disabled') {
          await this.client.post(`/api/members/${memberId}/disable`, {}, this.buildHeaders());
        } else if (input.status === 'active') {
          await this.client.post(`/api/members/${memberId}/enable`, {}, this.buildHeaders());
        }
        if (input.role) {
          await this.client.put(`/api/members/${memberId}/role`, { role: input.role }, this.buildHeaders());
        }
        // 重新拉取
        const res = await this.client.get(`/api/members/${memberId}`, this.buildHeaders());
        return this.mapMember(res.data);
      },
      deleteUser: async (memberId) => {
        await this.client.delete(`/api/members/${memberId}`, this.buildHeaders());
      },
      // Intellect 企业版无"用户级 datasets/agents"概念，返回空数组
      listUserDatasets: async () => [],
      listUserAgents: async () => [],
      grantSuperuser: async (memberId) => {
        await this.client.put(`/api/members/${memberId}/role`, { role: 'owner' }, this.buildHeaders());
      },
      revokeSuperuser: async (memberId) => {
        await this.client.put(`/api/members/${memberId}/role`, { role: 'member' }, this.buildHeaders());
      },
    };
  }

  services(): IServiceAdmin {
    return {
      listServices: async () => {
        const res = await this.client.get('/health/detailed');
        const data = res.data;
        // 聚合 Intellect 企业版 /health/detailed 为统一服务列表
        const services: PlatformService[] = [
          {
            id: 'intellect-gateway',
            name: 'Intellect Gateway',
            type: 'intellect-gateway',
            status: data.status === 'ok' ? 'running' : 'degraded',
            endpoints: [this.backend.endpoint],
            lastHeartbeatAt: data.updated_at,
          },
        ];
        // 平台列表
        for (const [key, val] of Object.entries(data.platforms || {})) {
          services.push({
            id: `platform-${key}`,
            name: `Platform: ${key}`,
            type: `platform-${key}`,
            status: (val as any).state === 'connected' ? 'running' : 'stopped',
          });
        }
        return services;
      },
      getService: async (id) => {
        const list = await this.listServices();
        const svc = list.find(s => s.id === id);
        if (!svc) throw new Error(`Service ${id} not found`);
        return { ...svc, components: [] };
      },
    };
  }

  // sandbox 不实现（adminCapabilities.sandbox = false）
  sandbox(): undefined {
    return undefined;
  }

  // ── 字段映射 ──
  private mapMember(m: any): PlatformUser {
    return {
      id: m.member_id,
      email: m.email || m.login_name,
      displayName: m.display_name,
      status: m.enabled ? 'active' : 'disabled',
      roles: m.role ? [m.role] : ['member'],
      isSuperuser: m.role === 'owner',
      createdAt: m.created_at,
      lastLoginAt: m.last_login_at,
      _raw: m,
    };
  }

  private buildHeaders(): Record<string, string> {
    return { 'Authorization': `Bearer ${this.backend.adminToken}` };
  }
}
```

### 6.3 Registry 集成

```typescript
// bff/src/services/adapters/registry.ts（扩展）

class AdapterRegistry {
  private adapters = new Map<string, IHarnessAdapter>();
  private adminAdapters = new Map<string, IPlatformAdminAdapter>();  // 新增

  async register(backend: HarnessBackend): Promise<void> {
    // 业务 adapter
    const adapter = await this.createBusinessAdapter(backend);
    this.adapters.set(backend.id, adapter);

    // 运维 adapter
    const adminAdapter = this.createAdminAdapter(backend);
    if (adminAdapter) {
      this.adminAdapters.set(backend.id, adminAdapter);
    }
  }

  getAdminAdapter(backendId: string): IPlatformAdminAdapter {
    const adapter = this.adminAdapters.get(backendId);
    if (!adapter) throw new Error(`Admin adapter for ${backendId} not registered`);
    return adapter;
  }

  // 默认 admin adapter：取租户绑定的主后端
  getDefaultAdminAdapter(tenantId: string): IPlatformAdminAdapter {
    const binding = tenantStore.getHarnessBinding(tenantId, 'admin');
    return this.getAdminAdapter(binding.backendId);
  }

  private createAdminAdapter(backend: HarnessBackend): IPlatformAdminAdapter | null {
    switch (backend.type) {
      case 'intellect-rag':
        return new IntellectRagPlatformAdminAdapter(backend, new IntellectAdminClient(backend));
      case 'intellect-enterprise':
        return new IntellectEnterprisePlatformAdminAdapter(backend, new IntellectClient(backend));
      default:
        return null;
    }
  }
}
```

---

## 七、BFF 路由设计

### 7.1 路由清单

新增 `bff/src/routes/platform-admin.ts`，统一前缀 `/api/bff/platform-admin`：

```
# Version（必选，所有后端）
GET    /api/bff/platform-admin/version

# Users
GET    /api/bff/platform-admin/users
GET    /api/bff/platform-admin/users/:userId
POST   /api/bff/platform-admin/users
PUT    /api/bff/platform-admin/users/:userId
DELETE /api/bff/platform-admin/users/:userId
GET    /api/bff/platform-admin/users/:userId/datasets
GET    /api/bff/platform-admin/users/:userId/agents
PUT    /api/bff/platform-admin/users/:userId/superuser
DELETE /api/bff/platform-admin/users/:userId/superuser

# Services
GET    /api/bff/platform-admin/services
GET    /api/bff/platform-admin/services/:serviceId

# Sandbox
GET    /api/bff/platform-admin/sandbox/providers
GET    /api/bff/platform-admin/sandbox/providers/:providerId/schema
GET    /api/bff/platform-admin/sandbox/config
POST   /api/bff/platform-admin/sandbox/config
POST   /api/bff/platform-admin/sandbox/test

# Capabilities（前端条件渲染依据）
GET    /api/bff/platform-admin/capabilities
```

### 7.2 路由实现示例

```typescript
// bff/src/routes/platform-admin.ts

import { Hono } from 'hono';
import { getAdapterRegistry } from '../services/adapters/registry';
import { getTenantContext } from '../middleware/auth';

const app = new Hono();

// ── 版本 ──
app.get('/version', async (c) => {
  const ctx = getTenantContext(c);
  const adapter = getAdapterRegistry().getDefaultAdminAdapter(ctx.tenantId);
  const version = await adapter.version().getVersion();
  return c.json({ code: 0, message: 'OK', data: version });
});

// ── 用户 ──
app.get('/users', async (c) => {
  const ctx = getTenantContext(c);
  const adapter = getAdapterRegistry().getDefaultAdminAdapter(ctx.tenantId);
  if (!adapter.adminCapabilities.users || !adapter.users) {
    return c.json({ code: 403, message: 'User management not supported by this backend', data: null }, 403);
  }
  const users = await adapter.users().listUsers();
  return c.json({ code: 0, message: 'OK', data: users });
});

app.get('/users/:userId', async (c) => {
  const ctx = getTenantContext(c);
  const adapter = getAdapterRegistry().getDefaultAdminAdapter(ctx.tenantId);
  const userId = c.req.param('userId');
  const detail = await adapter.users()!.getUser(userId);
  return c.json({ code: 0, message: 'OK', data: detail });
});

// ... 其他路由同理

// ── 能力声明 ──
app.get('/capabilities', async (c) => {
  const ctx = getTenantContext(c);
  const adapter = getAdapterRegistry().getDefaultAdminAdapter(ctx.tenantId);
  return c.json({
    code: 0, message: 'OK',
    data: {
      backendId: adapter.backendId,
      backendType: adapter.backendType,
      adminCapabilities: adapter.adminCapabilities,
    },
  });
});

export default app;
```

### 7.3 路由注册

```typescript
// bff/src/index.ts

import platformAdminRoutes from './routes/platform-admin';

app.use('/api/bff/platform-admin/*', authMiddleware);
app.route('/api/bff/platform-admin', platformAdminRoutes);
```

### 7.4 数据流

```
前端 admin-service.ts
  │  axios.get('/api/bff/platform-admin/users')
  ↓
BFF /api/bff/platform-admin/users  (authMiddleware 校验 admin token)
  │  getTenantContext(c) → tenantId
  │  registry.getDefaultAdminAdapter(tenantId) → IntellectRagPlatformAdminAdapter
  │  adapter.users().listUsers()
  ↓
IntellectRagAdminClient.get('/api/v1/admin/users')  → Intellect RAG Admin :9381
  │
  ↓ 返回 [{email, activate_status, is_superuser, ...}]
BFF Adapter.mapUser() → 统一 Schema
  │
  ↓ 返回 [{id, email, status, roles, ...}]
前端 service 接收统一 Schema，业务页面零改动
```

---

## 八、Intellect 企业版侧待办（API 新增需求）

### 8.1 必须新增（P1）

**`GET /api/version`**：返回 Intellect 企业版及其组件版本

```json
{
  "version": "0.15.1",
  "build_time": "2026-06-20T10:00:00Z",
  "git_commit": "abc1234",
  "components": [
    { "name": "intellect-agent", "version": "0.15.1", "status": "ok" },
    { "name": "gateway", "version": "0.15.1", "status": "ok" },
    { "name": "intellect-core", "version": "0.15.1", "status": "ok" }
  ]
}
```

实现位置：`intellect-team/plugins/platforms/api_server/adapter.py`，参考已有 `_handle_health`。

### 8.2 已有能力（直接复用）

| 模块 | Intellect 企业版端点 | 说明 |
|------|-------------------|------|
| Users | `/api/members/*` | 已有完整 CRUD（见 `agent/membership.py`） |
| Services | `/health/detailed` | 已有 gateway 状态 + platforms + PID + uptime |

### 8.3 暂不实现

| 模块 | 原因 | 替代方案 |
|------|------|---------|
| Sandbox admin API | Intellect 企业版 codex_runtime 配置散落在 config.yaml，无统一 admin API | capability=false，前端隐藏沙箱配置菜单 |
| 用户级 datasets/agents 列表 | Intellect 企业版无此概念（资源归属 Team/Project） | 返回空数组，前端兼容显示 |

### 8.4 鉴权头

Intellect `/api/members/*` 已支持 member bearer token（`imt_*`），BFF 直接注入 `Authorization: Bearer <admin_token>` 即可。

---

## 九、前端改造方案

### 9.1 `api.ts` 路径常量迁移

```typescript
// src/utils/api.ts

// 旧：直连 Intellect RAG Admin
const restAPIv1 = `/api/v1`;
adminListUsers: `${restAPIv1}/admin/users`,
adminListServices: `${restAPIv1}/admin/services`,
adminGetSystemVersion: `${restAPIv1}/admin/version`,
adminListSandboxProviders: `${restAPIv1}/admin/sandbox/providers`,
// ...

// 新：统一走 BFF platform-admin
const bffPlatformAdmin = `/api/bff/platform-admin`;
adminListUsers: `${bffPlatformAdmin}/users`,
adminGetUserDetails: `${bffPlatformAdmin}/users`,  // :userId 通过 path param
adminCreateUser: `${bffPlatformAdmin}/users`,
adminDeleteUser: `${bffPlatformAdmin}/users`,       // :userId
adminListUserDatasets: `${bffPlatformAdmin}/users`, // :userId/datasets
adminListUserAgents: `${bffPlatformAdmin}/users`,   // :userId/agents
adminUpdateUserStatus: `${bffPlatformAdmin}/users`, // :userId
adminUpdateUserPassword: `${bffPlatformAdmin}/users`,
adminSetSuperuser: `${bffPlatformAdmin}/users`,     // :userId/superuser

adminListServices: `${bffPlatformAdmin}/services`,
adminShowServiceDetails: `${bffPlatformAdmin}/services`,  // :serviceId

adminGetSystemVersion: `${bffPlatformAdmin}/version`,

adminListSandboxProviders: `${bffPlatformAdmin}/sandbox/providers`,
adminGetSandboxProviderSchema: `${bffPlatformAdmin}/sandbox/providers`,  // :providerId/schema
adminGetSandboxConfig: `${bffPlatformAdmin}/sandbox/config`,
adminSetSandboxConfig: `${bffPlatformAdmin}/sandbox/config`,
adminTestSandboxConnection: `${bffPlatformAdmin}/sandbox/test`,
```

### 9.2 `admin-service.ts` 签名保持

`admin-service.ts` 中的函数签名**完全不变**，只是底层数据源切到 BFF：

```typescript
// src/services/admin-service.ts

// 签名不变
export const listUsers = () =>
  request.get<ResponseData<AdminService.ListUsersItem[]>>(adminListUsers, {});

// 但 ListUsersItem 类型需调整为统一 Schema
// 或者保留旧字段（_raw 透传），让 Adapter 兼容旧字段
```

**策略选择**（建议方案 B）：

| 方案 | 描述 | 优缺点 |
|------|------|--------|
| A. 改 TypeScript 类型 | `ListUsersItem` 改为 `PlatformUser` | 类型干净，但前端页面组件需改字段访问 |
| B. 保留旧字段名 | Adapter 在 mapUser 时同时输出新旧字段 | 前端组件零改动，但类型不干净 |

**推荐方案 B**：在 Adapter 中输出**双字段**，前端组件零改动：

```typescript
// Adapter 输出（兼容新旧字段）
{
  // 新统一 Schema
  id: 'admin@intellect.com',
  email: 'admin@intellect.com',
  displayName: 'Admin',
  status: 'active',
  roles: ['admin'],
  isSuperuser: true,
  createdAt: '2026-01-01T00:00:00Z',
  // 旧字段（兼容前端组件，下个版本删除）
  activate_status: 'on',
  is_superuser: true,
  create_date: '2026-01-01T00:00:00Z',
  latest_login_time: '2026-06-01T00:00:00Z',
  // 原生透传
  _raw: { /* 原始数据 */ },
}
```

### 9.3 Admin 页面条件渲染

```typescript
// src/pages/admin/layouts/navigation-layout.tsx

import { useHarnessCapabilities } from '@/hooks/use-harness-capabilities';

function AdminNavigation() {
  const { data: caps } = useHarnessCapabilities();

  return (
    <nav className="admin-nav">
      <NavLink to={Routes.Admin}>登录</NavLink>
      {caps?.adminCapabilities.services && (
        <NavLink to={Routes.AdminServices}>服务状态</NavLink>
      )}
      {caps?.adminCapabilities.users && (
        <NavLink to={Routes.AdminUsers}>用户管理</NavLink>
      )}
      {caps?.adminCapabilities.sandbox && (
        <NavLink to={Routes.AdminSandbox}>沙箱配置</NavLink>
      )}
      {/* version 永远显示 */}
      <NavLink to={Routes.AdminVersion}>系统版本</NavLink>

      {/* BFF 接管的本地功能永远显示 */}
      <NavLink to={Routes.AdminWhitelist}>白名单</NavLink>
      <NavLink to={Routes.AdminRoles}>角色管理</NavLink>
    </nav>
  );
}
```

### 9.4 新增 Hooks

```typescript
// src/hooks/use-harness-capabilities.ts

import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import api from '@/utils/api';

export interface AdminCapabilities {
  users: boolean;
  services: boolean;
  sandbox: boolean;
  version: boolean;
}

export function useHarnessCapabilities() {
  return useQuery({
    queryKey: ['harness-admin-capabilities'],
    queryFn: async () => {
      const res = await axios.get(`${api.adminPlatformAdminCapabilities}`);
      return res.data.data as {
        backendId: string;
        backendType: string;
        adminCapabilities: AdminCapabilities;
      };
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
```

### 9.5 前端改动清单

| 文件 | 改动 |
|------|------|
| [src/utils/api.ts](file:///Users/simon/workspace/agentui/src/utils/api.ts) | 8 类路径常量切到 `bffPlatformAdmin` |
| [src/services/admin-service.ts](file:///Users/simon/workspace/agentui/src/services/admin-service.ts) | 接口签名不变，类型可选调整 |
| [src/hooks/use-harness-capabilities.ts](file:///Users/simon/workspace/agentui/src/hooks/use-harness-capabilities.ts) | **新增** |
| [src/pages/admin/layouts/navigation-layout.tsx](file:///Users/simon/workspace/agentui/src/pages/admin/layouts/navigation-layout.tsx) | 菜单条件渲染 |
| 业务页面（users.tsx / services.tsx / sandbox-settings.tsx） | **零改动**（依赖 Adapter 双字段兼容） |

---

## 十、实施路线

### 10.1 阶段划分

| 阶段 | 模块 | 复杂度 | 依赖 |
|------|------|--------|------|
| **P0** | 接口与 Schema 定义 | 低 | 无 |
| **P1** | version 迁移 | 低 | Intellect 企业版新增 `/api/version` |
| **P2** | services 迁移 | 中 | Intellect 企业版 `/health/detailed` 已就绪 |
| **P3** | users 迁移 | 高 | 字段映射 + 角色 + 资源 |
| **P4** | sandbox 处理 | 低 | Intellect 企业版标 `capability=false`，前端隐藏菜单 |
| **P5** | 双字段兼容下线 | 低 | P3 完成后 1-2 个版本 |

### 10.2 P0：接口与 Schema 定义（先行）

**目标**：在 BFF 落地接口定义，不实现具体 Adapter

- [ ] 创建 `bff/src/services/adapters/admin-types.ts`：定义 4 个子接口
- [ ] 创建 `bff/src/services/adapters/admin-schemas.ts`：定义统一 Schema
- [ ] 扩展 `HarnessCapabilities`：新增 `adminUsers/adminServices/adminSandbox/adminVersion`
- [ ] 在 `IPlatformAdminAdapter` 顶层接口中声明

### 10.3 P1：version 迁移

**目标**：最简单的模块先打通，验证端到端流程

- [ ] Intellect 企业版侧：新增 `GET /api/version`（见 §8.1）
- [ ] BFF：实现 `IntellectRagPlatformAdminAdapter.version()` + `IntellectEnterprisePlatformAdminAdapter.version()`
- [ ] BFF：注册 `/api/bff/platform-admin/version` 路由
- [ ] 前端：`api.ts` 中 `adminGetSystemVersion` 改路径
- [ ] 前端：新增 `useHarnessCapabilities()` Hook
- [ ] 验证：Intellect RAG 后端 + Intellect 企业版后端均能返回统一 `PlatformVersion`

### 10.4 P2：services 迁移

- [ ] BFF：实现 `IntellectRagPlatformAdminAdapter.services()`（包装 `/admin/services/*`）
- [ ] BFF：实现 `IntellectEnterprisePlatformAdminAdapter.services()`（聚合 `/health/detailed`）
- [ ] BFF：注册 `/api/bff/platform-admin/services` 路由
- [ ] 前端：`api.ts` 中 services 相关路径迁移
- [ ] 前端：services.tsx 页面根据 `capabilities.services` 条件渲染

### 10.5 P3：users 迁移

- [ ] BFF：实现 `IntellectRagPlatformAdminAdapter.users()`（包装 `/admin/users/*`，双字段输出）
- [ ] BFF：实现 `IntellectEnterprisePlatformAdminAdapter.users()`（映射 `/api/members/*`）
- [ ] BFF：注册 `/api/bff/platform-admin/users/*` 路由
- [ ] 前端：`api.ts` 中 users 相关路径迁移
- [ ] 前端：user-detail 页面字段兼容（双字段策略）
- [ ] 验证：Intellect RAG 后端用户管理可用

### 10.6 P4：sandbox 处理

- [ ] BFF：实现 `IntellectRagPlatformAdminAdapter.sandbox()`（包装 `/admin/sandbox/*`）
- [ ] BFF：`IntellectEnterprisePlatformAdminAdapter` 不实现 sandbox，`adminCapabilities.sandbox = false`
- [ ] 前端：`api.ts` 中 sandbox 相关路径迁移
- [ ] 前端：sandbox-settings.tsx 根据 `capabilities.sandbox` 条件渲染
- [ ] Intellect 企业版后端时，菜单中"沙箱配置"项隐藏

### 10.7 P5：双字段兼容下线

- [ ] 前端：`admin-service.ts` 类型改为纯统一 Schema
- [ ] 前端：users/services 页面组件字段访问改为统一 Schema
- [ ] BFF：Adapter `mapUser` 等方法移除旧字段输出

---

## 十一、约束与边界

### 11.1 必须遵守

1. **BFF 不持久化运维数据**：users/services/sandbox/version 实时透传，不缓存
2. **Adapter 必须实现 version**：所有后端必选
3. **能力声明必须真实**：`adminCapabilities` 必须与 Adapter 实际实现一致
4. **响应包络统一**：`{ code, message, data }`，与现有 BFF 路由一致
5. **前端业务页面零改动**：通过 Adapter 双字段输出兼容
6. **Admin token 不落盘**：从环境变量注入（见 [multi-harness-design.md §四](file:///Users/simon/workspace/agentui/docs/multi-harness-design.md)）

### 11.2 不在本方案范围

- BFF 接管的 whitelist / roles / resources：已在 P0 完成，见 [frontend-architecture.md §15](file:///Users/simon/workspace/agentui/docs/frontend-architecture.md)
- Team / Project 管理：属于业务运行时（多租户扩展层），见 [multi-harness-design.md §5.2](file:///Users/simon/workspace/agentui/docs/multi-harness-design.md)
- 画布编排：硬绑定 Intellect RAG，不经过 Adapter
- 模型管理（model management）：本方案不涉及，后续单独抽象

### 11.3 已知风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Intellect RAG 与 Intellect 企业版用户模型差异大 | users 迁移复杂 | 双字段输出，前端零改动；P3 充分测试 |
| Intellect 企业版无 sandbox admin API | 沙箱配置在 Intellect 企业版后端不可用 | capability=false，前端隐藏菜单；后续推动 Intellect 企业版暴露 API |
| 服务状态语义不一致 | services 列表显示可能误导用户 | 在 ServiceDetail 中保留 `_raw` 字段，UI 显示后端原生信息 |
| Admin token 共享 | 同一后端多租户共用 admin token | 多租户阶段需引入 token 池或 scoped token（P4+） |

---

## 十二、关键文件清单

### BFF 侧（新增）

| 文件 | 职责 | 阶段 |
|------|------|------|
| `bff/src/services/adapters/admin-types.ts` | 4 个子接口定义 | P0 |
| `bff/src/services/adapters/admin-schemas.ts` | 统一 Schema | P0 |
| `bff/src/services/adapters/intellect-rag/admin-adapter.ts` | Intellect RAG 实现 | P1-P4 |
| `bff/src/services/adapters/intellect-enterprise/admin-adapter.ts` | Intellect 企业版实现 | P1-P4 |
| `bff/src/routes/platform-admin.ts` | BFF 路由 | P1-P4 |
| `bff/src/services/adapters/registry.ts` | 扩展注册 admin adapter | P0 |

### BFF 侧（修改）

| 文件 | 改动 | 阶段 |
|------|------|------|
| [bff/src/services/adapters/types.ts](file:///Users/simon/workspace/agentui/bff/src/services/adapters/types.ts) | 扩展 `HarnessCapabilities` | P0 |
| [bff/src/index.ts](file:///Users/simon/workspace/agentui/bff/src/index.ts) | 注册 platform-admin 路由 | P1 |

### 前端侧（修改）

| 文件 | 改动 | 阶段 |
|------|------|------|
| [src/utils/api.ts](file:///Users/simon/workspace/agentui/src/utils/api.ts) | 路径常量切到 `bffPlatformAdmin` | P1-P4 |
| [src/services/admin-service.ts](file:///Users/simon/workspace/agentui/src/services/admin-service.ts) | 签名不变，类型可选调整 | P3 |
| [src/pages/admin/layouts/navigation-layout.tsx](file:///Users/simon/workspace/agentui/src/pages/admin/layouts/navigation-layout.tsx) | 菜单条件渲染 | P1 |

### 前端侧（新增）

| 文件 | 职责 | 阶段 |
|------|------|------|
| `src/hooks/use-harness-capabilities.ts` | 能力探测 Hook | P1 |

### Intellect 企业版侧（新增，交付 Intellect 企业版团队）

| 文件 | 改动 | 阶段 |
|------|------|------|
| `intellect-team/plugins/platforms/api_server/adapter.py` | 新增 `_handle_version` + 路由 | P1 |

---

## 十三、相关文档

| 文档 | 关系 |
|------|------|
| [multi-harness-design.md](file:///Users/simon/workspace/agentui/docs/multi-harness-design.md) | 父方案，本文档是其子方案 |
| [intellect-admin-api-guide.md](file:///Users/simon/workspace/agentui/docs/intellect-admin-api-guide.md) | Intellect 企业版侧 Team/Project API 规范，本文档 §8 补充 version API 规范 |
| [frontend-architecture.md](file:///Users/simon/workspace/agentui/docs/frontend-architecture.md) | 前端框架总体，本文档影响 §7.3 / §15 / §16 |
| [vite-architecture.md](file:///Users/simon/workspace/agentui/docs/vite-architecture.md) | 代理层架构，本文档新增 `/api/bff/platform-admin/*` 前缀 |
