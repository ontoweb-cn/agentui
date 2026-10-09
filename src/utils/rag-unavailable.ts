/**
 * RAG 后端不可用的包络级静默判断。
 *
 * BFF 在租户解析不到 intellect-rag 后端时,/proxy/v1/* 返回
 * `{ code: 503, message: 'Tenant <id> has no canvas backend bound' }`。
 * 这是刻意的能力状态信号(前端已按 capability 门控跳过大部分调用),
 * 不应作为错误弹全局 toast;长尾调用(如无能力字段的 searches)到达
 * 此处时被本模块静默。Promise 仍按错误 reject,由调用方自行处理。
 */

const RAG_UNAVAILABLE_ERROR = 'RAG_UNAVAILABLE';
const RAG_UNAVAILABLE_MESSAGE = 'no canvas backend bound';

/** 响应信封是否为"RAG 后端未绑定"的 503。 */
export function isRagUnavailableEnvelope(data: {
  code?: number;
  error?: string;
  message?: string;
} | undefined | null): boolean {
  if (data?.code !== 503) return false;
  // 优先匹配稳定机器标记;message 文案匹配仅作兜底(历史兼容)
  return (
    data.error === RAG_UNAVAILABLE_ERROR ||
    (typeof data.message === 'string' &&
      data.message.includes(RAG_UNAVAILABLE_MESSAGE))
  );
}

/** 响应对象是否为"RAG 后端未绑定"的 503(读 body,需 clone)。 */
export async function isSilentRagUnavailableResponse(
  response: Response,
): Promise<boolean> {
  if (response?.status !== 503) return false;
  try {
    const data = await response.clone().json();
    return isRagUnavailableEnvelope(data);
  } catch {
    return false;
  }
}
