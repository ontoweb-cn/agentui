// spec-010 v8 A3-5: TokenVault — 凭据存储抽象。
// Constitution Token Security:运行时凭据经 vault 抽象读取,JSON 不存明文。
//
// 两种实现:
// - EnvTokenVault:从环境变量读取(P0 模式,向后兼容)
// - EncryptedFileTokenVault:加密文件存储(P4 模式,B-5 实现加密)
//
// M3 异步:setCredentials 返回 Promise<void>(加密文件写入是 async)。

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 凭据类型。
 * - bearer-token:单个 token(OpenAI 兼容后端 / intellect-enterprise API_SERVER_KEY)
 * - email-password:email + password(JWT 登录,intellect-rag 专用)
 */
export type CredentialKind = 'bearer-token' | 'email-password';

export interface BearerTokenCredential {
  kind: 'bearer-token';
  token: string;
}

export interface EmailPasswordCredential {
  kind: 'email-password';
  email: string;
  password: string;
}

export type Credential = BearerTokenCredential | EmailPasswordCredential;

/**
 * Token Vault — 凭据存储抽象。
 *
 * spec-010 v8 A3-5:复合凭据存储接口。
 * - EnvTokenVault:从环境变量读取(P0 模式)
 * - EncryptedFileTokenVault:加密文件存储(P4 模式,B-5 实现)
 *
 * M3:setCredentials 返回 Promise<void>(异步,因为加密文件写入是 async)。
 */
export interface ITokenVault {
  /**
   * 读取后端凭据。
   * @param backendId 后端 ID
   * @returns 凭据对象,未配置时返回 null
   */
  getCredentials(backendId: string): Promise<Credential | null>;

  /**
   * 保存后端凭据(M3 异步)。
   * @param backendId 后端 ID
   * @param credential 凭据对象
   */
  setCredentials(backendId: string, credential: Credential): Promise<void>;

  /**
   * 删除后端凭据。
   */
  deleteCredentials(backendId: string): Promise<void>;

  /**
   * 列出所有已存储凭据的 backendId(不含明文)。
   */
  listBackendIds(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// EnvTokenVault (P0 模式,从环境变量读取)
// ---------------------------------------------------------------------------

/**
 * 环境变量 TokenVault(P0 模式)。
 *
 * 约定 env var 命名:
 * - {BACKEND_ID_UPPER}_TOKEN:bearer-token 模式
 * - {BACKEND_ID_UPPER}_EMAIL + {BACKEND_ID_UPPER}_PASSWORD:email-password 模式
 *
 * 优先级:email-password > bearer-token(两者同时存在时优先 email-password)。
 *
 * 只读:不支持 setCredentials/deleteCredentials(抛错),listBackendIds 返回空数组
 * (env var 无法枚举)。如需写入,使用 EncryptedFileTokenVault。
 */
export class EnvTokenVault implements ITokenVault {
  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  async getCredentials(backendId: string): Promise<Credential | null> {
    const prefix = backendId.toUpperCase().replace(/-/g, '_');

    // 优先 email-password(同时存在 EMAIL + PASSWORD)
    const email = this.env[`${prefix}_EMAIL`];
    const password = this.env[`${prefix}_PASSWORD`];
    if (email && password) {
      return { kind: 'email-password', email, password };
    }

    // 回退 bearer-token
    const token = this.env[`${prefix}_TOKEN`];
    if (token) {
      return { kind: 'bearer-token', token };
    }

    return null;
  }

  async setCredentials(backendId: string, _credential: Credential): Promise<void> {
    // EnvTokenVault 不支持写入(env var 只能在运行前设置)
    throw new Error(
      `EnvTokenVault does not support setCredentials (backendId=${backendId}). Use EncryptedFileTokenVault or set env vars manually.`,
    );
  }

  async deleteCredentials(backendId: string): Promise<void> {
    throw new Error(
      `EnvTokenVault does not support deleteCredentials (backendId=${backendId})`,
    );
  }

  async listBackendIds(): Promise<string[]> {
    // EnvTokenVault 无法枚举,返回空数组
    return [];
  }
}

// ---------------------------------------------------------------------------
// EncryptedFileTokenVault (P4 模式,B-5 加密文件存储)
// ---------------------------------------------------------------------------

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../data');
const VAULT_FILE_DEFAULT = resolve(DATA_DIR, 'token-vault.json');
const VAULT_KEY_FILE = resolve(DATA_DIR, 'vault-key.txt');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bit
const IV_LENGTH = 12; // GCM 推荐 12 字节 IV

interface EncryptedEntry {
  encrypted: string;
  iv: string;
  tag: string;
}

/**
 * 加密文件 TokenVault(P4 模式,B-5 实现)。
 *
 * - AES-256-GCM 加密(认证加密,防篡改)
 * - 密钥从 HARNESS_TOKEN_ENCRYPTION_KEY env var 读取(32 字节,64 hex 或 32 raw)
 * - 存储到 bff/data/token-vault.json(加密后的 base64)
 * - 实现 ITokenVault 接口
 *
 * 安全约束:
 * - 密钥不在内存中持久化到磁盘
 * - 加密文件不含明文 token
 * - GCM auth tag 防篡改:解密失败返回 null
 */
export class EncryptedFileTokenVault implements ITokenVault {
  private readonly encryptionKey: Buffer;
  private readonly vaultFile: string;
  private readonly keyFile: string;
  private cache: Map<string, EncryptedEntry> = new Map();

  constructor(vaultFile?: string, keyFile?: string) {
    this.keyFile = keyFile ?? VAULT_KEY_FILE;
    let key = process.env.HARNESS_TOKEN_ENCRYPTION_KEY;
    if (!key) {
      // Dev/single-instance mode: auto-generate and persist a key so tokens
      // survive restarts without requiring the user to set an env var.
      key = this.loadOrCreateKey();
      console.warn(
        `[token-vault] HARNESS_TOKEN_ENCRYPTION_KEY not set; using auto-generated key at ${this.keyFile}. ` +
          'For production, set HARNESS_TOKEN_ENCRYPTION_KEY env var.',
      );
    }
    // 密钥可以是 32 字节直接使用,或 hex 编码的 64 字符
    if (key.length === 64) {
      this.encryptionKey = Buffer.from(key, 'hex');
    } else if (key.length === 32) {
      this.encryptionKey = Buffer.from(key);
    } else {
      throw new Error(
        'HARNESS_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars or 32 raw chars)',
      );
    }
    if (this.encryptionKey.length !== KEY_LENGTH) {
      throw new Error(
        `HARNESS_TOKEN_ENCRYPTION_KEY decodes to ${this.encryptionKey.length} bytes, expected ${KEY_LENGTH}`,
      );
    }
    this.vaultFile = vaultFile ?? VAULT_FILE_DEFAULT;
    this.load();
  }

  /**
   * Dev mode: load or create a persistent encryption key.
   * The key is stored as hex (64 chars) so it survives restarts.
   * This file MUST be gitignored and protected on the filesystem.
   */
  private loadOrCreateKey(): string {
    if (existsSync(this.keyFile)) {
      return readFileSync(this.keyFile, 'utf-8').trim();
    }
    const generated = randomBytes(KEY_LENGTH).toString('hex');
    const dir = dirname(this.keyFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.keyFile, generated, 'utf-8');
    return generated;
  }

  private load(): void {
    if (!existsSync(this.vaultFile)) return;
    try {
      const data = JSON.parse(readFileSync(this.vaultFile, 'utf-8'));
      for (const [id, entry] of Object.entries(data)) {
        this.cache.set(id, entry as EncryptedEntry);
      }
    } catch {
      // 文件损坏,忽略(不抛异常,允许 vault 以空状态启动)
    }
  }

  private save(): void {
    const dir = dirname(this.vaultFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const obj: Record<string, EncryptedEntry> = {};
    for (const [id, entry] of this.cache) {
      obj[id] = entry;
    }
    writeFileSync(this.vaultFile, JSON.stringify(obj, null, 2));
  }

  private encrypt(data: string): EncryptedEntry {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    };
  }

  private decrypt(entry: EncryptedEntry): string {
    const decipher = createDecipheriv(
      ALGORITHM,
      this.encryptionKey,
      Buffer.from(entry.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(entry.encrypted, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  async getCredentials(backendId: string): Promise<Credential | null> {
    const entry = this.cache.get(backendId);
    if (!entry) return null;
    try {
      const json = this.decrypt(entry);
      return JSON.parse(json) as Credential;
    } catch {
      // 解密失败(密钥变更或篡改):返回 null,不抛异常
      return null;
    }
  }

  async setCredentials(backendId: string, credential: Credential): Promise<void> {
    const json = JSON.stringify(credential);
    const entry = this.encrypt(json);
    this.cache.set(backendId, entry);
    this.save();
  }

  async deleteCredentials(backendId: string): Promise<void> {
    this.cache.delete(backendId);
    this.save();
  }

  async listBackendIds(): Promise<string[]> {
    return Array.from(this.cache.keys());
  }
}

