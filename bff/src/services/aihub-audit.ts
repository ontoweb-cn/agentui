/**
 * AIHub 代理鉴权失败审计。
 *
 * M0 只落最小事件（reason/path/requestId，不含 token/查询参数明文），
 * M2 接入与 hiedu 一致的统一审计通道。
 */

export type AihubAuthRejectReason =
  | 'missing_session'
  | 'missing_member_id';

export interface AihubAuthRejectEvent {
  event: 'auth.reject';
  feature: 'aihub';
  ts: string;
  requestId: string;
  method: string;
  path: string;
  reason: AihubAuthRejectReason;
}

export type AihubAuditSink = (event: AihubAuthRejectEvent) => void;

export const consoleAihubAuditSink: AihubAuditSink = (event) => {
  console.warn(JSON.stringify(event));
};
