import { useAuth } from '@/hooks/auth-hooks';
import { redirectToLogin } from '@/utils/authorization-util';
import { useEffect } from 'react';

/**
 * 认证守卫:未登录跳转登录页,探测中渲染空白,已登录渲染 children。
 *
 * 用于路由配置 wrapRoutes,给需要认证的路由 Component 外层包裹。
 * useAuth 在企业版 cookie 探测完成前保持 isLogin=null,避免页面渲染
 * 触发 API 请求导致 401 拦截器与 probe 形成竞态跳转。
 *
 * 跳转副作用放到 useEffect 中执行,避免渲染期间触发 location 修改
 * (React StrictMode 下渲染会执行两次,直接调用 redirectToLogin 会
 * 重复跳转;且渲染期副作用违反 React 纯函数约定)。
 */
export default function AuthWrapper({ children }: React.PropsWithChildren) {
  const { isLogin } = useAuth();

  useEffect(() => {
    if (isLogin === false) {
      redirectToLogin();
    }
  }, [isLogin]);

  if (isLogin === true) {
    return <>{children}</>;
  }

  // isLogin === null(探测中)或 isLogin === false(已触发跳转,渲染空白)
  return <></>;
}
