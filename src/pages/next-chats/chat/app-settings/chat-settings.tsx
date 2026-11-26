import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DatasetMetadata } from '@/constants/chat';
import { useFetchChat, useUpdateChat } from '@/hooks/use-chat-request';
import { useFindLlmByUuid } from '@/hooks/use-llm-request';
import { cn } from '@/lib/utils';
import {
  removeUselessFieldsFromValues,
  setLLMSettingEnabledValues,
} from '@/utils/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { isEmpty, omit } from 'lodash';
import { LucidePanelRightClose } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { z } from 'zod';
import { getWebSearchProvider } from '../web-search-api-key';
import ChatBasicSetting from './chat-basic-settings';
import { ChatPromptEngine } from './chat-prompt-engine';
import { SavingButton } from './saving-button';
import { useChatSettingSchema } from './use-chat-setting-schema';
import { useRevealSubmitErrors } from './use-reveal-submit-errors';

// 开合状态由页面层(chat/index.tsx)持有,齿轮 toggle 常驻 CardHeader
type ChatSettingsProps = { visible: boolean; switchVisible: () => void };

export function ChatSettings({
  visible,
  switchVisible,
}: ChatSettingsProps) {
  const { data } = useFetchChat();
  const formSchema = useChatSettingSchema(
    data.web_search_configured_providers ?? [],
  );
  const { updateChat, loading } = useUpdateChat();
  const findLlmByUuid = useFindLlmByUuid();
  const { id } = useParams();
  const { t } = useTranslation();

  // T2.8:无效提交时展开全部折叠分区并滚动到首个错误字段(上游模式)。
  const {
    formContainerRef,
    handleInvalidSubmit,
    advancedSettingOpen,
    onAdvancedSettingOpenChange,
  } = useRevealSubmitErrors();

  type FormSchemaType = z.infer<typeof formSchema>;

  const form = useForm<FormSchemaType>({
    resolver: zodResolver(formSchema),
    shouldUnregister: false,
    defaultValues: {
      name: '',
      icon: '',
      description: '',
      dataset_ids: [],
      prompt_config: {
        quote: true,
        keyword: false,
        tts: false,
        use_kg: false,
        refine_multiturn: true,
        system: '',
        parameters: [],
        reasoning: false,
        cross_languages: [],
        toc_enhance: false,
        reference_metadata: {
          include: false,
          fields: undefined,
        },
      },
      top_n: 8,
      similarity_threshold: 0.2,
      vector_similarity_weight: 0.2,
      top_k: 1024,
      meta_data_filter: {
        method: DatasetMetadata.Disabled,
        manual: [],
      },
    },
  });

  async function onSubmit(values: FormSchemaType) {
    const nextValues: Record<string, any> = removeUselessFieldsFromValues(
      values,
      'llm_setting.',
    );
    const referenceMetadata = nextValues?.prompt_config?.reference_metadata;
    if (
      referenceMetadata &&
      Array.isArray(referenceMetadata.fields) &&
      referenceMetadata.fields.length === 0
    ) {
      referenceMetadata.fields = undefined;
    }

    // Add model_type to llm_setting based on the selected llm_id
    if (nextValues.llm_id) {
      nextValues.llm_setting = {
        ...nextValues.llm_setting,
        model_type: findLlmByUuid(nextValues.llm_id)?.model_type || 'chat',
      };
    }

    // await 避免 mutateAsync 拒绝时出现未处理的 Promise rejection;
    // 失败 toast 由 next-request 全局 errorHandler 统一弹出。
    await updateChat({
      chatId: id!,
      params: {
        ...omit(data, [
          'operator_permission',
          'tenant_id',
          'created_by',
          'create_time',
          'create_date',
          'update_time',
          'update_date',
          'id',
        ]),
        ...nextValues,
      },
    });
  }

  function onInvalid() {
    handleInvalidSubmit();
  }

  useEffect(() => {
    const llmSettingEnabledValues = setLLMSettingEnabledValues(
      data.llm_setting,
    );
    const referenceMetadata = data?.prompt_config?.reference_metadata;
    const normalizedReferenceMetadata =
      referenceMetadata &&
      Array.isArray(referenceMetadata.fields) &&
      referenceMetadata.fields.length === 0
        ? { ...referenceMetadata, fields: undefined }
        : referenceMetadata;

    const nextData = {
      ...data,
      prompt_config: {
        ...data.prompt_config,
        reference_metadata: normalizedReferenceMetadata,
        // T2.1:legacy 对话(仅存 tavily_api_key,无 provider 字段)打开设置页
        // 时回显 Tavily 预选,与运行时联网开关(getWebSearchProvider 推断)对齐;
        // 显式 '' 是"用户清除",不得回落;新对话(undefined)归一为 ''。
        // 副作用(上游同款):legacy 对话保存会首次写入 web_search_provider: 'tavily'。
        web_search_provider: getWebSearchProvider(data.prompt_config) ?? '',
      },
      ...llmSettingEnabledValues,
    };

    if (!isEmpty(data)) {
      form.reset(nextData as FormSchemaType);
    }
  }, [data, form]);

  return (
    <section
      data-testid="chat-detail-settings"
      className={cn(
        'transition-[width] ease-out duration-300 flex-shrink-0 flex flex-col overflow-hidden',
        visible ? 'w-[440px]' : 'w-0',
      )}
    >
      {visible && (
        <>
          <div className="p-5 pb-2 flex justify-between items-center text-base">
            {t('chat.chatSetting')}

            <Button
              variant="transparent"
              size="icon-sm"
              className="border-0"
              onClick={switchVisible}
              data-testid="chat-detail-settings-close"
            >
              <LucidePanelRightClose
                className="size-4 cursor-pointer"
                onClick={switchVisible}
              />
            </Button>
          </div>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit, onInvalid)}
              className="flex-1 flex flex-col min-h-0"
            >
              <ScrollArea viewportClassName="[&>div]:!block">
                <div ref={formContainerRef}>
                  <section className="p-5 space-y-6 overflow-auto flex-1 min-h-0">
                    <ChatBasicSetting></ChatBasicSetting>
                    <ChatPromptEngine
                      advancedSettingOpen={advancedSettingOpen}
                      onAdvancedSettingOpenChange={
                        onAdvancedSettingOpenChange
                      }
                      configuredProviders={
                        data.web_search_configured_providers ?? []
                      }
                    ></ChatPromptEngine>
                  </section>
                </div>
              </ScrollArea>

              <div className="p-5 pt-4 space-x-5 text-right">
                <Button
                  variant={'outline'}
                  onClick={switchVisible}
                  data-testid="chat-detail-settings-cancel"
                >
                  {t('chat.cancel')}
                </Button>
                <SavingButton loading={loading}></SavingButton>
              </div>
            </form>
          </Form>
        </>
      )}
    </section>
  );
}
