// useFetchTenantInfo 对 {code:0, data:null} 信封的 null 守卫(P1-a)
// docs/model-provider-empty-models-fix-design.md §5.4 / §8.2

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

jest.mock('@/services/user-service', () => ({
  __esModule: true,
  default: { getTenantInfo: jest.fn() },
  addTenantUser: jest.fn(),
  agreeTenant: jest.fn(),
  deleteTenantUser: jest.fn(),
  listTenant: jest.fn(),
  listTenantUser: jest.fn(),
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

jest.mock('../use-warn-empty-model', () => ({
  useWarnEmptyModel: jest.fn(),
}));

import userService from '@/services/user-service';
import { useFetchTenantInfo } from '../use-user-setting-request';

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

describe('useFetchTenantInfo null 守卫', () => {
  it('code:0 + data:null(上游 401 被 BFF 改写)不抛异常', async () => {
    (userService.getTenantInfo as jest.Mock).mockResolvedValue({
      data: { code: 0, data: null },
    });

    const { result } = renderHook(() => useFetchTenantInfo(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    // 抛错时 react-query 会回落 initialData {},只有不抛才返回原信封
    expect(result.current.data).toEqual({ code: 0, data: null });
  });

  it('code:0 + 有 data 时照常展开 chat_id/speech2text_id', async () => {
    (userService.getTenantInfo as jest.Mock).mockResolvedValue({
      data: { code: 0, data: { llm_id: 'l1', asr_id: 'a1' } },
    });

    const { result } = renderHook(() => useFetchTenantInfo(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toMatchObject({
      llm_id: 'l1',
      asr_id: 'a1',
      chat_id: 'l1',
      speech2text_id: 'a1',
    });
  });
});
