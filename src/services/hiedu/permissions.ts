// 权限点常量与展示元数据。端口化自 intellect-auth/hiedu/web/src/permissions.ts；
// 编码须与 hiedu/domain/access.go 的白名单保持一致，运行期仍以后端
// /api/role-permissions 为唯一事实源，本文件只负责标签与分组。

export const PERM = {
  UnitRead: 'unit:read',
  UnitWrite: 'unit:write',
  PersonRead: 'person:read',
  PersonWrite: 'person:write',
  PersonPIIRead: 'person:pii:read',
  PersonPIIWrite: 'person:pii:write',
  ProjectRead: 'project:read',
  ProjectReadOwn: 'project:read:own',
  ProjectWrite: 'project:write',
  ProjectTransferOwner: 'project:transfer_owner',
  ClassRead: 'class:read',
  ClassWrite: 'class:write',
  StudentRead: 'student:read',
  StudentWrite: 'student:write',
  DictRead: 'dict:read',
  DictWrite: 'dict:write',
  AuditRead: 'audit:read',
  ReconcileRead: 'reconcile:read',
  ReconcileRepair: 'reconcile:repair',
  SyncWrite: 'sync:write',
  MembershipRead: 'membership:read',
  InvitationAccept: 'invitation:accept',
  AttributesRead: 'attributes:read',
  RoleAdmin: 'role:admin',
  SystemImport: 'system:import',
  SystemExport: 'system:export',
} as const;

export type PermissionCode = (typeof PERM)[keyof typeof PERM];

export interface PermissionMeta {
  code: string;
  label: string;
  group: string;
  /** 高风险权限点：授予时需二次确认。 */
  risk?: boolean;
  /** 该权限点实际需要校级范围才生效。 */
  orgScopeOnly?: boolean;
}

export const PERMISSIONS: PermissionMeta[] = [
  { code: PERM.UnitRead, label: '组织读取', group: '组织' },
  { code: PERM.UnitWrite, label: '组织写入', group: '组织' },
  { code: PERM.PersonRead, label: '人员读取', group: '人员' },
  { code: PERM.PersonWrite, label: '人员写入', group: '人员' },
  { code: PERM.PersonPIIRead, label: 'PII 读取（邮箱明文）', group: '人员', risk: true },
  { code: PERM.PersonPIIWrite, label: 'PII 写入（邮箱修改）', group: '人员', risk: true },
  { code: PERM.ProjectRead, label: '项目读取', group: '项目' },
  { code: PERM.ProjectReadOwn, label: '项目读取（本人负责）', group: '项目' },
  { code: PERM.ProjectWrite, label: '项目写入', group: '项目' },
  { code: PERM.ProjectTransferOwner, label: '项目负责人转移', group: '项目' },
  { code: PERM.ClassRead, label: '班级读取', group: '班级与学籍' },
  { code: PERM.ClassWrite, label: '班级写入', group: '班级与学籍' },
  { code: PERM.StudentRead, label: '学籍读取', group: '班级与学籍' },
  { code: PERM.StudentWrite, label: '学籍写入', group: '班级与学籍' },
  { code: PERM.DictRead, label: '字典读取', group: '字典' },
  { code: PERM.DictWrite, label: '字典写入', group: '字典' },
  { code: PERM.AuditRead, label: '审计读取', group: '审计与运维', orgScopeOnly: true },
  { code: PERM.ReconcileRead, label: '对账读取', group: '审计与运维', orgScopeOnly: true },
  { code: PERM.ReconcileRepair, label: '对账修复', group: '审计与运维', risk: true, orgScopeOnly: true },
  { code: PERM.SyncWrite, label: '同步任务', group: '审计与运维', orgScopeOnly: true },
  { code: PERM.MembershipRead, label: '成员关系查询', group: '集成' },
  { code: PERM.InvitationAccept, label: '接受邀请', group: '集成' },
  { code: PERM.AttributesRead, label: '人员属性回查', group: '集成' },
  { code: PERM.RoleAdmin, label: '角色与授权管理', group: '系统', risk: true, orgScopeOnly: true },
  { code: PERM.SystemImport, label: '批量导入', group: '系统', risk: true },
  { code: PERM.SystemExport, label: '批量导出', group: '系统', risk: true, orgScopeOnly: true },
];

export const PERMISSION_GROUP_ORDER = [
  '组织',
  '人员',
  '项目',
  '班级与学籍',
  '字典',
  '审计与运维',
  '集成',
  '系统',
];

const LABELS: Record<string, string> = Object.fromEntries(
  PERMISSIONS.map((item) => [item.code, item.label]),
);

export function permissionLabel(code: string): string {
  return LABELS[code] ?? code;
}

export function permissionMeta(code: string): PermissionMeta | undefined {
  return PERMISSIONS.find((item) => item.code === code);
}
