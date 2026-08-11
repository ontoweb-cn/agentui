import type { ReactNode } from 'react';
import { useUserRole } from '../hooks/use-user-role';

/**
 * 角色守卫组件。
 *
 * canManage 为 true 时渲染 children，否则渲染 fallback（默认 null 即不渲染）。
 * 仅用于前端 UX——安全保证由后端 API 提供。
 *
 * @example
 * <RequireRole>
 *   <Button onClick={handleDelete}>删除</Button>
 * </RequireRole>
 */
export function RequireRole({
  fallback = null,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { canManage } = useUserRole();
  return canManage ? <>{children}</> : <>{fallback}</>;
}

export default RequireRole;
