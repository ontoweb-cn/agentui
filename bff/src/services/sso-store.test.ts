// A7(wizard-sso-followup): SsoStore 单元测试 —— 使用临时文件,不触碰 bff/data。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readSsoRuntimeConfig,
  writeSsoRuntimeConfig,
  clearSsoRuntimeConfig,
  ssoRuntimeConfigSchema,
} from './sso-store';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sso-store-test-'));
  file = join(dir, 'sso-config.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const validInput = {
  enabled: true,
  publicOrigin: 'https://example.com/',
  providers: [' a ', 'a', 'b', ''],
  silentRelogin: false,
};

describe('SsoStore', () => {
  it('缺失文件 → read 返回 null(env 兜底)', () => {
    expect(readSsoRuntimeConfig(file)).toBeNull();
  });

  it('write 归一化:publicOrigin 去尾斜杠、providers trim/去重/去空、空数组归一 null', () => {
    const saved = writeSsoRuntimeConfig(validInput, file);
    expect(saved.publicOrigin).toBe('https://example.com');
    expect(saved.providers).toEqual(['a', 'b']);
    expect(saved.enabled).toBe(true);
    expect(saved.silentRelogin).toBe(false);
    expect(saved.updatedAt).toBeTruthy();
    expect(existsSync(file)).toBe(true);
  });

  it('providers 空数组 → null(不过滤)', () => {
    const saved = writeSsoRuntimeConfig({ ...validInput, providers: [] }, file);
    expect(saved.providers).toBeNull();
  });

  it('round-trip:write 后 read 返回同值', () => {
    writeSsoRuntimeConfig(validInput, file);
    const read = readSsoRuntimeConfig(file);
    expect(read?.publicOrigin).toBe('https://example.com');
    expect(read?.providers).toEqual(['a', 'b']);
  });

  it('损坏 JSON → null + 不抛错', () => {
    writeSsoRuntimeConfig(validInput, file);
    // 覆写为非法 JSON
    require('node:fs').writeFileSync(file, '{oops', 'utf-8');
    expect(readSsoRuntimeConfig(file)).toBeNull();
  });

  it('schema 不符(缺字段)→ null', () => {
    require('node:fs').writeFileSync(
      file,
      JSON.stringify({ enabled: true }),
      'utf-8',
    );
    expect(readSsoRuntimeConfig(file)).toBeNull();
  });

  it('clear 删除文件;再读为 null', () => {
    writeSsoRuntimeConfig(validInput, file);
    clearSsoRuntimeConfig(file);
    expect(existsSync(file)).toBe(false);
    expect(readSsoRuntimeConfig(file)).toBeNull();
  });

  it('写入内容不含任何 secret 类字段(Constitution Token Security)', () => {
    writeSsoRuntimeConfig(validInput, file);
    const raw = readFileSync(file, 'utf-8');
    expect(raw.toLowerCase()).not.toContain('secret');
    expect(() => ssoRuntimeConfigSchema.parse(JSON.parse(raw))).not.toThrow();
  });
});
