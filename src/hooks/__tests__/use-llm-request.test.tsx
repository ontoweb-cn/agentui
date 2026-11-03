// 模型管理 hooks 错误态与 401 诚实化(P1-a)
// docs/model-provider-empty-models-fix-design.md §8.2

import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

jest.mock('@/services/llm-service', () => ({
  __esModule: true,
  default: {
    listProviders: jest.fn(),
    listAllAddedModels: jest.fn(),
    listDefaultModels: jest.fn(),
    addProvider: jest.fn(),
    addProviderInstance: jest.fn(),
    addInstanceModel: jest.fn(),
    editInstanceModel: jest.fn(),
    deleteProviderInstance: jest.fn(),
    updateModelStatus: jest.fn(),
    setDefaultModel: jest.fn(),
    showProviderInstance: jest.fn(),
    listProviderInstances: jest.fn(),
    listInstanceModels: jest.fn(),
    verifyProviderConnection: jest.fn(),
    listProviderModels: jest.fn(),
  },
}));

jest.mock('@/hooks/use-harness-capabilities', () => ({
  useIsCapabilityEnabled: jest.fn(() => true),
}));

jest.mock('@/components/ui/message', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/locales/config', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
  DEFAULT_LANGUAGE_CODE: 'English',
  supportedLanguages: [],
}));

import message from '@/components/ui/message';
import llmService from '@/services/llm-service';
import {
  useFetchAvailableProviders,
  useSetDefaultModel,
} from '../use-llm-request';

const mockedMessage = message as unknown as {
  error: jest.Mock;
  success: jest.Mock;
};

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useFetchAvailableProviders 错误态', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('非零 code 信封抛错:isError 为真,data 保持 initialData []', async () => {
    (llmService.listProviders as jest.Mock).mockResolvedValue({
      data: { code: 401, data: null, message: '<Unauthorized>' },
    });

    const { result } = renderHook(() => useFetchAvailableProviders(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('code:0 信封正常返回 data,isError 为假', async () => {
    (llmService.listProviders as jest.Mock).mockResolvedValue({
      data: { code: 0, data: [{ name: 'Tongyi-Qianwen' }] },
    });

    const { result } = renderHook(() => useFetchAvailableProviders(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(result.current.data).toEqual([{ name: 'Tongyi-Qianwen' }]),
    );
    expect(result.current.isError).toBe(false);
  });
});

describe('useSetDefaultModel 401 诚实化', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('code:401 时弹 message.error 且 mutation 正常返回不抛异常', async () => {
    (llmService.setDefaultModel as jest.Mock).mockResolvedValue({
      data: { code: 401, data: null, message: 'upstream boom' },
    });

    const { result } = renderHook(() => useSetDefaultModel(), {
      wrapper: makeWrapper(),
    });

    let mutationResult: { code?: number } | undefined;
    await act(async () => {
      mutationResult = await result.current.setDefaultModel({
        model_provider: 'p',
        model_instance: 'i',
        model_type: 'chat',
        model_name: 'm',
      });
    });

    expect(mockedMessage.error).toHaveBeenCalledWith('upstream boom');
    expect(mutationResult?.code).toBe(401);
  });

  it('code:401 且无 message 时回退通用文案', async () => {
    (llmService.setDefaultModel as jest.Mock).mockResolvedValue({
      data: { code: 401, data: null },
    });

    const { result } = renderHook(() => useSetDefaultModel(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.setDefaultModel({
        model_provider: 'p',
        model_instance: 'i',
        model_type: 'chat',
        model_name: 'm',
      });
    });

    expect(mockedMessage.error).toHaveBeenCalledWith('message.401');
  });

  it('code:0 时弹 success,不触发 error', async () => {
    (llmService.setDefaultModel as jest.Mock).mockResolvedValue({
      data: { code: 0, data: null },
    });

    const { result } = renderHook(() => useSetDefaultModel(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.setDefaultModel({
        model_provider: 'p',
        model_instance: 'i',
        model_type: 'chat',
        model_name: 'm',
      });
    });

    expect(mockedMessage.success).toHaveBeenCalled();
    expect(mockedMessage.error).not.toHaveBeenCalled();
  });
});
