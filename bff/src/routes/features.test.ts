import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createFeaturesRoutes } from './features';

describe('GET /features', () => {
  it('返回 features 信封，统一认证/aihub 默认 false', async () => {
    const app = new Hono();
    app.route(
      '/',
      createFeaturesRoutes({
        resolve: () => ({ 'intellect-auth': false, aihub: false }),
      }),
    );
    const res = await app.request('/features');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      code: 0,
      message: 'success',
      data: { features: { 'intellect-auth': false, aihub: false } },
    });
  });

  it('开启时返回 true', async () => {
    const app = new Hono();
    app.route(
      '/',
      createFeaturesRoutes({
        resolve: () => ({ 'intellect-auth': true, aihub: true }),
      }),
    );
    const res = await app.request('/features');
    const body = await res.json();
    expect(body.data.features['intellect-auth']).toBe(true);
    expect(body.data.features.aihub).toBe(true);
  });
});
