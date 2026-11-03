/**
 * 统一认证总闸中间件（D2=B）。
 *
 * INTELLECT_AUTH_ENABLED 未开启（或 hiedu 断言代理配置不完整）时，
 * 直接拒绝 hiedu 代理请求，避免“能力隐藏但接口仍可用”的割裂状态。
 */

import type { Context, Next } from 'hono';
import { isIntellectAuthEnabled } from '../services/features';

export type IntellectAuthGateChecker = () => boolean;

export function createIntellectAuthGate(
  isEnabled: IntellectAuthGateChecker = isIntellectAuthEnabled,
) {
  return async (c: Context, next: Next) => {
    if (!isEnabled()) {
      return c.json(
        {
          code: 503,
          error: 'FEATURE_DISABLED',
          message: 'intellect-auth feature is disabled',
        },
        503,
      );
    }
    await next();
  };
}

export const intellectAuthGate = createIntellectAuthGate();
