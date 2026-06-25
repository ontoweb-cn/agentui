import { Hono } from 'hono';

export const healthRoutes = new Hono();

healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'openkg-agentui-bff',
    timestamp: new Date().toISOString(),
  });
});
