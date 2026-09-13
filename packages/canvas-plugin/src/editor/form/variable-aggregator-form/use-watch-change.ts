import { useEffect } from 'react';
import { UseFormReturn, useWatch } from 'react-hook-form';
import useGraphStore from '../../store';
import { VariableAggregatorFormSchemaType } from './schema';

export function useWatchFormChange(
  id?: string,
  form?: UseFormReturn<VariableAggregatorFormSchemaType>,
) {
  const values = useWatch({ control: form?.control });
  const { replaceNodeForm } = useGraphStore((state) => state);

  useEffect(() => {
    if (id && form?.formState.isDirty) {
      const latestValues = form.getValues();
      const outputs = latestValues.groups?.reduce(
        (pre, cur) => {
          if (cur.group_name) {
            pre[cur.group_name] = {
              type: cur.type,
            };
          }

          return pre;
        },
        {} as Record<string, Record<string, any>>,
      );

      replaceNodeForm(id, { ...latestValues, outputs: outputs ?? {} });
    }
  }, [form?.formState.isDirty, id, replaceNodeForm, values]);
}
