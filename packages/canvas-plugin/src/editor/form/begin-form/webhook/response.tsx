import { Collapse } from '@/components/collapse';
import { SelectWithSearch } from '@/components/originui/select-with-search';
import { IntellectFormItem } from '@/components/intellect-form';
import { Textarea } from '@/components/ui/textarea';
import { WebHookResponseStatusFormField } from '@/components/webhook-response-status';
import { WebhookExecutionMode } from '@agentui/canvas-plugin/editor/constant';
import { buildOptions } from '@/utils/form';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

export function WebhookResponse() {
  const { t } = useTranslation();

  const form = useFormContext();

  const executionMode = useWatch({
    control: form.control,
    name: 'execution_mode',
  });

  return (
    <Collapse title={<div>Response</div>}>
      <section className="space-y-4">
        <IntellectFormItem
          name="execution_mode"
          label={t('flow.webhook.executionMode')}
          tooltip={t('flow.webhook.executionModeTip')}
        >
          <SelectWithSearch
            options={buildOptions(WebhookExecutionMode, t, 'flow.webhook')}
          ></SelectWithSearch>
        </IntellectFormItem>
        {executionMode === WebhookExecutionMode.Immediately && (
          <>
            <WebHookResponseStatusFormField
              name={'response.status'}
            ></WebHookResponseStatusFormField>
            {/* <DynamicResponse
              name="response.headers_template"
              label={t('flow.webhook.headersTemplate')}
            ></DynamicResponse> */}
            {/* <DynamicResponse
              name="response.body_template"
              label={t('flow.webhook.bodyTemplate')}
            ></DynamicResponse> */}
            <IntellectFormItem
              name="response.body_template"
              label={t('flow.webhook.bodyTemplate')}
            >
              <Textarea className="overflow-auto"></Textarea>
            </IntellectFormItem>
          </>
        )}
      </section>
    </Collapse>
  );
}
