/**
 * 角色与授权：本地 RBAC 角色列表、创建/编辑（同页内联）、权限点配置与分配面板。
 *
 * 移植自 intellect-auth/hiedu/web/src/pages/Roles.tsx 与 RoleDetail.tsx：
 * - 创建走 create_only，编码冲突由后端 409 兜底；编辑沿用 ETag/If-Match；
 * - 系统角色编码收敛白名单，创建后类型/范围不可改（后端固化）；
 * - 只能授予自己已持有的本地权限点，应用权限点（app/*）由应用侧执行。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  api,
  errorMessage,
  isApiError,
  type AppRegistry,
  type Me,
  type RoleAssignmentDetail,
  type RoleSummary,
} from '@/services/hiedu/api';
import { formatDateTime, hasPermission } from '@/services/hiedu/format';
import {
  PERMISSIONS,
  PERMISSION_GROUP_ORDER,
  permissionMeta,
  type PermissionMeta,
} from '@/services/hiedu/permissions';
import { PageHeader, Panel } from './components/page';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
  StatusBadge,
} from './components/state';
import { useMe } from './hooks';

// 系统角色承担平台级授权，编码收敛到固定集合，避免铸造永久不可治理的角色。
const SYSTEM_ROLE_CODES = ['ORG_ADMIN', 'AUDITOR'];

// 应用目录/权限点变更低频：短 TTL 缓存，避免重复打开编辑器时 N+1 拉取。仅缓存成功响应。
const CATALOG_TTL_MS = 30_000;
const catalogCache = new Map<string, { at: number; data: unknown }>();

async function cachedCatalog<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = catalogCache.get(key);
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.data as T;
  const data = await loader();
  catalogCache.set(key, { at: Date.now(), data });
  return data;
}

interface AppGroupState {
  app: AppRegistry;
  perms: { code: string; label: string; kind: string }[];
}

interface PermissionOption {
  code: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  note?: string;
  badges: string[];
}

interface PermissionGroupView {
  key: string;
  title: string;
  emptyHint?: string;
  items: PermissionOption[];
}

export default function RolesPage() {
  const me = useMe();
  const canRead = hasPermission(me.permissions, 'role:admin');
  const orgScope = me.scopes.some((scope) => scope.all);

  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');

  // 同页内联编辑：不跳转路由，编辑器直接展开在列表下方。
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.roles();
      setRoles(Array.isArray(result.data) ? result.data : []);
    } catch (err) {
      setError(errorMessage(err));
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, [canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (editing || creating) {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [editing, creating]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return roles.filter((role) => {
      if (status && role.status !== status) return false;
      if (kind === 'system' && !role.is_system) return false;
      if (kind === 'custom' && role.is_system) return false;
      if (!needle) return true;
      return (
        role.code.toLowerCase().includes(needle) ||
        role.name.toLowerCase().includes(needle)
      );
    });
  }, [roles, q, status, kind]);

  function closeEditor() {
    setCreating(false);
    setEditing(null);
  }

  if (!canRead || !orgScope) {
    return (
      <ForbiddenState
        message="无权限访问角色与授权"
        detail="需要校级范围的 role:admin 权限。"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="角色与授权"
        description="维护本地 RBAC 角色、权限点与数据范围；权限变更即时对已分配人员生效。"
        actions={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            新建角色
          </Button>
        }
      />

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border-button bg-bg-card p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label className="min-w-48 flex-1">
          <span className="mb-1 block text-xs text-text-secondary">搜索</span>
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="角色编码或名称"
          />
        </label>
        <label className="w-36">
          <span className="mb-1 block text-xs text-text-secondary">状态</span>
          <Select value={status} onValueChange={(value) => setStatus(value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="active">启用</SelectItem>
              <SelectItem value="disabled">停用</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="w-36">
          <span className="mb-1 block text-xs text-text-secondary">类型</span>
          <Select value={kind} onValueChange={(value) => setKind(value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="system">系统角色</SelectItem>
              <SelectItem value="custom">业务角色</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <Button type="submit" size="sm" disabled={loading}>
          刷新
        </Button>
      </form>

      {loading ? <LoadingState label="正在加载角色…" /> : null}
      {!loading && error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : null}

      {!loading && !error ? (
        <Panel className="overflow-hidden" bodyClassName="p-0">
          {visible.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>编码</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>权限点</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>范围</TableHead>
                  <TableHead>已分配人数</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((role) => (
                  <TableRow key={role.code}>
                    <TableCell>
                      <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                        {role.code}
                      </code>
                    </TableCell>
                    <TableCell className="font-medium">{role.name}</TableCell>
                    <TableCell>{role.permissions?.length ?? 0}</TableCell>
                    <TableCell>
                      {role.is_system ? (
                        <span className="text-xs text-text-secondary">系统角色</span>
                      ) : (
                        <span className="text-xs text-text-tertiary">业务角色</span>
                      )}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {role.scope_all ? '全校' : '按分配'}
                    </TableCell>
                    <TableCell title={`分配记录 ${role.assignment_count} 条（含离职/毕业人员）`}>
                      {role.assigned_person_count}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={role.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCreating(false);
                            setEditing(role.code);
                          }}
                        >
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={role.is_system}
                          title={role.is_system ? '系统角色不可停用' : undefined}
                          onClick={() => {
                            void toggleRole(role, () => void load());
                          }}
                        >
                          {role.status === 'active' ? '停用' : '启用'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState
                title="未找到角色"
                description="请调整筛选条件，或新建一个业务角色。"
              />
            </div>
          )}
        </Panel>
      ) : null}

      {creating || editing ? (
        <div ref={editorRef}>
          <RoleEditor
            key={creating ? '__create__' : editing}
            code={creating ? '' : (editing ?? '')}
            onClose={closeEditor}
            onSaved={() => void load()}
            onCreated={(created) => {
              setCreating(false);
              setEditing(created);
              void load();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

async function toggleRole(role: RoleSummary, refresh: () => void) {
  const enable = role.status !== 'active';
  const ok = window.confirm(
    enable
      ? `启用后，已分配人员将重新获得「${role.name}」的权限点与数据范围。确认启用？`
      : `停用后，${role.assigned_person_count} 名已分配人员将立即失去「${role.name}」的权限点与数据范围；分配记录保留，重新启用后恢复。确认停用？`,
  );
  if (!ok) return;
  try {
    await api.setRoleEnabled(role.code, enable);
    refresh();
  } catch (err) {
    window.alert(errorMessage(err));
  }
}

interface RoleEditorProps {
  code: string;
  onClose: () => void;
  onSaved: () => void;
  onCreated: (code: string) => void;
}

function RoleEditor({ code, onClose, onSaved, onCreated }: RoleEditorProps) {
  const me: Me = useMe();
  const isCreate = !code;

  const [role, setRole] = useState<RoleSummary | null>(null);
  const [roleEtag, setRoleEtag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appsWarning, setAppsWarning] = useState('');

  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [initial, setInitial] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [appGroups, setAppGroups] = useState<AppGroupState[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // 创建模式：编码与类型/范围仅在创建时可选，创建后由后端固化。
  const [codeInput, setCodeInput] = useState('');
  const [isSystem, setIsSystem] = useState(false);
  const [scopeAll, setScopeAll] = useState(false);

  const grantable = useMemo(
    () => new Set(me.permissions),
    [me.permissions],
  );
  const hasWildcard = me.permissions.includes('*');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [roleRes, permsRes] = await Promise.all([
        code ? api.role(code) : Promise.resolve(null),
        api.rolePermissions(),
      ]);
      // 应用目录属辅助信息：读取失败时降级为空，不影响角色本身编辑。
      let activeApps: AppRegistry[] = [];
      let warning = '';
      try {
        const appsRes = await cachedCatalog('apps', () => api.apps());
        activeApps = (appsRes.data ?? []).filter((app) => app.status === 'active');
      } catch (err) {
        warning = `应用目录加载失败：${errorMessage(err)}（本地权限点仍可编辑）`;
      }
      setAppsWarning(warning);
      const details = await Promise.all(
        activeApps.map(async (app) => {
          try {
            const perms = await cachedCatalog(`app-perms:${app.app_code}`, () =>
              api.appPermissions(app.app_code),
            );
            return {
              app,
              perms: (perms.data ?? [])
                .filter((item) => item.status === 'active')
                .map((item) => ({
                  code: `app/${app.app_code}:${item.perm_code}`,
                  label: item.display_name || item.perm_code,
                  kind: item.kind,
                })),
            };
          } catch {
            // 单个应用目录不可读不影响角色本身的加载。
            return { app, perms: [] };
          }
        }),
      );
      if (roleRes) {
        setRole(roleRes.data);
        setRoleEtag(roleRes.etag);
        setName(roleRes.data.name);
        setSelected([...(roleRes.data.permissions ?? [])]);
        setInitial([...(roleRes.data.permissions ?? [])]);
      } else {
        // 创建模式：角色本体留空，权限点从零开始勾选。
        setRole(null);
        setRoleEtag(null);
        setName('');
        setSelected([]);
        setInitial([]);
      }
      setCatalog(permsRes.data.local ?? []);
      setAppGroups(details);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshRole = useCallback(async () => {
    const result = await api.role(code);
    setRole(result.data);
    setRoleEtag(result.etag);
  }, [code]);

  const permissionGroups = useMemo<PermissionGroupView[]>(() => {
    const allowed = new Set(catalog);
    const known = new Set(PERMISSIONS.map((item) => item.code));
    const groups: PermissionGroupView[] = [];
    const localOption = (item: PermissionMeta): PermissionOption => {
      const disabled = !hasWildcard && !grantable.has(item.code);
      const badges: string[] = [];
      if (item.risk) badges.push('高危');
      if (item.orgScopeOnly) badges.push('需校级');
      return {
        code: item.code,
        label: item.label,
        checked: selected.includes(item.code),
        disabled,
        note: disabled ? '超出你的授权范围' : undefined,
        badges,
      };
    };
    for (const group of PERMISSION_GROUP_ORDER) {
      const items = PERMISSIONS.filter(
        (item) => item.group === group && allowed.has(item.code),
      );
      if (items.length > 0) {
        groups.push({ key: group, title: group, items: items.map(localOption) });
      }
    }
    const extra = catalog.filter((item) => !known.has(item));
    if (extra.length > 0) {
      groups.push({
        key: '其他',
        title: '其他',
        items: extra.map((code) => localOption({ code, label: code, group: '其他' })),
      });
    }
    for (const { app, perms } of appGroups) {
      groups.push({
        key: app.app_code,
        title: `应用 · ${app.display_name || app.app_code}`,
        emptyHint: '该应用暂无可用权限点。',
        items: perms.map((item) => ({
          code: item.code,
          label: item.label,
          checked: selected.includes(item.code),
          badges: [item.kind],
        })),
      });
    }
    return groups;
  }, [catalog, appGroups, selected, grantable, hasWildcard]);

  const added = selected.filter((item) => !initial.includes(item));
  const removed = initial.filter((item) => !selected.includes(item));

  function toggle(code: string) {
    setSelected((current) =>
      current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code],
    );
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage('角色名称不能为空');
      return;
    }
    // 编辑沿用既有编码；创建取输入值并归一为大写。
    const targetCode = code || codeInput.trim().toUpperCase();
    if (!targetCode) {
      setMessage('角色编码不能为空');
      return;
    }
    if (!code && isSystem && !SYSTEM_ROLE_CODES.includes(targetCode)) {
      setMessage(`系统角色编码仅允许 ${SYSTEM_ROLE_CODES.join(' / ')}`);
      return;
    }
    const riskyAdded = added.filter(
      (perm) => permissionMeta(perm)?.risk || perm.startsWith('app/'),
    );
    const riskyRemoved = removed.filter(
      (perm) => permissionMeta(perm)?.risk || perm.startsWith('app/'),
    );
    if (riskyAdded.length > 0 || riskyRemoved.length > 0) {
      const removalWarning = removed.includes('role:admin')
        ? '\n注意：移除 role:admin 可能导致对应管理员失去入口。'
        : '';
      const ok = window.confirm(
        `本次将新增 ${riskyAdded.length} 个、移除 ${riskyRemoved.length} 个高风险或应用权限点，保存后立即生效。${removalWarning}\n确认继续？`,
      );
      if (!ok) return;
    }
    setBusy(true);
    setMessage('');
    try {
      if (!code) {
        // 创建：编码查重交由后端 create_only 兜底（409），避免与列表快照不同步。
        await api.upsertRole({
          code: targetCode,
          name: trimmed,
          permissions: selected,
          is_system: isSystem,
          scope_all: isSystem ? scopeAll : false,
          create_only: true,
        });
        // 切换编辑模式与列表刷新由父级 onCreated 一并负责；无父级回调时兜底关闭。
        if (onCreated) onCreated(targetCode);
        else {
          onSaved();
          onClose();
        }
        return;
      }
      if (!role) return;
      await api.upsertRole(
        {
          code: role.code,
          name: trimmed,
          permissions: selected,
          scope_all: role.scope_all,
          is_system: role.is_system,
        },
        roleEtag ?? undefined,
      );
      setInitial([...selected]);
      await refreshRole();
      setMessage('已保存；权限变更将在相关人员下次请求时生效。');
      onSaved();
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        setMessage(
          code ? '角色已被他人修改，请刷新页面后重新编辑。' : '角色编码已存在，请更换编码。',
        );
      } else {
        setMessage(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <LoadingState label={isCreate ? '正在加载权限目录…' : '正在加载角色…'} />;
  }

  if (!isCreate && (error || !role)) {
    return (
      <ErrorState message={error || '角色不存在'} onRetry={() => void load()} />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={role ? `角色 · ${role.code}` : '新建角色'}
        description={
          role
            ? role.is_system
              ? '系统角色：名称与权限可改，范围与类型不可改。'
              : '业务角色：可配置权限点并分配到部门。'
            : '在同一编辑器中创建角色并配置权限点；编码创建后不可修改。'
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={onClose}>
              {isCreate ? '取消' : '关闭'}
            </Button>
            <Button size="sm" loading={busy} onClick={() => void save()}>
              {busy ? (isCreate ? '创建中…' : '保存中…') : isCreate ? '创建' : '保存'}
            </Button>
          </>
        }
      />

      {message ? (
        <p className="rounded-md border border-border-button bg-bg-card px-3 py-2 text-sm text-text-secondary">
          {message}
        </p>
      ) : null}

      <Panel title="基本信息">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label>
            <span className="mb-1 block text-xs text-text-secondary">角色编码</span>
            {role ? (
              <code className="inline-block rounded bg-bg-secondary px-2 py-1 text-sm text-text-primary">
                {role.code}
              </code>
            ) : (
              <Input
                aria-label="角色编码"
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value)}
                placeholder="大写字母/数字/下划线，创建后不可修改"
              />
            )}
          </label>
          <label>
            <span className="mb-1 block text-xs text-text-secondary">角色名称 *</span>
            <Input
              aria-label="角色名称"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {role ? (
            <>
              <div>
                <span className="mb-1 block text-xs text-text-secondary">类型</span>
                <p className="text-sm text-text-primary">
                  {role.is_system ? '系统角色' : '业务角色'}
                </p>
              </div>
              <div>
                <span className="mb-1 block text-xs text-text-secondary">数据范围</span>
                <p className="text-sm text-text-primary">
                  {role.scope_all ? '全校（分配时不可指定部门）' : '按分配部门'}
                </p>
              </div>
              <div>
                <span className="mb-1 block text-xs text-text-secondary">已分配人数</span>
                <p className="text-sm text-text-primary">
                  {role.assigned_person_count} 人 / {role.assignment_count} 条记录
                </p>
              </div>
              <div>
                <span className="mb-1 block text-xs text-text-secondary">状态</span>
                <StatusBadge status={role.status} />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="role-is-system"
                  checked={isSystem}
                  onCheckedChange={(checked) => {
                    setIsSystem(checked === true);
                    if (checked !== true) setScopeAll(false);
                  }}
                />
                <Label htmlFor="role-is-system">系统角色</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="role-scope-all"
                  checked={scopeAll}
                  disabled={!isSystem}
                  onCheckedChange={(checked) => setScopeAll(checked === true)}
                />
                <Label htmlFor="role-scope-all" className={isSystem ? '' : 'text-text-disabled'}>
                  全校范围（仅系统角色）
                </Label>
              </div>
              <p className="text-xs text-text-secondary sm:col-span-2">
                系统角色编码仅允许 {SYSTEM_ROLE_CODES.join(' / ')}；创建后不可停用，类型与数据范围不可修改。
              </p>
            </>
          )}
        </div>
      </Panel>

      <Panel
        title="权限点"
        extra={
          <span className="text-xs text-text-secondary">
            已选 {selected.length} 项
            {added.length || removed.length
              ? ` · 本次新增 ${added.length} / 移除 ${removed.length}`
              : ''}
          </span>
        }
      >
        <p className="mb-3 text-xs text-text-secondary">
          只能授予自己已持有的本地权限点；应用权限点（app/*）不受该限制，由应用侧执行。标记“需校级”的权限点在部门范围下不会生效。
        </p>
        {appsWarning ? (
          <p className="mb-3 rounded-md bg-bg-secondary px-3 py-2 text-xs text-text-secondary">
            {appsWarning}
          </p>
        ) : null}
        <div className="flex flex-col gap-4">
          {permissionGroups.map((group) => (
            <div key={group.key}>
              <h3 className="mb-2 text-sm font-medium text-text-primary">{group.title}</h3>
              {group.items.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((item) => (
                    <label
                      key={item.code}
                      className={`flex items-start gap-2 rounded-md border border-border-button bg-bg-base p-2 ${
                        item.disabled ? 'opacity-60' : 'cursor-pointer'
                      }`}
                    >
                      <Checkbox
                        checked={item.checked}
                        disabled={item.disabled}
                        onCheckedChange={() => toggle(item.code)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-text-primary">
                          {item.label}
                        </span>
                        <code className="block truncate text-xs text-text-tertiary">
                          {item.code}
                        </code>
                        {item.badges.length > 0 ? (
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            {item.badges.map((badge) => (
                              <span
                                key={badge}
                                className="rounded bg-bg-secondary px-1 text-[10px] text-text-secondary"
                              >
                                {badge}
                              </span>
                            ))}
                          </span>
                        ) : null}
                        {item.note ? (
                          <span className="block text-xs text-state-error">{item.note}</span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-text-secondary">{group.emptyHint}</p>
              )}
            </div>
          ))}
        </div>
      </Panel>

      {role ? (
        <RoleAssignmentsPanel
          code={role.code}
          onChanged={() => void refreshRole()}
        />
      ) : null}
    </div>
  );
}

const ASSIGNMENT_PAGE_SIZE = 20;

// 已分配人员面板：分页数据与撤销操作内聚于此，编辑器只提供角色编码。
function RoleAssignmentsPanel({
  code,
  onChanged,
}: {
  code: string;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<RoleAssignmentDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.roleAssignmentsByRole(code, {
        page,
        page_size: ASSIGNMENT_PAGE_SIZE,
      });
      setRows(Array.isArray(result.data) ? result.data : []);
      setTotal(result.total ?? 0);
    } catch (err) {
      setError(errorMessage(err));
      setRows([]);
      setTotal(0);
    }
  }, [code, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(row: RoleAssignmentDetail) {
    const ok = window.confirm(
      `确认撤销 ${row.person_name || row.person_no} 的「${row.role_name}」分配？`,
    );
    if (!ok) return;
    setBusyRow(row.id);
    try {
      await api.revokeRoleAssignment(
        row.person_id,
        row.role_code,
        row.scope_all ? undefined : row.unit_id,
      );
      await load();
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyRow(null);
    }
  }

  const hasMore = page * ASSIGNMENT_PAGE_SIZE < total;

  return (
    <Panel
      title="已分配人员"
      extra={<span className="text-xs text-text-secondary">共 {total} 条</span>}
      bodyClassName="p-0"
    >
      <div className="p-4 pb-0">
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      </div>
      {rows.length > 0 ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>人员</TableHead>
                <TableHead>部门</TableHead>
                <TableHead>含下级</TableHead>
                <TableHead>人员状态</TableHead>
                <TableHead>分配时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="font-medium">{row.person_name || row.person_no}</span>
                    <span className="ml-1 text-xs text-text-tertiary">
                      {' '}
                      {row.person_no || '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.scope_all ? (
                      '全校'
                    ) : (
                      <span>
                        {row.unit_name || '—'}
                        {row.unit_status && row.unit_status !== 'active' ? (
                          <span className="ml-1 text-xs text-state-error">
                            部门{row.unit_status === 'disabled' ? '已停用' : row.unit_status}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {row.scope_all ? '—' : row.include_descendants ? '含下级' : '仅本部门'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.person_status} />
                  </TableCell>
                  <TableCell className="text-xs text-text-tertiary">
                    {formatDateTime(row.created_at)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-state-error"
                      disabled={busyRow === row.id}
                      onClick={() => void revoke(row)}
                    >
                      撤销
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <footer className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-text-secondary">
              第 {page} 页 · 共 {total} 条
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => current + 1)}
                disabled={!hasMore}
              >
                下一页
              </Button>
            </div>
          </footer>
        </>
      ) : (
        <div className="p-4">
          <EmptyState title="尚未分配" description="该角色还没有分配给任何人员。" />
        </div>
      )}
    </Panel>
  );
}


