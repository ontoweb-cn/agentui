// Multi-Harness P1:HarnessStore 单元测试(research.md §4 P1 硬前置)
// 覆盖 load() 的 6 种边界 + list/get/saveConfig 行为。
// 用 vi.mock('node:fs') 模拟 fs,因 Store 内 DATA_DIR/CONFIG_FILE 是模块顶层硬编码路径。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';

// vi.hoisted 保证 mockFs 在 vi.mock 工厂执行前已定义
const { mockFs } = vi.hoisted(() => ({
  mockFs: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

vi.mock('node:fs', () => mockFs);

// 在 mock 设置完成后才 import SUT(System Under Test)
import { JSONFileHarnessStore } from './harness-store';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const validBackendConfig = {
  id: 'intellect-rag-default',
  name: 'Default Intellect RAG',
  type: 'intellect-rag' as const,
  endpoint: 'http://localhost:9380',
  adminTokenEnvVar: 'HARNESS_INTELLECT_RAG_ADMIN_TOKEN',
  capabilities: {
    canvas: true,
    knowledgeBase: true,
    memory: true,
    mcp: false,
    multiTenant: false,
    modelManagement: false,
  },
  defaultForTenant: true,
};

const enterpriseBackendConfig = {
  id: 'intellect-enterprise-1',
  name: 'Intellect Enterprise',
  type: 'intellect-enterprise' as const,
  endpoint: 'http://localhost:9381',
  adminTokenEnvVar: 'HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY',
  capabilities: {
    canvas: false,
    knowledgeBase: false,
    memory: true,
    mcp: false,
    multiTenant: true,
    modelManagement: false,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setFsFile(content: unknown): void {
  mockFs.existsSync.mockReturnValue(true);
  mockFs.readFileSync.mockReturnValue(typeof content === 'string' ? content : JSON.stringify(content));
}

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JSONFileHarnessStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // mock 全局 console(Store 用全局 console,不是 node:console 模块)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // 默认所有 env 变量未设置
    delete process.env.HARNESS_INTELLECT_RAG_ADMIN_TOKEN;
    delete process.env.HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // load() - edge cases
  // -------------------------------------------------------------------------

  describe('load() edge cases', () => {
    it('文件不存在时返回空数组,不抛异常', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const store = new JSONFileHarnessStore();

      await expect(store.load()).resolves.toBeUndefined();
      expect(store.list()).toEqual([]);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Config file not found'),
      );
    });

    it('JSON 解析失败时返回空数组,不抛异常', async () => {
      setFsFile('not a valid json {{{');
      const store = new JSONFileHarnessStore();

      await expect(store.load()).resolves.toBeUndefined();
      expect(store.list()).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse JSON'),
      );
    });

    it('schema 校验失败时返回空数组,不抛异常', async () => {
      // 缺少必填字段 type
      setFsFile({ backends: [{ id: 'x', name: 'X', endpoint: 'http://x' }] });
      const store = new JSONFileHarnessStore();

      await expect(store.load()).resolves.toBeUndefined();
      expect(store.list()).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid config schema'),
      );
    });

    it('endpoint 不是合法 URL 时 schema 校验失败', async () => {
      setFsFile({
        backends: [{ ...validBackendConfig, endpoint: 'not-a-url' }],
      });
      const store = new JSONFileHarnessStore();

      await store.load();
      expect(store.list()).toEqual([]);
    });

    it('adminTokenEnvVar 不符合命名规则时 schema 校验失败', async () => {
      setFsFile({
        backends: [{ ...validBackendConfig, adminTokenEnvVar: 'lowercase-invalid' }],
      });
      const store = new JSONFileHarnessStore();

      await store.load();
      expect(store.list()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // load() - happy path
  // -------------------------------------------------------------------------

  describe('load() 正常路径', () => {
    it('加载单个后端,合并 env 中的 adminToken', async () => {
      setFsFile({ backends: [validBackendConfig] });
      setEnv({ HARNESS_INTELLECT_RAG_ADMIN_TOKEN: 'secret-token-123' });

      const store = new JSONFileHarnessStore();
      await store.load();

      const backends = store.list();
      expect(backends).toHaveLength(1);
      expect(backends[0].id).toBe('intellect-rag-default');
      expect(backends[0].adminToken).toBe('secret-token-123');
      // projectToken 未配置时为 undefined
      expect(backends[0].projectToken).toBeUndefined();
    });

    it('加载多个后端(intellect-rag + intellect-enterprise)', async () => {
      setFsFile({ backends: [validBackendConfig, enterpriseBackendConfig] });
      setEnv({
        HARNESS_INTELLECT_RAG_ADMIN_TOKEN: 'rag-token',
        HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY: 'enterprise-key',
      });

      const store = new JSONFileHarnessStore();
      await store.load();

      expect(store.list()).toHaveLength(2);
      expect(store.get('intellect-rag-default')?.type).toBe('intellect-rag');
      expect(store.get('intellect-enterprise-1')?.type).toBe('intellect-enterprise');
    });
  });

  // -------------------------------------------------------------------------
  // load() - env 缺失
  // -------------------------------------------------------------------------

  describe('load() env 缺失处理(FR-023)', () => {
    it('adminToken env 缺失时跳过该后端,不抛异常', async () => {
      setFsFile({ backends: [validBackendConfig] });
      // 不设置 HARNESS_INTELLECT_RAG_ADMIN_TOKEN

      const store = new JSONFileHarnessStore();
      await store.load();

      expect(store.list()).toEqual([]);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Backend "intellect-rag-default" skipped'),
      );
    });

    it('部分后端 env 缺失时只跳过缺失的,保留有 env 的', async () => {
      setFsFile({ backends: [validBackendConfig, enterpriseBackendConfig] });
      setEnv({
        HARNESS_INTELLECT_RAG_ADMIN_TOKEN: 'rag-token',
        // enterprise key 不设置
      });

      const store = new JSONFileHarnessStore();
      await store.load();

      const backends = store.list();
      expect(backends).toHaveLength(1);
      expect(backends[0].id).toBe('intellect-rag-default');
    });

    it('projectToken env 缺失时告警但不跳过该后端(P4+ 可选)', async () => {
      const configWithProjectToken = {
        ...validBackendConfig,
        projectTokenEnvVar: 'HARNESS_INTELLECT_RAG_PROJECT_TOKEN',
      };
      setFsFile({ backends: [configWithProjectToken] });
      setEnv({
        HARNESS_INTELLECT_RAG_ADMIN_TOKEN: 'admin-token',
        // project token 不设置
      });

      const store = new JSONFileHarnessStore();
      await store.load();

      const backends = store.list();
      expect(backends).toHaveLength(1);
      expect(backends[0].adminToken).toBe('admin-token');
      expect(backends[0].projectToken).toBeUndefined();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('project token env var'),
      );
    });

    it('projectToken env 存在时合并到后端', async () => {
      const configWithProjectToken = {
        ...validBackendConfig,
        projectTokenEnvVar: 'HARNESS_INTELLECT_RAG_PROJECT_TOKEN',
      };
      setFsFile({ backends: [configWithProjectToken] });
      setEnv({
        HARNESS_INTELLECT_RAG_ADMIN_TOKEN: 'admin-token',
        HARNESS_INTELLECT_RAG_PROJECT_TOKEN: 'project-token',
      });

      const store = new JSONFileHarnessStore();
      await store.load();

      const backends = store.list();
      expect(backends[0].adminToken).toBe('admin-token');
      expect(backends[0].projectToken).toBe('project-token');
    });
  });

  // -------------------------------------------------------------------------
  // load() - 重复 ID
  // -------------------------------------------------------------------------

  describe('load() 重复 ID 处理', () => {
    it('重复 ID 时后写入覆盖先写入', async () => {
      const first = { ...validBackendConfig, name: 'First' };
      const second = { ...validBackendConfig, name: 'Second' };
      setFsFile({ backends: [first, second] });
      setEnv({ HARNESS_INTELLECT_RAG_ADMIN_TOKEN: 'token' });

      const store = new JSONFileHarnessStore();
      await store.load();

      const backends = store.list();
      expect(backends).toHaveLength(1);
      expect(backends[0].name).toBe('Second');
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate backend id "intellect-rag-default"'),
      );
    });
  });

  // -------------------------------------------------------------------------
  // list() / get()
  // -------------------------------------------------------------------------

  describe('list() / get() 查询', () => {
    it('list() 返回内部数组的引用(非副本)', async () => {
      setFsFile({ backends: [validBackendConfig] });
      setEnv({ HARNESS_INTELLECT_RAG_ADMIN_TOKEN: 'token' });

      const store = new JSONFileHarnessStore();
      await store.load();

      // 当前实现直接返回内部数组(未做防御性拷贝),测试锁定该行为
      expect(store.list()).toBe(store.list());
    });

    it('get(id) 返回匹配的后端', async () => {
      setFsFile({ backends: [validBackendConfig] });
      setEnv({ HARNESS_INTELLECT_RAG_ADMIN_TOKEN: 'token' });

      const store = new JSONFileHarnessStore();
      await store.load();

      expect(store.get('intellect-rag-default')?.id).toBe('intellect-rag-default');
    });

    it('get(unknownId) 返回 undefined', async () => {
      setFsFile({ backends: [validBackendConfig] });
      setEnv({ HARNESS_INTELLECT_RAG_ADMIN_TOKEN: 'token' });

      const store = new JSONFileHarnessStore();
      await store.load();

      expect(store.get('does-not-exist')).toBeUndefined();
    });

    it('未调用 load() 时 list() 返回空数组', () => {
      const store = new JSONFileHarnessStore();
      expect(store.list()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // saveConfig()
  // -------------------------------------------------------------------------

  describe('saveConfig() 持久化', () => {
    it('写入 JSON 文件,内容不含 adminToken/projectToken 明文', async () => {
      mockFs.existsSync.mockReturnValue(true); // DATA_DIR 已存在
      const store = new JSONFileHarnessStore();

      const configs = [
        {
          ...validBackendConfig,
          // 注意:HarnessBackendConfig 不含 adminToken/projectToken 字段
        },
      ];

      await store.saveConfig(configs);

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
      const [, content] = (mockFs.writeFileSync as Mock).mock.calls[0];
      const parsed = JSON.parse(content as string);
      expect(parsed).toEqual({ backends: configs });
      // 确保不含 token 明文(Constitution Token 安全约束)
      // 用 "adminToken":/ "projectToken": 锁定 JSON 字段名,避免误匹配 adminTokenEnvVar
      expect(content as string).not.toContain('"adminToken":');
      expect(content as string).not.toContain('"projectToken":');
      expect(content as string).not.toContain('secret-token');
    });

    it('DATA_DIR 不存在时先创建目录再写文件', async () => {
      mockFs.existsSync.mockReturnValue(false); // DATA_DIR 不存在
      const store = new JSONFileHarnessStore();

      await store.saveConfig([]);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true },
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    });

    it('saveConfig 不影响内部内存状态(运行时内存对象不写回)', async () => {
      setFsFile({ backends: [validBackendConfig] });
      setEnv({ HARNESS_INTELLECT_RAG_ADMIN_TOKEN: 'token' });

      const store = new JSONFileHarnessStore();
      await store.load();
      const beforeCount = store.list().length;

      await store.saveConfig([]); // 写入空配置

      // 内存中仍保留 load() 加载的后端
      expect(store.list()).toHaveLength(beforeCount);
    });
  });

  // -------------------------------------------------------------------------
  // P2: listConfigs() - 返回所有配置(含未就绪,不含 token 明文)
  // -------------------------------------------------------------------------

  describe('listConfigs() (P2)', () => {
    it('返回所有配置(含 env token 未就绪的后端)', async () => {
      // 两个配置:一个 env 就绪,一个 env 缺失
      setFsFile({ backends: [validBackendConfig, enterpriseBackendConfig] });
      // 只设置 RAG token,不设置 enterprise token
      setEnv({ HARNESS_INTELLECT_RAG_ADMIN_TOKEN: 'rag-token' });

      const store = new JSONFileHarnessStore();
      await store.load();

      // list() 只返回就绪的(1 个)
      expect(store.list()).toHaveLength(1);
      expect(store.list()[0].id).toBe('intellect-rag-default');

      // listConfigs() 返回所有配置(2 个,含未就绪的 enterprise)
      const configs = store.listConfigs();
      expect(configs).toHaveLength(2);
      expect(configs.map((c) => c.id).sort()).toEqual([
        'intellect-enterprise-1',
        'intellect-rag-default',
      ]);
    });

    it('listConfigs 不含 adminToken/projectToken 明文(Token Security)', async () => {
      setFsFile({ backends: [validBackendConfig] });
      setEnv({ HARNESS_INTELLECT_RAG_ADMIN_TOKEN: 'secret-token-123' });

      const store = new JSONFileHarnessStore();
      await store.load();

      const configs = store.listConfigs();
      expect(configs).toHaveLength(1);

      // 序列化后不应含 adminToken 字段(Token Security)
      const json = JSON.stringify(configs);
      expect(json).not.toContain('"adminToken":');
      expect(json).not.toContain('"projectToken":');
      expect(json).not.toContain('secret-token-123');
      // 应含 adminTokenEnvVar 引用
      expect(json).toContain('"adminTokenEnvVar":"HARNESS_INTELLECT_RAG_ADMIN_TOKEN"');
    });

    it('未调用 load() 时 listConfigs() 返回空数组', () => {
      const store = new JSONFileHarnessStore();
      expect(store.listConfigs()).toEqual([]);
    });

    it('load() 文件不存在时 listConfigs() 返回空数组', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const store = new JSONFileHarnessStore();
      await store.load();
      expect(store.listConfigs()).toEqual([]);
    });

    it('saveConfig 后 listConfigs 立即反映新配置', async () => {
      setFsFile({ backends: [validBackendConfig] });
      setEnv({ HARNESS_INTELLECT_RAG_ADMIN_TOKEN: 'token' });

      const store = new JSONFileHarnessStore();
      await store.load();
      expect(store.listConfigs()).toHaveLength(1);

      // saveConfig 写入新配置
      const newConfigs = [
        validBackendConfig,
        enterpriseBackendConfig,
      ];
      mockFs.existsSync.mockReturnValue(true);
      await store.saveConfig(newConfigs);

      // listConfigs 立即反映(saveConfig 同步更新内存 allConfigs)
      expect(store.listConfigs()).toHaveLength(2);
      expect(store.listConfigs().map((c) => c.id).sort()).toEqual([
        'intellect-enterprise-1',
        'intellect-rag-default',
      ]);
    });

    it('重复 ID 时 listConfigs 也保留 last-write 覆盖语义', async () => {
      const first = { ...validBackendConfig, name: 'First' };
      const second = { ...validBackendConfig, name: 'Second' };
      setFsFile({ backends: [first, second] });
      setEnv({ HARNESS_INTELLECT_RAG_ADMIN_TOKEN: 'token' });

      const store = new JSONFileHarnessStore();
      await store.load();

      const configs = store.listConfigs();
      expect(configs).toHaveLength(1);
      expect(configs[0].name).toBe('Second');
    });
  });
});
