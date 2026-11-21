/**
 * D2-3：IdP access/refresh token 的服务端会话存储。
 *
 * 数据只存在 BFF 进程可读的本地文件（0600），浏览器仅持 HttpOnly 会话 cookie。
 * 单节点实现；多副本部署时替换为 Redis（与 AgentUI 其它会话映射同一升级路径）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');
const DEFAULT_STORE_FILE = resolve(DATA_DIR, 'idp-token-map.json');

export interface IdpTokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
  issuer: string;
  /** OP session id（back-channel 撤销关联，可选）。 */
  sid?: string;
  subject: string;
  updatedAt: string;
}

interface IdpTokenStoreFile {
  sessions: Record<string, IdpTokenSet>;
}

const storeFile = () => process.env.BFF_IDP_TOKEN_STORE_FILE || DEFAULT_STORE_FILE;

function loadStore(): IdpTokenStoreFile {
  const file = storeFile();
  if (!existsSync(file)) {
    return { sessions: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as IdpTokenStoreFile;
    if (parsed && typeof parsed.sessions === 'object' && parsed.sessions !== null) {
      return parsed;
    }
  } catch (err) {
    console.error('[idp-token-store] store unreadable, starting fresh:', (err as Error).message);
  }
  return { sessions: {} };
}

function saveStore(store: IdpTokenStoreFile): void {
  const file = storeFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
}

/** 会话键约定：`<tenantId>:<subject>`（subject 为 IdP 稳定用户名）。 */
export function idpSessionKey(tenantId: string, subject: string): string {
  return `${tenantId}:${subject}`;
}

export function putIdpTokens(key: string, tokens: IdpTokenSet): void {
  if (!key || !tokens.accessToken) return;
  const store = loadStore();
  store.sessions[key] = { ...tokens, updatedAt: new Date().toISOString() };
  saveStore(store);
}

export function getIdpTokens(key: string): IdpTokenSet | null {
  return loadStore().sessions[key] ?? null;
}

export function deleteIdpTokens(key: string): void {
  if (!key) return;
  const store = loadStore();
  if (store.sessions[key]) {
    delete store.sessions[key];
    saveStore(store);
  }
}

/** 单测用：清空存储。 */
export function __resetIdpTokenStoreForTest(): void {
  saveStore({ sessions: {} });
}
