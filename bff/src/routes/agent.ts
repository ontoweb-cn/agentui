import { Hono } from 'hono';
import { intellectRagClient } from '../services/intellect-rag-client';

export const agentRoutes = new Hono();

// List agents (proxy to intellect-rag)
agentRoutes.get('/', async (c) => {
  const token = c.req.header('Authorization') || '';
  const data = await intellectRagClient.get('/api/v1/agents', token, c.req.query());
  return c.json(data);
});

// Get agent detail
agentRoutes.get('/:id', async (c) => {
  const token = c.req.header('Authorization') || '';
  const id = c.req.param('id');
  const data = await intellectRagClient.get(`/api/v1/agents/${id}`, token);
  return c.json(data);
});

// Create agent
agentRoutes.post('/', async (c) => {
  const token = c.req.header('Authorization') || '';
  const body = await c.req.json();
  const data = await intellectRagClient.post('/api/v1/agents', token, body);
  return c.json(data);
});

// Update agent
agentRoutes.put('/:id', async (c) => {
  const token = c.req.header('Authorization') || '';
  const id = c.req.param('id');
  const body = await c.req.json();
  const data = await intellectRagClient.put(`/api/v1/agents/${id}`, token, body);
  return c.json(data);
});

// Delete agent
agentRoutes.delete('/:id', async (c) => {
  const token = c.req.header('Authorization') || '';
  const id = c.req.param('id');
  const data = await intellectRagClient.delete(`/api/v1/agents/${id}`, token);
  return c.json(data);
});
