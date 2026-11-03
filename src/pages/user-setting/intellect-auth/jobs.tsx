import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { IntellectSelect } from '@/components/ui/select';
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
  type JobItem,
  type JobsView,
} from '@/services/hiedu/api';
import {
  formatCount,
  formatDateTime,
  hasPermission,
} from '@/services/hiedu/format';
import { Field, MutedText, PageHeader, Panel } from './components/page';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
  StatusBadge,
} from './components/state';
import { useMe } from './hooks';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: 'all', label: '全部任务' },
  { value: 'pending', label: '待处理' },
  { value: 'manual', label: '人工处理' },
  { value: 'done', label: '已完成' },
];

const STAT_CARDS = [
  { key: 'pending', label: '待处理' },
  { key: 'manual', label: '人工处理' },
  { key: 'done', label: '已完成' },
] as const;

export default function JobsPage() {
  const me = useMe();
  const canManage = hasPermission(me.permissions, 'sync:write');

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<JobsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const [outbox, setOutbox] = useState<JobItem[]>([]);
  const [outboxLoading, setOutboxLoading] = useState(true);
  const [outboxError, setOutboxError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // 快速切换筛选/页码时，过期响应不得覆盖新数据（评审 R-race）
  const loadSeqRef = useRef(0);
  const load = useCallback(async () => {
    if (!canManage) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    try {
      const result = await api.jobs({
        status: status || undefined,
        page,
        page_size: PAGE_SIZE,
      });
      if (seq !== loadSeqRef.current) return;
      setView(result.data);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setErrorStatus(isApiError(err) ? err.status : null);
      setError(errorMessage(err));
      setView(null);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [canManage, page, status]);

  const loadOutbox = useCallback(async () => {
    if (!canManage) return;
    setOutboxLoading(true);
    setOutboxError(null);
    try {
      const result = await api.outbox({ status: 'manual', limit: 100 });
      setOutbox(Array.isArray(result.data) ? result.data : []);
    } catch (err) {
      setOutboxError(errorMessage(err));
      setOutbox([]);
    } finally {
      setOutboxLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadOutbox();
  }, [loadOutbox]);

  if (!canManage) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="同步任务"
          description="查看 IdP 投影任务进度、人工队列与失败明细。"
        />
        <ForbiddenState
          message="无权限访问同步任务"
          detail="当前账号缺少 sync:write 权限。"
        />
      </div>
    );
  }

  async function retry(item: JobItem) {
    setBusy(true);
    setOutboxError(null);
    try {
      await api.retryOutbox(item.id);
      await Promise.all([load(), loadOutbox()]);
    } catch (err) {
      setOutboxError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function downloadFailures(item: JobItem, format: 'csv' | 'text') {
    setDownloadError(null);
    try {
      await api.downloadJobFailures(item.id, format);
    } catch (err) {
      setDownloadError(errorMessage(err));
    }
  }

  const counts = view?.counts ?? {};
  const total = view?.total ?? 0;
  const items = view?.items ?? [];
  const hasMore = page * PAGE_SIZE < total;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="同步任务"
        description="查看 IdP 投影任务进度、人工队列与失败明细；重试与下载均要求校级范围。"
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {STAT_CARDS.map((card) => (
          <article
            key={card.key}
            className="rounded-lg border border-border-button bg-bg-card p-4"
          >
            <span className="text-xs text-text-secondary">{card.label}</span>
            <strong className="mt-1 block text-2xl font-semibold text-text-primary">
              {formatCount(counts[card.key])}
            </strong>
          </article>
        ))}
      </section>

      <Panel bodyClassName="flex flex-wrap items-end gap-3">
        <Field label="状态" className="w-40">
          <IntellectSelect
            value={status || 'all'}
            onChange={(value) => {
              setStatus(value === 'all' ? '' : String(value ?? ''));
              setPage(1);
            }}
            options={STATUS_OPTIONS}
            placeholder="全部任务"
          />
        </Field>
        <Button
          type="button"
          onClick={() => {
            if (page === 1) {
              void load();
            } else {
              setPage(1); // 页码变化经 effect 触发刷新，避免双请求
            }
          }}
          disabled={loading}
        >
          刷新
        </Button>
      </Panel>

      <Panel>
        {loading ? <LoadingState label="正在加载任务列表…" /> : null}
        {!loading && error ? (
          errorStatus === 403 ? (
            <ForbiddenState
              message="无权限查看同步任务"
              detail="当前账号的数据范围不足以读取任务列表。"
            />
          ) : (
            <ErrorState message={error} onRetry={() => void load()} />
          )
        ) : null}
        {!loading && !error && items.length === 0 ? (
          <EmptyState
            title="暂无任务"
            description="当前筛选条件下没有同步任务。"
          />
        ) : null}
        {!loading && !error && items.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>对象</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>尝试</TableHead>
                  <TableHead>下次执行</TableHead>
                  <TableHead>最近错误</TableHead>
                  <TableHead>失败明细</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <code className="rounded bg-bg-secondary px-1.5 py-0.5 text-xs">
                        #{item.id}
                      </code>
                    </TableCell>
                    <TableCell>{item.kind}</TableCell>
                    <TableCell className="text-text-secondary">
                      {item.subject}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                    <TableCell>{item.attempts}</TableCell>
                    <TableCell className="text-text-secondary">
                      {formatDateTime(item.next_at)}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {item.last_error || '—'}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => void downloadFailures(item, 'csv')}
                        >
                          CSV
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => void downloadFailures(item, 'text')}
                        >
                          文本
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
              <span>
                第 {page} 页 · 共 {total} 条
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
        ) : null}
      </Panel>

      {downloadError ? (
        <p role="alert" className="text-sm text-state-error">
          {downloadError}
        </p>
      ) : null}

      <Panel
        title="人工处理队列"
        extra={<MutedText>{outbox.length} 条待人工干预</MutedText>}
      >
        {outboxLoading ? <LoadingState label="正在加载人工队列…" /> : null}
        {!outboxLoading && outboxError ? (
          <ErrorState
            message={outboxError}
            onRetry={() => void loadOutbox()}
          />
        ) : null}
        {!outboxLoading && !outboxError && outbox.length === 0 ? (
          <EmptyState
            title="人工队列为空"
            description="所有任务都在自动流转中。"
          />
        ) : null}
        {!outboxLoading && !outboxError && outbox.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>对象</TableHead>
                <TableHead>尝试</TableHead>
                <TableHead>最近错误</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outbox.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <code className="rounded bg-bg-secondary px-1.5 py-0.5 text-xs">
                      #{item.id}
                    </code>
                  </TableCell>
                  <TableCell>{item.kind}</TableCell>
                  <TableCell className="text-text-secondary">
                    {item.subject}
                  </TableCell>
                  <TableCell>{item.attempts}</TableCell>
                  <TableCell className="text-text-secondary">
                    {item.last_error || '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void retry(item)}
                    >
                      重试
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </Panel>
    </div>
  );
}
