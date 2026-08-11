import { useMemo } from 'react';
import { AuthMode, UserInfo } from '@/constants/authorization';

/**
 * 读取当前登录用户的角色与部署模式，用于前端 UX 权限守卫。
 *
 * canManage 为 true 当且仅当：
 *   - 部署模式为企业版（authMode === 'intellect-enterprise'）
 *   - 且当前用户角色为 admin 或 owner
 *
 * 不承担安全责任——后端 API 必须独立做角色强制校验。
 */
export function useUserRole() {
  const role = useMemo(() => {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(UserInfo);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed?.role === 'string' ? (parsed.role as string) : null;
    } catch {
      return null;
    }
  }, []);

  const isEnterprise = useMemo(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(AuthMode) === 'intellect-enterprise';
  }, []);

  const canManage = isEnterprise && (role === 'admin' || role === 'owner');

  return { role, canManage, isEnterprise };
}

export default useUserRole;
