// P0-1: hiedu 审计 sink 单元测试。
// 覆盖:默认 sink 输出单行结构化 JSON,且不包含 token/cookie 等敏感字段。

import { describe, it, expect, vi, afterEach } from 'vitest';

import { consoleHieduAuditSink, type HieduAuthRejectEvent } from './hiedu-audit';

describe('consoleHieduAuditSink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('输出单行 JSON,包含 event/auth.reject 与追踪字段', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const event: HieduAuthRejectEvent = {
      event: 'auth.reject',
      ts: '2026-10-31T00:00:00.000Z',
      requestId: 'req-1',
      method: 'GET',
      path: '/api/bff/hiedu/api/me',
      reason: 'missing_session',
    };

    consoleHieduAuditSink(event);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0] as string;
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual(event);
    expect(line).not.toContain('imt_token');
  });
});
