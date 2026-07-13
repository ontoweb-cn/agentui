import message from '@/components/ui/message';
import { AuthMode, TenantId, UserInfo } from '@/constants/authorization';
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
 *   - 401 → 不做任何操作(未登录状态,保持登录页)
 *
 * 使用 fetch() 直接调用,绕开 request.ts 401 拦截器(避免探测 401 时弹出通知/触发跳转)。
 * 跳过 /admin 路径(admin 走 intellect-rag admin token,不涉及企业版 cookie)。
 * TanStack Query staleTime=Infinity 避免重复探测,retry=false 避免登录页频繁重试。
 */
const useEnterpriseCookieProbe = () => {
  const { authMode } = useAuthMode();
  const location = useLocation();

  const hasAuthorization = !!authorizationUtil.getAuthorization();
  const hasMarker = localStorage.getItem(AuthMode) === 'intellect-enterprise';
  const isAdminPath = location.pathname.startsWith('/admin');

  // 仅企业版 + 无 localStorage Authorization + 无 authMode 标记 + 非 admin 路径时启用
  const enabled =
    authMode === 'intellect-enterprise' &&
    !hasAuthorization &&
    !hasMarker &&
    !isAdminPath;

  return useQuery({
    queryKey: ['enterpriseCookieProbe'],
    queryFn: async () => {
      // P2-B 修复:fetch/resp.json() 可能抛错(网络断开、非 JSON 响应),
      // try/catch 兜底返回 false(视为未登录),避免控制台未捕获错误。
      try {
        const tenantId = localStorage.getItem(TenantId) || '0';
        const resp = await fetch(api.userInfo, {
          credentials: 'include',
          headers: { 'X-Tenant-Id': tenantId },
        });
        if (!resp.ok) {
          // 401/其他错误:未登录或 cookie 过期,不做任何操作
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
            [TenantId]: '0',
            [UserInfo]: JSON.stringify(userInfo),
          });
          return true;
        }
        return false;
      } catch {
        // 网络错误或 JSON 解析失败:视为未登录
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
  const [isLogin, setIsLogin] = useState<Nullable<boolean>>(null);

  useEffect(() => {
    // P2 Cookie 模式:企业版 token 在 HttpOnly cookie 中,前端 JS 不可读。
    // 通过 localStorage authMode 标记判断登录态,真实有效性由后续 /auth/me 请求验证。
    // 401 拦截器调用 removeAll 会清除 authMode 标记,自动跳登录页。
    const isEnterprise =
      localStorage.getItem(AuthMode) === 'intellect-enterprise';
    setIsLogin(!!authorizationUtil.getAuthorization() || !!auth || isEnterprise);
  }, [auth, probe.data]);

  return { isLogin };
};
