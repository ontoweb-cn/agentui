/**
 * use-inflight-state — INFLIGHT 状态恢复（P2）
 *
 * 参考 webui 三层结构 (sessions.js L807-880, ui.js L4248-4365)，
 * 简化为两层：内存 Map（切换会话快速恢复）+ sessionStorage（页面刷新恢复，10 分钟 TTL）。
 *
 * 设计要点：
 * - 内存 Map 切换会话时立即读取，无需反序列化
 * - sessionStorage 完整快照，页面刷新后恢复
 * - 节流写入：token 增量 2s 节流，状态转换（tool/done/error）立即写入
 * - TTL 10 分钟，过期自动清理
 * - 流完成立即 clearInflight，避免与 server 持久化的消息重复
 *
 * P2 评审修复：
 * - Q2: hydrateFromStorage 改 lazy，避免模块级副作用
 * - Q5: tailStart 扫描到 user 消息，而非简单 liveIdx-1
 * - Q6: sessionStorage 数据完整性校验
 * - Q8: 删除 useInflightState 占位 hook（YAGNI）
 * - Q10: writeStorage evict 策略，超限时清理最旧条目
 * - Q11: _live 字段加入 IMessage 类型
 * - Q15: tailStart 默认分支与 _live 分支语义统一
 */
import { MessageType } from '@/constants/chat';
import { IMessage, ToolCallRecord } from '@/interfaces/database/chat';

const INFLIGHT_TTL_MS = 10 * 60 * 1000; // 10 分钟
const INFLIGHT_STORAGE_KEY = 'agentui-inflight-state';
const THROTTLE_MS = 2000; // token 增量节流 2s
// sessionStorage 单条估算上限（5MB / 4 = 1.25MB，留余量）
const STORAGE_QUOTA_BYTES = 1_000_000;

export interface InflightState {
  sessionId: string;
  streamId?: string;
  messages: IMessage[]; // 包含 user 乐观消息 + assistant 流式消息
  toolCalls: ToolCallRecord[];
  reasoning: string;
  uploadedFiles: string[];
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// 内存层
// ---------------------------------------------------------------------------

const inflightMap = new Map<string, InflightState>();

// 节流写入时间戳（按 sessionId 隔离）
const lastWriteTime = new Map<string, number>();

// Q2: lazy hydrate 标记，避免模块级副作用
let hydrated = false;

function isExpired(state: InflightState): boolean {
  return Date.now() - state.updatedAt > INFLIGHT_TTL_MS;
}

// ---------------------------------------------------------------------------
// sessionStorage 层（页面刷新恢复）
// ---------------------------------------------------------------------------

interface StorageSnapshot {
  [sessionId: string]: InflightState;
}

// Q6: 完整性校验，防止 sessionStorage 被污染导致后续渲染崩溃
function isValidState(v: unknown): v is InflightState {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.sessionId === 'string' &&
    Array.isArray(s.messages) &&
    typeof s.updatedAt === 'number' &&
    (s.toolCalls === undefined || Array.isArray(s.toolCalls)) &&
    (s.reasoning === undefined || typeof s.reasoning === 'string') &&
    (s.uploadedFiles === undefined || Array.isArray(s.uploadedFiles))
  );
}

function readStorage(): StorageSnapshot {
  try {
    const raw = sessionStorage.getItem(INFLIGHT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const valid: StorageSnapshot = {};
    const now = Date.now();
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      // Q6: 双重校验 - 类型校验 + TTL 校验
      if (isValidState(v) && now - v.updatedAt <= INFLIGHT_TTL_MS) {
        valid[k] = v;
      }
    }
    return valid;
  } catch {
    return {};
  }
}

// Q10: evict 策略 - 写入前估算大小，超限时清理最旧条目
function writeStorage(snapshot: StorageSnapshot): void {
  try {
    let payload = JSON.stringify(snapshot);
    // 估算超限时清理最旧条目
    while (payload.length > STORAGE_QUOTA_BYTES) {
      const entries = Object.entries(snapshot);
      if (entries.length === 0) break;
      // 找到 updatedAt 最旧的条目
      let oldestKey: string | null = null;
      let oldestTime = Number.MAX_SAFE_INTEGER;
      for (const [k, v] of entries) {
        if (v.updatedAt < oldestTime) {
          oldestTime = v.updatedAt;
          oldestKey = k;
        }
      }
      if (!oldestKey) break;
      delete snapshot[oldestKey];
      // 同步清理内存层（保持一致）
      inflightMap.delete(oldestKey);
      payload = JSON.stringify(snapshot);
    }
    sessionStorage.setItem(INFLIGHT_STORAGE_KEY, payload);
  } catch {
    // sessionStorage 满或不可用时静默失败
  }
}

// Q2: lazy hydrate - 首次 loadInflight 时执行，避免模块级副作用
function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  const snapshot = readStorage();
  for (const [sessionId, state] of Object.entries(snapshot)) {
    if (!isExpired(state)) {
      inflightMap.set(sessionId, state);
    }
  }
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/**
 * 保存 inflight 状态。
 * @param state 完整状态（updatedAt 字段会被内部 Date.now() 覆盖）
 * @param throttle 是否节流写入（token 增量场景 true，状态转换场景 false）
 */
export function saveInflight(state: InflightState, throttle = false): void {
  ensureHydrated();
  const now = Date.now();
  if (throttle) {
    const last = lastWriteTime.get(state.sessionId) ?? 0;
    if (now - last < THROTTLE_MS) {
      return; // 节流跳过
    }
  }
  lastWriteTime.set(state.sessionId, now);

  const nextState = { ...state, updatedAt: now };
  inflightMap.set(state.sessionId, nextState);

  // 同步到 sessionStorage
  const snapshot = readStorage();
  snapshot[state.sessionId] = nextState;
  writeStorage(snapshot);
}

/**
 * 加载 inflight 状态（内存优先，过期返回 null）。
 */
export function loadInflight(sessionId: string): InflightState | null {
  ensureHydrated();
  const state = inflightMap.get(sessionId);
  if (!state) return null;
  if (isExpired(state)) {
    clearInflight(sessionId);
    return null;
  }
  return state;
}

/**
 * 清除指定 sessionId 的 inflight 状态。
 * 流完成时立即调用，避免与 server 持久化的消息重复。
 */
export function clearInflight(sessionId: string): void {
  ensureHydrated();
  inflightMap.delete(sessionId);
  lastWriteTime.delete(sessionId);
  const snapshot = readStorage();
  if (snapshot[sessionId]) {
    delete snapshot[sessionId];
    writeStorage(snapshot);
  }
}

// 测试专用：重置 lazy hydrate 标记和内存层
// （生产代码不应调用，仅用于单元测试隔离）
// L3 修复:生产环境守卫,避免被生产代码误调用破坏状态。
export function __resetInflightStateForTest(): void {
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[use-inflight-state] __resetInflightStateForTest called in production, ignored.',
    );
    return;
  }
  inflightMap.clear();
  lastWriteTime.clear();
  hydrated = false;
}

/**
 * 合并 inflight tail 到 server-side 消息列表（参考 webui _mergeInflightTailMessages）。
 *
 * 合并策略：
 * 1. 找到 inflight 中最后一个 _live: true 的消息（assistant 流式消息）
 * 2. 从该消息向前扫描直到遇到 user 消息或数组开头（Q5 修复：确保 user 消息被包含）
 * 3. 追加到 server-side 消息列表尾部
 * 4. 用 id 去重，避免与 server 持久化的消息重复
 *
 * Q15 修复：无 _live 标记时，从最后一条 user 消息开始作为 tail，与 _live 分支语义统一
 *
 * @param baseMessages server-side 持久化消息
 * @param inflightMessages inflight 中的 tail 消息
 * @returns 合并后的消息列表
 */
export function mergeInflightTailMessages(
  baseMessages: IMessage[],
  inflightMessages: IMessage[],
): IMessage[] {
  if (!inflightMessages || inflightMessages.length === 0) return baseMessages;

  // 找到 tail 起始位置：从最后一条 _live 消息向前扫描到 user 消息
  const tailStart = findTailStart(inflightMessages);
  const tail = inflightMessages.slice(tailStart);
  return dedupeAndAppend(baseMessages, tail);
}

// Q5 + Q15: 统一的 tail 起始位置计算
// - 优先从最后一条 _live 消息向前扫描到 user 消息
// - 无 _live 时从最后一条 user 消息开始
// - 都没有时 tailStart = 0（全部作为 tail）
function findTailStart(messages: IMessage[]): number {
  // 找到最后一个 _live: true 的消息索引
  let liveIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]._live) {
      liveIdx = i;
      break;
    }
  }

  // 锚点：_live 消息位置（优先）或最后一条 user 消息位置（fallback）或末尾
  let anchorIdx: number;
  if (liveIdx !== -1) {
    anchorIdx = liveIdx;
  } else {
    // Q15: 无 _live 时，从最后一条 user 消息开始
    anchorIdx = messages.length - 1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === MessageType.User) {
        anchorIdx = i;
        break;
      }
    }
  }

  // Q5: 从锚点向前扫描直到遇到 user 消息或数组开头
  // 确保包含触发本轮对话的 user 消息
  for (let i = anchorIdx; i >= 0; i--) {
    if (messages[i].role === MessageType.User) {
      return i;
    }
  }
  // 未找到 user 消息：返回 0，tail 包含全部消息
  // （inflight 中无 user 消息属于异常场景，全量保留以便 UI 显示）
  return 0;
}

function dedupeAndAppend(
  base: IMessage[],
  tail: IMessage[],
): IMessage[] {
  const baseIds = new Set(base.map((m) => m.id).filter(Boolean));
  const dedupedTail = tail.filter((m) => !m.id || !baseIds.has(m.id));
  return [...base, ...dedupedTail];
}
