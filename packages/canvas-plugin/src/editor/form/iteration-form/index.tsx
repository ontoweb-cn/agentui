import { Form } from '@/components/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { memo, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { ArrayFields } from '../../constant';
import { INextOperatorForm } from '../../interface';
import { FormWrapper } from '../components/form-wrapper';
import { Output } from '../components/output';
import { QueryVariable } from '../components/query-variable';
import { DynamicOutput } from './dynamic-output';
import { OutputArray } from './interface';
import { IterationFormSchema } from './schema';
import { useValues } from './use-values';
import { useWatchFormChange } from './use-watch-form-change';

function IterationForm({ node }: INextOperatorForm) {
  const defaultValues = useValues(node);

  const form = useForm({
    defaultValues: defaultValues,
    resolver: zodResolver(IterationFormSchema),
  });

  const outputs: OutputArray = useWatch({
    control: form?.control,
    name: 'outputs',
  });

  const outputList = useMemo(() => {
    return outputs.map((x) => ({ title: x.name, type: x?.type }));
  }, [outputs]);

  useWatchFormChange(node?.id, form);

  return (
    <Form {...form}>
      <FormWrapper>
        <QueryVariable
          name="items_ref"
          types={ArrayFields as any[]}
        ></QueryVariable>
        <DynamicOutput node={node}></DynamicOutput>
        <Output list={outputList}></Output>
      </FormWrapper>
    </Form>
  );
}

export default memo(IterationForm);
