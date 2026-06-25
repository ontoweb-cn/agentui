import { Hono } from 'hono';

export const sessionRoutes = new Hono();

// Session management stubs - to be implemented as Harness logic migrates
sessionRoutes.get('/', (c) => {
  return c.json({
    sessions: [],
    message: 'Session management - coming soon',
  });
});

sessionRoutes.post('/', async (c) => {
  const body = await c.req.json();
  return c.json({
    id: crypto.randomUUID(),
    ...body,
    createdAt: new Date().toISOString(),
  });
});

sessionRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  return c.json({
    id,
    status: 'active',
    message: 'Session detail - coming soon',
  });
});

sessionRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ id, deleted: true });
});
