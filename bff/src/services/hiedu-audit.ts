/**
 * hiedu 代理审计 sink — P0-1。
 *
 * 认证失败(无 session / token 无效 / memberId 缺失)时写 `auth.reject`。
 * 默认实现输出单行结构化 JSON(便于日志采集);测试可注入自定义 sink。
 */

export type HieduAuthRejectReason =
  | 'missing_session'
  | 'invalid_session'
  | 'missing_member_id';

export interface HieduAuthRejectEvent {
  event: 'auth.reject';
  /** ISO-8601 时间戳 */
  ts: string;
  /** 与转发给 hiedu 的 X-Request-Id 一致,便于链路追踪 */
  requestId: string;
  method: string;
  path: string;
  reason: HieduAuthRejectReason;
}

export type HieduAuditSink = (event: HieduAuthRejectEvent) => void;

/** 默认 sink:单行 JSON 输出到 stderr(warn),不记录 token/cookie。 */
export const consoleHieduAuditSink: HieduAuditSink = (event) => {
  console.warn(JSON.stringify(event));
};
