import { describe, it, expect, afterEach, vi } from 'vitest';
import { getRagBaseUrl, resolveRagBaseUrl } from './rag-base-url';

describe('getRagBaseUrl', () => {
  afterEach(() => {
    delete process.env.INTELLECT_RAG_URL;
  });

  it('未设置时默认 http://localhost:9380', () => {
    delete process.env.INTELLECT_RAG_URL;
    expect(getRagBaseUrl()).toBe('http://localhost:9380');
  });

  it('读取 INTELLECT_RAG_URL 并去掉尾部斜杠', () => {
    process.env.INTELLECT_RAG_URL = 'http://rag.example:9380/';
    expect(getRagBaseUrl()).toBe('http://rag.example:9380');
  });
});

// D10 路径级灰度分流(spec 2026-11-27-go-migration-w1b §5.3/§6)
describe('resolveRagBaseUrl', () => {
  afterEach(() => {
    delete process.env.INTELLECT_RAG_URL;
    delete process.env.RAG_GO_PREFIXES;
    delete process.env.RAG_GO_UPSTREAM;
    vi.restoreAllMocks();
  });

  it('默认(未设置 RAG_GO_*)全量走 Python', () => {
    delete process.env.RAG_GO_PREFIXES;
    delete process.env.RAG_GO_UPSTREAM;
    expect(resolveRagBaseUrl('/api/v1/datasets')).toBe('http://localhost:9380');
  });

  it('前缀列表为空串时全量走 Python(行为零变化)', () => {
    process.env.RAG_GO_PREFIXES = '   ';
    process.env.RAG_GO_UPSTREAM = 'http://127.0.0.1:9382';
    expect(resolveRagBaseUrl('/api/v1/datasets')).toBe('http://localhost:9380');
  });

  it('上游缺失时全量走 Python(不半切换)', () => {
    process.env.RAG_GO_PREFIXES = '/api/v1/datasets';
    delete process.env.RAG_GO_UPSTREAM;
    expect(resolveRagBaseUrl('/api/v1/datasets')).toBe('http://localhost:9380');
  });

  it('命中前缀 → Go 上游(尾斜杠被去掉)', () => {
    process.env.INTELLECT_RAG_URL = 'http://python:9380';
    process.env.RAG_GO_PREFIXES = '/api/v1/datasets';
    process.env.RAG_GO_UPSTREAM = 'http://127.0.0.1:9382/';
    expect(resolveRagBaseUrl('/api/v1/datasets')).toBe('http://127.0.0.1:9382');
    expect(resolveRagBaseUrl('/api/v1/datasets/kb-1/documents')).toBe('http://127.0.0.1:9382');
  });

  it('未命中前缀 → Python', () => {
    process.env.INTELLECT_RAG_URL = 'http://python:9380';
    process.env.RAG_GO_PREFIXES = '/api/v1/datasets';
    process.env.RAG_GO_UPSTREAM = 'http://127.0.0.1:9382';
    expect(resolveRagBaseUrl('/api/v1/agents')).toBe('http://python:9380');
  });

  it('逗号/空格混合分隔,取最长前缀', () => {
    process.env.INTELLECT_RAG_URL = 'http://python:9380';
    process.env.RAG_GO_PREFIXES = '/api/v1/datasets, /api/v1/datasets/kb-1';
    process.env.RAG_GO_UPSTREAM = 'http://127.0.0.1:9382';
    // 两者都命中,结果同为 Go 上游;用仅命中短前缀的路径验证长前缀不误伤
    expect(resolveRagBaseUrl('/api/v1/datasets/kb-2')).toBe('http://127.0.0.1:9382');
    expect(resolveRagBaseUrl('/api/v1/datasets/kb-1/documents')).toBe('http://127.0.0.1:9382');
  });

  it('最长匹配:短前缀命中时仍走 Go,长前缀不命中不影响', () => {
    process.env.RAG_GO_PREFIXES = ['/api/v1/data', '/api/v1/datasets'].join(' ');
    process.env.RAG_GO_UPSTREAM = 'http://127.0.0.1:9382';
    expect(resolveRagBaseUrl('/api/v1/datasets')).toBe('http://127.0.0.1:9382');
  });

  it('路径段边界:/api/v1/data 不匹配 /api/v1/datasets', () => {
    process.env.INTELLECT_RAG_URL = 'http://python:9380';
    process.env.RAG_GO_PREFIXES = '/api/v1/data';
    process.env.RAG_GO_UPSTREAM = 'http://127.0.0.1:9382';
    expect(resolveRagBaseUrl('/api/v1/datasets')).toBe('http://python:9380');
    expect(resolveRagBaseUrl('/api/v1/data')).toBe('http://127.0.0.1:9382');
    expect(resolveRagBaseUrl('/api/v1/data/x')).toBe('http://127.0.0.1:9382');
  });

  it('忽略 query 与 hash', () => {
    process.env.RAG_GO_PREFIXES = '/api/v1/datasets';
    process.env.RAG_GO_UPSTREAM = 'http://127.0.0.1:9382';
    expect(resolveRagBaseUrl('/api/v1/datasets?page=1')).toBe('http://127.0.0.1:9382');
  });

  it('调用方传入租户级 origin 时,未分流沿用该 origin 而非全局默认', () => {
    process.env.RAG_GO_PREFIXES = '/api/v1/datasets';
    process.env.RAG_GO_UPSTREAM = 'http://127.0.0.1:9382';
    expect(resolveRagBaseUrl('/api/v1/agents', 'http://tenant-a:9380')).toBe(
      'http://tenant-a:9380',
    );
  });

  it.each([
    ['/api/v1/admin'],
    ['/api/v1/platform'],
    ['/api/bff'],
    ['/api/v1/wargame'],
    ['/api/v1/admin/users'],
    ['/api/v1/ad'],
    ['/api'],
  ])('禁用前缀 %s → 回退 Python 并报错一次', (forbidden) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.INTELLECT_RAG_URL = 'http://python:9380';
    process.env.RAG_GO_PREFIXES = forbidden;
    process.env.RAG_GO_UPSTREAM = 'http://127.0.0.1:9382';
    expect(resolveRagBaseUrl('/api/v1/datasets')).toBe('http://python:9380');
    expect(resolveRagBaseUrl('/api/v1/datasets')).toBe('http://python:9380');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('禁用前缀与合法前缀混排 → 整体回退 Python(不部分切换)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.INTELLECT_RAG_URL = 'http://python:9380';
    process.env.RAG_GO_PREFIXES = '/api/v1/datasets /api/bff';
    process.env.RAG_GO_UPSTREAM = 'http://127.0.0.1:9382';
    expect(resolveRagBaseUrl('/api/v1/datasets')).toBe('http://python:9380');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['api/v1/x'],
    ['/api/v1/../etc'],
    ['/api/v1/datasets?x=1'],
    [`/api/v1/${'a'.repeat(200)}`],
  ])('非法前缀 %s → 回退 Python', (invalid) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.INTELLECT_RAG_URL = 'http://python:9380';
    process.env.RAG_GO_PREFIXES = invalid;
    process.env.RAG_GO_UPSTREAM = 'http://127.0.0.1:9382';
    expect(resolveRagBaseUrl('/api/v1/datasets')).toBe('http://python:9380');
    expect(spy).toHaveBeenCalled();
  });

  it('形近非禁用前缀(/api/v1/adminx)正常走 Go', () => {
    process.env.RAG_GO_PREFIXES = '/api/v1/adminx';
    process.env.RAG_GO_UPSTREAM = 'http://127.0.0.1:9382';
    expect(resolveRagBaseUrl('/api/v1/adminx')).toBe('http://127.0.0.1:9382');
  });
});
