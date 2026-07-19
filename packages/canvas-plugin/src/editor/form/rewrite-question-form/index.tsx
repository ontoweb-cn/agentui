import { MessageHistoryWindowSizeFormField } from '@/components/message-history-window-size-item';
import { ModelTreeSelectFormField } from '@/components/model-tree-select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { IntellectSelect } from '@/components/ui/select';
import { useTranslation } from 'react-i18next';
import { INextOperatorForm } from '../../interface';
import { GoogleLanguageOptions } from '../../options';

const RewriteQuestionForm = ({ form }: INextOperatorForm & { form?: any }) => {
  const { t } = useTranslation();

  return (
    <Form {...form}>
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <ModelTreeSelectFormField
          name="llm_id"
          label={t('chat.model')}
          tooltip={t('chat.modelTip')}
        />
        <FormField
          control={form.control}
          name="language"
          render={({ field }) => (
            <FormItem>
              <FormLabel tooltip={t('chat.languageTip')}>
                {t('chat.language')}
              </FormLabel>
              <FormControl>
                <IntellectSelect
                  options={GoogleLanguageOptions}
                  allowClear={true}
                  {...field}
                ></IntellectSelect>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <MessageHistoryWindowSizeFormField></MessageHistoryWindowSizeFormField>
      </form>
    </Form>
  );
};

export default RewriteQuestionForm;
