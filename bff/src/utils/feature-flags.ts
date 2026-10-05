/**
 * 企业版画布 / agents 走 imt_ 透传（方案 A）。
 *
 * 未设置或非 `'false'` 时默认开启。社区版请显式设 `BFF_ENABLE_IMT_CANVAS_AGENTS=false`，
 * 以继续用 Authorization 头 + RAG 超管 JWT。
 */
export function isImtCanvasAgentsEnabled(): boolean {
  return process.env.BFF_ENABLE_IMT_CANVAS_AGENTS !== 'false';
}
