/**
 * 从 Axios 风格错误中解析用户可读描述。
 * 优先使用服务端 `response.data.message`（如 BFF 400 校验 detail），
 * 避免 mutation onError 与全局 errorHandler 各自再弹一层 toast。
 */
export function resolveHttpErrorDescription(
  error: {
    response?: {
      status?: number;
      statusText?: string;
      data?: { message?: string };
    };
  },
  statusFallback: (status: number) => string | undefined,
): string | undefined {
  const response = error.response;
  if (!response?.status) {
    return undefined;
  }
  const serverMessage = response.data?.message;
  if (typeof serverMessage === 'string' && serverMessage.trim()) {
    return serverMessage;
  }
  return statusFallback(response.status) || response.statusText;
}
