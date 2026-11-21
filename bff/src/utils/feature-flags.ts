/**
 * 企业版画布 / agents 走 imt_ 透传（方案 A）。
 *
 * 未设置或非 `'false'` 时默认开启。社区版请显式设 `BFF_ENABLE_IMT_CANVAS_AGENTS=false`，
 * 以继续用 Authorization 头 + RAG 超管 JWT。
 */
export function isImtCanvasAgentsEnabled(): boolean {
  return process.env.BFF_ENABLE_IMT_CANVAS_AGENTS !== 'false';
}

/**
 * 模型管理路径服务令牌模式(模型页修复 P1-b §4.6 + D2 收口)。
 * 行为变更开关而非兼容开关,**默认关**。
 *
 * 取值语义(BFF_MODEL_MGMT_SERVICE_TOKEN):
 * - `'true'`      → read-write:读+写均强制服务令牌,写操作受管理员角色门控
 *                   (§4.4,fail-closed)——D2 已于 2026-11-21 采纳设计推荐"读+写";
 * - `'read-only'` → 仅读:GET/HEAD 强制服务令牌,写请求保持成员令牌由上游
 *                   鉴权(§4.4 不适用)——D2 若回摆"仅读"无需改代码;
 * - 其余值        → off(零行为变化)。
 *
 * 回滚 = 置空/移除该变量,无需回代码。
 */
export type ModelMgmtServiceTokenMode = 'off' | 'read-only' | 'read-write';

export function getModelMgmtServiceTokenMode(): ModelMgmtServiceTokenMode {
  const raw = process.env.BFF_MODEL_MGMT_SERVICE_TOKEN;
  if (raw === 'true') return 'read-write';
  if (raw === 'read-only') return 'read-only';
  return 'off';
}
