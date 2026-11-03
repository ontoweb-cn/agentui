import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

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
import {
  api,
  errorMessage,
  type Invitation,
  type Person,
  type Project,
  type Unit,
} from '@/services/hiedu/api';
import { formatDateTime, hasPermission } from '@/services/hiedu/format';
import { AppModal } from './components/modal';
import { Field, PageHeader, Panel } from './components/page';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
  StatusBadge,
} from './components/state';
import { useMe } from './hooks';

const PAGE_SIZE = 20;
const OPTION_LIMIT = 300;

const SELECT_CLASS =
  'h-8 w-full rounded-md border-0.5 border-border-button bg-bg-input px-2 text-sm text-text-primary outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent-primary disabled:cursor-not-allowed disabled:opacity-50';

const PROJECT_STATUSES = [
  { value: 'all', label: '全部状态' },
  { value: 'draft', label: '草稿' },
  { value: 'active', label: '进行中' },
  { value: 'closed', label: '已关闭' },
  { value: 'cancelled', label: '已取消' },
];

const CATEGORY_OPTIONS = [
  { value: 'TEACHING', label: '教学' },
  { value: 'RESEARCH', label: '科研' },
];

interface CreateForm {
  project_code: string;
  name: string;
  category_code: string;
  owner_person_id: string;
  unit_id: string;
  course_code: string;
  start_date: string;
  end_date: string;
  max_members: string;
}

const EMPTY_CREATE: CreateForm = {
  project_code: '',
  name: '',
  category_code: 'TEACHING',
  owner_person_id: '',
  unit_id: '',
  course_code: '',
  start_date: '',
  end_date: '',
  max_members: '',
};

interface InviteForm {
  project_id: string;
  inviter_person_id: string;
  invitee_person_id: string;
  max_uses: string;
}

const EMPTY_INVITE: InviteForm = {
  project_id: '',
  inviter_person_id: '',
  invitee_person_id: '',
  max_uses: '',
};

function personLabel(person: Person): string {
  return `${person.name}（${person.person_no}）`;
}

export default function ProjectsPage() {
  const me = useMe();
  const canRead =
    hasPermission(me.permissions, 'project:read') ||
    hasPermission(me.permissions, 'project:read:own');
  const canWrite = hasPermission(me.permissions, 'project:write');

  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [units, setUnits] = useState<Unit[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);

  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invLoading, setInvLoading] = useState(false);
  const [invError, setInvError] = useState<string | null>(null);
  const [invProjectFilter, setInvProjectFilter] = useState('');

  const [dialog, setDialog] = useState<'create' | 'invite' | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const [inviteForm, setInviteForm] = useState<InviteForm>(EMPTY_INVITE);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 快速切换筛选/页码时，过期响应不得覆盖新数据。
  const loadSeqRef = useRef(0);
  const load = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.projects({
        q: q || undefined,
        status: status === 'all' ? undefined : status,
        category: category === 'all' ? undefined : category,
        page,
        page_size: PAGE_SIZE,
      });
      if (seq !== loadSeqRef.current) return;
      setProjects(Array.isArray(result.data) ? result.data : []);
      setTotal(result.total);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(errorMessage(err));
      setProjects([]);
      setTotal(null);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [canRead, category, page, q, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canRead) return;
    api
      .units({ include_inactive: 'false', page: 1, page_size: 500 })
      .then((result) =>
        setUnits(
          Array.isArray(result.data)
            ? result.data.filter((unit) => unit.status === 'active')
            : [],
        ),
      )
      .catch(() => setUnits([]));
    api
      .persons({ page: 1, page_size: OPTION_LIMIT, status: 'active' })
      .then((result) => setPersons(Array.isArray(result.data) ? result.data : []))
      .catch(() => setPersons([]));
  }, [canRead]);

  const loadInvitations = useCallback(async () => {
    if (!canRead) {
      setInvLoading(false);
      return;
    }
    setInvLoading(true);
    setInvError(null);
    try {
      const result = await api.invitations({
        project_id: invProjectFilter ? Number(invProjectFilter) : undefined,
        page: 1,
        page_size: 100,
      });
      setInvitations(Array.isArray(result.data) ? result.data : []);
    } catch (err) {
      setInvError(errorMessage(err));
      setInvitations([]);
    } finally {
      setInvLoading(false);
    }
  }, [canRead, invProjectFilter]);

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setQ(qInput.trim());
  }

  function openCreate() {
    setCreateForm(EMPTY_CREATE);
    setFormError(null);
    setDialog('create');
  }

  function openInvite() {
    const active = projects.find((project) => project.status === 'active');
    setInviteForm({ ...EMPTY_INVITE, project_id: active ? String(active.id) : '' });
    setIssuedToken(null);
    setFormError(null);
    setDialog('invite');
  }

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setFormError(null);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const code = createForm.project_code.trim();
    const name = createForm.name.trim();
    if (!code || !name) {
      setFormError('项目编码与名称为必填项');
      return;
    }
    if (!createForm.owner_person_id || !createForm.unit_id) {
      setFormError('请选择负责人与所属部门');
      return;
    }
    if (createForm.category_code === 'TEACHING' && !createForm.course_code.trim()) {
      setFormError('教学项目必须填写课程代码');
      return;
    }
    setBusy(true);
    try {
      await api.createProject({
        project_code: code,
        name,
        category_code: createForm.category_code,
        owner_person_id: Number(createForm.owner_person_id),
        unit_id: Number(createForm.unit_id),
        course_code: createForm.course_code.trim() || undefined,
        start_date: createForm.start_date || undefined,
        end_date: createForm.end_date || undefined,
        max_members: createForm.max_members ? Number(createForm.max_members) : undefined,
      });
      closeDialog();
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function publish(project: Project) {
    setBusy(true);
    setError(null);
    try {
      await api.publishProject(project.id);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!inviteForm.project_id) {
      setFormError('请选择项目');
      return;
    }
    setBusy(true);
    try {
      const result = await api.createInvitation({
        project_id: Number(inviteForm.project_id),
        inviter_person_id: inviteForm.inviter_person_id
          ? Number(inviteForm.inviter_person_id)
          : undefined,
        invitee_person_id: inviteForm.invitee_person_id
          ? Number(inviteForm.invitee_person_id)
          : undefined,
        max_uses: inviteForm.max_uses ? Number(inviteForm.max_uses) : undefined,
      });
      setIssuedToken(result.data.token);
      await loadInvitations();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invitation: Invitation) {
    setBusy(true);
    try {
      await api.revokeInvitation(invitation.id);
      await loadInvitations();
    } catch (err) {
      setInvError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!canRead) {
    return (
      <ForbiddenState
        message="无权限查看项目"
        detail="需要 project:read 或 project:read:own 权限。"
      />
    );
  }

  const hasMore = total !== null ? page * PAGE_SIZE < total : projects.length >= PAGE_SIZE;
  const activeProjects = projects.filter((project) => project.status === 'active');
  const staffOptions = persons.filter((person) => person.person_type === 'STAFF');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="项目与邀请"
        description="管理教学/科研项目，发布后由 IdP 投影生成项目组，并维护加入邀请。"
        actions={
          canWrite ? (
            <>
              <Button variant="outline" size="sm" onClick={openInvite}>
                新建邀请
              </Button>
              <Button size="sm" onClick={openCreate}>
                新建项目
              </Button>
            </>
          ) : null
        }
      />

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border-button bg-bg-card p-3"
        onSubmit={handleSearch}
      >
        <Field label="搜索" className="min-w-48 flex-1">
          <Input
            type="search"
            value={qInput}
            onChange={(event) => setQInput(event.target.value)}
            placeholder="项目名称或编码"
          />
        </Field>
        <Field label="状态" className="w-36">
          <select
            className={SELECT_CLASS}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            {PROJECT_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="类别" className="w-36">
          <select
            className={SELECT_CLASS}
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">全部类别</option>
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" size="sm">
          查询
        </Button>
      </form>

      {loading ? <LoadingState label="正在加载项目列表…" /> : null}
      {!loading && error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : null}

      {!loading && !error ? (
        <Panel className="overflow-hidden" bodyClassName="p-0">
          {projects.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>项目</TableHead>
                    <TableHead>编码</TableHead>
                    <TableHead>类别</TableHead>
                    <TableHead>课程</TableHead>
                    <TableHead>周期</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell className="font-medium">{project.name}</TableCell>
                      <TableCell>
                        <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                          {project.project_code}
                        </code>
                      </TableCell>
                      <TableCell>
                        {project.category_code === 'TEACHING' ? '教学' : '科研'}
                      </TableCell>
                      <TableCell>{project.course_code || '—'}</TableCell>
                      <TableCell className="text-text-secondary">
                        {project.start_date || '—'} ~ {project.end_date || '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={project.status} />
                      </TableCell>
                      <TableCell>
                        {canWrite && project.status === 'draft' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => void publish(project)}
                          >
                            发布
                          </Button>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-button px-4 py-3">
                <span className="text-xs text-text-secondary">
                  第 {page} 页 · 共 {total === null ? '—' : total} 条
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1 || loading}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={!hasMore || loading}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="p-4">
              <EmptyState title="未找到项目" description="请调整筛选条件或新建项目。" />
            </div>
          )}
        </Panel>
      ) : null}

      <Panel
        title="加入邀请"
        className="overflow-hidden"
        bodyClassName={invitations.length > 0 ? 'p-0' : undefined}
        extra={
          <Field label="按项目筛选" className="w-52">
            <select
              className={SELECT_CLASS}
              value={invProjectFilter}
              onChange={(event) => setInvProjectFilter(event.target.value)}
            >
              <option value="">全部可见项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>
        }
      >
        {invLoading ? <LoadingState label="正在加载邀请…" /> : null}
        {!invLoading && invError ? (
          <ErrorState message={invError} onRetry={() => void loadInvitations()} />
        ) : null}
        {!invLoading && !invError ? (
          invitations.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>项目</TableHead>
                  <TableHead>邀请人</TableHead>
                  <TableHead>被邀请人</TableHead>
                  <TableHead>使用</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>到期时间</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((invitation) => (
                  <TableRow key={invitation.id}>
                    <TableCell>
                      <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                        {projects.find((p) => p.id === invitation.project_id)?.name ??
                          `#${invitation.project_id}`}
                      </code>
                    </TableCell>
                    <TableCell>{invitation.inviter_person_id || '—'}</TableCell>
                    <TableCell>{invitation.invitee_person_id || '公开'}</TableCell>
                    <TableCell>
                      {invitation.used_count} / {invitation.max_uses}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={invitation.status} />
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {formatDateTime(invitation.expires_at)}
                    </TableCell>
                    <TableCell>
                      {canWrite && invitation.status === 'open' ? (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy}
                          onClick={() => void revoke(invitation)}
                        >
                          撤销
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
            <EmptyState title="暂无邀请" description="仅进行中的项目可创建邀请。" />
          )
        ) : null}
      </Panel>

      {dialog === 'create' ? (
        <AppModal
          title="新建项目"
          className="sm:max-w-2xl"
          onClose={closeDialog}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={closeDialog}
                disabled={busy}
              >
                取消
              </Button>
              <Button
                type="submit"
                form="project-create-form"
                size="sm"
                loading={busy}
              >
                {busy ? '创建中…' : '创建'}
              </Button>
            </>
          }
        >
          <form
            id="project-create-form"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            onSubmit={(event) => void submitCreate(event)}
          >
            <Field label="项目编码 *">
              <Input
                value={createForm.project_code}
                onChange={(event) =>
                  setCreateForm({ ...createForm, project_code: event.target.value })
                }
                placeholder="如 CS2026"
                required
              />
            </Field>
            <Field label="项目名称 *">
              <Input
                value={createForm.name}
                onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })}
                required
              />
            </Field>
            <Field label="类别 *">
              <select
                className={SELECT_CLASS}
                value={createForm.category_code}
                onChange={(event) =>
                  setCreateForm({ ...createForm, category_code: event.target.value })
                }
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`课程代码 ${createForm.category_code === 'TEACHING' ? '*' : ''}`}>
              <Input
                value={createForm.course_code}
                onChange={(event) =>
                  setCreateForm({ ...createForm, course_code: event.target.value })
                }
              />
            </Field>
            <Field label="负责人 *">
              <select
                className={SELECT_CLASS}
                value={createForm.owner_person_id}
                onChange={(event) =>
                  setCreateForm({ ...createForm, owner_person_id: event.target.value })
                }
              >
                <option value="">请选择在职教职工</option>
                {staffOptions.map((person) => (
                  <option key={person.id} value={person.id}>
                    {personLabel(person)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="所属部门 *">
              <select
                className={SELECT_CLASS}
                value={createForm.unit_id}
                onChange={(event) =>
                  setCreateForm({ ...createForm, unit_id: event.target.value })
                }
              >
                <option value="">请选择</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}（{unit.unit_code}）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="开始日期">
              <Input
                type="date"
                value={createForm.start_date}
                onChange={(event) =>
                  setCreateForm({ ...createForm, start_date: event.target.value })
                }
              />
            </Field>
            <Field label="结束日期">
              <Input
                type="date"
                value={createForm.end_date}
                onChange={(event) =>
                  setCreateForm({ ...createForm, end_date: event.target.value })
                }
              />
            </Field>
            <Field label="成员上限">
              <Input
                type="number"
                min={1}
                max={1000}
                value={createForm.max_members}
                onChange={(event) =>
                  setCreateForm({ ...createForm, max_members: event.target.value })
                }
                placeholder="默认 200"
              />
            </Field>
            <p className="text-xs text-text-secondary sm:col-span-2">
              创建后为草稿状态，发布后才会建立 IdP 项目组。
            </p>
            {formError ? (
              <p className="text-sm text-state-error sm:col-span-2">{formError}</p>
            ) : null}
          </form>
        </AppModal>
      ) : null}

      {dialog === 'invite' ? (
        <AppModal
          title="新建邀请"
          className="sm:max-w-xl"
          onClose={closeDialog}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={closeDialog}
                disabled={busy}
              >
                {issuedToken ? '关闭' : '取消'}
              </Button>
              {issuedToken ? null : (
                <Button
                  type="submit"
                  form="invite-create-form"
                  size="sm"
                  loading={busy}
                >
                  {busy ? '创建中…' : '创建邀请'}
                </Button>
              )}
            </>
          }
        >
          {issuedToken ? (
            <div className="flex flex-col gap-3">
              <p className="rounded-md bg-state-warning/5 px-3 py-2 text-sm text-state-warning">
                邀请 token 仅显示一次，请立即复制并通过安全渠道分发。
              </p>
              <Field label="邀请 token">
                <Input
                  value={issuedToken}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
              </Field>
            </div>
          ) : (
            <form
              id="invite-create-form"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              onSubmit={(event) => void submitInvite(event)}
            >
              <Field label="项目 *" className="sm:col-span-2">
                <select
                  className={SELECT_CLASS}
                  value={inviteForm.project_id}
                  onChange={(event) =>
                    setInviteForm({ ...inviteForm, project_id: event.target.value })
                  }
                >
                  <option value="">请选择进行中的项目</option>
                  {activeProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}（{project.project_code}）
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="邀请人">
                <select
                  className={SELECT_CLASS}
                  value={inviteForm.inviter_person_id}
                  onChange={(event) =>
                    setInviteForm({ ...inviteForm, inviter_person_id: event.target.value })
                  }
                >
                  <option value="">不指定</option>
                  {staffOptions.map((person) => (
                    <option key={person.id} value={person.id}>
                      {personLabel(person)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="被邀请人">
                <select
                  className={SELECT_CLASS}
                  value={inviteForm.invitee_person_id}
                  onChange={(event) =>
                    setInviteForm({ ...inviteForm, invitee_person_id: event.target.value })
                  }
                >
                  <option value="">公开邀请</option>
                  {persons.map((person) => (
                    <option key={person.id} value={person.id}>
                      {personLabel(person)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="最大使用次数">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={inviteForm.max_uses}
                  onChange={(event) =>
                    setInviteForm({ ...inviteForm, max_uses: event.target.value })
                  }
                  placeholder="公开邀请默认 20"
                />
              </Field>
              {activeProjects.length === 0 ? (
                <p className="text-xs text-text-secondary sm:col-span-2">
                  当前页没有进行中的项目：请先发布项目后再创建邀请。
                </p>
              ) : null}
              {formError ? (
                <p className="text-sm text-state-error sm:col-span-2">{formError}</p>
              ) : null}
            </form>
          )}
        </AppModal>
      ) : null}
    </div>
  );
}
