// Multi-Harness P0 Phase 5 (US3):TenantStore 实现。
// Constitution Principle V (Tenant Isolation) + Principle III (Canvas Hard-Bound)。
// 维护 BffTenant 实体与后端绑定关系,只存绑定 refs,不存 Team/Project/Member。
// setCanvasBinding 强制校验 canvasBackendId 对应的 HarnessBackend.type 必须是 'intellect-rag'。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BffTenant, TenantStore, HarnessStore } from '../types';

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');
const TENANTS_FILE = resolve(DATA_DIR, 'bff-tenants.json');

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const tenantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  intellectTenantId: z.string().optional(),
  intellectBackendId: z.string().min(1),
  canvasBackendId: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const tenantsFileSchema = z.object({
  tenants: z.array(tenantSchema),
});

// ---------------------------------------------------------------------------
// JSONFileTenantStore
// ---------------------------------------------------------------------------

export class JSONFileTenantStore implements TenantStore {
  private tenants: BffTenant[] = [];

  constructor(private readonly harnessStore: HarnessStore) {}

  async load(): Promise<void> {
    // JSON 不存在:返回空数组
    if (!existsSync(TENANTS_FILE)) {
      console.warn(
        `[tenant-store] Tenants file not found: ${TENANTS_FILE}, loading empty tenant list`,
      );
      this.tenants = [];
      return;
    }

    const raw = readFileSync(TENANTS_FILE, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(
        `[tenant-store] Failed to parse JSON: ${(err as Error).message}, loading empty list`,
      );
      this.tenants = [];
      return;
    }

    const validationResult = tenantsFileSchema.safeParse(parsed);
    if (!validationResult.success) {
      console.error(
        `[tenant-store] Invalid tenants schema: ${validationResult.error.message}, loading empty list`,
      );
      this.tenants = [];
      return;
    }

    // 校验每个 tenant 的绑定关系
    const loaded: BffTenant[] = [];
    for (const tenant of validationResult.data.tenants) {
      // 校验 intellectBackendId 存在
      const mainBackend = this.harnessStore.get(tenant.intellectBackendId);
      if (!mainBackend) {
        // 校验失败:抛出明确错误(不静默,spec.md Edge Cases)
        throw new Error(
          `[tenant-store] Tenant "${tenant.id}" references unknown intellectBackendId "${tenant.intellectBackendId}"`,
        );
      }

      // 校验 canvasBackendId(若设置)对应 backend.type === 'intellect-rag' (Constitution Principle III)
      if (tenant.canvasBackendId) {
        const canvasBackend = this.harnessStore.get(tenant.canvasBackendId);
        if (!canvasBackend) {
          throw new Error(
            `[tenant-store] Tenant "${tenant.id}" references unknown canvasBackendId "${tenant.canvasBackendId}"`,
          );
        }
        if (canvasBackend.type !== 'intellect-rag') {
          throw new Error(
            `[tenant-store] Tenant "${tenant.id}" canvasBackendId must be intellect-rag type, got: ${canvasBackend.type}`,
          );
        }
      }

      loaded.push(tenant as BffTenant);
      console.log(`[tenant-store] Loaded tenant: ${tenant.id} (backend: ${tenant.intellectBackendId})`);
    }

    this.tenants = loaded;
  }

  async createTenant(
    name: string,
    intellectBackendId: string,
    intellectTenantId?: string,
  ): Promise<BffTenant> {
    // 校验 backendId 存在
    const backend = this.harnessStore.get(intellectBackendId);
    if (!backend) {
      throw new Error(
        `[tenant-store] Cannot create tenant: intellectBackendId "${intellectBackendId}" not found in HarnessStore`,
      );
    }

    const now = new Date().toISOString();
    const tenant: BffTenant = {
      id: randomUUID(),
      name,
      intellectTenantId,
      intellectBackendId,
      createdAt: now,
      updatedAt: now,
    };

    this.tenants.push(tenant);
    await this.persist();
    return tenant;
  }

  getTenant(tenantId: string): BffTenant | undefined {
    return this.tenants.find((t) => t.id === tenantId);
  }

  listTenants(): BffTenant[] {
    return this.tenants;
  }

  async setHarnessBinding(tenantId: string, backendId: string): Promise<void> {
    const tenant = this.getTenant(tenantId);
    if (!tenant) {
      throw new Error(`[tenant-store] Tenant not found: ${tenantId}`);
    }
    const backend = this.harnessStore.get(backendId);
    if (!backend) {
      throw new Error(
        `[tenant-store] Backend not found in HarnessStore: ${backendId}`,
      );
    }
    tenant.intellectBackendId = backendId;
    tenant.updatedAt = new Date().toISOString();
    await this.persist();
  }

  getHarnessBinding(tenantId: string): string | undefined {
    return this.getTenant(tenantId)?.intellectBackendId;
  }

  async setCanvasBinding(tenantId: string, backendId: string): Promise<void> {
    const tenant = this.getTenant(tenantId);
    if (!tenant) {
      throw new Error(`[tenant-store] Tenant not found: ${tenantId}`);
    }
    const backend = this.harnessStore.get(backendId);
    if (!backend) {
      throw new Error(
        `[tenant-store] Backend not found in HarnessStore: ${backendId}`,
      );
    }
    // Constitution Principle III 强制校验:canvasBackendId 必须是 intellect-rag 类型
    if (backend.type !== 'intellect-rag') {
      throw new Error(
        `[tenant-store] canvasBackendId must be intellect-rag type, got: ${backend.type}`,
      );
    }
    tenant.canvasBackendId = backendId;
    tenant.updatedAt = new Date().toISOString();
    await this.persist();
  }

  getCanvasBinding(tenantId: string): string | undefined {
    return this.getTenant(tenantId)?.canvasBackendId;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async persist(): Promise<void> {
    const data = { tenants: this.tenants };
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    writeFileSync(TENANTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }
}
