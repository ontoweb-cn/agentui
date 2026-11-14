/**
 * 项目详情：成员列表维护 + 按已映射应用按成员分配项目档应用角色。
 *
 * 移植自 intellect-auth/hiedu/web/src/pages/ProjectDetail.tsx：
 * - 分层加载（评审 #1）：成员/已映射应用各按其权限点独立拉取，403 时降级隐藏而非整页报错；
 * - 过滤/刷新并发用 loadSeqRef 防陈旧响应覆盖新数据（评审 #6）；
 * - 直授变更先撤销再重授、非原子（评审 #3）：失败时明确告知原直授已撤销。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Routes } from '@/constants/routes';
import {
  api,
  errorMessage,
  type AppGrant,
  type AppPermission,
  type AppRegistry,
  type Person,
  type Project,
  type ProjectAppLink,
  type ProjectMember,
} from '@/services/hiedu/api';
import { hasPermission } from '@/services/hiedu/format';
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

const PROJECTS_BASE = `${Routes.UserSetting}${Routes.IntellectAuthProjects}`;

// 与 projects.tsx 同款原生 select 样式（下拉需带受控 value 与逐行禁用）。
const SELECT_CLASS =
  'h-8 w-full rounded-md border-0.5 border-border-button bg-bg-input px-2 text-sm text-text-primary outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent-primary disabled:cursor-not-allowed disabled:opacity-50';

/** 单个已 link 应用的项目档直授视图：成员 × 应用角色选择器（方案 §4.4）。 */
interface LinkedApp {
  registry: AppRegistry;
  link: ProjectAppLink;
  roles: AppPermission[]; // kind=project 且 active 且 assignable
  grants: AppGrant[]; // 该应用本项目的 active 直授（按 person_id 索引）
}

export default function ProjectDetailPage() {
  const me = useMe();
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id ?? '');
  // 页内权限门控:anyOf(project:read | project:read:own),对齐源仓路由门。
  const canReadAny =
    hasPermission(me.permissions, 'project:read') ||
    hasPermission(me.permissions, 'project:read:own');
  const canWrite = hasPermission(me.permissions, 'project:write');
  const canReadMembers = hasPermission(me.permissions, 'project:read');

  const [project, setProject] = useState<Project | null>(null);
  // null = 无 project:read 权限，成员区块整体隐藏（read:own 主体仍可看项目信息）。
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [persons, setPersons] = useState<Person[]>([]);
  const [personsWarning, setPersonsWarning] = useState('');
  const [linkedApps, setLinkedApps] = useState<LinkedApp[] | null>(null);
  // 应用侧加载失败的应用名聚合展示（评审 #5：禁止静默吞错）。
  const [degradeNotice, setDegradeNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addPerson, setAddPerson] = useState('');
  const [addRole, setAddRole] = useState('MEMBER');
  const [addError, setAddError] = useState('');

  // 过滤/刷新并发时陈旧响应不得覆盖新数据（评审 #6，对齐 Persons/Jobs 模式）。
  const loadSeqRef = useRef(0);
  const load = useCallback(async () => {
    if (!projectId) {
      setError('无效的项目 ID');
      setLoading(false);
      return;
    }
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const projectResult = await api.project(projectId);
      if (seq !== loadSeqRef.current) return;
      setProject(projectResult.data);

      // 分层加载（评审 #1）：各区块按其权限点独立拉取，403 时降级隐藏而非整页报错。
      if (canReadMembers) {
        try {
          const memberResult = await api.projectMembers(projectId);
          if (seq !== loadSeqRef.current) return;
          setMembers(Array.isArray(memberResult.data) ? memberResult.data : []);
        } catch (err) {
          if (seq !== loadSeqRef.current) return;
          setMembers(null);
          setDegradeNotice(
            (prev) => `${prev}成员列表加载失败：${errorMessage(err)}；`.trim(),
          );
        }
      } else {
        setMembers(null);
      }

      if (canWrite) {
        // 直授选择器需要：已映射应用 + 目录 + 直授。persons 仅“添加成员”用，失败单独降级。
        try {
          const personResult = await api.persons({
            status: 'active',
            page: 1,
            page_size: 500,
          });
          if (seq !== loadSeqRef.current) return;
          setPersons(Array.isArray(personResult.data) ? personResult.data : []);
          setPersonsWarning('');
        } catch (err) {
          if (seq !== loadSeqRef.current) return;
          setPersons([]);
          setPersonsWarning(`人员列表不可读，无法按姓名选择（${errorMessage(err)}）`);
        }

        const failures: string[] = [];
        const linked: LinkedApp[] = [];
        try {
          const appsResult = await api.apps();
          const registries = (Array.isArray(appsResult.data) ? appsResult.data : []).filter(
            (app) => app.status === 'active',
          );
          for (const registry of registries) {
            try {
              const [linkResult, permResult, grantResult] = await Promise.all([
                api.appProjectLinks(registry.app_code),
                api.appPermissions(registry.app_code),
                api.appGrants(registry.app_code, { project_id: String(projectId) }),
              ]);
              if (seq !== loadSeqRef.current) return;
              const link = (Array.isArray(linkResult.data) ? linkResult.data : []).find(
                (item) => item.project_id === projectId && item.status === 'active',
              );
              if (!link) continue;
              linked.push({
                registry,
                link,
                roles: (Array.isArray(permResult.data) ? permResult.data : []).filter(
                  (p) => p.kind === 'project' && p.status === 'active' && p.assignable,
                ),
                grants: Array.isArray(grantResult.data) ? grantResult.data : [],
              });
            } catch {
              failures.push(registry.display_name || registry.app_code);
            }
          }
        } catch (err) {
          failures.push(`应用列表（${errorMessage(err)}）`);
        }
        if (seq !== loadSeqRef.current) return;
        setLinkedApps(linked);
        setDegradeNotice(
          failures.length > 0
            ? `以下应用数据加载失败（已降级隐藏）：${failures.join('、')}`
            : '',
        );
      } else {
        setLinkedApps(null);
      }
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(errorMessage(err));
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [canReadMembers, canWrite, projectId]);

  useEffect(() => {
    // 未授权不发业务请求(避免噪音 403)。
    if (!canReadAny) return;
    void load();
  }, [load, canReadAny]);

  const personById = useMemo(() => {
    const map = new Map<number, Person>();
    for (const person of persons) map.set(person.id, person);
    return map;
  }, [persons]);

  async function addMember() {
    setAddError('');
    if (!addPerson) {
      setAddError('请选择人员');
      return;
    }
    setBusy(true);
    try {
      await api.addProjectMember(projectId, {
        person_id: Number(addPerson),
        role_code: addRole,
      });
      setAddOpen(false);
      setAddPerson('');
      setAddRole('MEMBER');
      await load();
    } catch (err) {
      setAddError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(personId: number) {
    setBusy(true);
    setActionError(null);
    try {
      await api.removeProjectMember(projectId, personId);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** 变更某成员在某应用的直授：选空=撤销直授（回落默认 seed），选档=授予/换档。
   * 撤销与重授非原子（评审 #3）：失败时明确告知原直授已撤销。 */
  async function changeGrant(app: LinkedApp, personId: number, role: string) {
    const current = app.grants.find((grant) => grant.person_id === personId);
    if ((current?.app_role ?? '') === role) {
      return; // 选值未变化，避免无谓的撤销-重授（评审 #3）。
    }
    setBusy(true);
    setActionError(null);
    let revoked = false;
    try {
      if (current) {
        await api.revokeAppGrant(app.registry.app_code, current.id);
        revoked = true;
      }
      if (role) {
        await api.grantAppRole(app.registry.app_code, {
          person_id: personId,
          scope_kind: 'project',
          project_id: projectId,
          app_role: role,
        });
      }
      await load();
    } catch (err) {
      const detail = errorMessage(err);
      setActionError(
        revoked
          ? `原直授已撤销但新档位授予失败（${detail}）；可重新选择档位重试，或选“默认”保持无直授。`
          : detail,
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!canReadAny) {
    return (
      <ForbiddenState
        message="无权限访问项目详情"
        detail="需要 project:read 或 project:read:own 权限。"
      />
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <LoadingState label="正在加载项目…" />
      </div>
    );
  }
  if (error || !project) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorState message={error ?? '项目不存在'} onRetry={() => void load()} />
      </div>
    );
  }

  const activeMembers = (members ?? []).filter((member) => member.Status === 'active');

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-1 text-sm text-text-secondary">
        <Link className="text-accent-primary hover:underline" to={PROJECTS_BASE}>
          项目与邀请
        </Link>
        <span>/</span>
        <code className="rounded bg-bg-secondary px-1 text-xs">
          {project.project_code}
        </code>
      </p>
      <PageHeader
        title={project.name}
        description={`${
          project.category_code === 'TEACHING' ? '教学' : '科研'
        }${project.course_code ? ` · ${project.course_code}` : ''}${
          project.start_date ? ` · ${project.start_date} ~ ${project.end_date || '—'}` : ''
        }`}
        actions={
          <>
            <StatusBadge status={project.status} />
            {canWrite && project.status === 'active' ? (
              <Button
                size="sm"
                onClick={() => {
                  setAddError('');
                  setAddOpen(true);
                }}
              >
                添加成员
              </Button>
            ) : null}
          </>
        }
      />

      {actionError ? <ErrorState message={actionError} /> : null}
      {degradeNotice ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-button bg-bg-card px-3 py-2 text-sm text-text-secondary"
        >
          <span>{degradeNotice}</span>
          <Button variant="ghost" size="sm" onClick={() => setDegradeNotice('')}>
            知道了
          </Button>
        </div>
      ) : null}

      {members !== null ? (
        <Panel
          title={`项目成员（${activeMembers.length}）`}
          className="overflow-hidden"
          bodyClassName="p-0"
        >
          {activeMembers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>成员</TableHead>
                  <TableHead>编号</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeMembers.map((member) => {
                  const person = personById.get(member.PersonID);
                  return (
                    <TableRow key={member.ID}>
                      <TableCell className="font-medium">
                        {person?.name ?? `#${member.PersonID}`}
                      </TableCell>
                      <TableCell>
                        <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                          {person?.person_no ?? '—'}
                        </code>
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {member.RoleCode}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={member.Status} />
                      </TableCell>
                      <TableCell>
                        {canWrite ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-state-error"
                            disabled={busy}
                            onClick={() => void removeMember(member.PersonID)}
                          >
                            移除
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
              <EmptyState title="暂无成员" description="通过「添加成员」或邀请链接加入。" />
            </div>
          )}
        </Panel>
      ) : null}

      {linkedApps !== null ? (
        <Panel title="应用角色（按已映射应用）">
          <p className="text-sm text-text-secondary">
            {'成员的应用角色优先级：直授 > 默认值 seed；选择「默认」即撤销直授。撤销/换档经同步任务收敛到应用侧。'}
          </p>
          {personsWarning ? (
            <p className="mt-2 rounded-md bg-bg-secondary px-3 py-2 text-sm text-text-secondary">
              {personsWarning}
            </p>
          ) : null}
          {linkedApps.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="项目尚未映射任何应用"
                description="在「应用管理 → 应用详情 → 项目映射」建立映射后，可在此按成员分配应用角色。"
              />
            </div>
          ) : (
            linkedApps.map((app) => (
              <div key={app.registry.app_code} className="mt-4">
                <h3 className="text-sm font-medium text-text-primary">
                  {app.registry.display_name}{' '}
                  <span className="text-xs text-text-secondary">
                    （<code>{app.link.app_project_name}</code>
                    {app.roles.length === 0 ? ' · 项目档目录为空' : ''}）
                  </span>
                </h3>
                {activeMembers.length === 0 ? (
                  <p className="mt-2 text-sm text-text-secondary">暂无成员。</p>
                ) : (
                  <div className="mt-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>成员</TableHead>
                          <TableHead>应用角色（直授）</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeMembers.map((member) => {
                          const grant = app.grants.find(
                            (g) => g.person_id === member.PersonID,
                          );
                          return (
                            <TableRow key={member.ID}>
                              <TableCell>
                                {personById.get(member.PersonID)?.name ??
                                  `#${member.PersonID}`}
                              </TableCell>
                              <TableCell>
                                <select
                                  className={`${SELECT_CLASS} max-w-72`}
                                  value={grant?.app_role ?? ''}
                                  disabled={!canWrite || busy}
                                  onChange={(event) =>
                                    void changeGrant(
                                      app,
                                      member.PersonID,
                                      event.target.value,
                                    )
                                  }
                                >
                                  <option value="">默认（无直授）</option>
                                  {app.roles.map((role) => (
                                    <option key={role.perm_code} value={role.perm_code}>
                                      {role.display_name}（{role.perm_code}）
                                      {role.owner_only ? ' · 仅负责人' : ''}
                                    </option>
                                  ))}
                                  {grant &&
                                  !app.roles.some((r) => r.perm_code === grant.app_role) ? (
                                    <option value={grant.app_role}>{grant.app_role}</option>
                                  ) : null}
                                </select>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            ))
          )}
        </Panel>
      ) : null}

      {addOpen ? (
        <AppModal
          title="添加成员"
          className="sm:max-w-lg"
          onClose={() => {
            if (!busy) setAddOpen(false);
          }}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddOpen(false)}
                disabled={busy}
              >
                取消
              </Button>
              <Button type="button" size="sm" loading={busy} onClick={() => void addMember()}>
                {busy ? '添加中…' : '添加'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {personsWarning ? (
              <p className="rounded-md bg-bg-secondary px-3 py-2 text-sm text-text-secondary">
                {personsWarning}
              </p>
            ) : null}
            <Field label="人员 *">
              <select
                className={SELECT_CLASS}
                value={addPerson}
                onChange={(event) => setAddPerson(event.target.value)}
                disabled={busy}
              >
                <option value="">请选择在职/在校人员</option>
                {persons.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}（{person.person_no}）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="项目角色">
              <select
                className={SELECT_CLASS}
                value={addRole}
                onChange={(event) => setAddRole(event.target.value)}
                disabled={busy}
              >
                <option value="MEMBER">成员（MEMBER）</option>
              </select>
            </Field>
            {addError ? <p className="text-sm text-state-error">{addError}</p> : null}
            <p className="text-xs text-text-secondary">
              添加后按已映射应用的默认值 seed 进入应用；如需指定档位，在「应用角色」表中直授。
            </p>
          </div>
        </AppModal>
      ) : null}
    </div>
  );
}
