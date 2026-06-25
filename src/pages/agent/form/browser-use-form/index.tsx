import { NextLLMSelect } from '@/components/llm-select/next';
import { IntellectFormItem } from '@/components/intellect-form';
import { Form } from '@/components/ui/form';
import { NumberInput } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { zodResolver } from '@hookform/resolvers/zod';
import { memo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { initialBrowserValues } from '../../constant';
import { useFormValues } from '../../hooks/use-form-values';
import { useWatchFormChange } from '../../hooks/use-watch-form-change';
import { INextOperatorForm } from '../../interface';
import { FormWrapper } from '../components/form-wrapper';
import { PromptEditor } from '../components/prompt-editor';

const FormSchema = z.object({
  llm_id: z.string(),
  prompts: z.string(),
  max_steps: z.coerce.number().min(1),
  headless: z.boolean(),
  enable_default_extensions: z.boolean(),
  chromium_sandbox: z.boolean(),
  persist_session: z.boolean(),
  upload_sources: z.string().optional(),
});

type FormSchemaType = z.infer<typeof FormSchema>;

function BrowserForm({ node }: INextOperatorForm) {
  const { t } = useTranslation();
  const defaultValues = useFormValues(initialBrowserValues, node);
  const form = useForm<FormSchemaType>({
    defaultValues,
    resolver: zodResolver(FormSchema),
    mode: 'onChange',
  });

  useWatchFormChange(node?.id, form);

  return (
    <Form {...form}>
      <FormWrapper>
        <IntellectFormItem label={t('chat.model')} name="llm_id">
          <NextLLMSelect></NextLLMSelect>
        </IntellectFormItem>
        <IntellectFormItem label={t('flow.userPrompt')} name="prompts">
          <PromptEditor showToolbar={true}></PromptEditor>
        </IntellectFormItem>
        <IntellectFormItem label={t('flow.maxSteps')} name="max_steps">
          {(field) => <NumberInput min={1} {...field}></NumberInput>}
        </IntellectFormItem>
        <IntellectFormItem label={t('flow.headless')} name="headless">
          {(field) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
            ></Switch>
          )}
        </IntellectFormItem>
        <IntellectFormItem
          label={t('flow.enableDefaultExtensions')}
          tooltip={t('flow.enableDefaultExtensionsTip')}
          name="enable_default_extensions"
        >
          {(field) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
            ></Switch>
          )}
        </IntellectFormItem>
        <IntellectFormItem
          label={t('flow.chromiumSandbox')}
          tooltip={t('flow.chromiumSandboxTip')}
          name="chromium_sandbox"
        >
          {(field) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
            ></Switch>
          )}
        </IntellectFormItem>
        <IntellectFormItem
          label={t('flow.persistSession')}
          tooltip={t('flow.persistSessionTip')}
          name="persist_session"
        >
          {(field) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
            ></Switch>
          )}
        </IntellectFormItem>
        <IntellectFormItem
          label={t('flow.uploadSources')}
          tooltip={t('flow.uploadSourcesTip')}
          name="upload_sources"
        >
          {(field) => (
            <PromptEditor
              {...field}
              showToolbar
              multiLine={false}
              placeholder="file_id,https://example.com/a.pdf,{node@files.0.id}"
            ></PromptEditor>
          )}
        </IntellectFormItem>
      </FormWrapper>
    </Form>
  );
}

export default memo(BrowserForm);
