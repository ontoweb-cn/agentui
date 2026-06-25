import { useTranslation } from 'react-i18next';
import { IntellectFormItem } from './intellect-form';
import { Input } from './ui/input';

type WebHookResponseStatusFormFieldProps = {
  name: string;
};

export function WebHookResponseStatusFormField({
  name,
}: WebHookResponseStatusFormFieldProps) {
  const { t } = useTranslation();

  return (
    <IntellectFormItem name={name} label={t('flow.webhook.status')}>
      <Input type="number"></Input>
    </IntellectFormItem>
  );
}
