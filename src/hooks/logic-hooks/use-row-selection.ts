import { RowSelectionState } from '@tanstack/react-table';
import { isEmpty } from 'lodash';
import { useCallback, useMemo, useState } from 'react';

export function useRowSelection() {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const clearRowSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const selectedCount = useMemo(() => {
    return Object.keys(rowSelection).length;
  }, [rowSelection]);

  return {
    rowSelection,
    setRowSelection,
    rowSelectionIsEmpty: isEmpty(rowSelection),
    clearRowSelection,
    selectedCount,
  };
}

export type UseRowSelectionType = ReturnType<typeof useRowSelection>;

export function useSelectedIds<T extends Array<{ id: string }>>(
  rowSelection: RowSelectionState,
  list: T,
) {
  const selectedIds = useMemo(() => {
    // 防御：当上游降级返回 data:null 时（如 token 过期 BFF 返回 401→{code:0,data:null}），
    // list 可能为 undefined，避免 .filter() 崩溃
    if (!Array.isArray(list)) return [];

    // When using getRowId, rowSelection keys are IDs, not indices
    const selectionKeys = Object.keys(rowSelection);

    // Check if keys are numeric (index-based) or string IDs
    const isIndexBased = selectionKeys.every((key) => !isNaN(Number(key)));

    if (isIndexBased) {
      // Legacy index-based selection
      return list
        .filter((_x, idx) => selectionKeys.some((y) => Number(y) === idx))
        .map((x) => x.id);
    } else {
      // ID-based selection (when getRowId is used)
      return selectionKeys.filter((id) => list.some((item) => item.id === id));
    }
  }, [list, rowSelection]);

  return { selectedIds };
}
