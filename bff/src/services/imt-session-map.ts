/**
 * imt 会话映射（agentui-sso-logout-loop A1+A4）：
 *   idpSub（统一认证稳定用户名）→ 该用户经本 BFF 签发的 imt_token 列表。
 *
 * back-channel 登出通知按 sub 定位并撤销令牌（经 intellect-team /api/members/logout）。
 * 持久化 bff/data/imt-session-map.json（0600，已 .gitignore——评审 F-S1 教训）。
 * 单节点限制与 sid 级精确化见 docs/AgentUI-SSO登出闭环运维手册.md §8。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 仓库惯例:ESM 下经 import.meta 推导 __dirname（与 harness-store.ts:22 一致）
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');
const DEFAULT_MAP_FILE = resolve(DATA_DIR, 'imt-session-map.json');

const mapFile = () => process.env.BFF_IMT_SESSION_MAP_FILE || DEFAULT_MAP_FILE;

/** 同一 sub 的令牌数上限：超出时丢弃最旧的（7 天 TTL 自然过期，防映射无限增长）。 */
const MAX_TOKENS_PER_SUB = 8;

interface SessionMapFile {
  sessions: Record<string, { tokens: string[]; updatedAt: string }>;
}

function loadMap(): SessionMapFile {
  const file = mapFile();
  if (!existsSync(file)) {
    return { sessions: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as SessionMapFile;
    if (parsed && typeof parsed.sessions === 'object' && parsed.sessions !== null) {
      return parsed;
    }
  } catch (err) {
    console.error('[imt-session-map] map file unreadable, starting fresh:', (err as Error).message);
  }
  return { sessions: {} };
}

function saveMap(map: SessionMapFile): void {
  const file = mapFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(map, null, 2), { mode: 0o600 });
}

/** 登录成功时记录：同一 sub 追加（不同浏览器/会话各自持有令牌），重复令牌去重，
 *  超过上限丢弃最旧（评审 F-Q1）。 */
export function recordImtSession(idpSub: string, token: string): void {
  if (!idpSub || !token) {
    return;
  }
  const map = loadMap();
  const entry = map.sessions[idpSub] ?? { tokens: [], updatedAt: '' };
  if (!entry.tokens.includes(token)) {
    entry.tokens.push(token);
  }
  if (entry.tokens.length > MAX_TOKENS_PER_SUB) {
    entry.tokens = entry.tokens.slice(entry.tokens.length - MAX_TOKENS_PER_SUB);
  }
  entry.updatedAt = new Date().toISOString();
  map.sessions[idpSub] = entry;
  saveMap(map);
  console.error(
    `[imt-session-map] record sub=${idpSub} token=${token.slice(0, 12)}… count=${entry.tokens.length} at=${entry.updatedAt}`,
  );
}

/** 只读查询：该 sub 当前登记的令牌（撤销流程用——先撤销成功再移除，评审 F-R1）。 */
export function lookupImtSessions(idpSub: string): string[] {
  return [...(loadMap().sessions[idpSub]?.tokens ?? [])];
}

/** 撤销成功后移除映射条目（只移除传入的令牌，失败保留待 IdP 重试）。 */
export function removeImtSessions(idpSub: string, revokedTokens: string[]): void {
  if (!idpSub || revokedTokens.length === 0) {
    return;
  }
  const map = loadMap();
  const entry = map.sessions[idpSub];
  if (!entry) {
    return;
  }
  entry.tokens = entry.tokens.filter((t) => !revokedTokens.includes(t));
  if (entry.tokens.length === 0) {
    delete map.sessions[idpSub];
  } else {
    entry.updatedAt = new Date().toISOString();
  }
  saveMap(map);
}

/** 便捷组合（测试/非关键路径）：查询+撤销，不保证撤销成功语义。 */
export function revokeImtSessions(idpSub: string): string[] {
  const tokens = lookupImtSessions(idpSub);
  removeImtSessions(idpSub, tokens);
  return tokens;
}

/** 单测用：重置持久化文件。 */
export function __resetImtSessionMapForTest(): void {
  const file = mapFile();
  if (existsSync(file)) {
    writeFileSync(file, JSON.stringify({ sessions: {} }, null, 2), { mode: 0o600 });
  }
}
