import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

jest.mock('@/services/features-service', () => ({
  __esModule: true,
  fetchFeatures: jest.fn(),
}));

import { fetchFeatures } from '@/services/features-service';
import { useFeatureFlags, useIsFeatureEnabled } from '../use-feature-flags';

const mockFetchFeatures = fetchFeatures as jest.MockedFunction<
  typeof fetchFeatures
>;

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

function envelope(enabled: boolean) {
  return {
    data: {
      code: 0,
      message: 'success',
      data: { features: { 'intellect-auth': enabled } },
    },
  } as Awaited<ReturnType<typeof fetchFeatures>>;
}

describe('useFeatureFlags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('能力显式 true 时放行', async () => {
    mockFetchFeatures.mockResolvedValue(envelope(true));
    const { result } = renderHook(() => useIsFeatureEnabled('intellect-auth'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('缺省/失败一律 false（fail-closed）', async () => {
    mockFetchFeatures.mockResolvedValue(envelope(false));
    const { result } = renderHook(() => useFeatureFlags(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(result.current.features?.['intellect-auth']).toBe(false),
    );
  });
});
