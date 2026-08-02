import message from '@/components/ui/message';
import { AuthMode, BackendId, UserInfo } from '@/constants/authorization';
import api from '@/utils/api';
import authorizationUtil from '@/utils/authorization-util';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import { useAuthMode } from './use-login-request';

export const useOAuthCallback = () => {
  const [currentQueryParameters, setSearchParams] = useSearchParams();
  const error = currentQueryParameters.get('error');
  const newQueryParameters: URLSearchParams = useMemo(
    () => new URLSearchParams(currentQueryParameters.toString()),
    [currentQueryParameters],
  );
  const navigate = useNavigate();

  useEffect(() => {
    if (error) {
      message.error(error);
      setTimeout(() => {
        navigate('/login');
        newQueryParameters.delete('error');
        setSearchParams(newQueryParameters);
      }, 1000);
      return;
    }

    const auth = currentQueryParameters.get('auth');
    if (auth) {
      authorizationUtil.setAuthorization(auth);
      newQueryParameters.delete('auth');
      setSearchParams(newQueryParameters);
      navigate('/');
    }
  }, [
    error,
    currentQueryParameters,
    newQueryParameters,
    navigate,
    setSearchParams,
  ]);

  return currentQueryParameters.get('auth');
};

/**
 * T006:企业版 cookie 模式登录态探测。
 *
 * 企业版 token 存 HttpOnly cookie,前端 JS 不可读。OAuth callback 返回 302 → 前端首页,
 * 此时 localStorage 无任何标记,isLogin=false。本 hook 通过 /auth/me 被动探测 cookie 有效性:
 *   - 200 → 存 localStorage 标记 → useAuth 中 isLogin 变 true
 *   - 401 → cookie 过期/无效,清除 localStorage 标记 → useAuth 中 isLogin 变 false → 跳转登录
 *
 * 修复:marker 存在时也启用探测,检测 cookie 过期(maxAge=86400s=1天)。
 * 旧实现 marker 存在时跳过探测,导致 cookie 过期后前端仍认为已登录,
 * 所有 API 请求 401 但 401 拦截器在企业模式下不跳转,用户停留空页面。
 *
 * 使用 fetch() 直接调用,绕开 request.ts 401 拦截器(避免探测 401 时弹出通知/触发跳转)。
 * 跳过 /admin 路径(admin 走 intellect-rag admin token,不涉及企业版 cookie)。
 * TanStack Query staleTime=Infinity 避免重复探测,retry=false 避免登录页频繁重试。
 */
const useEnterpriseCookieProbe = () => {
  const { authMode } = useAuthMode();
  const location = useLocation();

  const hasAuthorization = !!authorizationUtil.getAuthorization();
  const isAdminPath = location.pathname.startsWith('/admin');

  // 企业版 + 无 localStorage Authorization + 非 admin 路径时启用。
  // 不再跳过 hasMarker=true 的情况:需要验证 cookie 是否仍然有效(可能已过期)。
  const enabled =
    authMode === 'intellect-enterprise' &&
    !hasAuthorization &&
    !isAdminPath;

  return useQuery({
    queryKey: ['enterpriseCookieProbe'],
    queryFn: async () => {
      // P2-B 修复:fetch/resp.json() 可能抛错(网络断开、非 JSON 响应),
      // try/catch 兜底返回 false(视为未登录),避免控制台未捕获错误。
      try {
        const tenantId = localStorage.getItem(BackendId) || '0';
        const resp = await fetch(api.userInfo, {
          credentials: 'include',
          headers: { 'X-Backend-Id': tenantId },
        });
        if (!resp.ok) {
          // 401/其他错误:cookie 过期或无效,清除 localStorage 标记,
          // 使 useAuth 中 isLogin 变 false → AuthWrapper 跳转登录页。
          localStorage.removeItem(AuthMode);
          return false;
        }
        const json = await resp.json();
        if (json?.code === 0 && json?.data) {
          const userInfo = {
            name: json.data.display_name,
            email: json.data.email,
            memberId: json.data.member_id,
            role: json.data.role,
          };
          authorizationUtil.setItems({
            [AuthMode]: 'intellect-enterprise',
            [BackendId]: '0',
            [UserInfo]: JSON.stringify(userInfo),
          });
          return true;
        }
        // 200 但无有效数据:清除标记
        localStorage.removeItem(AuthMode);
        return false;
      } catch {
        // 网络错误或 JSON 解析失败:不清除标记(可能是暂时性网络问题),
        // 保持现有登录态,由后续请求的 401 拦截器处理。
        return false;
      }
    },
    enabled,
    staleTime: Infinity,
    retry: false,
  });
};

export const useAuth = () => {
  const auth = useOAuthCallback();
  // T006:企业版 cookie 探测。探测成功会写入 localStorage 标记,
  // probe.data 变化触发下方 useEffect 重新计算 isLogin。
  const probe = useEnterpriseCookieProbe();
  // authMode 加载状态:加载中时 isLogin 保持 null,避免页面渲染触发 API 请求
  // 与 401 拦截器形成竞态跳转。
  const { authMode, loading: authModeLoading } = useAuthMode();
  const [isLogin, setIsLogin] = useState<Nullable<boolean>>(null);

  useEffect(() => {
    const hasAuthorization = !!authorizationUtil.getAuthorization();
    const hasMarker = localStorage.getItem(AuthMode) === 'intellect-enterprise';

    // 1. 已有 Authorization(社区版 token)或 OAuth callback auth,直接登录
    if (hasAuthorization || auth) {
      setIsLogin(true);
      return;
    }

    // 2. authMode 还在加载中,保持 null 等待(避免竞态:此时无法判断
    //    是否需要启用 probe,提前返回 false 会导致页面渲染触发 401 跳转)
    if (authModeLoading) {
      setIsLogin(null);
      return;
    }

    // 3. 企业版 probe 已完成:以 probe 结果为准(检测 cookie 过期)。
    //    probe 返回 false 时 marker 已被 queryFn 清除,hasMarker 此时为 false。
    //    probe 返回 true 时 marker 已被 queryFn 写入,hasMarker 此时为 true。
    //    此检查必须在 hasMarker 乐观判断之前,确保 cookie 过期能被检测到。
    if (probe.data !== undefined) {
      setIsLogin(probe.data === true);
      return;
    }

    // 4. 已有企业版 localStorage 标记,probe 尚未完成:乐观视为登录
    //    (cookie 真实有效性由 probe 验证,probe 完成后 step 3 会纠正)
    if (hasMarker) {
      setIsLogin(true);
      return;
    }

    // 5. 社区版模式,无 Authorization,未登录
    if (authMode !== 'intellect-enterprise') {
      setIsLogin(false);
      return;
    }

    // 6. 企业版 cookie 模式:probe 进行中保持 null,探测完成按结果设置
    //    probe.isLoading=true 时 probe.data===undefined,保持 null 等待
    if (probe.isLoading && probe.data === undefined) {
      setIsLogin(null);
      return;
    }

    // 7. 企业版探测完成,根据结果设置(冗余兜底,正常流程 step 3 已处理)
    setIsLogin(probe.data === true);
  }, [auth, probe.data, probe.isLoading, authMode, authModeLoading]);

  return { isLogin };
};
