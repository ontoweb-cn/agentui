import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
  type ReconcileSnapshot,
  type SyncLog,
} from '@/services/hiedu/api';
import {
  formatCount,
  formatDateTime,
  hasPermission,
} from '@/services/hiedu/format';
import { Field, MutedText, PageHeader, Panel } from './components/page';
import { AppModal } from './components/modal';
import {
  EmptyState,
  ErrorState,
  ForbiddenState,
  LoadingState,
  StatusBadge,
} from './components/state';
import { useMe } from './hooks';

const METRICS = [
  { key: 'total', label: '检查对象' },
  { key: 'converged', label: '已收敛' },
  { key: 'diffs', label: '差异' },
  { key: 'errors', label: '错误' },
  { key: 'manual_queue', label: '人工队列' },
  { key: 'consecutive_unconverged', label: '连续未收敛' },
] as const;

export default function ReconcilePage() {
  const me = useMe();
  const canRead = hasPermission(me.permissions, 'reconcile:read');
  const isOrgScope = me.scopes.some((scope) => scope.all);
  const canRepair =
    isOrgScope && hasPermission(me.permissions, 'reconcile:repair');

  const [snapshot, setSnapshot] = useState<ReconcileSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [ignoring, setIgnoring] = useState<SyncLog | null>(null);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    try {
      const result = await api.reconcileSnapshot();
      setSnapshot(result.data);
    } catch (err) {
      setErrorStatus(isApiError(err) ? err.status : null);
      setError(errorMessage(err));
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canRead) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="对账看板"
          description="比对本地主数据与 IdP 投影，修复差异或记录忽略原因。"
        />
        <ForbiddenState
          message="无权限访问对账看板"
          detail="当前账号缺少 reconcile:read 权限。"
        />
      </div>
    );
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api.reconcileRun();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function repair(diff: SyncLog) {
    setBusy(true);
    setError(null);
    try {
      await api.repairDiff(diff.id);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitIgnore() {
    if (!ignoring) return;
    if (!reason.trim()) {
      setFormError('请填写忽略原因');
      return;
    }
    setBusy(true);
    try {
      await api.ignoreDiff(ignoring.id, reason.trim());
      setIgnoring(null);
      setReason('');
      setFormError(null);
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const status = snapshot?.status;
  const diffs = snapshot?.diffs ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="对账看板"
        description="比对本地主数据与 IdP 投影，修复差异或记录忽略原因。"
        actions={
          <Button
            onClick={() => void run()}
            disabled={busy || loading}
          >
            {busy ? '对账中…' : '立即对账'}
          </Button>
        }
      />

      {loading ? <LoadingState label="正在加载对账快照…" /> : null}
      {!loading && error ? (
        errorStatus === 403 ? (
          <ForbiddenState
            message="无权限查看对账快照"
            detail="对账数据仅对校级范围开放，当前账号的数据范围不足。"
          />
        ) : (
          <ErrorState message={error} onRetry={() => void load()} />
        )
      ) : null}

      {!loading && !error ? (
        <>
          <Panel
            title="对账状态"
            extra={<StatusBadge status={status?.status ?? 'no_run'} />}
          >
            {status ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-text-secondary">最近运行</span>
                  <strong className="text-sm text-text-primary">
                    {formatDateTime(status.last_run_at)}
                  </strong>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                  {METRICS.map((metric) => (
                    <div key={metric.key} className="flex flex-col gap-1">
                      <span className="text-xs text-text-secondary">
                        {metric.label}
                      </span>
                      <strong className="text-sm text-text-primary">
                        {formatCount(status[metric.key])}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState
                title="尚未对账"
                description="点击「立即对账」生成首份差异报告。"
              />
            )}
          </Panel>

          <Panel
            title="差异明细"
            extra={<MutedText>{diffs.length} 条</MutedText>}
          >
            {diffs.length === 0 ? (
              <EmptyState
                title="暂无差异"
                description="最近一次对账未发现需要处理的差异。"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>对象</TableHead>
                    <TableHead>动作</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>冲突</TableHead>
                    <TableHead>说明</TableHead>
                    <TableHead>时间</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {diffs.map((diff) => (
                    <TableRow key={diff.id}>
                      <TableCell>
                        <span className="block text-sm font-medium text-text-primary">
                          {diff.entity_type}
                        </span>
                        <code className="text-xs text-text-secondary">
                          {diff.entity_id || '—'}
                        </code>
                      </TableCell>
                      <TableCell>{diff.action}</TableCell>
                      <TableCell>
                        <StatusBadge status={diff.status} />
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {diff.conflict_type || '—'}
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {diff.message || '—'}
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {formatDateTime(diff.created_at)}
                      </TableCell>
                      <TableCell>
                        {canRepair && diff.status === 'diff' ? (
                          <span className="flex flex-wrap items-center gap-1">
                            <Button
                              variant="ghost"
                              size="xs"
                              disabled={busy}
                              onClick={() => void repair(diff)}
                            >
                              修复
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              className="text-state-error hover:text-state-error"
                              disabled={busy}
                              onClick={() => {
                                setIgnoring(diff);
                                setReason('');
                                setFormError(null);
                              }}
                            >
                              忽略
                            </Button>
                          </span>
                        ) : (
                          <span className="text-xs text-text-secondary">
                            {diff.status === 'diff' ? '只读' : '已处理'}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </>
      ) : null}

      {ignoring ? (
        <AppModal
          title="忽略差异"
          onClose={() => {
            if (busy) return;
            setIgnoring(null);
            setFormError(null);
          }}
          footer={
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setIgnoring(null);
                  setFormError(null);
                }}
              >
                取消
              </Button>
              <Button
                disabled={busy}
                onClick={() => void submitIgnore()}
              >
                {busy ? '提交中…' : '确认忽略'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-secondary">
              对象 {ignoring.entity_type} #{ignoring.entity_id} ·{' '}
              {ignoring.action}
            </p>
            <Field label="忽略原因 *">
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
              />
            </Field>
            {formError ? (
              <p role="alert" className="text-sm text-state-error">
                {formError}
              </p>
            ) : null}
          </div>
        </AppModal>
      ) : null}
    </div>
  );
}
