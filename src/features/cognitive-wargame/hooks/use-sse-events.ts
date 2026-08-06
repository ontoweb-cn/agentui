/**
 * SSE 事件订阅 hook
 *
 * 对齐 phase3-architecture-design.md §5.6 SSE 事件订阅约定 + GATEWAY-1（G-05）。
 * 订阅管理服务的 /scenarios/{id}/events/stream，接收实时推演事件。
 *
 * 特性：
 * - 自动重连（指数退避，最长 30s）
 * - 组件卸载时清理连接
 * - 事件回调通过 store 分发
 * - P1 修复：onEvent ref 避免 stale closure
 * - P2 修复：EventSource 通过 ?token= 传递认证
 * - P3 修复：readyState===CLOSED 时停止重连
 *
 * 注意：GATEWAY-1 完成前，SSE 直连管理服务；
 * GATEWAY-1 完成后，切换到 GATEWAY 的 SSE 端点（按频道订阅）。
 */
import { useEffect, useRef, useState } from 'react';

import { api } from '../api';
import { useWargameStore } from '../store';

/** SSE 事件类型（对齐 admin_server event_bridge） */
export type CognitiveEventType =
  | 'scenario.created'
  | 'scenario.started'
  | 'scenario.paused'
  | 'scenario.resumed'
  | 'scenario.completed'
  | 'round.started'
  | 'round.completed'
  | 'round.failed'
  | 'agent.acted'
  | 'metric.updated'
  | 'anomaly.detected'
  | 'intervention.applied'
  | 'counterfactual.started'
  | 'counterfactual.completed'
  | 'counterfactual.failed';

export interface CognitiveEvent {
  type: CognitiveEventType;
  scenario_id: string;
  round_id?: number;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface UseSseEventsOptions {
  /** 想定 ID（为空时不订阅） */
  scenarioId: string | null;
  /** 订阅的频道列表（不传则订阅全部） */
  channels?: string[];
  /** 事件回调 */
  onEvent?: (event: CognitiveEvent) => void;
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

export interface UseSseEventsResult {
  /** 当前连接状态 */
  connected: boolean;
  /** 最近一次错误 */
  error: Error | null;
  /** 手动重连 */
  reconnect: () => void;
}

const MAX_RETRY_DELAY = 30_000;
const INITIAL_RETRY_DELAY = 1_000;

export function useSseEvents(options: UseSseEventsOptions): UseSseEventsResult {
  const { scenarioId, channels, onEvent, enabled = true } = options;
  const setSseConnected = useWargameStore((s) => s.setSseConnected);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // P1 修复：用 ref 保存 onEvent 最新值，避免 stale closure
  // （onEvent 不在 useEffect deps 中，但 onmessage 需要引用最新值）
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const cleanup = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  const connect = () => {
    if (!scenarioId || !enabled) return;

    cleanup();
    const url = api.eventStreamUrl(scenarioId, channels);
    const source = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = source;

    source.onopen = () => {
      retryCountRef.current = 0;
      setConnected(true);
      setError(null);
      setSseConnected(true);
    };

    source.onerror = () => {
      setConnected(false);
      setSseConnected(false);

      // P3 修复：检查 readyState 判断是否为致命错误
      // CLOSED 表示连接被服务端拒绝（401/403/404），不会自动恢复
      const isFatal = source.readyState === EventSource.CLOSED;
      source.close();
      eventSourceRef.current = null;

      if (isFatal) {
        setError(new Error('SSE 连接被拒绝（可能是认证失败或资源不存在），已停止重连'));
        return;
      }

      // 指数退避重连（可恢复错误：网络断开/服务重启等）
      const delay = Math.min(
        INITIAL_RETRY_DELAY * 2 ** retryCountRef.current,
        MAX_RETRY_DELAY,
      );
      retryCountRef.current += 1;
      setError(new Error(`SSE 连接断开，${delay / 1000}s 后重连（第 ${retryCountRef.current} 次）`));
      retryTimerRef.current = setTimeout(connect, delay);
    };

    // 监听所有命名事件（P1 修复：引用 onEventRef.current 避免闭包过期）
    // P3.0-5 修复：后端 event_bridge 发布 { event_type, timestamp(number), ... }，
    // 前端 CognitiveEvent 统一为 { type, timestamp(string) }，这里做字段归一化。
    source.onmessage = (ev) => {
      try {
        const raw = JSON.parse(ev.data) as Record<string, unknown>;
        const event = {
          type: (raw.type ?? raw.event_type) as CognitiveEventType,
          scenario_id: raw.scenario_id as string,
          round_id: raw.round_id as number | undefined,
          timestamp: String(raw.timestamp ?? ''),
          payload: (raw.payload ?? {}) as Record<string, unknown>,
        } as CognitiveEvent;
        onEventRef.current?.(event);
      } catch {
        // 忽略非 JSON 心跳消息
      }
    };
  };

  useEffect(() => {
    connect();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId, enabled, channels?.join(',')]);

  return { connected, error, reconnect: connect };
}
