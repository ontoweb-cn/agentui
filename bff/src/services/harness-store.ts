// Multi-Harness P0 Phase 5 (US3):HarnessStore 实现。
// Constitution Principle V (Tenant Isolation) + Token 安全约束。
// 从 JSON 文件(无 token)+ 环境变量(token 明文)合并为运行时 HarnessBackend[]。
// P4+ 可替换为 SQLite/Postgres 实现,只要实现相同接口(Principle VII YAGNI)。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type {
  HarnessBackend,
  HarnessBackendConfig,
  HarnessStore,
} from '../types';
import type { HarnessStoreListConfigs } from '../types/harness-admin';

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');
const CONFIG_FILE = resolve(DATA_DIR, 'harness-backends.json');

// ---------------------------------------------------------------------------
// Zod schemas (validate JSON structure)
// ---------------------------------------------------------------------------

const capabilitiesSchema = z.object({
  canvas: z.boolean(),
  knowledgeBase: z.boolean(),
  memory: z.boolean(),
  mcp: z.boolean(),
  multiTenant: z.boolean(),
  modelManagement: z.boolean(),
});

const backendConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['intellect-rag', 'intellect-enterprise']),
  endpoint: z.string().url(),
  adminTokenEnvVar: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  projectTokenEnvVar: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  capabilities: capabilitiesSchema,
  defaultForTenant: z.boolean().optional(),
});

const configFileSchema = z.object({
  backends: z.array(backendConfigSchema),
});

// ---------------------------------------------------------------------------
// JSONFileHarnessStore
// ---------------------------------------------------------------------------

export class JSONFileHarnessStore implements HarnessStore, HarnessStoreListConfigs {
  private backends: HarnessBackend[] = [];
  // P2 新增:所有配置(含 env token 未就绪的),不含 token 明文。
  // 用于 Admin 列表展示(listConfigs),与 backends(仅就绪,含 token)区分。
  private allConfigs: HarnessBackendConfig[] = [];

  async load(): Promise<void> {
    // JSON 文件不存在:返回空数组,不报错(spec.md Edge Cases)
    if (!existsSync(CONFIG_FILE)) {
      console.warn(
        `[harness-store] Config file not found: ${CONFIG_FILE}, loading empty backend list`,
      );
      this.backends = [];
      this.allConfigs = [];
      return;
    }

    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(
        `[harness-store] Failed to parse JSON: ${(err as Error).message}, loading empty list`,
      );
      this.backends = [];
      this.allConfigs = [];
      return;
    }

    const validationResult = configFileSchema.safeParse(parsed);
    if (!validationResult.success) {
      console.error(
        `[harness-store] Invalid config schema: ${validationResult.error.message}, loading empty list`,
      );
      this.backends = [];
      this.allConfigs = [];
      return;
    }

    const configs = validationResult.data.backends;
    const merged: HarnessBackend[] = [];
    // P2:dedup 后的 configs 数组(保留 last-write 覆盖语义,与 backends 一致)
    const dedupedConfigs: HarnessBackendConfig[] = [];
    const seenIds = new Set<string>();

    for (const config of configs) {
      // 重复 ID:后写入覆盖先写入,告警
      if (seenIds.has(config.id)) {
        console.warn(
          `[harness-store] Duplicate backend id "${config.id}", later entry overwrites earlier`,
        );
        // 移除已存在的同 id 条目
        const idx = merged.findIndex((b) => b.id === config.id);
        if (idx >= 0) {
          merged.splice(idx, 1);
        }
        const cidx = dedupedConfigs.findIndex((c) => c.id === config.id);
        if (cidx >= 0) {
          dedupedConfigs.splice(cidx, 1);
        }
      }
      seenIds.add(config.id);
      // P2:所有配置都加入 dedupedConfigs(含 env 未就绪的),不含 token 明文
      dedupedConfigs.push(config);

      // 读 env:adminToken
      const adminToken = process.env[config.adminTokenEnvVar];
      if (!adminToken) {
        // env 缺失:跳过该后端,console.warn 告警(FR-023),不抛异常
        console.warn(
          `[harness-store] Backend "${config.id}" skipped: env var ${config.adminTokenEnvVar} not set`,
        );
        continue;
      }

      // 读 env:projectToken(可选,P4+ 预留)
      let projectToken: string | undefined;
      if (config.projectTokenEnvVar) {
        projectToken = process.env[config.projectTokenEnvVar];
        if (!projectToken) {
          console.warn(
            `[harness-store] Backend "${config.id}": project token env var ${config.projectTokenEnvVar} not set (optional, P4+ only)`,
          );
        }
      }

      const backend: HarnessBackend = {
        ...config,
        adminToken,
        projectToken,
      };
      merged.push(backend);
      console.log(`[harness-store] Loaded backend: ${backend.id} (${backend.type})`);
    }

    this.backends = merged;
    this.allConfigs = dedupedConfigs;
  }

  list(): HarnessBackend[] {
    return this.backends;
  }

  get(id: string): HarnessBackend | undefined {
    return this.backends.find((b) => b.id === id);
  }

  /**
   * P2 新增:返回所有配置(含 env token 未就绪的),不含 adminToken 明文。
   * 用于 Admin 列表展示(Token Security:JSON 中只有 adminTokenEnvVar 引用)。
   *
   * 与 list() 的区别:
   * - list():返回就绪后端(含 adminToken 明文,内存对象)
   * - listConfigs():返回所有配置(不含 adminToken,可暴露给前端)
   */
  listConfigs(): HarnessBackendConfig[] {
    return this.allConfigs;
  }

  async saveConfig(config: HarnessBackendConfig[]): Promise<void> {
    // 只持久化 HarnessBackendConfig(无 token),运行时内存对象不写回
    const data = { backends: config };
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8');
    // P2:同步更新内存 allConfigs(保证 listConfigs 立即反映新配置)
    this.allConfigs = config;
  }
}
