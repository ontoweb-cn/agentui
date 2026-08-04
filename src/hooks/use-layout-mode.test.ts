// spec-013 P1-8: useLayoutMode hook 测试
// P1-6 修复:不再使用 window.location.reload(),改为模块级 state + 事件同步

import { renderHook, act } from '@testing-library/react';
import { useLayoutMode, __resetForTesting } from './use-layout-mode';

const STORAGE_KEY = 'trae_work_layout';

describe('useLayoutMode', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTesting();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('默认返回 three-column 模式', () => {
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('three-column');
  });

  it('从 localStorage 读取 legacy 模式', () => {
    localStorage.setItem(STORAGE_KEY, 'legacy');
    __resetForTesting();
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('legacy');
  });

  it('从 localStorage 读取 three-column 模式', () => {
    localStorage.setItem(STORAGE_KEY, 'three-column');
    __resetForTesting();
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('three-column');
  });

  it('localStorage 为无效值时回退到默认', () => {
    localStorage.setItem(STORAGE_KEY, 'invalid');
    __resetForTesting();
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('three-column');
  });

  it('setMode 写入 localStorage 并同步更新 mode（不刷新页面）', () => {
    const { result } = renderHook(() => useLayoutMode());
    act(() => {
      result.current.setMode('legacy');
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('legacy');
    expect(result.current.mode).toBe('legacy');
  });

  it('setMode 写入 three-column 并同步更新 mode', () => {
    // 先设置为 legacy
    const { result } = renderHook(() => useLayoutMode());
    act(() => {
      result.current.setMode('legacy');
    });
    // 再切换回 three-column
    act(() => {
      result.current.setMode('three-column');
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('three-column');
    expect(result.current.mode).toBe('three-column');
  });

  it('setMode 设置相同值时不触发更新', () => {
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('three-column');
    act(() => {
      result.current.setMode('three-column');
    });
    // mode 仍为 three-column,localStorage 不变
    expect(result.current.mode).toBe('three-column');
  });

  it('toggleMode 从 three-column 切换到 legacy', () => {
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('three-column');
    act(() => {
      result.current.toggleMode();
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('legacy');
    expect(result.current.mode).toBe('legacy');
  });

  it('toggleMode 从 legacy 切换到 three-column', () => {
    const { result } = renderHook(() => useLayoutMode());
    act(() => {
      result.current.setMode('legacy');
    });
    expect(result.current.mode).toBe('legacy');
    act(() => {
      result.current.toggleMode();
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('three-column');
    expect(result.current.mode).toBe('three-column');
  });

  it('多个 hook 实例共享同一状态', () => {
    const { result: result1 } = renderHook(() => useLayoutMode());
    const { result: result2 } = renderHook(() => useLayoutMode());
    expect(result1.current.mode).toBe('three-column');
    expect(result2.current.mode).toBe('three-column');
    // 在 result1 中切换,result2 应同步更新
    act(() => {
      result1.current.setMode('legacy');
    });
    expect(result1.current.mode).toBe('legacy');
    expect(result2.current.mode).toBe('legacy');
  });

  it('不调用 window.location.reload（P1-6 修复）', () => {
    const reloadMock = jest.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
    });
    const { result } = renderHook(() => useLayoutMode());
    act(() => {
      result.current.setMode('legacy');
    });
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
