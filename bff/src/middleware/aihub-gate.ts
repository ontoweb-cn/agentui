/**
 * AIHub 能力总闸中间件。
 *
 * AIHUB_ENABLED 未开启（或代理/断言配置不完整）时直接 503，
 * 避免"入口隐藏但接口仍可用"。
 */

import type { Context, Next } from 'hono';
import { isAihubEnabled } from '../services/features';

export type AihubGateChecker = () => boolean;

export function createAihubGate(isEnabled: AihubGateChecker = isAihubEnabled) {
  return async (c: Context, next: Next) => {
    if (!isEnabled()) {
      return c.json(
        {
          code: 503,
          error: 'FEATURE_DISABLED',
          message: 'aihub feature is disabled',
        },
        503,
      );
    }
    await next();
  };
}

export const aihubGate = createAihubGate();
