// spec-010 v8 B-6 (P3-m3 修复):WizardGuard 路由守卫。
//
// 包装 AuthWrapper,在认证检查之前先检查是否需要 Wizard 首次安装:
// - needsSetup=true  → 重定向到 /wizard
// - needsSetup=false → 渲染 children(由 AuthWrapper 继续认证守卫)
// - 探测中           → 渲染 loading 占位(等待结果,避免与 AuthWrapper 竞态)
// - 探测失败         → 降级渲染 children(由 AuthWrapper 兜底)
//
// 设计要点:
// - 仅对已认证路由(root + authRequired)生效,不影响 /wizard / /login 等公开路由
// - React Query 缓存 5 分钟,避免每次路由切换都打 BFF
// - mode=add 场景不触发重定向(用户主动从 Admin 添加 backend)
// - isLoading 期间必须渲染 loading 占位,避免 AuthWrapper 在未登录状态下抢先跳转 /login,
//   导致 wizard 重定向的 useEffect 永远没有机会执行(原 P3-m3 修复遗留 bug)

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { fetchWizardStatus } from '@/services/wizard-service';
import { Routes } from '@/constants/routes';

const WIZARD_STATUS_STALE_MS = 5 * 60 * 1000; // 5 分钟缓存

/**
 * wizard/status 查询的 query key。
 * 导出供 wizard 页面 setup 成功后 invalidate,避免 WizardGuard 读到旧缓存
 * (needsSetup=true)导致重定向回 /wizard 形成死循环。
 */
export const WIZARD_STATUS_QUERY_KEY = ['wizard/status'];

function LoadingOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
    </div>
  );
}

export default function WizardGuard({ children }: React.PropsWithChildren) {
  const navigate = useNavigate();
  const location = useLocation();

  // 查询是否需要向导(首次安装)
  // staleTime 避免路由切换时重复请求;cacheTime 保留缓存供其他组件复用
  // retry: 1 容忍瞬时网络抖动(原 retry: false 对公开状态接口过激)
  // 错误时不阻塞渲染(降级放行,由 AuthWrapper 兜底)
  const { data, isPending, isFetching } = useQuery({
    queryKey: WIZARD_STATUS_QUERY_KEY,
    // fetchWizardStatus 已声明返回 WizardStatusResponse 裸对象(无 ApiResponse 包装),
    // res.data 是 axios 响应体,即 { needsSetup, ... }
    queryFn: async () => (await fetchWizardStatus()).data,
    staleTime: WIZARD_STATUS_STALE_MS,
    retry: 1,
  });

  const needsSetup = data?.needsSetup === true;

  useEffect(() => {
    // 仅在确认 needsSetup=true 时重定向
    // isError 或 data 为空时降级放行(不阻塞已有功能)
    if (needsSetup) {
      // 检查当前是否已在 wizard 路由(避免循环跳转)
      if (location.pathname === Routes.Wizard) return;

      // 检查 URL 是否含 mode=add(用户主动从 Admin 添加 backend,允许跳过)
      const params = new URLSearchParams(location.search);
      if (params.get('mode') === 'add') return;

      navigate(Routes.Wizard, { replace: true });
    }
  }, [needsSetup, navigate, location.pathname, location.search]);

  // needsSetup=true 时渲染空白(等待重定向)
  if (needsSetup) {
    return <LoadingOverlay />;
  }

  // isPending(首次加载)或 isFetching(retry/backgound refetch)期间渲染 loading 占位,
  // 而不是直接渲染 children。
  // 否则 AuthWrapper 会在未登录状态下抢先跳转 /login,而 /login 是公开路由不经过 WizardGuard,
  // 即使随后查询返回 needsSetup=true 也无法再触发 wizard 重定向。
  // 使用 isPending || isFetching 而非 isLoading,确保 retry 期间也显示 loading(避免闪烁)。
  if (isPending || isFetching) {
    return <LoadingOverlay />;
  }

  // isError(降级放行)或数据加载完成但 needsSetup=false → 渲染 children(由 AuthWrapper 兜底)
  return <>{children}</>;
}
