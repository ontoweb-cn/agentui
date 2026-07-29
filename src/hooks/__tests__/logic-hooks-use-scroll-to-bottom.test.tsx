jest.mock('eventsource-parser/stream', () => ({}));

import { act, renderHook } from '@testing-library/react';
import { useScrollToBottom } from '../logic-hooks';

function createMockContainer({ atBottom = true } = {}) {
  const listeners: Record<string, any> = {};
  // jsdom 不实现 Element.prototype.scrollTo，useScrollToBottom 内部会调用
  // container.scrollTo({ top, behavior })，此处提供 mock 实现：
  // 直接更新 scrollTop，模拟真实滚动行为，便于后续 isAtBottom 判断。
  const container: any = {
    scrollTop: atBottom ? 100 : 0,
    clientHeight: 100,
    scrollHeight: 200,
    addEventListener: jest.fn((event: string, cb: any) => {
      listeners[event] = cb;
    }),
    removeEventListener: jest.fn(),
  };
  container.scrollTo = jest.fn(({ top }: { top?: number } = {}) => {
    if (typeof top === 'number') container.scrollTop = top;
  });
  return { current: container, listeners } as any;
}

// Helper to flush all timers and microtasks
async function flushAll() {
  jest.runAllTimers();
  // Flush microtasks
  await Promise.resolve();
  // Sometimes, effects queue more timers, so run again
  jest.runAllTimers();
  await Promise.resolve();
}

describe('useScrollToBottom', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('should set isAtBottom true when user is at bottom', () => {
    const containerRef = createMockContainer({ atBottom: true });
    const { result } = renderHook(() => useScrollToBottom([], containerRef));
    expect(result.current.isAtBottom).toBe(true);
  });

  it('should set isAtBottom false when user is not at bottom', () => {
    const containerRef = createMockContainer({ atBottom: false });
    const { result } = renderHook(() => useScrollToBottom([], containerRef));
    expect(result.current.isAtBottom).toBe(false);
  });

  it('should scroll to bottom when isAtBottom is true and messages change', async () => {
    const containerRef = createMockContainer({ atBottom: true });

    function useTestScrollToBottom(messages: any, containerRef: any) {
      return useScrollToBottom(messages, containerRef);
    }

    const { rerender } = renderHook(
      ({ messages }) => useTestScrollToBottom(messages, containerRef),
      { initialProps: { messages: [] as any[] } },
    );

    rerender({ messages: ['msg1'] });
    await flushAll();

    // hook 的 scrollToBottom 内部调用 container.scrollTo({...})，
    // 不是 scrollRef.current.scrollIntoView（历史实现已重构）。
    expect(containerRef.current.scrollTo).toHaveBeenCalled();
  });

  it('should NOT scroll to bottom when isAtBottom is false and messages change', async () => {
    const containerRef = createMockContainer({ atBottom: false });

    function useTestScrollToBottom(messages: any, containerRef: any) {
      return useScrollToBottom(messages, containerRef);
    }

    const { result, rerender } = renderHook(
      ({ messages }) => useTestScrollToBottom(messages, containerRef),
      { initialProps: { messages: [] as any[] } },
    );

    // Simulate user scrolls up before messages change
    await act(async () => {
      containerRef.current.scrollTop = 0;
      containerRef.current.addEventListener.mock.calls[0][1]();
      await flushAll();
      jest.advanceTimersByTime(10);
    });

    rerender({ messages: ['msg1'] });
    await flushAll();

    expect(result.current.isAtBottom).toBe(false);
    expect(containerRef.current.scrollTo).not.toHaveBeenCalled();
  });

  it('should indicate button should appear when user is not at bottom', () => {
    const containerRef = createMockContainer({ atBottom: false });
    const { result } = renderHook(() => useScrollToBottom([], containerRef));
    // The button should appear in the UI when isAtBottom is false
    expect(result.current.isAtBottom).toBe(false);
  });
});

const originalRAF = global.requestAnimationFrame;
beforeAll(() => {
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
});
afterAll(() => {
  global.requestAnimationFrame = originalRAF;
});
