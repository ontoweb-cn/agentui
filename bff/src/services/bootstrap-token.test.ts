// spec-010 v8 B-1: BootstrapTokenManager 单元测试
// Constitution Principle VII (Test-First):测试先于实现。
// 覆盖:generate/verify/一次性失效/错误 token/M4 多实例约束/TTL 过期/文件持久化。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BootstrapTokenManager } from './bootstrap-token';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');
const TOKEN_FILE = resolve(DATA_DIR, '.bootstrap-token');

function cleanupTokenFile(): void {
  if (existsSync(TOKEN_FILE)) {
    try {
      unlinkSync(TOKEN_FILE);
    } catch {
      // ignore
    }
  }
}

describe('BootstrapTokenManager (spec-010 v8 B-1)', () => {
  let originalBootstrapEnv: string | undefined;
  let originalTtlEnv: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    originalBootstrapEnv = process.env.BOOTSTRAP_ENABLED;
    originalTtlEnv = process.env.BOOTSTRAP_TOKEN_TTL_SECONDS;
    delete process.env.BOOTSTRAP_TOKEN_TTL_SECONDS;
    cleanupTokenFile();
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalBootstrapEnv === undefined) {
      delete process.env.BOOTSTRAP_ENABLED;
    } else {
      process.env.BOOTSTRAP_ENABLED = originalBootstrapEnv;
    }
    if (originalTtlEnv === undefined) {
      delete process.env.BOOTSTRAP_TOKEN_TTL_SECONDS;
    } else {
      process.env.BOOTSTRAP_TOKEN_TTL_SECONDS = originalTtlEnv;
    }
    cleanupTokenFile();
  });

  it('generate 返回 64 字符 hex 字符串并持久化到文件', () => {
    const manager = new BootstrapTokenManager();
    const token = manager.generate();
    expect(token).not.toBeNull();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(manager.isActive()).toBe(true);
    expect(existsSync(TOKEN_FILE)).toBe(true);
  });

  it('verify 正确 token 返回 true,且 token 立即失效(一次性,文件删除)', () => {
    const manager = new BootstrapTokenManager();
    const token = manager.generate();
    expect(token).not.toBeNull();

    expect(manager.verify(token!)).toBe(true);
    // 一次性:验证成功后立即失效
    expect(manager.isActive()).toBe(false);
    expect(existsSync(TOKEN_FILE)).toBe(false);
    // 再次 verify 同一 token 应失败
    expect(manager.verify(token!)).toBe(false);
  });

  it('verify 错误 token 返回 false,token 不失效', () => {
    const manager = new BootstrapTokenManager();
    manager.generate();
    expect(manager.verify('wrong-token')).toBe(false);
    // 错误验证不应使 token 失效
    expect(manager.isActive()).toBe(true);
    expect(existsSync(TOKEN_FILE)).toBe(true);
  });

  it('BOOTSTRAP_ENABLED=false 时 generate 返回 null (M4 多实例约束)', () => {
    process.env.BOOTSTRAP_ENABLED = 'false';
    const manager = new BootstrapTokenManager();
    expect(manager.generate()).toBeNull();
    expect(manager.isActive()).toBe(false);
    expect(existsSync(TOKEN_FILE)).toBe(false);
  });

  it('TTL 过期后 verify 返回 false 并清理文件', () => {
    const manager = new BootstrapTokenManager();
    const token = manager.generate();
    expect(token).not.toBeNull();

    // 推进时间超过默认 TTL(1 小时)
    vi.advanceTimersByTime(61 * 60 * 1000);

    expect(manager.isActive()).toBe(false);
    expect(manager.verify(token!)).toBe(false);
    expect(existsSync(TOKEN_FILE)).toBe(false);
  });

  it('BOOTSTRAP_TOKEN_TTL_SECONDS 可配置 TTL', () => {
    process.env.BOOTSTRAP_TOKEN_TTL_SECONDS = '60'; // 60 秒
    const manager = new BootstrapTokenManager();
    const token = manager.generate();
    expect(token).not.toBeNull();

    // 推进 30 秒:TTL 内
    vi.advanceTimersByTime(30 * 1000);
    expect(manager.isActive()).toBe(true);

    // 推进到 70 秒:TTL 过期
    vi.advanceTimersByTime(40 * 1000);
    expect(manager.isActive()).toBe(false);
    expect(manager.verify(token!)).toBe(false);
  });

  it('generate 已有未过期 token 时返回现有 token(幂等)', () => {
    const manager1 = new BootstrapTokenManager();
    const token1 = manager1.generate();
    expect(token1).not.toBeNull();

    // 新实例从文件加载,应返回相同 token
    const manager2 = new BootstrapTokenManager();
    const token2 = manager2.generate();
    expect(token2).toBe(token1);
  });

  it('新实例可验证旧实例生成的 token(进程重启模拟)', () => {
    const manager1 = new BootstrapTokenManager();
    const token = manager1.generate();
    expect(token).not.toBeNull();

    // 新实例从文件加载
    const manager2 = new BootstrapTokenManager();
    expect(manager2.verify(token!)).toBe(true);
  });
});
