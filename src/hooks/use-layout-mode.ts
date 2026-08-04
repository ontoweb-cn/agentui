// spec-013 P1-4: useLayoutMode hook
// 控制 TRAE Work 三栏布局与旧布局之间的切换
// localStorage key: trae_work_layout, 值: 'three-column' | 'legacy'
//
// P1-6 修复:不再使用 window.location.reload() 切换布局,
// 改为模块级 state + 自定义事件,实现 React 内平滑切换。

import { useCallback, useSyncExternalStore } from 'react';

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

// 模块级 state:所有 useLayoutMode 调用方共享同一状态
let currentMode: LayoutMode = readStoredMode();
const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  // 监听其他 tab 的 localStorage 变化
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      currentMode = readStoredMode();
      callback();
    }
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    listeners.delete(callback);
    window.removeEventListener('storage', storageHandler);
  };
}

function getSnapshot(): LayoutMode {
  return currentMode;
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export interface UseLayoutModeReturn {
  mode: LayoutMode;
  setMode: (mode: LayoutMode) => void;
  toggleMode: () => void;
}

/**
 * 布局模式 hook。切换时写入 localStorage 并通过模块级事件通知所有订阅者,
 * 无需整页重载即可实现布局平滑切换。
 */
export function useLayoutMode(): UseLayoutModeReturn {
  const mode = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_MODE);

  const setMode = useCallback((next: LayoutMode) => {
    if (next === currentMode) return;
    currentMode = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略写入失败
    }
    emitChange();
  }, []);

  const toggleMode = useCallback(() => {
    setMode(currentMode === 'three-column' ? 'legacy' : 'three-column');
  }, [setMode]);

  return { mode, setMode, toggleMode };
}

/**
 * 测试专用:重置模块级 state。
 * 生产代码不应调用此函数。
 */
export function __resetForTesting(): void {
  currentMode = readStoredMode();
  listeners.clear();
}
