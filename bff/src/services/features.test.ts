import { describe, it, expect } from 'vitest';
import { resolveFeatures } from '../services/features';
import type { HieduConfigResult } from '../services/hiedu-assertion';
import type { AihubConfigResult } from '../services/aihub-assertion';

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

const okAihub: AihubConfigResult = {
  ok: true,
  config: {
    baseUrl: 'http://aihub.test',
    iss: 'gateway',
    aud: 'aihub',
    kid: 'kid-test',
    privateKey: {} as never,
  },
};

const disabledAihub: AihubConfigResult = {
  ok: false,
  statusCode: 503,
  error: 'AIHUB_PROXY_MISCONFIGURED',
  message: 'disabled',
};

describe('resolveFeatures', () => {
  it('缺省（未设置 INTELLECT_AUTH_ENABLED / AIHUB_ENABLED）为 false', () => {
    expect(resolveFeatures({}, () => okConfig, () => okAihub)).toEqual({
      'intellect-auth': false,
      aihub: false,
    });
  });

  it('显式 false 为 false，即使配置完整', () => {
    expect(
      resolveFeatures(
        { INTELLECT_AUTH_ENABLED: 'false', AIHUB_ENABLED: 'false' },
        () => okConfig,
        () => okAihub,
      ),
    ).toEqual({ 'intellect-auth': false, aihub: false });
  });

  it('开关 true 但配置不完整时为 false', () => {
    expect(
      resolveFeatures(
        { INTELLECT_AUTH_ENABLED: 'true', AIHUB_ENABLED: 'true' },
        () => disabledConfig,
        () => disabledAihub,
      ),
    ).toEqual({ 'intellect-auth': false, aihub: false });
  });

  it('开关 true 且配置完整时为 true（大小写不敏感）', () => {
    expect(
      resolveFeatures(
        { INTELLECT_AUTH_ENABLED: ' TRUE ', AIHUB_ENABLED: ' TRUE ' },
        () => okConfig,
        () => okAihub,
      ),
    ).toEqual({ 'intellect-auth': true, aihub: true });
  });

  it('aihub 独立于统一认证：仅 AIHUB 配置完整时为 true', () => {
    expect(
      resolveFeatures(
        { AIHUB_ENABLED: 'true' },
        () => disabledConfig,
        () => okAihub,
      ),
    ).toEqual({ 'intellect-auth': false, aihub: true });
  });
});
