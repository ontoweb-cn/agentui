/**
 * T4.2 M1 预备:Gateway `web_search_secrets` HTTP 客户端(契约见
 * docs/web-search-secrets-gateway-api-contract.md)。
 *
 * **未接线** PATCH / list / getSession。仅供探测与未来 `t42-m1-wire` 复用。
 * 探测失败(404/网络)→ unavailable,调用方不得启用 sanitizePromptConfigWebSearchKeys。
 */

export type WebSearchSecretStatusItem = {
  provider: string;
  configured: boolean;
  updated_at?: string;
  key_version?: number;
};

export type WebSearchSecretsProbeResult =
  | { available: true; basePath: string }
  | { available: false; reason: string; status?: number };

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; ok: boolean }>;

/**
 * HEAD/GET 探测 secrets 集合是否存在。Gateway 未实现时预期 404。
 * 使用 GET 列表路径(契约 §4.2);任意 2xx → available。
 */
export async function probeWebSearchSecretsApi(opts: {
  gatewayBaseUrl: string;
  sessionId: string;
  authorization: string;
  fetchImpl?: FetchLike;
}): Promise<WebSearchSecretsProbeResult> {
  const base = opts.gatewayBaseUrl.replace(/\/$/, '');
  const path = `${base}/api/sessions/${encodeURIComponent(opts.sessionId)}/web-search-secrets`;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  try {
    const res = await fetchImpl(path, {
      method: 'GET',
      headers: { Authorization: opts.authorization },
    });
    if (res.ok) {
      return { available: true, basePath: path };
    }
    return {
      available: false,
      reason:
        res.status === 404
          ? 'Gateway web_search_secrets route not found (L-T42-01)'
          : `unexpected status ${res.status}`,
      status: res.status,
    };
  } catch (err) {
    return {
      available: false,
      reason: `probe failed: ${(err as Error).message}`,
    };
  }
}

/** 构建 PUT 密文路径(不发请求)。 */
export function buildWebSearchSecretPutUrl(
  gatewayBaseUrl: string,
  sessionId: string,
  provider: string,
): string {
  const base = gatewayBaseUrl.replace(/\/$/, '');
  return `${base}/api/sessions/${encodeURIComponent(sessionId)}/web-search-secrets/${encodeURIComponent(provider)}`;
}
