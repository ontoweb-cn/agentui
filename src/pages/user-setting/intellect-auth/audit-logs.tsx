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
  isApiError,
  type AuditLog,
} from '@/services/hiedu/api';
import { formatDateTime, hasPermission } from '@/services/hiedu/format';
import { Field, PageHeader, Panel } from './components/page';
import { AppModal } from './components/modal';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
} from './components/state';
import { useMe } from './hooks';

const PAGE_SIZE = 30;

interface FilterState {
  actor: string;
  action: string;
  object_type: string;
  object_id: string;
  q: string;
  from: string;
  to: string;
}

const EMPTY_FILTER: FilterState = {
  actor: '',
  action: '',
  object_type: '',
  object_id: '',
  q: '',
  from: '',
  to: '',
};

export default function AuditLogsPage() {
  const me = useMe();
  const canRead = hasPermission(me.permissions, 'audit:read');

  const [form, setForm] = useState<FilterState>(EMPTY_FILTER);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTER);
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  // 快速切换筛选/页码时，过期响应不得覆盖新数据（评审 R-race）
  const loadSeqRef = useRef(0);
  const load = useCallback(async () => {
    if (!canRead) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    try {
      const result = await api.auditLogs({
        actor: applied.actor || undefined,
        action: applied.action || undefined,
        object_type: applied.object_type || undefined,
        object_id: applied.object_id || undefined,
        q: applied.q || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
        page,
        page_size: PAGE_SIZE,
      });
      if (seq !== loadSeqRef.current) return;
      setLogs(Array.isArray(result.data) ? result.data : []);
      setTotal(result.total);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setErrorStatus(isApiError(err) ? err.status : null);
      setError(errorMessage(err));
      setLogs([]);
      setTotal(null);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [applied, canRead, page]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canRead) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="审计日志"
          description="记录写操作的主体、对象、请求与来源信息。"
        />
        <ForbiddenState
          message="无权限访问审计日志"
          detail="当前账号缺少 audit:read 权限。"
        />
      </div>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setApplied({ ...form });
  }

  function reset() {
    setForm(EMPTY_FILTER);
    setApplied(EMPTY_FILTER);
    setPage(1);
  }

  const hasMore = total !== null ? page * PAGE_SIZE < total : logs.length >= PAGE_SIZE;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="审计日志"
        description="仅校级范围可查询；记录写操作的主体、对象、请求与来源信息。"
      />

      <Panel>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="关键词" className="sm:col-span-2">
              <Input
                value={form.q}
                onChange={(event) => setForm({ ...form, q: event.target.value })}
                placeholder="摘要、对象 ID 或请求 ID"
              />
            </Field>
            <Field label="操作人">
              <Input
                value={form.actor}
                onChange={(event) =>
                  setForm({ ...form, actor: event.target.value })
                }
              />
            </Field>
            <Field label="动作">
              <Input
                value={form.action}
                onChange={(event) =>
                  setForm({ ...form, action: event.target.value })
                }
                placeholder="如 person.update"
              />
            </Field>
            <Field label="对象类型">
              <Input
                value={form.object_type}
                onChange={(event) =>
                  setForm({ ...form, object_type: event.target.value })
                }
              />
            </Field>
            <Field label="对象 ID">
              <Input
                value={form.object_id}
                onChange={(event) =>
                  setForm({ ...form, object_id: event.target.value })
                }
              />
            </Field>
            <Field label="起始日期">
              <Input
                type="date"
                value={form.from}
                onChange={(event) =>
                  setForm({ ...form, from: event.target.value })
                }
              />
            </Field>
            <Field label="结束日期">
              <Input
                type="date"
                value={form.to}
                onChange={(event) =>
                  setForm({ ...form, to: event.target.value })
                }
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit">查询</Button>
            <Button type="button" variant="outline" onClick={reset}>
              重置
            </Button>
          </div>
        </form>
      </Panel>

      {loading ? <LoadingState label="正在加载审计日志…" /> : null}
      {!loading && error ? (
        errorStatus === 403 ? (
          <ForbiddenState
            message="无权限查看审计日志"
            detail="审计日志仅对具备 audit:read 的校级范围账号开放。"
          />
        ) : (
          <ErrorState message={error} onRetry={() => void load()} />
        )
      ) : null}

      {!loading && !error ? (
        <Panel>
          {logs.length === 0 ? (
            <EmptyState
              title="未找到审计日志"
              description="请调整筛选条件或时间范围。"
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>操作人</TableHead>
                    <TableHead>动作</TableHead>
                    <TableHead>对象</TableHead>
                    <TableHead>摘要</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-text-secondary">
                        {formatDateTime(log.created_at)}
                      </TableCell>
                      <TableCell>{log.actor || '—'}</TableCell>
                      <TableCell>
                        <code className="text-xs">{log.action}</code>
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {log.object_type || '—'}{' '}
                        {log.object_id ? `#${log.object_id}` : ''}
                      </TableCell>
                      <TableCell>{log.summary || '—'}</TableCell>
                      <TableCell className="text-text-secondary">
                        {log.ip || '—'}
                        <div className="text-xs text-text-tertiary">
                          {log.request_id || '无请求 ID'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setSelected(log)}
                        >
                          详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
                <span>
                  第 {page} 页 · 共 {total === null ? '—' : total} 条
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
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
              </footer>
            </>
          )}
        </Panel>
      ) : null}

      {selected ? (
        <AppModal
          title="审计详情"
          className="max-w-2xl"
          onClose={() => setSelected(null)}
        >
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-text-secondary">时间</dt>
              <dd className="mt-0.5 text-text-primary">
                {formatDateTime(selected.created_at)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">操作人</dt>
              <dd className="mt-0.5 text-text-primary">
                {selected.actor || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">动作</dt>
              <dd className="mt-0.5 text-text-primary">
                <code className="text-xs">{selected.action}</code>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">对象</dt>
              <dd className="mt-0.5 text-text-primary">
                {selected.object_type || '—'}{' '}
                {selected.object_id ? `#${selected.object_id}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">请求 ID</dt>
              <dd className="mt-0.5 text-text-primary">
                <code className="text-xs">{selected.request_id || '—'}</code>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">来源 IP</dt>
              <dd className="mt-0.5 text-text-primary">
                {selected.ip || '—'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-text-secondary">摘要</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-text-primary">
                {selected.summary || '—'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-text-secondary">详情</dt>
              <dd className="mt-0.5 whitespace-pre-wrap break-words text-text-primary">
                {selected.detail || '—'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-text-secondary">User-Agent</dt>
              <dd className="mt-0.5 break-words text-text-primary">
                {selected.ua || '—'}
              </dd>
            </div>
          </dl>
        </AppModal>
      ) : null}
    </div>
  );
}
