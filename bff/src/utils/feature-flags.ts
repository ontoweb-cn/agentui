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
 * 模型管理路径强制服务账号令牌(模型页修复 P1-b §4.6,方案 2)。
 * 行为变更开关而非兼容开关,**默认关**。
 * 仅当生产 RAG 成员令牌鉴权故障(D1 未落地)且 D2 决策为"读+写"时开启;
 * 开启后模型管理写操作受管理员角色门控(§4.4,fail-closed)。
 * 回滚 = 置 false,无需回代码。
 */
export function isModelMgmtServiceTokenEnabled(): boolean {
  return process.env.BFF_MODEL_MGMT_SERVICE_TOKEN === 'true';
}
