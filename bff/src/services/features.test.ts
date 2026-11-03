import { describe, it, expect } from 'vitest';
import { resolveFeatures } from '../services/features';
import type { HieduConfigResult } from '../services/hiedu-assertion';

const okConfig: HieduConfigResult = {
  ok: true,
  config: {
    baseUrl: 'http://hiedu.test',
    iss: 'agentui-bff',
    aud: 'hiedu',
    org: 'wust',
    keys: [],
  },
};

const disabledConfig: HieduConfigResult = {
  ok: false,
  statusCode: 503,
  error: 'HIEDU_PROXY_DISABLED',
  message: 'disabled',
};

describe('resolveFeatures', () => {
  it('缺省（未设置 INTELLECT_AUTH_ENABLED）为 false', () => {
    expect(resolveFeatures({}, () => okConfig)).toEqual({
      'intellect-auth': false,
    });
  });

  it('显式 false 为 false，即使 hiedu 配置完整', () => {
    expect(
      resolveFeatures({ INTELLECT_AUTH_ENABLED: 'false' }, () => okConfig),
    ).toEqual({ 'intellect-auth': false });
  });

  it('开关 true 但 hiedu 配置不完整时为 false', () => {
    expect(
      resolveFeatures(
        { INTELLECT_AUTH_ENABLED: 'true' },
        () => disabledConfig,
      ),
    ).toEqual({ 'intellect-auth': false });
  });

  it('开关 true 且配置完整时为 true（大小写不敏感）', () => {
    expect(
      resolveFeatures({ INTELLECT_AUTH_ENABLED: ' TRUE ' }, () => okConfig),
    ).toEqual({ 'intellect-auth': true });
  });
});
