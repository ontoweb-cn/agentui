import { SelectWithSearch } from '@/components/originui/select-with-search';
import { IntellectFormItem } from '@/components/intellect-form';
import { Input } from '@/components/ui/input';
import { WebhookJWTAlgorithmList } from '@agentui/canvas-plugin/constant';
import { WebhookSecurityAuthType } from '@agentui/canvas-plugin/editor/constant';
import { buildOptions } from '@/utils/form';
import { useCallback } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { DynamicStringForm } from '../../components/dynamic-string-form';

const AlgorithmOptions = buildOptions(WebhookJWTAlgorithmList);

export function Auth() {
  const { t } = useTranslation();
  const form = useFormContext();

  const authType = useWatch({
    name: 'security.auth_type',
    control: form.control,
  });

  const renderTokenAuth = useCallback(
    () => (
      <>
        <IntellectFormItem
          name="security.token.token_header"
          label={t('flow.webhook.tokenHeader')}
        >
          <Input></Input>
        </IntellectFormItem>
        <IntellectFormItem
          name="security.token.token_value"
          label={t('flow.webhook.tokenValue')}
        >
          <Input></Input>
        </IntellectFormItem>
      </>
    ),
    [t],
  );

  const renderBasicAuth = useCallback(
    () => (
      <>
        <IntellectFormItem
          name="security.basic_auth.username"
          label={t('flow.webhook.username')}
        >
          <Input></Input>
        </IntellectFormItem>
        <IntellectFormItem
          name="security.basic_auth.password"
          label={t('flow.webhook.password')}
        >
          <Input></Input>
        </IntellectFormItem>
      </>
    ),
    [t],
  );

  const renderJwtAuth = useCallback(
    () => (
      <>
        <IntellectFormItem
          name="security.jwt.algorithm"
          label={t('flow.webhook.algorithm')}
        >
          <SelectWithSearch options={AlgorithmOptions}></SelectWithSearch>
        </IntellectFormItem>
        <IntellectFormItem
          name="security.jwt.secret"
          label={t('flow.webhook.secret')}
        >
          <Input></Input>
        </IntellectFormItem>
        <IntellectFormItem
          name="security.jwt.issuer"
          label={t('flow.webhook.issuer')}
        >
          <Input></Input>
        </IntellectFormItem>
        <IntellectFormItem
          name="security.jwt.audience"
          label={t('flow.webhook.audience')}
        >
          <Input></Input>
        </IntellectFormItem>
        <DynamicStringForm
          name="security.jwt.required_claims"
          label={t('flow.webhook.requiredClaims')}
        ></DynamicStringForm>
      </>
    ),
    [t],
  );

  const AuthMap = {
    [WebhookSecurityAuthType.Token]: renderTokenAuth,
    [WebhookSecurityAuthType.Basic]: renderBasicAuth,
    [WebhookSecurityAuthType.Jwt]: renderJwtAuth,
    [WebhookSecurityAuthType.None]: () => null,
  };

  return (
    <div key={`auth-${authType}`} className="space-y-5">
      {AuthMap[
        (authType ?? WebhookSecurityAuthType.None) as WebhookSecurityAuthType
      ]()}
    </div>
  );
}
