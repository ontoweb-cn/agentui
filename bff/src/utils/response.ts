// Shared utility for transparent upstream response streaming.
// Used by proxy routes (spec-001) and canvas routes (spec-008) for
// header-safe passthrough of fetch Response objects.
//
// Filters transfer-encoding and content-encoding headers which are
// handled by the Hono/node-server layer; copying them would corrupt
// the downstream response.

/**
 * Copy an upstream fetch Response for streaming to the client.
 *
 * Preserves status, statusText, and body ReadableStream.
 * Filters transfer-encoding and content-encoding headers (handled by
 * the underlying HTTP server, not to be forwarded).
 */
export interface StreamResponseOptions {
  /** 需要丢弃的上游响应头(小写匹配),例如 set-cookie */
  stripHeaders?: readonly string[];
}

export function streamResponse(
  upstream: Response,
  options: StreamResponseOptions = {},
): Response {
  const responseHeaders = new Headers();
  const stripped = new Set(
    (options.stripHeaders ?? []).map((header) => header.toLowerCase()),
  );
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'transfer-encoding' || lower === 'content-encoding') {
      return;
    }
    if (stripped.has(lower)) {
      return;
    }
    responseHeaders.set(key, value);
  });
  // P2 修复:SSE 流需要禁用 Nginx 缓冲,确保 chunk 立即转发到客户端
  const contentType = responseHeaders.get('Content-Type') ?? '';
  if (contentType.includes('text/event-stream') && !responseHeaders.has('X-Accel-Buffering')) {
    responseHeaders.set('X-Accel-Buffering', 'no');
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
