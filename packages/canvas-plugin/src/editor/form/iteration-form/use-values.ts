import { IntellectNodeType } from '@/interfaces/database/agent';
import { isEmpty } from 'lodash';
import { useMemo } from 'react';
import { initialIterationValues } from '../../constant';
import { convertIterationOutputsToArray } from './utils';

export function useValues(node?: IntellectNodeType) {
  const values = useMemo(() => {
    const formData = node?.data?.form;

    if (isEmpty(formData)) {
      return { ...initialIterationValues, outputs: [] };
    }

    return {
      ...formData,
      outputs: convertIterationOutputsToArray(formData.outputs),
    };
  }, [node?.data?.form]);

  return values;
}
