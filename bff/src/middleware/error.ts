import type { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    const error = err as Error;
    console.error(`[BFF Error] ${error.message}`);

    // Intellect RAG API errors
    if (error.message.startsWith('Intellect RAG API error')) {
      const statusMatch = error.message.match(/error (\d+)/);
      const rawStatus = statusMatch ? Number(statusMatch[1]) : 502;
      const status = (rawStatus >= 400 && rawStatus < 600 ? rawStatus : 502) as ContentfulStatusCode;
      return c.json({ code: rawStatus, message: error.message }, status);
    }

    return c.json({ code: 500, message: 'Internal BFF error' }, 500);
  }
}
