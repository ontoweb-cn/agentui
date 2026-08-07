// spec-013 P1-4: useWorkMode hook
// 管理 Work/Code/Canvas 模式切换状态,localStorage 持久化
// localStorage key: trae_work_mode, 值: 'work' | 'code' | 'canvas'
//
// 参照 use-layout-mode.ts 的模式:模块级 state + 自定义事件 + useSyncExternalStore

import { useCallback, useSyncExternalStore } from 'react';
import type { WorkMode } from '@/components/trae-work';

const STORAGE_KEY = 'trae_work_mode';
const DEFAULT_MODE: WorkMode = 'work';

function isValidMode(value: unknown): value is WorkMode {
  return value === 'work' || value === 'code' || value === 'canvas';
}

function readStoredMode(): WorkMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (isValidMode(value)) {
      return value;
    }
  } catch {
    // localStorage 不可用（如 SSR 或隐私模式），使用默认值
  }
  return DEFAULT_MODE;
}

// 模块级 state:所有 useWorkMode 调用方共享同一状态
let currentMode: WorkMode = readStoredMode();
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

function getSnapshot(): WorkMode {
  return currentMode;
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export interface UseWorkModeReturn {
  mode: WorkMode;
  setMode: (mode: WorkMode) => void;
}

/**
 * Work 模式 hook。切换时写入 localStorage 并通过模块级事件通知所有订阅者,
 * 实现跨组件共享 + 刷新持久化。
 */
export function useWorkMode(): UseWorkModeReturn {
  const mode = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_MODE);

  const setMode = useCallback((next: WorkMode) => {
    if (next === currentMode) return;
    currentMode = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略写入失败
    }
    emitChange();
  }, []);

  return { mode, setMode };
}

/**
 * 测试专用:重置模块级 state。
 * 生产代码不应调用此函数。
 */
export function __resetForTesting(): void {
  currentMode = readStoredMode();
  listeners.clear();
}
