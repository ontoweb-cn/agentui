import { describe, expect, it } from 'vitest';
import {
  isIdpPassthroughUsable,
  loadIdpPassthroughConfig,
} from './idp-config';

describe('D2 IdP 直通配置', () => {
  it('默认关闭', () => {
    const cfg = loadIdpPassthroughConfig({} as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(isIdpPassthroughUsable(cfg)).toBe(false);
  });

  it('开启且字段齐全时可用，默认 token 端点与 audience=clientId', () => {
    const cfg = loadIdpPassthroughConfig({
      BFF_IDP_PASSTHROUGH_ENABLED: 'true',
      BFF_IDP_ISSUER: 'https://ai.example/auth/',
      BFF_IDP_CLIENT_ID: 'ia-agentui',
    } as NodeJS.ProcessEnv);
    expect(cfg.issuer).toBe('https://ai.example/auth');
    expect(cfg.tokenUrl).toBe('https://ai.example/auth/api/login/oauth/access_token');
    expect(cfg.audiences).toEqual(['ia-agentui']);
    expect(isIdpPassthroughUsable(cfg)).toBe(true);
  });

  it('缺少 clientId 时不可用（fail-closed）', () => {
    const cfg = loadIdpPassthroughConfig({
      BFF_IDP_PASSTHROUGH_ENABLED: 'true',
      BFF_IDP_ISSUER: 'https://ai.example/auth',
    } as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(true);
    expect(isIdpPassthroughUsable(cfg)).toBe(false);
  });

  it('支持显式 token URL 与多 audience', () => {
    const cfg = loadIdpPassthroughConfig({
      BFF_IDP_PASSTHROUGH_ENABLED: '1',
      BFF_IDP_ISSUER: 'https://ai.example/auth',
      BFF_IDP_CLIENT_ID: 'ia-agentui',
      BFF_IDP_TOKEN_URL: 'https://ai.example/auth/oauth/token',
      BFF_IDP_AUDIENCES: 'ia-agentui, intellect-team-api',
      BFF_IDP_REFRESH_SINGLEFLIGHT: 'false',
    } as NodeJS.ProcessEnv);
    expect(cfg.tokenUrl).toBe('https://ai.example/auth/oauth/token');
    expect(cfg.audiences).toEqual(['ia-agentui', 'intellect-team-api']);
    expect(cfg.refreshSingleflight).toBe(false);
  });
});
