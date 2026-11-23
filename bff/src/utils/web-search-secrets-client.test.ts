import { describe, expect, it, vi } from 'vitest';
import {
  buildWebSearchSecretPutUrl,
  probeWebSearchSecretsApi,
} from './web-search-secrets-client';

describe('probeWebSearchSecretsApi (t42-m1 prep)', () => {
  it('404 → unavailable with L-T42 reason', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 404, ok: false });
    const result = await probeWebSearchSecretsApi({
      gatewayBaseUrl: 'http://gw',
      sessionId: 's1',
      authorization: 'Bearer x',
      fetchImpl,
    });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.status).toBe(404);
      expect(result.reason).toMatch(/L-T42-01/);
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://gw/api/sessions/s1/web-search-secrets',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('2xx → available', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, ok: true });
    const result = await probeWebSearchSecretsApi({
      gatewayBaseUrl: 'http://gw/',
      sessionId: 's1',
      authorization: 'Bearer x',
      fetchImpl,
    });
    expect(result).toEqual({
      available: true,
      basePath: 'http://gw/api/sessions/s1/web-search-secrets',
    });
  });

  it('network error → unavailable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await probeWebSearchSecretsApi({
      gatewayBaseUrl: 'http://gw',
      sessionId: 's1',
      authorization: 'Bearer x',
      fetchImpl,
    });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toMatch(/ECONNREFUSED/);
    }
  });
});

describe('buildWebSearchSecretPutUrl', () => {
  it('encodes session and provider', () => {
    expect(buildWebSearchSecretPutUrl('http://gw/', 's/1', 'search1api')).toBe(
      'http://gw/api/sessions/s%2F1/web-search-secrets/search1api',
    );
  });
});
