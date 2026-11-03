import type { MeScope } from './api';

// 邮箱默认掩码；已脱敏值保持不变，避免二次掩码。
// “已脱敏”判定用掩码形态而非裸包含 `***`：`*` 是邮箱 local-part 的合法字符，
// 档案数据里可能出现 `john***@example.com`，不能据此跳过掩码（评审 R-mask）。
const MASKED_EMAIL_RE = /^\S{0,2}\*+\*@\S+$/;

export function maskEmail(value?: string | null): string {
  if (!value) return '未登记';
  if (MASKED_EMAIL_RE.test(value)) return value;
  const at = value.indexOf('@');
  if (at <= 0) return '***';
  const local = value.slice(0, at);
  if (local.length <= 2) return `*${value.slice(at)}`;
  return `${local.slice(0, 2)}***${value.slice(at)}`;
}

export function formatCount(value: number | string | null | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function personTypeLabel(type?: string): string {
  switch (type) {
    case 'STAFF':
      return '教职工';
    case 'STUDENT':
      return '学生';
    default:
      return type || '—';
  }
}

export function statusLabel(status?: string): string {
  switch (status) {
    case 'active':
      return '启用';
    case 'disabled':
      return '停用';
    case 'merged':
      return '已撤并';
    case 'closed':
      return '已关闭';
    case 'cancelled':
      return '已取消';
    case 'draft':
      return '草稿';
    case 'pending_account':
      return '待开通';
    case 'left':
      return '离职';
    case 'graduated':
      return '毕业';
    case 'suspended':
      return '暂停';
    case 'no_account':
      return '无账号';
    case 'ended':
      return '已结束';
    case 'queued':
      return '排队中';
    case 'pending_approval':
      return '待审批';
    case 'completed':
      return '已完成';
    case 'rejected':
      return '已驳回';
    case 'expired':
      return '已过期';
    case 'completed_with_errors':
      return '完成但有错误';
    case 'pending':
      return '待处理';
    case 'manual':
      return '人工处理';
    case 'done':
      return '已完成';
    case 'converged':
      return '已收敛';
    case 'unconverged':
      return '未收敛';
    case 'no_run':
      return '未运行';
    default:
      return status || '—';
  }
}

// 返回徽标色调，供 className={`badge badge-${tone}`} 使用。
export function statusTone(status?: string): string {
  switch (status) {
    case 'active':
    case 'done':
    case 'converged':
    case 'completed':
      return 'ok';
    case 'pending':
    case 'queued':
    case 'pending_approval':
    case 'completed_with_errors':
    case 'pending_account':
    case 'draft':
    case 'suspended':
    case 'unconverged':
      return 'warn';
    case 'merged':
    case 'cancelled':
    case 'rejected':
      return 'danger';
    default:
      return 'muted';
  }
}

export function scopeSummary(scopes: MeScope[]): string {
  if (!scopes || scopes.length === 0) return '无数据范围';
  if (scopes.some((scope) => scope.all)) return '全校范围';
  return `${scopes.length} 个部门范围`;
}

export function hasPermission(permissions: string[], permission: string): boolean {
  return permissions.includes('*') || permissions.includes(permission);
}
