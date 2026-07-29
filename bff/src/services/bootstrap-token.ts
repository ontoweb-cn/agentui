/**
 * BootstrapTokenManager — 首次安装 Bootstrap Token 管理。
 *
 * spec-010 v8 B-1 + §9.4: Bootstrap Token 机制。
 * - 首次安装时生成短期特权 token,用于创建第一个 backend
 * - M4: BOOTSTRAP_ENABLED=false 时不生成(多实例约束)
 * - M5: 控制台脱敏打印(前 8 位 + 文件路径)
 * - TTL: 默认 1 小时,可通过 BOOTSTRAP_TOKEN_TTL_SECONDS 配置
 * - 一次性:使用后立即失效
 *
 * 文件持久化(.bootstrap-token,权限 0600):
 * - 多实例 + 共享文件系统(NFS)场景下可共享 token
 * - 进程重启后 token 仍有效(直到 TTL 过期)
 */

import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');
const BOOTSTRAP_TOKEN_FILE = resolve(DATA_DIR, '.bootstrap-token');

const DEFAULT_TTL_SECONDS = 3600; // 1 小时( spec §9.4 M5)
const TOKEN_LENGTH = 32; // 256 bit

interface BootstrapTokenPayload {
  token: string;
  createdAt: number;
  ttlMs: number;
}

/**
 * 获取 TTL(毫秒)。模块级读取会导致测试无法 stub,因此在调用点读取。
 */
function getTtlMs(): number {
  const seconds = Number(process.env.BOOTSTRAP_TOKEN_TTL_SECONDS);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_TTL_SECONDS) * 1000;
}

/**
 * 从文件加载 token payload。文件不存在或损坏时返回 null。
 */
function loadPayload(): BootstrapTokenPayload | null {
  if (!existsSync(BOOTSTRAP_TOKEN_FILE)) return null;
  try {
    const raw = readFileSync(BOOTSTRAP_TOKEN_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as BootstrapTokenPayload;
    if (
      typeof parsed.token !== 'string' ||
      typeof parsed.createdAt !== 'number' ||
      typeof parsed.ttlMs !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 持久化 token payload 到文件(权限 0600)。
 */
function persistPayload(payload: BootstrapTokenPayload): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(BOOTSTRAP_TOKEN_FILE, JSON.stringify(payload), {
    mode: 0o600,
  });
  // 显式 chmod(防止文件已存在时 writeFileSync 不修改权限)
  try {
    chmod0600(BOOTSTRAP_TOKEN_FILE);
  } catch {
    // 非 POSIX 系统忽略
  }
}

function chmod0600(file: string): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs');
  fs.chmodSync(file, 0o600);
}

/**
 * 删除 token 文件。
 */
function removeTokenFile(): void {
  if (existsSync(BOOTSTRAP_TOKEN_FILE)) {
    try {
      unlinkSync(BOOTSTRAP_TOKEN_FILE);
    } catch {
      // ignore
    }
  }
}

export class BootstrapTokenManager {
  private readonly enabled: boolean;

  constructor() {
    // M4: 多实例约束,env var 控制是否启用
    this.enabled = process.env.BOOTSTRAP_ENABLED !== 'false';
  }

  /**
   * 生成 Bootstrap Token(仅首次安装时调用)。
   * 如果已有未过期 token,返回现有 token。
   * 如果 BOOTSTRAP_ENABLED=false,返回 null。
   */
  generate(): string | null {
    if (!this.enabled) {
      return null;
    }

    // 已有未过期 token,返回现有
    const existing = loadPayload();
    if (existing && Date.now() - existing.createdAt < existing.ttlMs) {
      return existing.token;
    }

    // 生成新 token
    const ttlMs = getTtlMs();
    const bytes = randomBytes(TOKEN_LENGTH);
    const token = bytes.toString('hex');
    const payload: BootstrapTokenPayload = {
      token,
      createdAt: Date.now(),
      ttlMs,
    };
    persistPayload(payload);

    // M5: 脱敏打印(前 8 位 + 文件路径)
    const masked = this.maskToken(token);
    console.log('════════════════════════════════════════════════════');
    console.log('  首次安装检测到无后端配置,已启用 Bootstrap 模式');
    console.log(`  Token(前 8 位):${masked}`);
    console.log(`  完整 token 请从文件读取:${BOOTSTRAP_TOKEN_FILE}`);
    console.log(`  TTL:${ttlMs / 1000}s,超时自动失效`);
    console.log('  向导端点 /api/bff/admin/wizard/setup 接受此 token 鉴权');
    console.log('  首个后端配置完成后,此 token 自动失效');
    console.log('════════════════════════════════════════════════════');

    return token;
  }

  /**
   * 验证 token 是否有效。
   * 验证成功后立即失效(一次性)。
   */
  verify(token: string): boolean {
    const payload = loadPayload();
    if (!payload) return false;

    // TTL 校验
    if (Date.now() - payload.createdAt >= payload.ttlMs) {
      this.invalidate();
      console.log('[Bootstrap] Token expired (TTL exceeded), invalidated');
      return false;
    }

    if (token === payload.token) {
      // 一次性:验证成功后立即失效
      this.invalidate();
      return true;
    }

    return false;
  }

  /**
   * 失效 token(删除文件)。
   */
  invalidate(): void {
    removeTokenFile();
  }

  /**
   * 检查是否有有效的 bootstrap token。
   */
  isActive(): boolean {
    const payload = loadPayload();
    if (!payload) return false;
    return Date.now() - payload.createdAt < payload.ttlMs;
  }

  /**
   * M5: 脱敏 token(前 8 位 + 后 4 位)。
   */
  private maskToken(token: string): string {
    if (token.length <= 12) {
      return '*'.repeat(token.length);
    }
    return `${token.slice(0, 8)}...${token.slice(-4)}`;
  }
}
