/**
 * 应用详情：概览/权限目录/角色引用/项目映射/团队映射/直授授权/对账七个页签。
 *
 * 移植自 intellect-auth/hiedu/web/src/pages/AppDetail.tsx：
 * - 各页签按权限点独立门控（role:admin → 目录维护；project:write / unit:write → 映射与直授）；
 * - 未激活页签不挂载（Radix Tabs 默认卸载，对齐源页条件渲染），切换即重新拉取；
 * - 目录停用为整行替换（带全量字段 + status=revoked，评审 #11）；直授撤销需确认（评审 #7）；
 * - 下拉数据显式 page_size=500 并给出截断提示（评审 #4）；人员搜索带并发序号防陈旧。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Routes } from '@/constants/routes';
import { cn } from '@/lib/utils';
import {
  api,
  errorMessage,
  type AppBindings,
  type AppGrantView,
  type AppPermission,
  type AppRegistry,
  type AppReconcileReport,
  type GrantInput,
  type Me,
  type Project,
  type ProjectAppLink,
  type Unit,
  type UnitAppLink,
} from '@/services/hiedu/api';
import { formatDateTime, hasPermission } from '@/services/hiedu/format';
import { AppModal } from './components/modal';
import { Field, PageHeader, Panel } from './components/page';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from './components/state';
import { AppStatusBadge, syncModeLabel } from './apps';
import { useMe } from './hooks';

const APPS_BASE = `${Routes.UserSetting}${Routes.IntellectAuthApps}`;

// 与 projects.tsx 同款原生 select 样式（下拉需带 disabled 选项与受控 value）。
const SELECT_CLASS =
  'h-8 w-full rounded-md border-0.5 border-border-button bg-bg-input px-2 text-sm text-text-primary outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent-primary disabled:cursor-not-allowed disabled:opacity-50';

type TabKey = 'overview' | 'perms' | 'roles' | 'plinks' | 'ulinks' | 'grants' | 'reconcile';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'perms', label: '权限目录' },
  { key: 'roles', label: '角色引用' },
  { key: 'plinks', label: '项目映射' },
  { key: 'ulinks', label: '团队映射' },
  { key: 'grants', label: '直授授权' },
  { key: 'reconcile', label: '对账' },
];

const KIND_LABEL: Record<string, string> = {
  platform: '平台档',
  project: '项目档',
  team: '团队档',
};

const EMPTY_PERM = {
  perm_code: '',
  display_name: '',
  kind: 'project',
  assignable: true,
  owner_only: false,
  sort: 0,
  description: '',
};

/** 对账漂移类别徽标（源页面 badge-warn）。 */
function DriftBadge({ children }: { children: ReactNode }) {
  return (
    <Badge
      variant="secondary"
      className="rounded-md border-transparent bg-state-warning/5 text-state-warning"
    >
      {children}
    </Badge>
  );
}

export default function AppDetailPage() {
  const me = useMe();
  const params = useParams<{ code: string }>();
  const code = params.code ?? '';
  const [app, setApp] = useState<AppRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.app(code);
      setApp(result.data);
    } catch (err) {
      setError(errorMessage(err));
      setApp(null);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <LoadingState label="正在加载应用…" />
      </div>
    );
  }
  if (error || !app) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorState message={error ?? '应用不存在'} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-1 text-sm text-text-secondary">
        <Link className="text-accent-primary hover:underline" to={APPS_BASE}>
          应用管理
        </Link>
        <span>/</span>
        <code className="rounded bg-bg-secondary px-1 text-xs">{app.app_code}</code>
      </p>
      <PageHeader
        title={app.display_name}
        description={`分发模式 ${syncModeLabel(app.sync_mode)} · 最近同步 ${formatDateTime(app.synced_at)}`}
        actions={<AppStatusBadge status={app.status} activeLabel="在管" />}
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
        <TabsList className="flex-wrap" aria-label="应用详情分区">
          {TABS.map((item) => (
            <TabsTrigger key={item.key} value={item.key}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab app={app} />
        </TabsContent>
        <TabsContent value="perms">
          <PermsTab appCode={app.app_code} active={app.status === 'active'} me={me} />
        </TabsContent>
        <TabsContent value="roles">
          <BindingsTab appCode={app.app_code} />
        </TabsContent>
        <TabsContent value="plinks">
          <ProjectLinksTab appCode={app.app_code} active={app.status === 'active'} me={me} />
        </TabsContent>
        <TabsContent value="ulinks">
          <UnitLinksTab appCode={app.app_code} active={app.status === 'active'} me={me} />
        </TabsContent>
        <TabsContent value="grants">
          <GrantsTab appCode={app.app_code} active={app.status === 'active'} me={me} />
        </TabsContent>
        <TabsContent value="reconcile">
          <ReconcileTab appCode={app.app_code} me={me} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab({ app }: { app: AppRegistry }) {
  const rows: [string, string][] = [
    ['应用编码', app.app_code],
    ['显示名称', app.display_name],
    ['状态', app.status],
    ['分发模式', syncModeLabel(app.sync_mode)],
    ['IdP 应用名', app.idp_ref || '—'],
    ['API 地址', app.api_base_url || '—'],
    ['M2M Client ID', app.m2m_client_id || '—'],
    ['M2M Secret', app.m2m_client_id ? '（走环境变量，不落库不展示）' : '—'],
    ['最近同步', formatDateTime(app.synced_at)],
  ];
  return (
    <Panel>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-text-secondary">{label}</dt>
            <dd className="mt-1 text-sm text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-text-secondary">
        分发通道：平台档权限经 IdP 角色壳（
        <code className="rounded bg-bg-secondary px-1">user.app_roles</code>
        ）随 userinfo/Token 下发；项目/团队档经 API 直连推送（origin=hiedu 行）；仅登记模式不自动分发。
      </p>
    </Panel>
  );
}

function PermsTab({
  appCode,
  active,
  me,
}: {
  appCode: string;
  active: boolean;
  me: Me;
}) {
  const canAdmin = hasPermission(me.permissions, 'role:admin');
  const [perms, setPerms] = useState<AppPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<typeof EMPTY_PERM>(EMPTY_PERM);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  // 撤销目录行（评审 #11）：upsert 为整行替换，需带全量现有字段 + status=revoked。
  const [revokeTarget, setRevokeTarget] = useState<AppPermission | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.appPermissions(appCode);
      setPerms(Array.isArray(result.data) ? result.data : []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [appCode]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    setFormError('');
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(form.perm_code)) {
      setFormError('权限编码须为小写字母/数字/连字符，2~31 位');
      return;
    }
    if (!form.display_name.trim()) {
      setFormError('请填写显示名称');
      return;
    }
    setBusy(true);
    try {
      await api.upsertAppPermission(appCode, {
        ...form,
        display_name: form.display_name.trim(),
        assignable: form.kind === 'platform' ? false : form.assignable,
      });
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setBusy(true);
    try {
      await api.upsertAppPermission(appCode, {
        perm_code: revokeTarget.perm_code,
        display_name: revokeTarget.display_name,
        kind: revokeTarget.kind,
        assignable: revokeTarget.assignable,
        owner_only: revokeTarget.owner_only,
        sort: revokeTarget.sort,
        description: revokeTarget.description,
        status: 'revoked',
      });
      setRevokeTarget(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="overflow-hidden" bodyClassName="p-0">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
        <p className="max-w-2xl text-sm text-text-secondary">
          平台档：唯一事实源为本地 RBAC（角色编辑器勾选），不可直授；
          项目/团队档经直授或默认值 seed 分发。
        </p>
        {active && canAdmin ? (
          <Button
            size="sm"
            onClick={() => {
              setForm(EMPTY_PERM);
              setFormError('');
              setOpen(true);
            }}
          >
            新增权限点
          </Button>
        ) : null}
      </div>
      {loading ? (
        <div className="px-4 pb-4">
          <LoadingState />
        </div>
      ) : null}
      {!loading && error ? (
        <div className="px-4 pb-4">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : null}
      {!loading && !error ? (
        perms.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>编码</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>档位</TableHead>
                <TableHead>可直授</TableHead>
                <TableHead>负责人限定</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>说明</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perms.map((p) => (
                <TableRow key={p.perm_code}>
                  <TableCell>
                    <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                      {p.perm_code}
                    </code>
                  </TableCell>
                  <TableCell className="font-medium">{p.display_name}</TableCell>
                  <TableCell className="text-text-secondary">
                    {KIND_LABEL[p.kind] ?? p.kind}
                  </TableCell>
                  <TableCell>{p.assignable ? '是' : '否'}</TableCell>
                  <TableCell className="text-text-secondary">
                    {p.owner_only ? '仅项目负责人' : '—'}
                  </TableCell>
                  <TableCell>
                    <AppStatusBadge status={p.status} activeLabel="有效" />
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {p.description || '—'}
                  </TableCell>
                  <TableCell>
                    {active && canAdmin && p.status === 'active' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-state-error"
                        disabled={busy}
                        onClick={() => setRevokeTarget(p)}
                      >
                        停用
                      </Button>
                    ) : (
                      <span className="text-text-secondary">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-4">
            <EmptyState title="目录为空" description="为该应用登记可分配的权限档位。" />
          </div>
        )
      ) : null}

      {revokeTarget ? (
        <AppModal
          title="停用权限点"
          className="sm:max-w-lg"
          onClose={() => {
            if (!busy) setRevokeTarget(null);
          }}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRevokeTarget(null)}
                disabled={busy}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                loading={busy}
                onClick={() => void confirmRevoke()}
              >
                {busy ? '处理中…' : '确认停用'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-primary">
              停用后该权限点停止分发：角色中对应的{' '}
              <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                app/{appCode}:{revokeTarget.perm_code}
              </code>{' '}
              引用不再生效，其名下 active 直授一并撤销。可重新登记同编码恢复。
            </p>
            <p className="text-xs text-text-secondary">
              权限点{' '}
              <code className="rounded bg-bg-secondary px-1 text-text-secondary">
                {revokeTarget.perm_code}
              </code>
              （{revokeTarget.display_name}）
            </p>
          </div>
        </AppModal>
      ) : null}

      {open ? (
        <AppModal
          title="新增权限点"
          className="sm:max-w-lg"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                取消
              </Button>
              <Button type="button" size="sm" loading={busy} onClick={() => void submit()}>
                {busy ? '保存中…' : '保存'}
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="权限编码 *">
              <Input
                value={form.perm_code}
                onChange={(event) => setForm({ ...form, perm_code: event.target.value })}
                placeholder="如 admin / project-dev"
                disabled={busy}
              />
            </Field>
            <Field label="显示名称 *">
              <Input
                value={form.display_name}
                onChange={(event) =>
                  setForm({ ...form, display_name: event.target.value })
                }
                disabled={busy}
              />
            </Field>
            <Field label="档位">
              <select
                className={SELECT_CLASS}
                value={form.kind}
                onChange={(event) => setForm({ ...form, kind: event.target.value })}
                disabled={busy}
              >
                <option value="platform">平台档（RBAC 单源，不可直授）</option>
                <option value="project">项目档</option>
                <option value="team">团队档</option>
              </select>
            </Field>
            <Field label="说明">
              <Input
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                disabled={busy}
              />
            </Field>
            {form.kind !== 'platform' ? (
              <Field
                label="负责人限定（owner_only：仅项目负责人可持）"
                className="sm:col-span-2"
              >
                <select
                  className={SELECT_CLASS}
                  value={form.owner_only ? '1' : '0'}
                  onChange={(event) =>
                    setForm({ ...form, owner_only: event.target.value === '1' })
                  }
                  disabled={busy}
                >
                  <option value="0">否</option>
                  <option value="1">是</option>
                </select>
              </Field>
            ) : null}
            {formError ? (
              <p className="text-sm text-state-error sm:col-span-2">{formError}</p>
            ) : null}
          </div>
        </AppModal>
      ) : null}
    </Panel>
  );
}

function BindingsTab({ appCode }: { appCode: string }) {
  const [bindings, setBindings] = useState<AppBindings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .appBindings(appCode)
      .then((result) => {
        if (!cancelled) setBindings(result.data);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appCode]);

  if (loading) return <LoadingState label="正在加载引用关系…" />;
  if (error) return <ErrorState message={error} />;
  if (!bindings) return null;

  return (
    <Panel className="overflow-hidden" bodyClassName="p-0">
      <p className="px-4 pt-4 text-sm text-text-secondary">
        “角色引用”列出通过本地角色获得该应用权限的人员入口；直授见「直授授权」页签。
      </p>
      {bindings.role_refs.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>权限点</TableHead>
              <TableHead>档位</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>引用角色</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bindings.role_refs.map((ref) => (
              <TableRow key={ref.perm_code}>
                <TableCell>
                  <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                    {ref.perm_code}
                  </code>
                  {ref.display_name ? `（${ref.display_name}）` : ''}
                </TableCell>
                <TableCell className="text-text-secondary">
                  {KIND_LABEL[ref.kind ?? ''] ?? ref.kind}
                </TableCell>
                <TableCell>
                  <AppStatusBadge status={ref.status} activeLabel="有效" />
                </TableCell>
                <TableCell>
                  {ref.roles.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1">
                      {ref.roles.map((role) => (
                        <span
                          key={role.code}
                          className={cn(
                            'rounded px-1 text-xs',
                            role.status === 'active'
                              ? 'bg-accent-primary/5 text-accent-primary'
                              : 'bg-bg-secondary text-text-secondary',
                          )}
                        >
                          {role.name}（{role.code}）
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-text-secondary">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="p-4">
          <EmptyState
            title="尚无角色引用"
            description="在「角色与授权」编辑器中勾选该应用的权限点后，这里会显示引用关系。"
          />
        </div>
      )}
    </Panel>
  );
}

function ProjectLinksTab({
  appCode,
  active,
  me,
}: {
  appCode: string;
  active: boolean;
  me: Me;
}) {
  const canWrite = hasPermission(me.permissions, 'project:write');
  const [links, setLinks] = useState<ProjectAppLink[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsTruncated, setProjectsTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [linkResult, projectResult] = await Promise.all([
        api.appProjectLinks(appCode),
        // 显式 page_size=500（后端上限，评审 #4）：避免默认 50 静默截断下拉。
        api.projects({ page: 1, page_size: 500 }),
      ]);
      setLinks(Array.isArray(linkResult.data) ? linkResult.data : []);
      setProjects(Array.isArray(projectResult.data) ? projectResult.data : []);
      setProjectsTruncated(
        projectResult.total !== null && projectResult.total > (projectResult.data?.length ?? 0),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [appCode]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeProjects = projects.filter((p) => p.status === 'active');

  async function submit() {
    setFormError('');
    const pid = Number(projectId);
    if (!pid) {
      setFormError('请选择项目');
      return;
    }
    if (!/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(name)) {
      setFormError('应用侧项目名须为 DNS-1123 格式（小写字母/数字/连字符）');
      return;
    }
    setBusy(true);
    try {
      await api.upsertAppProjectLink(appCode, { project_id: pid, app_project_name: name });
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="overflow-hidden" bodyClassName="p-0">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
        <p className="max-w-2xl text-sm text-text-secondary">
          建立映射后，项目成员按直授与默认值 seed 收敛到应用侧（origin=hiedu 行）。
          {canWrite ? '' : '（需要 project:write 权限维护映射）'}
        </p>
        {active && canWrite ? (
          <Button
            size="sm"
            onClick={() => {
              setProjectId('');
              setName('');
              setFormError('');
              setOpen(true);
            }}
          >
            新增映射
          </Button>
        ) : null}
      </div>
      {loading ? (
        <div className="px-4 pb-4">
          <LoadingState />
        </div>
      ) : null}
      {!loading && error ? (
        <div className="px-4 pb-4">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : null}
      {!loading && !error ? (
        links.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>项目 ID</TableHead>
                <TableHead>应用侧项目名</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近同步</TableHead>
                <TableHead>最近错误</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => (
                <TableRow key={link.id}>
                  <TableCell>{link.project_id}</TableCell>
                  <TableCell>
                    <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                      {link.app_project_name}
                    </code>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={link.status} />
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {formatDateTime(link.last_synced_at)}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {link.last_error || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-4">
            <EmptyState title="暂无项目映射" />
          </div>
        )
      ) : null}

      {open ? (
        <AppModal
          title="新增项目映射"
          className="sm:max-w-lg"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                取消
              </Button>
              <Button type="button" size="sm" loading={busy} onClick={() => void submit()}>
                {busy ? '保存中…' : '保存'}
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="项目 *">
              <select
                className={SELECT_CLASS}
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  const project = activeProjects.find(
                    (p) => String(p.id) === event.target.value,
                  );
                  if (project) setName(`hiedu-prj-${project.project_code.toLowerCase()}`);
                }}
                disabled={busy}
              >
                <option value="">请选择</option>
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code} · {p.name}
                  </option>
                ))}
              </select>
            </Field>
            {projectsTruncated ? (
              <p className="text-xs text-text-secondary sm:col-span-2">
                项目数超过一页，仅显示前 {activeProjects.length} 个；请先缩小项目规模或用编码检索。
              </p>
            ) : null}
            <Field label="应用侧项目名（DNS-1123）*" className="sm:col-span-2">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
              />
            </Field>
            {formError ? (
              <p className="text-sm text-state-error sm:col-span-2">{formError}</p>
            ) : null}
          </div>
        </AppModal>
      ) : null}
    </Panel>
  );
}

function UnitLinksTab({
  appCode,
  active,
  me,
}: {
  appCode: string;
  active: boolean;
  me: Me;
}) {
  const canWrite = hasPermission(me.permissions, 'unit:write');
  const [links, setLinks] = useState<UnitAppLink[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitsTruncated, setUnitsTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [unitId, setUnitId] = useState('');
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [linkResult, unitResult] = await Promise.all([
        api.appUnitLinks(appCode),
        api.units({ include_inactive: 'false', page: 1, page_size: 500 }),
      ]);
      setLinks(Array.isArray(linkResult.data) ? linkResult.data : []);
      setUnits(Array.isArray(unitResult.data) ? unitResult.data : []);
      setUnitsTruncated(
        unitResult.total !== null && unitResult.total > (unitResult.data?.length ?? 0),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [appCode]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeUnits = units.filter((u) => u.status === 'active');

  async function submit() {
    setFormError('');
    const uid = Number(unitId);
    if (!uid) {
      setFormError('请选择团队');
      return;
    }
    if (!/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(name)) {
      setFormError('应用侧组名须为 DNS-1123 格式');
      return;
    }
    setBusy(true);
    try {
      await api.upsertAppUnitLink(appCode, { unit_id: uid, app_unit_name: name });
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="overflow-hidden" bodyClassName="p-0">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
        <p className="max-w-2xl text-sm text-text-secondary">
          团队（Unit）与应用侧组（Team）的映射，成员经 _tsync 收敛。
          {canWrite ? '' : '（需要 unit:write 权限维护映射）'}
        </p>
        {active && canWrite ? (
          <Button
            size="sm"
            onClick={() => {
              setUnitId('');
              setName('');
              setFormError('');
              setOpen(true);
            }}
          >
            新增映射
          </Button>
        ) : null}
      </div>
      {loading ? (
        <div className="px-4 pb-4">
          <LoadingState />
        </div>
      ) : null}
      {!loading && error ? (
        <div className="px-4 pb-4">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : null}
      {!loading && !error ? (
        links.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>团队 ID</TableHead>
                <TableHead>应用侧组名</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近同步</TableHead>
                <TableHead>最近错误</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => (
                <TableRow key={link.id}>
                  <TableCell>{link.unit_id}</TableCell>
                  <TableCell>
                    <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                      {link.app_unit_name}
                    </code>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={link.status} />
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {formatDateTime(link.last_synced_at)}
                  </TableCell>
                  <TableCell className="text-text-secondary">
                    {link.last_error || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-4">
            <EmptyState title="暂无团队映射" />
          </div>
        )
      ) : null}

      {open ? (
        <AppModal
          title="新增团队映射"
          className="sm:max-w-lg"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                取消
              </Button>
              <Button type="button" size="sm" loading={busy} onClick={() => void submit()}>
                {busy ? '保存中…' : '保存'}
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="团队 *">
              <select
                className={SELECT_CLASS}
                value={unitId}
                onChange={(event) => {
                  setUnitId(event.target.value);
                  const unit = activeUnits.find((u) => String(u.id) === event.target.value);
                  if (unit) setName(`hiedu-team-${unit.unit_code.toLowerCase()}`);
                }}
                disabled={busy}
              >
                <option value="">请选择</option>
                {activeUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.unit_code} · {u.name}
                  </option>
                ))}
              </select>
            </Field>
            {unitsTruncated ? (
              <p className="text-xs text-text-secondary sm:col-span-2">
                团队数超过一页，仅显示前 {activeUnits.length} 个。
              </p>
            ) : null}
            <Field label="应用侧组名（DNS-1123）*" className="sm:col-span-2">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
              />
            </Field>
            {formError ? (
              <p className="text-sm text-state-error sm:col-span-2">{formError}</p>
            ) : null}
          </div>
        </AppModal>
      ) : null}
    </Panel>
  );
}

function GrantsTab({
  appCode,
  active,
  me,
}: {
  appCode: string;
  active: boolean;
  me: Me;
}) {
  // 直授写权限按档位切分（后端服务层同口径，评审 #2）：路由 requireAny 放行查看。
  const canGrantProject = hasPermission(me.permissions, 'project:write');
  const canGrantUnit = hasPermission(me.permissions, 'unit:write');
  const canSearchPersons = hasPermission(me.permissions, 'person:read');
  const [grants, setGrants] = useState<AppBindings['grants']>([]);
  const [perms, setPerms] = useState<AppPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [personQ, setPersonQ] = useState('');
  const [personHits, setPersonHits] = useState<
    { id: number; name: string; person_no: string }[]
  >([]);
  const [form, setForm] = useState<GrantInput>({
    person_id: 0,
    scope_kind: 'project',
    app_role: '',
  });
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  // 撤销确认（评审 #7）与项目/团队下拉（评审 #8）。
  const [revokeTarget, setRevokeTarget] = useState<AppGrantView | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const searchSeqRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [grantResult, permResult] = await Promise.all([
        api.appBindings(appCode),
        api.appPermissions(appCode),
      ]);
      setGrants(grantResult.data?.grants ?? []);
      setPerms(Array.isArray(permResult.data) ? permResult.data : []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [appCode]);

  useEffect(() => {
    void load();
  }, [load]);

  // 打开授权弹窗时拉取项目/团队下拉数据（显式 page_size=500，评审 #4）。
  useEffect(() => {
    if (!open) return;
    api
      .projects({ status: 'active', page: 1, page_size: 500 })
      .then((result) => setProjects(Array.isArray(result.data) ? result.data : []))
      .catch(() => setProjects([]));
    api
      .units({ include_inactive: 'false', page: 1, page_size: 500 })
      .then((result) => setUnits(Array.isArray(result.data) ? result.data : []))
      .catch(() => setUnits([]));
  }, [open]);

  const assignablePerms = perms.filter(
    (p) => p.status === 'active' && p.assignable && p.kind === form.scope_kind,
  );
  const canWriteScope = form.scope_kind === 'project' ? canGrantProject : canGrantUnit;

  async function searchPersons() {
    const needle = personQ.trim();
    if (!needle) {
      setPersonHits([]);
      return;
    }
    if (!canSearchPersons) {
      setFormError('缺少 person:read 权限，无法搜索人员；请改用应用角色选择器在项目成员页授权。');
      return;
    }
    const seq = ++searchSeqRef.current;
    try {
      const result = await api.persons({ q: needle, page_size: '10' });
      if (seq !== searchSeqRef.current) return;
      setPersonHits(
        (Array.isArray(result.data) ? result.data : []).map((p) => ({
          id: p.id,
          name: p.name,
          person_no: p.person_no,
        })),
      );
    } catch (err) {
      if (seq !== searchSeqRef.current) return;
      setFormError(errorMessage(err));
    }
  }

  async function submit() {
    setFormError('');
    if (!form.person_id) {
      setFormError('请选择人员');
      return;
    }
    if (!form.app_role) {
      setFormError('请选择应用角色');
      return;
    }
    if (form.scope_kind === 'project' && !form.project_id) {
      setFormError('请选择项目');
      return;
    }
    if (form.scope_kind === 'team' && !form.unit_id) {
      setFormError('请选择团队');
      return;
    }
    setBusy(true);
    try {
      await api.grantAppRole(appCode, form);
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setBusy(true);
    try {
      await api.revokeAppGrant(appCode, revokeTarget.id);
      setRevokeTarget(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="overflow-hidden" bodyClassName="p-0">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
        <p className="max-w-2xl text-sm text-text-secondary">
          日常授权推荐在项目/团队成员页按成员操作；此处为管理员侧总览与兜底入口。
          {canGrantProject || canGrantUnit ? '' : '（需要 project:write 或 unit:write 才能维护直授）'}
        </p>
        {active && (canGrantProject || canGrantUnit) ? (
          <Button
            size="sm"
            onClick={() => {
              setForm({
                person_id: 0,
                scope_kind: canGrantProject ? 'project' : 'team',
                project_id: undefined,
                unit_id: undefined,
                app_role: '',
              });
              setPersonQ('');
              setPersonHits([]);
              setFormError('');
              setOpen(true);
            }}
          >
            新增直授
          </Button>
        ) : null}
      </div>
      {loading ? (
        <div className="px-4 pb-4">
          <LoadingState />
        </div>
      ) : null}
      {!loading && error ? (
        <div className="px-4 pb-4">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : null}
      {!loading && !error ? (
        grants.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>人员</TableHead>
                <TableHead>档位</TableHead>
                <TableHead>范围</TableHead>
                <TableHead>应用角色</TableHead>
                <TableHead>授权人</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((grant) => {
                const mayRevoke = grant.scope_kind === 'project' ? canGrantProject : canGrantUnit;
                return (
                  <TableRow key={grant.id}>
                    <TableCell className="font-medium">
                      {grant.person_name || '—'}{' '}
                      <span className="text-xs text-text-secondary">
                        ({grant.person_no || grant.person_id})
                      </span>
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {grant.scope_kind === 'project' ? '项目档' : '团队档'}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {grant.scope_kind === 'project'
                        ? `项目 #${grant.project_id}`
                        : `团队 #${grant.unit_id}`}
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                        {grant.app_role}
                      </code>
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {grant.created_by || '—'}
                    </TableCell>
                    <TableCell>
                      {mayRevoke ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-state-error"
                          disabled={busy}
                          onClick={() => setRevokeTarget(grant)}
                        >
                          撤销
                        </Button>
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="p-4">
            <EmptyState
              title="暂无 active 直授"
              description="无直授的成员按应用默认值 seed（如有配置）落位。"
            />
          </div>
        )
      ) : null}

      {revokeTarget ? (
        <AppModal
          title="撤销直授"
          className="sm:max-w-md"
          onClose={() => {
            if (!busy) setRevokeTarget(null);
          }}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRevokeTarget(null)}
                disabled={busy}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                loading={busy}
                onClick={() => void confirmRevoke()}
              >
                {busy ? '处理中…' : '确认撤销'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-primary">
              撤销后该成员在该应用回落到默认值 seed（如已配置），否则不再落行；
              收敛经同步任务下发到应用侧。
            </p>
            <p className="text-xs text-text-secondary">
              {revokeTarget.person_name || `#${revokeTarget.person_id}`} ·{' '}
              <code className="rounded bg-bg-secondary px-1 text-text-secondary">
                {revokeTarget.app_role}
              </code>
            </p>
          </div>
        </AppModal>
      ) : null}

      {open ? (
        <AppModal
          title="新增直授"
          className="sm:max-w-xl"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                取消
              </Button>
              <Button type="button" size="sm" loading={busy} onClick={() => void submit()}>
                {busy ? '授权中…' : '确认授权'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {canSearchPersons ? (
              <>
                <Field label="搜索人员（工号/学号/姓名）">
                  <div className="flex gap-2">
                    <Input
                      className="flex-1"
                      value={personQ}
                      onChange={(event) => setPersonQ(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void searchPersons();
                        }
                      }}
                      disabled={busy}
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => void searchPersons()}
                    >
                      搜索
                    </Button>
                  </div>
                </Field>
                {personHits.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>姓名</TableHead>
                        <TableHead>编号</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {personHits.map((p) => (
                        <TableRow
                          key={p.id}
                          className={
                            form.person_id === p.id
                              ? 'outline outline-2 -outline-offset-2 outline-accent-primary'
                              : undefined
                          }
                        >
                          <TableCell>{p.name}</TableCell>
                          <TableCell>
                            <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                              {p.person_no}
                            </code>
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setForm({ ...form, person_id: p.id })}
                            >
                              {form.person_id === p.id ? '已选择' : '选择'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
              </>
            ) : (
              <p className="rounded-md bg-bg-secondary px-3 py-2 text-sm text-text-secondary">
                缺少 person:read 权限，无法在此搜索人员；请在项目成员页按成员直授。
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="档位">
                <select
                  className={SELECT_CLASS}
                  value={form.scope_kind}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      scope_kind: event.target.value,
                      project_id: undefined,
                      unit_id: undefined,
                      app_role: '',
                    })
                  }
                  disabled={busy}
                >
                  <option value="project" disabled={!canGrantProject}>
                    项目档{canGrantProject ? '' : '（无 project:write）'}
                  </option>
                  <option value="team" disabled={!canGrantUnit}>
                    团队档{canGrantUnit ? '' : '（无 unit:write）'}
                  </option>
                </select>
              </Field>
              {form.scope_kind === 'project' ? (
                <Field label="项目 *">
                  <select
                    className={SELECT_CLASS}
                    value={form.project_id ?? ''}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        project_id: event.target.value
                          ? Number(event.target.value)
                          : undefined,
                      })
                    }
                    disabled={busy || !canWriteScope}
                  >
                    <option value="">请选择</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.project_code} · {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="团队 *">
                  <select
                    className={SELECT_CLASS}
                    value={form.unit_id ?? ''}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        unit_id: event.target.value ? Number(event.target.value) : undefined,
                      })
                    }
                    disabled={busy || !canWriteScope}
                  >
                    <option value="">请选择</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.unit_code} · {u.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="应用角色">
                <select
                  className={SELECT_CLASS}
                  value={form.app_role}
                  onChange={(event) => setForm({ ...form, app_role: event.target.value })}
                  disabled={busy}
                >
                  <option value="">请选择</option>
                  {assignablePerms.map((p) => (
                    <option key={p.perm_code} value={p.perm_code}>
                      {p.display_name}（{p.perm_code}）{p.owner_only ? ' · 仅负责人' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {formError ? <p className="text-sm text-state-error">{formError}</p> : null}
            <p className="text-xs text-text-secondary">
              直授优先于默认值 seed；成员关系前提与 owner 限定由后端校验。
            </p>
          </div>
        </AppModal>
      ) : null}
    </Panel>
  );
}

function ReconcileTab({ appCode, me }: { appCode: string; me: Me }) {
  const [report, setReport] = useState<AppReconcileReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const result = await api.reconcileApp(appCode);
      setReport(result.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  const driftTotal = report
    ? report.grant_drifts.length + report.link_drifts.length + report.role_drifts.length
    : 0;

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-3xl text-sm text-text-secondary">
          三维对账：① 映射↔应用侧实际状态 ② IdP 角色壳成员 ③ 直授↔成员关系。只读报告；hiedu
          来源差异自动重投收敛。
        </p>
        <Button
          size="sm"
          loading={running}
          disabled={running || !me.person.id}
          onClick={() => void run()}
        >
          {running ? '对账中…' : '运行对账'}
        </Button>
      </div>
      {error ? (
        <div className="mt-3">
          <ErrorState message={error} onRetry={() => void run()} />
        </div>
      ) : null}
      {report ? (
        driftTotal === 0 ? (
          <p className="mt-3 text-sm text-text-secondary">
            三维均无漂移（应用{' '}
            <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
              {report.app_code}
            </code>
            ）。
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5 text-sm text-text-primary">
            {report.grant_drifts.map((d, index) => (
              <li key={`g-${index}`} className="flex flex-wrap items-center gap-1.5">
                <DriftBadge>直授</DriftBadge>
                <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                  {d.app_role}
                </code>
                <span>
                  person #{d.person_id} · {d.type} {d.message ?? ''}
                </span>
              </li>
            ))}
            {report.link_drifts.map((d, index) => (
              <li key={`l-${index}`} className="flex flex-wrap items-center gap-1.5">
                <DriftBadge>映射</DriftBadge>
                <span>
                  {d.scope_kind === 'project' ? '项目' : '团队'}{' '}
                  <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                    {d.app_object_name}
                  </code>{' '}
                  {d.username} · 期望 {d.expected_role || '无'} / 实际 {d.actual_role || '无'}
                  （origin={d.actual_origin || '—'}）· {d.type}
                </span>
              </li>
            ))}
            {report.role_drifts.map((d, index) => (
              <li key={`r-${index}`} className="flex flex-wrap items-center gap-1.5">
                <DriftBadge>角色壳</DriftBadge>
                <span>
                  <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                    {d.role_name}
                  </code>{' '}
                  · {d.type} {d.users ? `(${d.users})` : ''} {d.message ?? ''}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="mt-3 text-sm text-text-secondary">点击「运行对账」生成报告。</p>
      )}
    </Panel>
  );
}
