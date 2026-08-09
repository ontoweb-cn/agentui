/**
 * ApprovalListPage — 想定审批（P3.3-3）。
 *
 * 列出 intellect-gateway 审批（resource_type=scenario），支持按状态筛选与
 * 决议（approved/rejected/request_changes）。审批状态存储于 gateway，
 * 本页经 cognitive-wargame 审批代理 API 读写。
 */
import { EmptyCard } from '@/components/empty/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spin } from '@/components/ui/spin';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { api, type Approval } from '../api';
import WargameSectionLayout from '../components/section-menu';
import { useFetchUserInfo } from '@/hooks/use-user-setting-request';
import { t } from 'i18next';
import { useCallback, useEffect, useState } from 'react';

const STATUS_OPTIONS = [
  '',
  'pending',
  'approved',
  'rejected',
  'request_changes',
  'completed',
] as const;

const ApprovalListPage: React.FC = () => {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  // 审批人身份：X-Actor 头透传当前用户 id（落 resolved_by/submitted_by，审计用）
  const { data: userInfo } = useFetchUserInfo();

  // 决议 Dialog 状态
  const [resolveTarget, setResolveTarget] = useState<Approval | null>(null);
  const [decision, setDecision] = useState('approved');
  const [comment, setComment] = useState('');
  const [resolving, setResolving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getApprovals({
        resource_type: 'scenario',
        status: statusFilter || undefined,
        limit: 100,
      });
      setApprovals(data.approvals ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setApprovals([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openResolve = (a: Approval) => {
    setResolveTarget(a);
    setDecision('approved');
    setComment('');
    setError(null);
  };

  const confirmResolve = async () => {
    if (!resolveTarget) return;
    setResolving(true);
    setError(null);
    try {
      await api.resolveApproval(
        resolveTarget.approval_id,
        decision,
        comment || undefined,
        userInfo?.id,
      );
      setResolveTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  };

  const statusVariant = (
    s: string,
  ): 'default' | 'secondary' | 'success' | 'destructive' | 'outline' => {
    if (s === 'approved' || s === 'completed') return 'success';
    if (s === 'pending') return 'secondary';
    if (s === 'rejected') return 'destructive';
    return 'outline';
  };

  const statusLabel = (s: string) => {
    const key = `cognitiveWargame.approval.${s}`;
    const fallback = s;
    return t(key, { defaultValue: fallback });
  };

  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-medium">
          {t('cognitiveWargame.approval.title')}
        </h1>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label>{t('cognitiveWargame.approval.filterStatus')}</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s
                      ? statusLabel(s)
                      : t('cognitiveWargame.approval.all')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            {t('cognitiveWargame.common.refresh')}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-text-error">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t('cognitiveWargame.approval.listTitle')} ({approvals.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Spin spinning={loading}>
            {approvals.length === 0 ? (
              <EmptyCard
                title={t('cognitiveWargame.common.empty')}
                className="w-full"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t('cognitiveWargame.approval.submitTitle')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.approval.resourceId')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.approval.status')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.approval.submittedBy')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.approval.createdAt')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.common.actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvals.map((a) => (
                    <TableRow key={a.approval_id}>
                      <TableCell className="font-medium">{a.title}</TableCell>
                      <TableCell>{a.resource_id}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(a.status)}>
                          {statusLabel(a.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{a.submitted_by ?? '-'}</TableCell>
                      <TableCell>{a.created_at ?? '-'}</TableCell>
                      <TableCell>
                        {a.status === 'pending' && (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0"
                            onClick={() => openResolve(a)}
                          >
                            {t('cognitiveWargame.approval.resolve')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Spin>
        </CardContent>
      </Card>

      <Dialog
        open={!!resolveTarget}
        onOpenChange={(o) => !o && setResolveTarget(null)}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {t('cognitiveWargame.approval.confirmResolve')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label>{t('cognitiveWargame.approval.decision')}</Label>
              <Select value={decision} onValueChange={setDecision}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">
                    {t('cognitiveWargame.approval.approve')}
                  </SelectItem>
                  <SelectItem value="rejected">
                    {t('cognitiveWargame.approval.reject')}
                  </SelectItem>
                  <SelectItem value="request_changes">
                    {t('cognitiveWargame.approval.requestChanges')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t('cognitiveWargame.approval.comment')}</Label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResolveTarget(null)}
              disabled={resolving}
            >
              {t('cognitiveWargame.common.cancel')}
            </Button>
            <Button onClick={confirmResolve} disabled={resolving}>
              {resolving
                ? t('cognitiveWargame.common.loading')
                : t('cognitiveWargame.common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </WargameSectionLayout>
  );
};

export default ApprovalListPage;
