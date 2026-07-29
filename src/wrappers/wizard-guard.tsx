// spec-010 v8 B-6 (P3-m3 修复):WizardGuard 路由守卫。
//
// 包装 AuthWrapper,在认证检查之前先检查是否需要 Wizard 首次安装:
// - needsSetup=true  → 重定向到 /wizard
// - needsSetup=false → 渲染 children(由 AuthWrapper 继续认证守卫)
// - 探测中/失败      → 渲染 children(降级放行,由 AuthWrapper 兜底)
//
// 设计要点:
// - 仅对已认证路由(root + authRequired)生效,不影响 /wizard / /login 等公开路由
// - React Query 缓存 5 分钟,避免每次路由切换都打 BFF
// - mode=add 场景不触发重定向(用户主动从 Admin 添加 backend)
// - 失败时降级放行,不阻塞用户访问已有功能

import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { fetchWizardStatus } from '@/services/wizard-service';
import { Routes } from '@/constants/routes';

const WIZARD_STATUS_STALE_MS = 5 * 60 * 1000; // 5 分钟缓存

export default function WizardGuard({ children }: React.PropsWithChildren) {
  const navigate = useNavigate();

  // 查询是否需要向导(首次安装)
  // staleTime 避免路由切换时重复请求;cacheTime 保留缓存供其他组件复用
  // isError 时不阻塞渲染(降级放行,由 AuthWrapper 兜底)
  const { data } = useQuery({
    queryKey: ['wizard/status'],
    queryFn: async () => (await fetchWizardStatus()).data,
    staleTime: WIZARD_STATUS_STALE_MS,
    retry: false,
  });

  const needsSetup = data?.data?.needsSetup === true;

  useEffect(() => {
    // 仅在确认 needsSetup=true 时重定向
    // isError 或 data 为空时降级放行(不阻塞已有功能)
    if (needsSetup) {
      // 检查当前是否已在 wizard 路由(避免循环跳转)
      const currentPath = window.location.pathname;
      if (currentPath === Routes.Wizard) return;

      // 检查 URL 是否含 mode=add(用户主动从 Admin 添加 backend,允许跳过)
      const params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'add') return;

      navigate(Routes.Wizard, { replace: true });
    }
  }, [needsSetup, navigate]);

  // needsSetup=true 时渲染空白(等待重定向),其他情况渲染 children
  if (needsSetup) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
      </div>
    );
  }

  // isError 或 data 未加载 → 降级渲染 children(由 AuthWrapper 兜底)
  return <>{children}</>;
}
