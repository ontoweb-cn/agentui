import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createFeaturesRoutes } from './features';

describe('GET /features', () => {
  it('返回 features 信封，统一认证默认 false', async () => {
    const app = new Hono();
    app.route('/', createFeaturesRoutes({ resolve: () => ({ 'intellect-auth': false }) }));
    const res = await app.request('/features');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      code: 0,
      message: 'success',
      data: { features: { 'intellect-auth': false } },
    });
  });

  it('开启时返回 true', async () => {
    const app = new Hono();
    app.route('/', createFeaturesRoutes({ resolve: () => ({ 'intellect-auth': true }) }));
    const res = await app.request('/features');
    const body = await res.json();
    expect(body.data.features['intellect-auth']).toBe(true);
  });
});
