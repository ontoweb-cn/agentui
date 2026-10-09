// Multi-Harness P2 (US2):useHarnessCapabilities hook。
// Constitution Principle I + II + V + VIII (Progressive Enhancement)。
// 用 TanStack Query 查询当前 tenant 绑定后端的能力,供前端条件渲染。
//
// 注意:tenantId 不得依赖 useFetchTenantInfo(/proxy/v1/users/me/models,
// RAG 依赖接口)——租户解析不到 intellect-rag 时该接口 503,会造成
// "能力查询依赖被门控接口"的循环依赖,能力永不加载。故 tenantId 取
// localStorage 的 BackendId(缺省 '0'),userId 走 /auth/me(bffAuth 安全通道)。

import { useQuery } from '@tanstack/react-query';
import { useFetchUserInfo } from './use-user-setting-request';
import { fetchHarnessCapabilities } from '@/services/harness-admin-service';
import type { CapabilitiesResponse } from '@/services/harness-admin-service';
import { BackendId } from '@/constants/authorization';

export const HarnessCapabilitiesQueryKey = 'harness-capabilities';

export type CapabilityName = keyof CapabilitiesResponse['capabilities'];

/**
 * 查询当前 tenant 绑定后端的能力。
 *
 * 行为:
 * - userId 未就绪(未登录/会话探测中)时 enabled=false,不发请求
 * - tenantId 变化时自动重新查询
 * - BFF 侧保证:租户解析不到 intellect-rag 后端时,RAG 依赖能力显式为 false
 */
export function useHarnessCapabilities(): {
  data?: CapabilitiesResponse;
  isLoading: boolean;
  error?: Error;
  refetch: () => void;
} {
  const { data: userInfo } = useFetchUserInfo();

  // userId 从用户中心取(/auth/me);tenantId 取后端切换器选择(缺省 '0')
  const tenantId = localStorage.getItem(BackendId) || '0';
  const userId = (userInfo as { id?: string } | undefined)?.id;

  const { data, isLoading, error, refetch } = useQuery<
    CapabilitiesResponse,
    Error
  >({
    queryKey: [HarnessCapabilitiesQueryKey, tenantId, userId],
    enabled: !!userId,
    gcTime: 5 * 60 * 1000, // 5 分钟缓存,避免频繁查询
    retry: 1, // 失败重试 1 次(避免短暂不可用导致的体验问题)
    queryFn: async () => {
      // 显式带 X-Backend-Id / X-User-Id header(US2 必需)
      const { data: res } = await fetchHarnessCapabilities({
        'X-Backend-Id': tenantId,
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
 * 能力开关判断:fail-closed。
 *
 * 仅当能力接口已加载且字段显式为 true 时返回 true;
 * 加载中/失败/未登录/字段缺失一律 false——由 BFF 保证"检测不到
 * intellect-rag → RAG 依赖能力为 false",前端据此隐藏功能并跳过
 * 必然失败的调用(避免 503 toast)。
 */
export function useIsCapabilityEnabled(cap: CapabilityName): boolean {
  const { data } = useHarnessCapabilities();
  return data?.capabilities?.[cap] === true;
}
