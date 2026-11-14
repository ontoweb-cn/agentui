/**
 * 应用管理：已纳管应用列表与注册/注销/清除，以及 IdP 未纳管应用目录。
 *
 * 移植自 intellect-auth/hiedu/web/src/pages/Apps.tsx：
 * - 手动刷新与注销/清除后的并发重载用 loadSeqRef 防陈旧响应覆盖新数据（评审 #6）；
 * - IdP 目录不可达仅降级本面板，不阻塞已纳管列表（方案 §4.2.2 B1）；
 * - 清除为物理删除，需输入应用编码确认；syncModeLabel 供应用详情页复用（同源导出）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { Routes } from '@/constants/routes';
import { cn } from '@/lib/utils';
import {
  api,
  errorMessage,
  type AppRegisterInput,
  type AppSummary,
  type IdpApplication,
} from '@/services/hiedu/api';
import { statusLabel, statusTone } from '@/services/hiedu/format';
import { AppModal } from './components/modal';
import { Field, PageHeader, Panel } from './components/page';
import { EmptyState, ErrorState, LoadingState } from './components/state';
import { useMe } from './hooks';

const SYNC_MODE_LABEL: Record<string, string> = {
  api_push: 'API 直连',
  idp_role: 'IdP 角色',
  manual: '仅登记',
};

export function syncModeLabel(mode: string): string {
  return SYNC_MODE_LABEL[mode] ?? mode;
}

// 状态徽标色调：与 components/state.tsx 的 StatusBadge 同口径。
const TONE_CLASS: Record<string, string> = {
  ok: 'bg-state-success/5 text-state-success',
  warn: 'bg-state-warning/5 text-state-warning',
  danger: 'bg-state-error/5 text-state-error',
  muted: 'bg-bg-secondary text-text-secondary',
};

/** 应用状态徽标：active 用页面专属文案（在管/有效），其余沿用 statusLabel。 */
export function AppStatusBadge({
  status,
  activeLabel,
}: {
  status: string;
  activeLabel: string;
}) {
  const tone = statusTone(status);
  return (
    <Badge
      variant="secondary"
      className={cn('rounded-md border-transparent', TONE_CLASS[tone])}
    >
      {status === 'active' ? activeLabel : statusLabel(status)}
    </Badge>
  );
}

const APPS_BASE = `${Routes.UserSetting}${Routes.IntellectAuthApps}`;

// 与 projects.tsx 同款原生 select 样式（下拉需带 disabled 选项与受控 value）。
const SELECT_CLASS =
  'h-8 w-full rounded-md border-0.5 border-border-button bg-bg-input px-2 text-sm text-text-primary outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent-primary disabled:cursor-not-allowed disabled:opacity-50';

const EMPTY_FORM: AppRegisterInput = {
  app_code: '',
  display_name: '',
  api_base_url: '',
  m2m_client_id: '',
  sync_mode: 'manual',
  idp_ref: '',
};

export default function AppsPage() {
  const me = useMe();
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [idpApps, setIdpApps] = useState<IdpApplication[] | null>(null);
  const [idpError, setIdpError] = useState<string | null>(null);
  const [idpLoading, setIdpLoading] = useState(true);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const [registerOpen, setRegisterOpen] = useState(false);
  const [form, setForm] = useState<AppRegisterInput>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'deregister' | 'purge' | null>(null);
  const [target, setTarget] = useState<AppSummary | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState('');

  // 手动刷新与注销/清除后的并发重载：陈旧响应不得覆盖新数据（评审 #6）。
  const loadSeqRef = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.apps();
      if (seq !== loadSeqRef.current) return;
      setApps(Array.isArray(result.data) ? result.data : []);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(errorMessage(err));
      setApps([]);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, []);

  const idpSeqRef = useRef(0);
  const loadIdpApps = useCallback(async () => {
    const seq = ++idpSeqRef.current;
    setIdpLoading(true);
    setIdpError(null);
    try {
      const result = await api.idpApplications();
      if (seq !== idpSeqRef.current) return;
      setIdpApps(Array.isArray(result.data) ? result.data : []);
    } catch (err) {
      // IdP 目录不可达仅降级本面板，不阻塞已纳管列表（方案 §4.2.2 B1）。
      if (seq !== idpSeqRef.current) return;
      setIdpApps(null);
      setIdpError(errorMessage(err));
    } finally {
      if (seq === idpSeqRef.current) setIdpLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadIdpApps();
  }, [load, loadIdpApps]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return apps.filter((app) => {
      if (status && app.status !== status) return false;
      if (!needle) return true;
      return (
        app.app_code.toLowerCase().includes(needle) ||
        app.display_name.toLowerCase().includes(needle)
      );
    });
  }, [apps, q, status]);

  const unmanaged = useMemo(
    () => (idpApps ?? []).filter((app) => !app.managed),
    [idpApps],
  );

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setTarget(null);
    setPurgeConfirm('');
  }

  async function confirmDeregister() {
    if (!target) return;
    setBusy(true);
    try {
      await api.deregisterApp(target.app_code);
      setDialog(null);
      setTarget(null);
      await Promise.all([load(), loadIdpApps()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmPurge() {
    if (!target || purgeConfirm !== target.app_code) return;
    setBusy(true);
    try {
      await api.purgeApp(target.app_code);
      setDialog(null);
      setTarget(null);
      setPurgeConfirm('');
      await Promise.all([load(), loadIdpApps()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function openRegister(prefill?: Partial<AppRegisterInput>) {
    setForm({ ...EMPTY_FORM, ...prefill });
    setFormError('');
    setRegisterOpen(true);
  }

  async function submitRegister() {
    setFormError('');
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(form.app_code)) {
      setFormError('应用编码须为小写字母/数字/连字符，2~31 位');
      return;
    }
    if (!form.display_name.trim()) {
      setFormError('请填写显示名称');
      return;
    }
    setBusy(true);
    try {
      await api.registerApp({ ...form, display_name: form.display_name.trim() });
      setRegisterOpen(false);
      await Promise.all([load(), loadIdpApps()]);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="应用管理"
        description="纳管本组织可使用的应用及其权限目录；应用账号与 OAuth 配置仍在统一认证管理台维护。"
        actions={
          <Button size="sm" onClick={() => openRegister()}>
            注册应用
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
        <Field label="搜索" className="min-w-48 flex-1">
          <Input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="应用编码或名称"
          />
        </Field>
        <Field label="状态" className="w-36">
          <select
            className={SELECT_CLASS}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">全部</option>
            <option value="active">在管</option>
            <option value="deregistered">已注销</option>
          </select>
        </Field>
        <Button type="submit" size="sm" disabled={loading}>
          刷新
        </Button>
      </form>

      {loading ? <LoadingState label="正在加载应用…" /> : null}
      {!loading && error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : null}

      {!loading && !error ? (
        <Panel className="overflow-hidden" bodyClassName="p-0">
          {visible.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>应用编码</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>分发模式</TableHead>
                  <TableHead>权限点</TableHead>
                  <TableHead>映射</TableHead>
                  <TableHead>直授</TableHead>
                  <TableHead>IdP 关联</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((app) => (
                  <TableRow key={app.app_code}>
                    <TableCell>
                      <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                        {app.app_code}
                      </code>
                    </TableCell>
                    <TableCell className="font-medium">{app.display_name}</TableCell>
                    <TableCell>
                      <AppStatusBadge status={app.status} activeLabel="在管" />
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {syncModeLabel(app.sync_mode)}
                    </TableCell>
                    <TableCell>{app.catalog_count}</TableCell>
                    <TableCell>{app.link_count}</TableCell>
                    <TableCell>{app.grant_count}</TableCell>
                    <TableCell>
                      {app.idp_ref ? (
                        <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                          {app.idp_ref}
                        </code>
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          asLink
                          variant="ghost"
                          size="sm"
                          to={`${APPS_BASE}/${encodeURIComponent(app.app_code)}`}
                        >
                          详情
                        </Button>
                        {app.status === 'active' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setTarget(app);
                              setDialog('deregister');
                            }}
                          >
                            注销
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setTarget(app);
                              setDialog('purge');
                            }}
                          >
                            清除
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState
                title="暂无纳管应用"
                description="从下方 IdP 目录注册一个应用，或手工填写应用编码。"
              />
            </div>
          )}
        </Panel>
      ) : null}

      <Panel
        title="IdP 未纳管应用"
        className="overflow-hidden"
        bodyClassName="p-0"
        extra={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadIdpApps()}
            disabled={idpLoading}
          >
            刷新目录
          </Button>
        }
      >
        <p className="px-4 pt-4 text-sm text-text-secondary">
          统一认证（{me.org_code} 组织）中已注册、但尚未纳入本页管理的应用。
        </p>
        {idpLoading ? (
          <div className="p-4">
            <LoadingState label="正在拉取 IdP 应用目录…" />
          </div>
        ) : null}
        {!idpLoading && idpError ? (
          <div className="p-4">
            <ErrorState
              message={`IdP 应用目录不可达：${idpError}`}
              onRetry={() => void loadIdpApps()}
            />
          </div>
        ) : null}
        {!idpLoading && !idpError ? (
          unmanaged.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>应用名</TableHead>
                  <TableHead>显示名</TableHead>
                  <TableHead>主页</TableHead>
                  <TableHead>标签</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unmanaged.map((app) => (
                  <TableRow key={app.name}>
                    <TableCell>
                      <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                        {app.name}
                      </code>
                    </TableCell>
                    <TableCell>{app.display_name}</TableCell>
                    <TableCell className="text-text-secondary">
                      {app.homepage_url || '—'}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {(app.tags ?? []).join('、') || '—'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          openRegister({
                            app_code: /^[a-z0-9][a-z0-9-]{1,30}$/.test(app.name)
                              ? app.name
                              : '',
                            display_name: app.display_name || app.name,
                            idp_ref: app.name,
                          })
                        }
                      >
                        纳管
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState title="没有未纳管应用" description="IdP 组织内应用均已纳管。" />
            </div>
          )
        ) : null}
      </Panel>

      {registerOpen ? (
        <AppModal
          title="注册应用"
          className="sm:max-w-xl"
          onClose={() => {
            if (!busy) setRegisterOpen(false);
          }}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRegisterOpen(false)}
                disabled={busy}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                loading={busy}
                onClick={() => void submitRegister()}
              >
                {busy ? '注册中…' : '注册'}
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="应用编码 *">
              <Input
                value={form.app_code}
                onChange={(event) => setForm({ ...form, app_code: event.target.value })}
                placeholder="如 ai-devops"
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
            <Field label="分发模式">
              <select
                className={SELECT_CLASS}
                value={form.sync_mode}
                onChange={(event) => setForm({ ...form, sync_mode: event.target.value })}
                disabled={busy}
              >
                <option value="manual">仅登记</option>
                <option value="api_push">API 直连</option>
                <option value="idp_role">IdP 角色</option>
              </select>
            </Field>
            <Field label="IdP 应用名">
              <Input
                value={form.idp_ref}
                onChange={(event) => setForm({ ...form, idp_ref: event.target.value })}
                placeholder="统一认证中的应用名（可留空）"
                disabled={busy}
              />
            </Field>
            <Field label="API 地址">
              <Input
                value={form.api_base_url}
                onChange={(event) =>
                  setForm({ ...form, api_base_url: event.target.value })
                }
                placeholder="仅 API 直连模式需要"
                disabled={busy}
              />
            </Field>
            <Field label="M2M Client ID">
              <Input
                value={form.m2m_client_id}
                onChange={(event) =>
                  setForm({ ...form, m2m_client_id: event.target.value })
                }
                placeholder="仅 API 直连模式需要；secret 走环境变量"
                disabled={busy}
              />
            </Field>
            {formError ? (
              <p className="text-sm text-state-error sm:col-span-2">{formError}</p>
            ) : null}
            <p className="text-xs text-text-secondary sm:col-span-2">
              注册后可在详情页维护该应用的权限目录（平台/项目/团队档）。
            </p>
          </div>
        </AppModal>
      ) : null}

      {dialog === 'deregister' && target ? (
        <AppModal
          title="注销应用"
          className="sm:max-w-lg"
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
                type="button"
                size="sm"
                loading={busy}
                onClick={() => void confirmDeregister()}
              >
                {busy ? '处理中…' : '确认注销'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-primary">
              注销后：目录行软失效（停发角色引用）、该应用全部直授撤销、映射行下线，
              并投递反向清理任务（Role 壳摘除 + 应用侧成员清除）。可用「重新注册」恢复。
            </p>
            <p className="text-xs text-text-secondary">
              应用{' '}
              <code className="rounded bg-bg-secondary px-1 text-text-secondary">
                {target.app_code}
              </code>{' '}
              · {target.display_name}
            </p>
          </div>
        </AppModal>
      ) : null}

      {dialog === 'purge' && target ? (
        <AppModal
          title="清除应用（不可恢复）"
          className="sm:max-w-lg"
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
                type="button"
                size="sm"
                disabled={busy || purgeConfirm !== target.app_code}
                onClick={() => void confirmPurge()}
              >
                {busy ? '处理中…' : '确认清除'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-primary">
              物理删除注册行、权限目录、映射与直授历史，并清洗角色中悬空的{' '}
              <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                app/{target.app_code}:*
              </code>{' '}
              权限引用。仅用于防止同编码重注册复活，一般无需执行。
            </p>
            <Field label="输入应用编码以确认">
              <Input
                value={purgeConfirm}
                onChange={(event) => setPurgeConfirm(event.target.value)}
                placeholder={target.app_code}
                disabled={busy}
              />
            </Field>
          </div>
        </AppModal>
      ) : null}
    </div>
  );
}
