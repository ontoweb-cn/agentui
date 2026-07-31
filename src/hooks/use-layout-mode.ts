// spec-013 P1-4: useLayoutMode hook
// 控制 TRAE Work 三栏布局与旧布局之间的切换
// localStorage key: trae_work_layout, 值: 'three-column' | 'legacy'

import { useCallback, useState } from 'react';

export type LayoutMode = 'three-column' | 'legacy';

const STORAGE_KEY = 'trae_work_layout';
const DEFAULT_MODE: LayoutMode = 'three-column';

function readStoredMode(): LayoutMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'legacy' || value === 'three-column') {
      return value;
    }
  } catch {
    // localStorage 不可用（如 SSR 或隐私模式），使用默认值
  }
  return DEFAULT_MODE;
}

export interface UseLayoutModeReturn {
  mode: LayoutMode;
  setMode: (mode: LayoutMode) => void;
  toggleMode: () => void;
}

/**
 * 布局模式 hook。切换时写入 localStorage 并刷新页面,
 * 确保布局干净切换,避免 React 状态残留。
 */
export function useLayoutMode(): UseLayoutModeReturn {
  const [mode] = useState<LayoutMode>(readStoredMode);

  const setMode = useCallback((next: LayoutMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略写入失败
    }
    window.location.reload();
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'three-column' ? 'legacy' : 'three-column');
  }, [mode, setMode]);

  return { mode, setMode, toggleMode };
}
