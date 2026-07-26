import { Hono } from 'hono';
import { getAllTenantStatuses, getOverallReadiness } from '../services/tenant-status';

export const healthRoutes = new Hono();

// Liveness 探针(仅进程存活)
healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'openkg-agentui-bff',
    timestamp: new Date().toISOString(),
  });
});

// 方案 3 (P2):Readiness 探针(包含 tenant 校验状态)
// K8s readinessProbe 指向此端点,失败时摘除流量。
// P1-2 修复:not_ready 时返回 503,确保 K8s 根据状态码摘除流量。
healthRoutes.get('/readiness', (c) => {
  const overall = getOverallReadiness();
  const statusCode = overall === 'ok' ? 200 : 503;
  return c.json(
    {
      status: overall,
      service: 'openkg-agentui-bff',
      tenants: getAllTenantStatuses(),
      timestamp: new Date().toISOString(),
    },
    statusCode,
  );
});
