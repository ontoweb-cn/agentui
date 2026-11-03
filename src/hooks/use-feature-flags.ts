/**
 * 系统级能力开关 hook（features）。
 *
 * 与 useHarnessCapabilities 不同：特征能力不依赖当前 harness 后端/租户，
 * 只依赖宿主会话。缺省 false；加载中/失败一律 false（fail-closed）。
 */

import { useQuery } from '@tanstack/react-query';
import {
  fetchFeatures,
  type FeaturesResponse,
} from '@/services/features-service';

export const FeaturesQueryKey = 'bff-features';

export type FeatureName = keyof FeaturesResponse['features'];

export function useFeatureFlags(): {
  features?: FeaturesResponse['features'];
  isLoading: boolean;
  error?: Error;
  refetch: () => void;
} {
  const { data, isLoading, error, refetch } = useQuery<
    FeaturesResponse,
    Error
  >({
    queryKey: [FeaturesQueryKey],
    gcTime: 5 * 60 * 1000,
    retry: 1,
    // 失败自愈：错误态每 15s 静默重发，覆盖 BFF 冷启动/瞬时网络失败。
    refetchInterval: (query) => (query.state.error ? 15_000 : false),
    queryFn: async () => {
      const res = await fetchFeatures();
      if (res?.data?.code !== 0) {
        throw new Error(res?.data?.message ?? 'Failed to fetch features');
      }
      return res.data.data;
    },
  });

  return { features: data?.features, isLoading, error: error ?? undefined, refetch };
}

/** 能力开关判断：仅显式 true 放行。 */
export function useIsFeatureEnabled(feature: FeatureName): boolean {
  const { features } = useFeatureFlags();
  return features?.[feature] === true;
}
