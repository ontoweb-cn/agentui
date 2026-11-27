import { BeginQuery } from '../interface';
import { useCallback, useMemo, useState } from 'react';

/**
 * run-sheet 的 wait-for-user 适配 (plan §4.3 / p0p2-closeout B5-U3)。
 *
 * 聊天链路的等待表单由 useAwaitComponentData 驱动（消息流里的 user_inputs
 * 事件 → 表单 → sendFormMessage）。run-sheet 是非对话入口，没有消息流，因此
 * 这里复刻同一套语义，但以「最后一个 user_inputs 事件」为状态源：
 *
 *  - `applyUserInputs(event)` 收到引擎的 user_inputs 载荷后打开表单；
 *  - `submit(values)` 用与聊天链路相同的 buildBeginQueryWithObject 归一化，
 *    再回调宿主（宿主负责发 resume：POST /canvas/:id/resume，BFF 按后端选方言）；
 *  - `dismiss()` 允许用户关掉表单（超时/取消/再编辑由宿主决定何时调用）。
 */
export interface UserInputsEvent {
  /** 字段定义，键为变量名，值为字段描述（与聊天链路 data.inputs 同形）。 */
  inputs?: Record<string, BeginQuery>;
  /** 引擎给出的提示文案（Python user_inputs.tips）。 */
  tips?: string;
}

export interface RunSheetAwaitState {
  /** 表单是否处于打开状态。 */
  waiting: boolean;
  /** 待填字段定义。 */
  inputs: Record<string, BeginQuery>;
  /** 提示文案。 */
  tips: string;
  /** 收到 user_inputs 事件：打开表单。 */
  applyUserInputs: (event: UserInputsEvent) => void;
  /** 提交表单：归一化后回调宿主。 */
  submit: (values: BeginQuery[]) => void;
  /** 关闭表单而不提交（取消/超时）。 */
  dismiss: () => void;
}

export interface RunSheetAwaitOptions {
  onSubmit: (inputs: Record<string, BeginQuery>) => void;
  /** 归一化函数（默认与聊天链路同源，由宿主注入以免包间耦合）。 */
  normalize?: (
    declared: Record<string, BeginQuery>,
    values: BeginQuery[],
  ) => Record<string, BeginQuery>;
}

/**
 * 单字段直填的缺省归一化：把 [{key,value}] 合并回声明表。
 * 与 buildBeginQueryWithObject 的可见行为一致（保留未提交字段的声明）。
 */
function defaultNormalize(
  declared: Record<string, BeginQuery>,
  values: BeginQuery[],
): Record<string, BeginQuery> {
  const next: Record<string, BeginQuery> = { ...declared };
  for (const value of values) {
    const key = value.key;
    if (!key) continue;
    next[key] = { ...(next[key] ?? {}), ...value };
  }
  return next;
}

export function useRunSheetAwait(options: RunSheetAwaitOptions): RunSheetAwaitState {
  const { onSubmit, normalize = defaultNormalize } = options;
  const [inputs, setInputs] = useState<Record<string, BeginQuery>>({});
  const [tips, setTips] = useState('');
  const [waiting, setWaiting] = useState(false);

  const applyUserInputs = useCallback((event: UserInputsEvent) => {
    setInputs(event.inputs ?? {});
    setTips(event.tips ?? '');
    // 空字段定义仍然打开表单：引擎明确要求用户交互，UI 应显示空态而不是静默继续。
    setWaiting(true);
  }, []);

  const submit = useCallback(
    (values: BeginQuery[]) => {
      onSubmit(normalize(inputs, values));
      setWaiting(false);
    },
    [inputs, normalize, onSubmit],
  );

  const dismiss = useCallback(() => {
    setWaiting(false);
  }, []);

  const state = useMemo(
    () => ({ waiting, inputs, tips, applyUserInputs, submit, dismiss }),
    [waiting, inputs, tips, applyUserInputs, submit, dismiss],
  );
  return state;
}
