// run-sheet wait-for-user hook tests (p0p2-closeout B5-U3).


import { renderHook, act } from '@testing-library/react';

// jest 的 testEnvironment=jsdom（根 jest.config.ts）；不使用 vitest 的显式
// import，让同一文件在仓库既有的 jest 通道里运行。
import { useRunSheetAwait } from './use-run-sheet-await';
import type { BeginQuery } from '../interface';

const DECLARED: Record<string, BeginQuery> = {
  jd: { key: 'jd', name: 'Job Description', type: 'line', value: '', optional: false, options: [] },
  resume: { key: 'resume', name: 'Resume', type: 'file', value: '', optional: false, options: [] },
};

describe('useRunSheetAwait', () => {
  it('opens the form when a user_inputs event arrives', () => {
    const onSubmit = jest.fn();
    const { result } = renderHook(() => useRunSheetAwait({ onSubmit }));
    expect(result.current.waiting).toBe(false);

    act(() => result.current.applyUserInputs({ inputs: DECLARED, tips: 'fill me' }));

    expect(result.current.waiting).toBe(true);
    expect(result.current.inputs).toEqual(DECLARED);
    expect(result.current.tips).toBe('fill me');
  });

  it('opens an empty form when the engine asks with no fields', () => {
    const onSubmit = jest.fn();
    const { result } = renderHook(() => useRunSheetAwait({ onSubmit }));
    act(() => result.current.applyUserInputs({}));
    // A bare user_inputs is still an interaction request: show the empty state
    // instead of silently continuing the run.
    expect(result.current.waiting).toBe(true);
    expect(result.current.inputs).toEqual({});
  });

  it('normalises and forwards submitted values, then closes the form', () => {
    const onSubmit = jest.fn();
    const { result } = renderHook(() => useRunSheetAwait({ onSubmit }));
    act(() => result.current.applyUserInputs({ inputs: DECLARED }));
    act(() => result.current.submit([{ key: 'jd', name: 'Job Description', type: 'line', value: 'engineer', optional: false, options: [] }]));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0][0] as Record<string, BeginQuery>;
    expect(submitted.jd.value).toBe('engineer');
    // Unsubmitted declarations survive so resume still carries the full form.
    expect(submitted.resume).toEqual(DECLARED.resume);
    expect(result.current.waiting).toBe(false);
  });

  it('dismiss closes the form without submitting', () => {
    const onSubmit = jest.fn();
    const { result } = renderHook(() => useRunSheetAwait({ onSubmit }));
    act(() => result.current.applyUserInputs({ inputs: DECLARED }));
    act(() => result.current.dismiss());
    expect(result.current.waiting).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('re-editing reopens the form with the new declaration', () => {
    const onSubmit = jest.fn();
    const { result } = renderHook(() => useRunSheetAwait({ onSubmit }));
    act(() => result.current.applyUserInputs({ inputs: DECLARED }));
    act(() => result.current.dismiss());
    act(() => result.current.applyUserInputs({ inputs: { jd: DECLARED.jd } }));
    expect(result.current.waiting).toBe(true);
    expect(Object.keys(result.current.inputs)).toEqual(['jd']);
  });
});
