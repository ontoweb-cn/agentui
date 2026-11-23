/**
 * TC-RP1-05(组件级,T2.8 验收):无效保存 → 高级设置面板自动展开、
 * FormMessage 可见、scrollIntoView 定位首个错误字段。
 *
 * jsdom 无布局:滚动为原型 mock 断言;真浏览器视觉走查 = TC-RP1-10(受限项
 * L-RP1-01)。展示型字段(rerank/相似度/TopN/跨语言/TOC/知识图谱/元数据过滤/
 * 动态变量/头像名描述/LLM 设置)mock 掉,表单原语与 WebSearchFormField 保持真实。
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatSettings } from './chat-settings';

const scrollIntoViewMock = jest.fn();

// 稳定引用:useFetchChat 每次渲染返回新对象会让 chat-settings 的
// useEffect([data, form]) 无限触发 form.reset(真实场景 react-query 缓存
// 引用稳定),jsdom 下表现为测试挂起。
const fixtureChat = {
  id: 'e2e-chat-1',
  name: 'e2e reveal chat',
  description: '',
  icon: '',
  dataset_ids: [],
  prompt_config: {
    quote: true,
    keyword: false,
    tts: false,
    use_kg: false,
    refine_multiturn: true,
    system: '',
    parameters: [],
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

jest.mock('react-router', () => ({
  ...jest.requireActual('react-router'),
  useParams: () => ({ id: 'e2e-chat-1' }),
}));

jest.mock('@/hooks/use-chat-request', () => ({
  useFetchChat: () => ({
    data: fixtureChat,
    loading: false,
    refetch: jest.fn(),
  }),
  useUpdateChat: () => ({
    data: undefined,
    loading: false,
    updateChat: jest.fn(),
  }),
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
  // jsdom 无 ResizeObserver(radix use-size/ScrollArea 依赖)
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

beforeEach(() => {
  scrollIntoViewMock.mockClear();
});

describe('ChatSettings invalid-submit reveal (T2.8)', () => {
  it('keeps the advanced panel collapsed before an invalid submit', () => {
    const { container } = render(
      <TooltipProvider>
        <ChatSettings visible switchVisible={jest.fn()} />
      </TooltipProvider>,
    );

    expect(
      container.querySelector('[id$="-form-item-message"]'),
    ).toBeNull();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('expands the advanced panel and scrolls to the first error on invalid submit', async () => {
    const { container } = render(
      <TooltipProvider>
        <ChatSettings visible switchVisible={jest.fn()} />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByTestId('chat-settings-save'));

    await waitFor(() => {
      // system 提示词为空 → 校验失败的 FormMessage 在展开后的面板内可见
      expect(
        container.querySelector('[id$="-form-item-message"]'),
      ).not.toBeNull();
    });
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
    // Radix Select 挂载时也会自带一次 {block:'nearest'} 的内部滚动,次数断言
    // 在集成语境下不可用;精确断言 smooth/center 的那次调用目标是错误消息段。
    const revealCallIndex = scrollIntoViewMock.mock.calls.findIndex(
      (call) =>
        (call[0] as { behavior?: string } | undefined)?.behavior === 'smooth',
    );
    expect(revealCallIndex).toBeGreaterThanOrEqual(0);
    const revealed = scrollIntoViewMock.mock.instances[
      revealCallIndex
    ] as HTMLElement;
    // 错误指示元素两类:FormControl(aria-invalid,id 后缀 -form-item)或
    // FormMessage 段落(-form-item-message)——DOM 序首个即 FormControl。
    expect(/-form-item(-message)?$/.test(revealed.id)).toBe(true);
  });
});
