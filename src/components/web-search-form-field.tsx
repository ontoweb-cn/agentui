/**
 * Provenance(ported from upstream RAGFlow web/, base 91c702e):
 * 结构性适配点——shadcn 表单原语(FormItem/FormMessage)+ agentui 语言键约定;
 * 上游每次演进本文件需手工重适配(见 docs/ragflow-ui-improvement-recommendations.md 同步漂移面)。
 * T2.2:provider 目录/键名/语言键收敛至 web-search-catalog.ts + 枚举派生单一来源,
 * 本文件只做 UI 组装。
 */
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import PasswordInput from '@/components/originui/password-input';
import { SelectWithSearch } from '@/components/originui/select-with-search';
import { WebSearchProvider } from '@/constants/chat';
import { useTranslate } from '@/hooks/common-hooks';
import {
  isWebSearchApiKeyRequired,
  webSearchProviderBaseKey,
} from '@/pages/next-chats/chat/web-search-api-key';
import {
  getWebSearchProviderCatalogEntry,
  webSearchProviderCatalog,
  webSearchProviderPlaceholderKey,
  webSearchProviderTipKey,
} from '@/pages/next-chats/chat/web-search-catalog';
import { prefixName } from '@/utils/form';
import { useFormContext, useWatch } from 'react-hook-form';

interface IProps {
  prefix?: string;
}

const providerOptions = webSearchProviderCatalog
  .slice()
  .sort((left, right) => left.name.localeCompare(right.name))
  .map(({ name, logo, value }) => ({
    label: (
      <span className="flex items-center gap-2">
        <img
          src={logo}
          alt=""
          aria-hidden="true"
          className="size-4 shrink-0 object-contain"
        />
        {name}
      </span>
    ),
    // The dropdown filters on value + keywords, so the shown name has to be
    // searchable too: typing "You.com" must find the "youcom" entry.
    keywords: [name],
    value,
  }));

export function WebSearchFormField({ prefix = '' }: IProps) {
  const form = useFormContext();
  const { t } = useTranslate('chat');
  const providerName = prefixName(prefix, 'prompt_config.web_search_provider');
  const selectedProvider = useWatch({
    control: form.control,
    name: providerName,
  }) as WebSearchProvider | undefined;
  const entry = getWebSearchProviderCatalogEntry(selectedProvider);
  // Leaving the key blank on a provider that needs one is a SILENT failure: the
  // chat box simply never offers the Internet switch. Mark the field required
  // so the asterisk says so before the user has to discover it.
  const keyRequired = isWebSearchApiKeyRequired(selectedProvider);
  const keyFieldName = entry
    ? `prompt_config.${webSearchProviderBaseKey(entry.value)}_api_key`
    : undefined;

  return (
    <>
      <FormField
        control={form.control}
        name={providerName}
        render={({ field }) => (
          <FormItem>
            <FormLabel tooltip={t('webSearchProviderTip')}>
              {t('webSearchProvider')}
            </FormLabel>
            <FormControl>
              <SelectWithSearch
                value={field.value}
                onChange={field.onChange}
                options={providerOptions}
                placeholder={t('webSearchProviderPlaceholder')}
                allowClear
                testId="web-search-provider"
                optionTestIdPrefix="web-search-provider-option"
              />
            </FormControl>
          </FormItem>
        )}
      />
      {entry && keyFieldName && (
        <FormField
          key={entry.value}
          control={form.control}
          name={prefixName(prefix, keyFieldName)}
          rules={{
            validate: (value) =>
              !keyRequired ||
              Boolean(String(value ?? '').trim()) ||
              t('webSearchApiKeyRequired'),
          }}
          render={({ field }) => (
            <FormItem>
              <FormLabel
                tooltip={t(webSearchProviderTipKey(entry.value))}
                required={keyRequired}
              >
                {t('webSearchApiKeyLabel', { provider: entry.name })}
              </FormLabel>
              <FormControl>
                <PasswordInput
                  {...field}
                  value={field.value ?? ''}
                  placeholder={t(webSearchProviderPlaceholderKey(entry.value))}
                  autoComplete="new-password"
                />
              </FormControl>
              <FormDescription>
                <a href={entry.helpUrl} target="_blank" rel="noreferrer">
                  {t('webSearchApiKeyHelp')}
                </a>
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </>
  );
}
