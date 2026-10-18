import { act, renderHook } from '@testing-library/react';

import { useSendMessageWithSse } from '../logic-hooks';

jest.mock('@/components/ui/message', () => ({
  __esModule: true,
  default: { error: jest.fn() },
}));

const originalFetch = global.fetch;

function mockFetch(response: Record<string, unknown>) {
  global.fetch = jest.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

describe('useSendMessageWithSse', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('HTTP 非 2xx 时记录 error 并结束 loading', async () => {
    mockFetch({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      clone: () => ({
        json: async () => ({ message: 'boom' }),
      }),
    });

    const { result } = renderHook(() => useSendMessageWithSse());

    await act(async () => {
      await result.current.send('/api/test', {});
    });

    expect(result.current.error).toBe('boom');
    expect(result.current.done).toBe(true);
  });

  it('abort 不记录为 error', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        new DOMException('The operation was aborted.', 'AbortError'),
      ) as unknown as typeof fetch;
    const controller = new AbortController();
    controller.abort();

    const { result } = renderHook(() => useSendMessageWithSse());

    await act(async () => {
      await result.current.send('/api/test', {}, controller);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.done).toBe(true);
  });

  it('新一轮 send 开始时清空上一轮 error', async () => {
    mockFetch({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      clone: () => ({
        json: async () => ({ message: 'first-error' }),
      }),
    });

    const { result } = renderHook(() => useSendMessageWithSse());

    await act(async () => {
      await result.current.send('/api/test', {});
    });
    expect(result.current.error).toBe('first-error');

    mockFetch({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      clone: () => ({
        json: async () => ({ message: 'second-error' }),
      }),
    });

    await act(async () => {
      await result.current.send('/api/test', {});
    });
    expect(result.current.error).toBe('second-error');
  });
});
