/**
 * 系统能力查询路由。
 *
 * 路径：前端 `/api/bff/features` → Vite/nginx rewrite 去掉 `/api/bff`
 *       → BFF 收到 `/features` → 本路由匹配。
 *
 * 鉴权：仅要求有效宿主会话（index.ts 挂载 authMiddleware +
 * requireValidImtSession），不依赖 X-Backend-Id / X-User-Id。
 */

import { Hono } from 'hono';
import { getFeatures } from '../services/features';
import type { Features } from '../types/features';
import type { FeaturesResponse } from '../types/features';

export interface FeaturesRouteDeps {
  /** 能力解析器（测试可注入固定值） */
  resolve?: () => Features;
}

export function createFeaturesRoutes(
  deps: FeaturesRouteDeps = {},
): Hono {
  const resolve = deps.resolve ?? getFeatures;
  const routes = new Hono();

  routes.get('/features', (c) => {
    const response: FeaturesResponse = { features: resolve() };
    return c.json({ code: 0, message: 'success', data: response });
  });

  return routes;
}

export const featuresRoutes = createFeaturesRoutes();
