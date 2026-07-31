// spec-013 P1-8: useLayoutMode hook 测试

import { renderHook, act } from '@testing-library/react';
import { useLayoutMode } from './use-layout-mode';

const STORAGE_KEY = 'trae_work_layout';

describe('useLayoutMode', () => {
  beforeEach(() => {
    localStorage.clear();
    // mock window.location.reload
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: jest.fn() },
      writable: true,
    });
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
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('legacy');
  });

  it('从 localStorage 读取 three-column 模式', () => {
    localStorage.setItem(STORAGE_KEY, 'three-column');
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('three-column');
  });

  it('localStorage 为无效值时回退到默认', () => {
    localStorage.setItem(STORAGE_KEY, 'invalid');
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('three-column');
  });

  it('setMode 写入 localStorage 并刷新页面', () => {
    const { result } = renderHook(() => useLayoutMode());
    act(() => {
      result.current.setMode('legacy');
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('legacy');
    expect(window.location.reload).toHaveBeenCalled();
  });

  it('setMode 写入 three-column 并刷新页面', () => {
    localStorage.setItem(STORAGE_KEY, 'legacy');
    const { result } = renderHook(() => useLayoutMode());
    act(() => {
      result.current.setMode('three-column');
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('three-column');
    expect(window.location.reload).toHaveBeenCalled();
  });

  it('toggleMode 从 three-column 切换到 legacy', () => {
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('three-column');
    act(() => {
      result.current.toggleMode();
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('legacy');
    expect(window.location.reload).toHaveBeenCalled();
  });

  it('toggleMode 从 legacy 切换到 three-column', () => {
    localStorage.setItem(STORAGE_KEY, 'legacy');
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.mode).toBe('legacy');
    act(() => {
      result.current.toggleMode();
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('three-column');
    expect(window.location.reload).toHaveBeenCalled();
  });
});
