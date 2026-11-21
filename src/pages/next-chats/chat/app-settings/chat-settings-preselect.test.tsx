/**
 * TC-RP1-06(T2.1 验收):legacy 对话(仅存 tavily_api_key)打开设置页时
 * Tavily 预选且 Key 字段回填;显式清除/新对话不预选。
 *
 * 夹具引用稳定(fixture 常量)——useFetchChat 每次渲染返回新对象会让
 * chat-settings 的 useEffect([data, form]) 无限触发 form.reset。
 * 真浏览器走查 = TC-RP1-10(受限项 L-RP1-01)。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatSettings } from './chat-settings';

const scrollIntoViewMock = jest.fn();

const legacyTavilyChat = {
  id: 'e2e-chat-legacy',
  name: 'e2e legacy tavily chat',
  description: '',
  icon: '',
  dataset_ids: [],
  prompt_config: {
    quote: true,
    keyword: false,
    tts: false,
    use_kg: false,
    refine_multiturn: true,
    system: 'Answer using {knowledge}',
    parameters: [],
    tavily_api_key: 'tvly-e2e-legacy',
  },
  llm_setting: {},
  similarity_threshold: 0.2,
  vector_similarity_weight: 0.2,
  top_n: 8,
  meta_data_filter: { method: 'disabled', manual: [] },
  prompt_type: 'simple',
  status: 'VALID',
  tenant_id: '',
};

const clearedProviderChat = {
  ...legacyTavilyChat,
  id: 'e2e-chat-cleared',
  prompt_config: {
    ...legacyTavilyChat.prompt_config,
    tavily_api_key: 'tvly-e2e-legacy',
    web_search_provider: '',
    anysearch_api_key: 'retained-key',
  },
};

const newChat = {
  ...legacyTavilyChat,
  id: 'e2e-chat-new',
  name: 'e2e new chat',
  prompt_config: {
    quote: true,
    keyword: false,
    tts: false,
    use_kg: false,
    refine_multiturn: true,
    system: 'Answer using {knowledge}',
    parameters: [],
  },
};

const currentChat = { current: legacyTavilyChat };

function setCurrentChat(chat: typeof legacyTavilyChat) {
  currentChat.current = chat;
}

jest.mock('@/hooks/use-chat-request', () => {
  // 工厂自包含(jest.mock 提升,不可引用后置 const):内部 current 由
  // __setCurrent 在用例中切换,模拟 useFetchChat 返回的稳定 data 引用。
  let current: unknown;
  return {
    __setCurrentChat: (chat: unknown) => {
      current = chat;
    },
    useFetchChat: () => ({
      data: current,
      loading: false,
      refetch: jest.fn(),
    }),
    useUpdateChat: () => ({
      data: undefined,
      loading: false,
      updateChat: jest.fn(),
    }),
  };
});

jest.mock('react-router', () => ({
  ...jest.requireActual('react-router'),
  useParams: () => ({ id: 'e2e-chat' }),
}));

jest.mock('@/hooks/use-llm-request', () => ({
  useFindLlmByUuid: () => () => undefined,
}));

jest.mock('@/hooks/use-harness-capabilities', () => ({
  useIsCapabilityEnabled: () => false,
}));

jest.mock('@/hooks/use-knowledge-request', () => ({
  useFetchKnowledgeMetadataKeys: () => ({ data: [], loading: false }),
}));

jest.mock('@/components/avatar-name-description', () => ({
  AvatarNameDescription: () => null,
}));

jest.mock('@/components/llm-setting-items/next', () => ({
  LlmSettingEnabledSchema: {},
  LlmSettingFieldSchema: {},
  LlmSettingFieldItems: () => null,
}));

jest.mock('@/components/rerank', () => ({
  rerankFormSchema: {},
  RerankFormFields: () => null,
}));

jest.mock('@/components/similarity-slider', () => ({
  similarityThresholdSchema: {},
  vectorSimilarityWeightSchema: {},
  SimilaritySliderFormField: () => null,
}));

jest.mock('@/components/top-n-item', () => ({
  topnSchema: {},
  TopNFormField: () => null,
}));

jest.mock('@/components/metadata-filter', () => ({
  MetadataFilterSchema: {},
  MetadataFilter: () => null,
}));

jest.mock('@/components/cross-language-form-field', () => ({
  CrossLanguageFormField: () => null,
}));

jest.mock('@/components/toc-enhance-form-field', () => ({
  TOCEnhanceFormField: () => null,
}));

jest.mock('@/components/use-knowledge-graph-item', () => ({
  UseKnowledgeGraphFormField: () => null,
}));

jest.mock('./dynamic-variable', () => ({
  DynamicVariableForm: () => null,
}));

beforeAll(() => {
  const globalObj = globalThis as Record<string, unknown>;
  globalObj.ResizeObserver =
    globalObj.ResizeObserver ??
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

const chatRequestMock = jest.requireMock('@/hooks/use-chat-request') as {
  __setCurrentChat: (chat: unknown) => void;
};

beforeEach(() => {
  scrollIntoViewMock.mockClear();
  setCurrentChat(legacyTavilyChat);
  chatRequestMock.__setCurrentChat(currentChat.current);
});

function renderSettings() {
  return render(
    <TooltipProvider>
      <ChatSettings visible switchVisible={jest.fn()} />
    </TooltipProvider>,
  );
}

// web-search 字段在默认折叠的"高级设置"面板内:先点开(radix trigger 的
// data-state 由 closed 变 open),再断言面板内内容。
async function openAdvancedPanel(container: HTMLElement) {
  const trigger = container.querySelector('button[data-state="closed"]');
  expect(trigger).not.toBeNull();
  fireEvent.click(trigger as HTMLElement);
  await waitFor(() => {
    expect(
      container.querySelector('button[data-state="open"]'),
    ).not.toBeNull();
  });
}

describe('ChatSettings legacy provider preselect (T2.1)', () => {
  it('preselects Tavily with its key field for a legacy dialog', async () => {
    const { container } = renderSettings();
    await openAdvancedPanel(container);

    // 预选生效的可见结果:Tavily 的 key 字段(标签"Tavily API Key")渲染
    await screen.findByText('Tavily API Key');
  });

  it('does not preselect for a new unconfigured dialog', async () => {
    setCurrentChat(newChat);
    chatRequestMock.__setCurrentChat(newChat);
    const { container } = renderSettings();
    await openAdvancedPanel(container);

    expect(screen.queryByText(/API Key/)).toBeNull();
  });

  it('does not preselect for an explicitly cleared provider', async () => {
    setCurrentChat(clearedProviderChat);
    chatRequestMock.__setCurrentChat(clearedProviderChat);
    const { container } = renderSettings();
    await openAdvancedPanel(container);

    expect(screen.queryByText(/API Key/)).toBeNull();
  });
});
