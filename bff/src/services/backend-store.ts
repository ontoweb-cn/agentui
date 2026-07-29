// Multi-Harness P0 Phase 5 (US3):BackendStore 实现。
// Constitution Principle V (Tenant Isolation) + Principle III (Canvas Hard-Bound)。
// 维护 BffTenant 实体与后端绑定关系,只存绑定 refs,不存 Team/Project/Member。
// setCanvasBinding 强制校验 canvasBackendId 对应的 HarnessBackend.type 必须是 'intellect-rag'。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BffTenant, BackendStore, HarnessStore } from '../types';
import {
  TenantNotFoundError,
  BackendNotConfiguredError,
  InvalidCanvasBackendError,
} from './adapter-registry-errors';

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
  intellectProjectId: z.string().optional(),
  intellectBackendId: z.string().min(1),
  canvasBackendId: z.string().optional(),
  authMode: z.enum(['intellect-rag', 'intellect-enterprise']).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const tenantsFileSchema = z.object({
  tenants: z.array(tenantSchema),
});

// ---------------------------------------------------------------------------
// JSONFileBackendStore
// ---------------------------------------------------------------------------

export class JSONFileBackendStore implements BackendStore {
  private tenants: BffTenant[] = [];

  constructor(private readonly harnessStore: HarnessStore) {}

  async load(): Promise<void> {
    // JSON 不存在:返回空数组
    if (!existsSync(TENANTS_FILE)) {
      console.warn(
        `\[backend-store\] Tenants file not found: ${TENANTS_FILE}, loading empty tenant list`,
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
        `\[backend-store\] Failed to parse JSON: ${(err as Error).message}, loading empty list`,
      );
      this.tenants = [];
      return;
    }

    const validationResult = tenantsFileSchema.safeParse(parsed);
    if (!validationResult.success) {
      console.error(
        `\[backend-store\] Invalid tenants schema: ${validationResult.error.message}, loading empty list`,
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
        throw new BackendNotConfiguredError(tenant.intellectBackendId);
      }

      // P4b: authMode=intellect-enterprise 时,intellectBackendId 必须指向 type='intellect-enterprise' 后端
      if (
        tenant.authMode === 'intellect-enterprise' &&
        mainBackend.type !== 'intellect-enterprise'
      ) {
        throw new Error(
          `\[backend-store\] Tenant "${tenant.id}" authMode=intellect-enterprise requires intellectBackendId to point to type='intellect-enterprise' backend, got: ${mainBackend.type}`,
        );
      }

      // 校验 canvasBackendId(若设置)对应 backend.type === 'intellect-rag' (Constitution Principle III)
      if (tenant.canvasBackendId) {
        const canvasBackend = this.harnessStore.get(tenant.canvasBackendId);
        if (!canvasBackend) {
          throw new BackendNotConfiguredError(tenant.canvasBackendId);
        }
        if (canvasBackend.type !== 'intellect-rag') {
          throw new InvalidCanvasBackendError(tenant.id, tenant.canvasBackendId, canvasBackend.type);
        }
      }

      loaded.push(tenant as BffTenant);
      console.log(`\[backend-store\] Loaded tenant: ${tenant.id} (backend: ${tenant.intellectBackendId})`);
    }

    this.tenants = loaded;
  }

  async createBackend(
    name: string,
    intellectBackendId: string,
    intellectTenantId?: string,
  ): Promise<BffTenant> {
    // 校验 backendId 存在
    const backend = this.harnessStore.get(intellectBackendId);
    if (!backend) {
      throw new BackendNotConfiguredError(intellectBackendId);
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

  getBackend(tenantId: string): BffTenant | undefined {
    return this.tenants.find((t) => t.id === tenantId);
  }

  listBackends(): BffTenant[] {
    return this.tenants;
  }

  async setHarnessBinding(tenantId: string, backendId: string): Promise<void> {
    const tenant = this.getBackend(tenantId);
    if (!tenant) {
      throw new TenantNotFoundError(tenantId);
    }
    const backend = this.harnessStore.get(backendId);
    if (!backend) {
      throw new BackendNotConfiguredError(backendId);
    }
    tenant.intellectBackendId = backendId;
    tenant.updatedAt = new Date().toISOString();
    await this.persist();
  }

  getHarnessBinding(tenantId: string): string | undefined {
    return this.getBackend(tenantId)?.intellectBackendId;
  }

  async setIntellectBinding(
    tenantId: string,
    intellectTenantId: string | undefined,
    intellectProjectId?: string,
  ): Promise<void> {
    const tenant = this.getBackend(tenantId);
    if (!tenant) {
      throw new TenantNotFoundError(tenantId);
    }
    // intellectTenantId 为 undefined 时清除绑定(回退缺省),为 "0" 也表示缺省
    tenant.intellectTenantId = intellectTenantId || '0';
    // intellectProjectId 为 undefined/空字符串时清除 project 绑定
    if (intellectProjectId) {
      tenant.intellectProjectId = intellectProjectId;
    } else {
      delete tenant.intellectProjectId;
    }
    tenant.updatedAt = new Date().toISOString();
    await this.persist();
  }

  getIntellectTeamId(tenantId: string): string | undefined {
    const tenant = this.getBackend(tenantId);
    if (!tenant?.intellectTenantId || tenant.intellectTenantId === '0') {
      return undefined;
    }
    return tenant.intellectTenantId;
  }

  getIntellectProjectId(tenantId: string): string | undefined {
    return this.getBackend(tenantId)?.intellectProjectId;
  }

  async setCanvasBinding(tenantId: string, backendId: string): Promise<void> {
    const tenant = this.getBackend(tenantId);
    if (!tenant) {
      throw new TenantNotFoundError(tenantId);
    }
    const backend = this.harnessStore.get(backendId);
    if (!backend) {
      throw new BackendNotConfiguredError(backendId);
    }
    // Constitution Principle III 强制校验:canvasBackendId 必须是 intellect-rag 类型
    if (backend.type !== 'intellect-rag') {
      throw new InvalidCanvasBackendError(tenantId, backendId, backend.type);
    }
    tenant.canvasBackendId = backendId;
    tenant.updatedAt = new Date().toISOString();
    await this.persist();
  }

  getCanvasBinding(tenantId: string): string | undefined {
    return this.getBackend(tenantId)?.canvasBackendId;
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
