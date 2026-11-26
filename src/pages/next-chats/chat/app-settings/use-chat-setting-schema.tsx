import {
  LlmSettingEnabledSchema,
  LlmSettingFieldSchema,
} from '@/components/llm-setting-items/next';
import { MetadataFilterSchema } from '@/components/metadata-filter';
import { rerankFormSchema } from '@/components/rerank';
import {
  similarityThresholdSchema,
  vectorSimilarityWeightSchema,
} from '@/components/similarity-slider';
import { topnSchema } from '@/components/top-n-item';
import { useTranslate } from '@/hooks/common-hooks';
import { WebSearchProvider } from '@/constants/chat';
import { useMemo } from 'react';
import { z, ZodIssueCode } from 'zod';
import { missingWebSearchApiKeyField } from '../web-search-api-key';
import { chatPromptKbIssues } from './validate-chat-prompt';

// Pure builder so the schema can be unit-tested without rendering a form
// (upstream pattern; T2.3). agentui 字段差异(相对上游):保留 tts/use_kg/
// reference_metadata/toc_enhance,使用 vectorSimilarityWeightSchema,无
// agentic_rag/decision_id/rerank-candidates(agentui 无对应组件)。
export function buildChatSettingFormSchema(
  t: (key: string) => string,
  configuredProviders: Iterable<string> = [],
) {
  const promptConfigSchema = z.object({
    quote: z.boolean(),
    keyword: z.boolean(),
    tts: z.boolean(),
    empty_response: z.string().optional(),
    prologue: z.string().optional(),
    system: z.string().min(1, { message: t('systemMessage') }),
    refine_multiturn: z.boolean(),
    use_kg: z.boolean(),
    parameters: z
      .array(
        z.object({
          key: z.string().min(1, { message: t('variableKeyMessage') }),
          optional: z.boolean(),
        }),
      )
      .optional(),
    tavily_api_key: z.string().optional(),
    anysearch_api_key: z.string().optional(),
    brave_api_key: z.string().optional(),
    exa_api_key: z.string().optional(),
    firecrawl_api_key: z.string().optional(),
    keirolabs_api_key: z.string().optional(),
    linkup_api_key: z.string().optional(),
    parallel_api_key: z.string().optional(),
    perplexity_api_key: z.string().optional(),
    querit_api_key: z.string().optional(),
    search1api_api_key: z.string().optional(),
    searchapi_api_key: z.string().optional(),
    serply_api_key: z.string().optional(),
    youcom_api_key: z.string().optional(),
    web_search_provider: z
      .enum([
        WebSearchProvider.AnySearch,
        WebSearchProvider.Brave,
        WebSearchProvider.Exa,
        WebSearchProvider.Firecrawl,
        WebSearchProvider.Keirolabs,
        WebSearchProvider.Linkup,
        WebSearchProvider.Parallel,
        WebSearchProvider.Perplexity,
        WebSearchProvider.Querit,
        WebSearchProvider.Search1API,
        WebSearchProvider.SearchApi,
        WebSearchProvider.Serply,
        WebSearchProvider.Tavily,
        WebSearchProvider.YouCom,
      ])
      .optional()
      .or(z.literal('')),
    reasoning: z.boolean().optional(),
    cross_languages: z.array(z.string()).optional(),
    toc_enhance: z.boolean().optional(),
    reference_metadata: z
      .object({
        include: z.boolean().optional(),
        fields: z.array(z.string()).optional(),
      })
      .optional(),
  });

  const formSchema = z
    .object({
      name: z.string().min(1, { message: t('assistantNameMessage') }),
      icon: z.string(),
      description: z.string().optional(),
      dataset_ids: z.array(z.string()).min(0, {
        message: t('knowledgeBasesMessage'),
      }),
      prompt_config: promptConfigSchema,
      ...rerankFormSchema,
      llm_setting: z.object(LlmSettingFieldSchema),
      ...LlmSettingEnabledSchema,
      llm_id: z.string().optional(),
      ...vectorSimilarityWeightSchema,
      ...similarityThresholdSchema,
      ...topnSchema,
      ...MetadataFilterSchema,
    })
    .superRefine((value, ctx) => {
      // Upstream parity (T2.9): KB-bound prompts must keep the {knowledge}
      // placeholder and empty_response requires at least one dataset. See
      // validate-chat-prompt.ts for the rules and the decision record.
      for (const issue of chatPromptKbIssues(value, t)) {
        ctx.addIssue({
          code: ZodIssueCode.custom,
          path: issue.path,
          message: issue.message,
        });
      }

      // A keyed provider selected without its key fails SILENTLY at runtime —
      // the Internet switch never appears in the chat box — so block the save
      // here instead. Keyless providers are exempt. The rule lives in
      // missingWebSearchApiKeyField so it can be unit-tested without the form.
      const missingKeyField = missingWebSearchApiKeyField(
        value?.prompt_config,
        configuredProviders,
      );
      if (missingKeyField) {
        ctx.addIssue({
          code: ZodIssueCode.custom,
          path: ['prompt_config', missingKeyField],
          message: t('webSearchApiKeyRequired'),
        });
      }
    });

  return formSchema;
}

export function useChatSettingSchema(
  configuredProviders: Iterable<string> = [],
) {
  const { t } = useTranslate('chat');
  const configuredKey = Array.from(new Set(configuredProviders)).sort().join(',');

  return useMemo(
    () =>
      buildChatSettingFormSchema(
        (key: string) => t(key),
        configuredKey ? configuredKey.split(',') : [],
      ),
    [t, configuredKey],
  );
}
