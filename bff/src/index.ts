import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error';
import { adminRoutes } from './routes/admin';
import { agentRoutes } from './routes/agent';
import { sessionRoutes } from './routes/session';
import { healthRoutes } from './routes/health';

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', cors());
app.use('*', errorHandler);

// Health check (no auth required)
app.route('/health', healthRoutes);

// Auth-protected routes
app.use('/api/*', authMiddleware);
app.route('/api/agent', agentRoutes);
app.route('/api/session', sessionRoutes);
// Admin routes (BFF-owned: whitelist, roles, resources — migrated from
// Intellect RAG Admin stubs/missing routes). Strongly-coupled admin features
// (users, services, sandbox, system settings) remain on Intellect RAG Admin :9381.
app.route('/api/admin', adminRoutes);

const port = Number(process.env.BFF_PORT) || 9390;

serve(
  { fetch: app.fetch, port },
  (info) => {
    console.log(`[BFF] OpenKG AgentUI BFF running on http://localhost:${info.port}`);
  },
);

export default app;
