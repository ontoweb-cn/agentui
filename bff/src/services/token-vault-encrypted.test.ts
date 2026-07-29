// spec-010 v8 B-5: EncryptedFileTokenVault 单元测试
// Constitution Principle VII (Test-First) + Token Security。
// 覆盖 AES-256-GCM 加密/解密 + 持久化 + 多凭据类型 + 错误处理。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EncryptedFileTokenVault } from './token-vault';
import type { Credential } from './token-vault';

const TEST_KEY_HEX = 'a'.repeat(64); // 32 bytes hex
const TEST_KEY_RAW = 'b'.repeat(32); // 32 bytes raw

function uniqueVaultFile(): string {
  return join(tmpdir(), `token-vault-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

describe('EncryptedFileTokenVault (B-5)', () => {
  let vaultFile: string;
  let savedKey: string | undefined;

  beforeEach(() => {
    vaultFile = uniqueVaultFile();
    savedKey = process.env.HARNESS_TOKEN_ENCRYPTION_KEY;
    process.env.HARNESS_TOKEN_ENCRYPTION_KEY = TEST_KEY_HEX;
  });

  afterEach(() => {
    if (existsSync(vaultFile)) {
      rmSync(vaultFile);
    }
    if (savedKey !== undefined) {
      process.env.HARNESS_TOKEN_ENCRYPTION_KEY = savedKey;
    } else {
      delete process.env.HARNESS_TOKEN_ENCRYPTION_KEY;
    }
  });

  it('setCredentials → getCredentials (bearer-token)', async () => {
    const vault = new EncryptedFileTokenVault(vaultFile);
    const cred: Credential = { kind: 'bearer-token', token: 'secret-token-abc' };
    await vault.setCredentials('backend-1', cred);

    const retrieved = await vault.getCredentials('backend-1');
    expect(retrieved).toEqual(cred);
  });

  it('setCredentials → getCredentials (email-password)', async () => {
    const vault = new EncryptedFileTokenVault(vaultFile);
    const cred: Credential = {
      kind: 'email-password',
      email: 'admin@example.com',
      password: 'pass123',
    };
    await vault.setCredentials('backend-2', cred);

    const retrieved = await vault.getCredentials('backend-2');
    expect(retrieved).toEqual(cred);
  });

  it('getCredentials 返回 null(未存储的 backendId)', async () => {
    const vault = new EncryptedFileTokenVault(vaultFile);
    const result = await vault.getCredentials('nonexistent');
    expect(result).toBeNull();
  });

  it('持久化:新实例从文件加载已存储凭据', async () => {
    const vault1 = new EncryptedFileTokenVault(vaultFile);
    await vault1.setCredentials('backend-persist', { kind: 'bearer-token', token: 'persisted-token' });

    // 新实例,同一文件,同一密钥
    const vault2 = new EncryptedFileTokenVault(vaultFile);
    const retrieved = await vault2.getCredentials('backend-persist');
    expect(retrieved).toEqual({ kind: 'bearer-token', token: 'persisted-token' });
  });

  it('deleteCredentials 删除后 getCredentials 返回 null', async () => {
    const vault = new EncryptedFileTokenVault(vaultFile);
    await vault.setCredentials('backend-del', { kind: 'bearer-token', token: 'to-delete' });

    await vault.deleteCredentials('backend-del');
    const result = await vault.getCredentials('backend-del');
    expect(result).toBeNull();
  });

  it('listBackendIds 返回所有已存储的 backendId', async () => {
    const vault = new EncryptedFileTokenVault(vaultFile);
    await vault.setCredentials('backend-a', { kind: 'bearer-token', token: 'a' });
    await vault.setCredentials('backend-b', { kind: 'bearer-token', token: 'b' });

    const ids = await vault.listBackendIds();
    expect(ids.sort()).toEqual(['backend-a', 'backend-b']);
  });

  it('加密文件不含明文 token', async () => {
    const vault = new EncryptedFileTokenVault(vaultFile);
    await vault.setCredentials('backend-secret', { kind: 'bearer-token', token: 'plaintext-secret-xyz' });

    const fileContent = readFileSync(vaultFile, 'utf-8');
    expect(fileContent).not.toContain('plaintext-secret-xyz');
    // 文件应含加密后的 base64
    expect(fileContent).toContain('encrypted');
    expect(fileContent).toContain('iv');
    expect(fileContent).toContain('tag');
  });

  it('密钥变更后解密失败返回 null', async () => {
    // 用 key1 加密
    process.env.HARNESS_TOKEN_ENCRYPTION_KEY = TEST_KEY_HEX;
    const vault1 = new EncryptedFileTokenVault(vaultFile);
    await vault1.setCredentials('backend-key', { kind: 'bearer-token', token: 'original-token' });

    // 用不同 key2 解密(raw key,与 hex key 不同)
    process.env.HARNESS_TOKEN_ENCRYPTION_KEY = TEST_KEY_RAW;
    const vault2 = new EncryptedFileTokenVault(vaultFile);
    const result = await vault2.getCredentials('backend-key');
    expect(result).toBeNull();
  });

  it('缺少 HARNESS_TOKEN_ENCRYPTION_KEY 抛异常', () => {
    delete process.env.HARNESS_TOKEN_ENCRYPTION_KEY;
    expect(() => new EncryptedFileTokenVault(vaultFile)).toThrow(
      'HARNESS_TOKEN_ENCRYPTION_KEY env var is required',
    );
  });

  it('密钥长度不合法抛异常', () => {
    process.env.HARNESS_TOKEN_ENCRYPTION_KEY = 'too-short';
    expect(() => new EncryptedFileTokenVault(vaultFile)).toThrow(
      'must be 32 bytes',
    );
  });

  it('raw 字符串密钥(32 字节)正常工作', async () => {
    process.env.HARNESS_TOKEN_ENCRYPTION_KEY = TEST_KEY_RAW;
    const vault = new EncryptedFileTokenVault(vaultFile);
    await vault.setCredentials('backend-raw', { kind: 'bearer-token', token: 'raw-key-token' });

    const retrieved = await vault.getCredentials('backend-raw');
    expect(retrieved).toEqual({ kind: 'bearer-token', token: 'raw-key-token' });
  });
});
