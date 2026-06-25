import { IntellectNodeType } from '@/interfaces/database/agent';
import { isEmpty } from 'lodash';
import { useMemo } from 'react';
import { initialRetrievalValues } from '../../constant';

export function useValues(node?: IntellectNodeType) {
  const defaultValues = useMemo(
    () => ({
      ...initialRetrievalValues,
    }),
    [],
  );

  const values = useMemo(() => {
    const formData = node?.data?.form;

    if (isEmpty(formData)) {
      return defaultValues;
    }

    return formData;
  }, [defaultValues, node?.data?.form]);

  return values;
}
