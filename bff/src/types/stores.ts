// @see specs/001-multi-harness-p0/contracts/stores.ts (authority source)
/**
 * Contract: Stores — HarnessStore & TenantStore
 *
 * Authority source: specs/001-multi-harness-p0/contracts/stores.ts
 * Runtime copy: bff/src/types/stores.ts
 *
 * Constitution references:
 * - Principle V (Tenant Isolation via BFF):
 *   TenantStore maintains BffTenant entities with binding refs only.
 * - Token Security:
 *   HarnessStore reads token from env, JSON stores adminTokenEnvVar ref only.
 *   Runtime HarnessBackend (with token) is in-memory, never persisted.
 * - Principle VII (YAGNI):
 *   P0 implements these as JSON-file-backed stores. P4+ may swap to SQLite/Postgres
 *   by implementing the same interface.
 */

import type {
  HarnessBackend,
  HarnessBackendConfig,
} from './harness';
import type { BffTenant } from './tenant';

// ---------------------------------------------------------------------------
// HarnessStore
// ---------------------------------------------------------------------------

/**
 * 后端配置存储。
 *
 * Persistence:
 * - JSON file: bff/data/harness-backends.json (HarnessBackendConfig[], NO token)
 * - Environment: adminTokenEnvVar → admin token plaintext (gitignored .env)
 * - Runtime: HarnessBackend[] in-memory (merged JSON + env)
 *
 * Lifecycle:
 * - BFF startup: load() reads JSON + env, merges to HarnessBackend[], skips
 *   backends whose adminTokenEnvVar is unset (with warning, NOT throw).
 * - Runtime: get(id) / list() return in-memory objects.
 * - saveConfig(config): writes HarnessBackendConfig[] back to JSON (NO token).
 *
 * Constitution Principle VII YAGNI: P0 implements JSON file backend.
 * P4+ may implement SQLite/Postgres backend by implementing this interface.
 */
export interface HarnessStore {
  /**
   * 从 JSON + env 加载后端配置到内存。
   * 启动时调用一次。
   * - env 缺失的后端被跳过并告警(不抛异常)
   * - 重复 ID 的后端,后写入覆盖先写入并告警
   */
  load(): Promise<void>;

  /**
   * 列出所有已加载的后端(运行时内存对象,含 token)。
   */
  list(): HarnessBackend[];

  /**
   * 按 ID 获取后端。
   * @returns 后端对象,不存在则返回 undefined
   */
  get(id: string): HarnessBackend | undefined;

  /**
   * 保存配置(写回 JSON 文件)。
   * 只持久化 HarnessBackendConfig(无 token),运行时内存对象不写回。
   * @param config 后端配置数组
   */
  saveConfig(config: HarnessBackendConfig[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// TenantStore
// ---------------------------------------------------------------------------

/**
 * BFF 租户存储,维护 BffTenant 实体与后端绑定关系。
 *
 * Persistence:
 * - JSON file: bff/data/bff-tenants.json (BffTenant[], NO token, git-tracked)
 *
 * Constitution Principle V: TenantStore 只存绑定关系,
 * 不存 Team/Project/Member 业务数据(那些通过 IMultiTenantAdapter 透传管理)。
 *
 * Constitution Principle III: setCanvasBinding 强制校验
 * canvasBackendId 对应的 HarnessBackend.type 必须是 'intellect-rag'。
 */
export interface TenantStore {
  /**
   * 从 JSON 加载 BffTenant 数组到内存。
   * 启动时调用一次。
   */
  load(): Promise<void>;

  /**
   * 创建 BFF Tenant。
   * @param name 租户名称
   * @param intellectBackendId 主后端 ID(必须已存在于 HarnessStore)
   * @param intellectTenantId 对应的 Intellect 企业版 Tenant ID(企业版用户必填)
   * @returns 新建的 BffTenant
   * @throws 若 intellectBackendId 不存在于 HarnessStore
   */
  createTenant(
    name: string,
    intellectBackendId: string,
    intellectTenantId?: string,
  ): Promise<BffTenant>;

  /** 按 ID 获取 Tenant。 */
  getTenant(tenantId: string): BffTenant | undefined;

  /** 列出所有 Tenant。 */
  listTenants(): BffTenant[];

  /**
   * 设置 Tenant 的主后端绑定。
   * @throws 若 tenantId 或 backendId 不存在
   */
  setHarnessBinding(tenantId: string, backendId: string): Promise<void>;

  /** 获取 Tenant 的主后端 ID(未绑定则 undefined)。 */
  getHarnessBinding(tenantId: string): string | undefined;

  /**
   * 设置 Tenant 的 Intellect 企业版 Team/Project 绑定(P5 新增)。
   *
   * Constitution Principle V (Tenant Isolation):
   * - 真正的租户隔离通过多实例(intellectBackendId 绑定不同 intellect-team 实例)实现
   * - intellectTenantId="0" 或 undefined:不注入 X-Intellect-Team 头(缺省,向后兼容)
   * - intellectTenantId=真实 team_id:注入 X-Intellect-Team 头(启用实例内 Team 数据隔离)
   * - intellectProjectId 为空:不注入 X-Intellect-Project 头
   *
   * @param tenantId BFF Tenant ID
   * @param intellectTenantId intellect-team team_id,值 "0" 或 undefined 表示缺省
   * @param intellectProjectId 可选 intellect-team project_id
   * @throws 若 tenantId 不存在
   */
  setIntellectBinding(
    tenantId: string,
    intellectTenantId: string | undefined,
    intellectProjectId?: string,
  ): Promise<void>;

  /** 获取 Tenant 绑定的 Intellect team_id(未绑定或 "0" 则 undefined)。 */
  getIntellectTeamId(tenantId: string): string | undefined;

  /** 获取 Tenant 绑定的 Intellect project_id(未绑定则 undefined)。 */
  getIntellectProjectId(tenantId: string): string | undefined;

  /**
   * 设置 Tenant 的画布后端绑定。
   *
   * Constitution Principle III 强制校验:
   * - backendId 必须已存在于 HarnessStore
   * - 对应 HarnessBackend.type 必须是 'intellect-rag'
   *
   * @throws 若 tenantId 不存在,或 backendId 不存在,或 backendId 类型非 intellect-rag
   */
  setCanvasBinding(tenantId: string, backendId: string): Promise<void>;

  /** 获取 Tenant 的画布后端 ID(未绑定则 undefined)。 */
  getCanvasBinding(tenantId: string): string | undefined;
}

// ---------------------------------------------------------------------------
// Store Factory (used by BFF bootstrap in index.ts)
// ---------------------------------------------------------------------------

/**
 * Store 工厂,用于 BFF 启动时初始化。
 * P0 实现为 JSONFileHarnessStore / JSONFileTenantStore。
 * P4+ 可替换为 SQLiteImplementation,只要实现相同接口。
 */
export interface StoreFactory {
  createHarnessStore(): HarnessStore;
  createTenantStore(): TenantStore;
}
