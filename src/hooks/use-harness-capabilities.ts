// Multi-Harness P2 (US2):useHarnessCapabilities hook。
// Constitution Principle I + II + V + VIII (Progressive Enhancement)。
// 用 TanStack Query 查询当前 tenant 绑定后端的能力,供前端条件渲染。
// tenantId 变化 → queryKey 变化 → 自动重新查询。

import { useQuery } from '@tanstack/react-query';
import { useFetchTenantInfo, useFetchUserInfo } from './use-user-setting-request';
import { fetchHarnessCapabilities } from '@/services/harness-admin-service';
import type { CapabilitiesResponse } from '@/services/harness-admin-service';

export const HarnessCapabilitiesQueryKey = 'harness-capabilities';

/**
 * 查询当前 tenant 绑定后端的能力。
 *
 * 行为:
 * - tenantId/userId 未就绪时 enabled=false,不发请求
 * - tenantId 变化时自动重新查询
 * - 失败时降级:返回 undefined,前端按"无能力"渲染(Progressive Enhancement)
 *
 * @returns { data, isLoading, error, refetch }
 */
export function useHarnessCapabilities(): {
  data?: CapabilitiesResponse;
  isLoading: boolean;
  error?: Error;
  refetch: () => void;
} {
  const { data: userInfo } = useFetchUserInfo();
  const { data: tenantInfo } = useFetchTenantInfo();

  // tenantId/userId 从用户中心取(P1 简化方案,与现有前端一致)
  const tenantId = (tenantInfo as { tenant_id?: string })?.tenant_id;
  const userId = (userInfo as { id?: string })?.id;

  const { data, isLoading, error, refetch } = useQuery<
    CapabilitiesResponse,
    Error
  >({
    queryKey: [HarnessCapabilitiesQueryKey, tenantId, userId],
    enabled: !!tenantId && !!userId,
    gcTime: 5 * 60 * 1000, // 5 分钟缓存,避免频繁查询
    retry: 1, // 失败重试 1 次(避免 503 短暂不可用导致的体验问题)
    queryFn: async () => {
      // 显式带 X-Backend-Id / X-User-Id header(US2 必需)
      const { data: res } = await fetchHarnessCapabilities({
        'X-Backend-Id': tenantId as string,
        'X-User-Id': userId as string,
      });
      if (res?.code !== 0) {
        throw new Error(res?.message ?? 'Failed to fetch capabilities');
      }
      return res.data;
    },
  });

  return { data, isLoading, error: error ?? undefined, refetch };
}

/**
 * 默认能力(全部 true)用于降级或加载中。
 * 不假设能力,前端必须显式处理 undefined。
 */
export const DEFAULT_CAPABILITIES = {
  canvas: true,
  knowledgeBase: true,
  memory: true,
  mcp: true,
  multiTenant: false,
  modelManagement: false,
} as const;
