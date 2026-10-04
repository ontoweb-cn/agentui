import { IntellectFormItem } from '@/components/intellect-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { useGetVariableLabelOrTypeByValue } from '../../hooks/use-get-begin-query';
import useGraphStore from '../../store';
import { QueryVariable } from '../components/query-variable';
import { NameInput } from './name-input';
import { VariableAggregatorFormSchemaType } from './schema';

type DynamicGroupVariableProps = {
  name: `groups.${number}`;
  parentIndex: number;
  nodeId?: string;
  removeParent: (index: number) => void;
};

export function DynamicGroupVariable({
  name,
  parentIndex,
  nodeId,
  removeParent,
}: DynamicGroupVariableProps) {
  const form = useFormContext<VariableAggregatorFormSchemaType>();
  const replaceNodeForm = useGraphStore((state) => state.replaceNodeForm);

  const variableFieldName = `${name}.variables` as const;

  const { getType } = useGetVariableLabelOrTypeByValue();

  const { fields, remove, append } = useFieldArray({
    name: variableFieldName,
    control: form.control,
  });

  const firstValue = form.getValues(`${variableFieldName}.0.value` as const);
  const firstType = getType(firstValue);

  const buildOutputs = useCallback(
    (groups: VariableAggregatorFormSchemaType['groups']) => {
      return groups.reduce(
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
    },
    [],
  );

  const handleAppendVariable = useCallback(() => {
    const nextVariable = { value: '' };
    const groups = form.getValues('groups') ?? [];
    const nextGroups = groups.map((group, index) =>
      index === parentIndex
        ? {
            ...group,
            variables: [...(group.variables ?? []), nextVariable],
          }
        : group,
    );

    append(nextVariable);

    if (nodeId) {
      replaceNodeForm(nodeId, {
        ...form.getValues(),
        groups: nextGroups,
        outputs: buildOutputs(nextGroups),
      });
    }
  }, [append, buildOutputs, form, nodeId, parentIndex, replaceNodeForm]);

  return (
    <section className="py-3 group space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <IntellectFormItem name={`${name}.group_name`} className="w-32">
            {(field) => (
              <NameInput
                value={field.value}
                onChange={field.onChange}
              ></NameInput>
            )}
          </IntellectFormItem>
          {/* Use a hidden form to store data types; otherwise, data loss may occur. */}
          <IntellectFormItem name={`${name}.type`} className="hidden">
            <Input></Input>
          </IntellectFormItem>
          <Button
            variant={'ghost'}
            type="button"
            className="hidden group-hover:block"
            onClick={() => removeParent(parentIndex)}
          >
            <Trash2 />
          </Button>
        </div>
        <div className="flex gap-2 items-center">
          {firstType && (
            <span className="text-text-secondary border px-1 rounded-md">
              {firstType}
            </span>
          )}
          <Button
            variant={'ghost'}
            type="button"
            onClick={handleAppendVariable}
          >
            <Plus />
          </Button>
        </div>
      </div>

      <section className="space-y-3">
        {fields.map((field, index) => (
          <div key={field.id} className="flex gap-2 items-center">
            <QueryVariable
              name={`${variableFieldName}.${index}.value`}
              className="flex-1 min-w-0"
              hideLabel
              types={firstType && fields.length > 1 ? [firstType] : []}
              onChange={(val) => {
                const type = getType(val);
                if (type && index === 0) {
                  form.setValue(`${name}.type` as const, type, {
                    shouldDirty: true,
                  });
                }
              }}
            ></QueryVariable>
            <Button
              variant={'ghost'}
              type="button"
              onClick={() => remove(index)}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </section>
    </section>
  );
}
