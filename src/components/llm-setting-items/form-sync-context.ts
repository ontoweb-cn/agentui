import { createContext, useContext } from 'react';

export interface FormSyncContextValue {
  nodeId: string | undefined;
  updateNodeForm: (nodeId: string, values: Record<string, unknown>) => void;
}

export const FormSyncContext = createContext<FormSyncContextValue | null>(null);

export const useFormSync = (): FormSyncContextValue => {
  const ctx = useContext(FormSyncContext);
  if (!ctx) {
    // 画布外使用时返回 noop,避免 crash(评审意见:画布外应 noop 或抛错,不 crash)
    // 评审 S1:DEV 环境打印警告,帮助开发者定位 Provider 缺失问题
    if (import.meta.env.DEV) {
      console.warn(
        '[useFormSync] FormSyncContext.Provider 未挂载,返回 noop 实现。' +
          '若此组件期望在画布内运行,请检查 Provider 是否正确包裹。',
      );
    }
    return {
      nodeId: undefined,
      updateNodeForm: () => {},
    };
  }
  return ctx;
};
