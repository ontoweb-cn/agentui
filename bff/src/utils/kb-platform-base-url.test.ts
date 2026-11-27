import { describe, it, expect, afterEach } from 'vitest';
import {
  buildKbPlatformUpstreamUrl,
  getKbPlatformBaseUrl,
  joinKbPlatformApiPath,
} from './kb-platform-base-url';

describe('getKbPlatformBaseUrl', () => {
  afterEach(() => {
    delete process.env.KB_PLATFORM_URL;
  });

  it('未设置时默认 http://127.0.0.1:9381', () => {
    delete process.env.KB_PLATFORM_URL;
    expect(getKbPlatformBaseUrl()).toBe('http://127.0.0.1:9381');
  });

  it('读取 KB_PLATFORM_URL 并去掉尾部斜杠', () => {
    process.env.KB_PLATFORM_URL = 'http://platform:9381/';
    expect(getKbPlatformBaseUrl()).toBe('http://platform:9381');
  });
});

describe('joinKbPlatformApiPath', () => {
  it('拼接 catalog overview', () => {
    expect(joinKbPlatformApiPath('/catalog/overview')).toBe(
      '/api/v1/platform/catalog/overview',
    );
  });

  it('空后缀为 platform 根', () => {
    expect(joinKbPlatformApiPath('')).toBe('/api/v1/platform');
  });

  it('拒绝含非法字符的路径', () => {
    expect(joinKbPlatformApiPath('/catalog/../etc')).toBe('');
  });
});

describe('buildKbPlatformUpstreamUrl', () => {
  afterEach(() => {
    delete process.env.KB_PLATFORM_URL;
  });

  it('保留 query', () => {
    process.env.KB_PLATFORM_URL = 'http://127.0.0.1:9381';
    expect(
      buildKbPlatformUpstreamUrl('/catalog/instances', '?kind=md&status=online'),
    ).toBe('http://127.0.0.1:9381/api/v1/platform/catalog/instances?kind=md&status=online');
  });
});