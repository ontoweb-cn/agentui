import { ModelTreeSelect } from '@/components/model-tree-select';
import { useTranslation } from 'react-i18next';
import { IntellectFormItem } from '../intellect-form';

export type LLMFormFieldProps = {
  modelTypes?: string[];
  name?: string;
  testId?: string;
  optionTestIdPrefix?: string;
  config?: any;
};

export function LLMFormField({ name, config, modelTypes }: LLMFormFieldProps) {
  const { t } = useTranslation();

  return (
    <IntellectFormItem name={name || 'llm_id'} label={t('chat.model')}>
      <ModelTreeSelect
        allowClear={config?.allowClear ?? false}
        modelTypes={modelTypes}
      />
    </IntellectFormItem>
  );
}
