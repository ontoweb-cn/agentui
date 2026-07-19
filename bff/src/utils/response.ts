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
export function streamResponse(upstream: Response): Response {
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'transfer-encoding' || lower === 'content-encoding') {
      return;
    }
    responseHeaders.set(key, value);
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
