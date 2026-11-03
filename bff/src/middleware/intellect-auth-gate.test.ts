import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createIntellectAuthGate } from './intellect-auth-gate';

function createApp(enabled: boolean) {
  const app = new Hono();
  app.use('/hiedu/*', createIntellectAuthGate(() => enabled));
  app.get('/hiedu/ping', (c) => c.json({ ok: true }));
  return app;
}

describe('intellectAuthGate', () => {
  it('总闸关闭时返回 503 FEATURE_DISABLED', async () => {
    const res = await createApp(false).request('/hiedu/ping');
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      code: 503,
      error: 'FEATURE_DISABLED',
      message: 'intellect-auth feature is disabled',
    });
  });

  it('总闸开启时放行', async () => {
    const res = await createApp(true).request('/hiedu/ping');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});
