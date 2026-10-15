// 邀请码管理(企业版注册治理,docs/invite-code-enterprise-design.md Phase 3.3)。
// 精简实现:生成(邮箱可选/有效期)+ 全量列表(状态过滤)+ 撤销。
// RBAC 由网关裁决(member:invite),非 owner/admin 调用会收到 403 文案。
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  LucideCopy,
  LucidePlus,
  LucideRotateCcw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import message from '@/components/ui/message';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import {
  createAdminInvite,
  listAdminInvites,
  revokeAdminInvite,
  type AdminInviteItem,
} from '@/services/admin-service';

const STATUS_OPTIONS = ['pending', 'accepted', 'expired', 'revoked'] as const;

function formatEpoch(value: number | null): string {
  if (!value) return '-';
  return new Date(value * 1000).toLocaleString();
}

export default function Invites() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [email, setEmail] = useState('');
  const [ttlHours, setTtlHours] = useState('168');
  const [generated, setGenerated] = useState<string>('');

  const invitesQuery = useQuery({
    queryKey: ['admin-invites', statusFilter],
    queryFn: () => listAdminInvites(statusFilter || undefined),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-invites'] });

  const createMutation = useMutation({
    mutationFn: () =>
      createAdminInvite({
        email: email.trim() || undefined,
        ttl_seconds: Math.max(60, Number(ttlHours) * 3600 || 604800),
      }),
    onSuccess: (resp) => {
      const code = resp?.data?.data?.code ?? '';
      setGenerated(code);
      setEmail('');
      message.success(t('admin.inviteCreated'));
      invalidate();
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        t('admin.inviteCreateFailed');
      message.error(detail);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (code: string) => revokeAdminInvite(code),
    onSuccess: () => {
      message.success(t('admin.inviteRevoked'));
      invalidate();
    },
    onError: () => message.error(t('admin.inviteRevokeFailed')),
  });

  const items: AdminInviteItem[] = useMemo(
    () => invitesQuery.data?.data?.data?.invites ?? [],
    [invitesQuery.data],
  );

  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.inviteCodes')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-64"
              placeholder={t('admin.inviteEmailOptional')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              className="w-32"
              placeholder={t('admin.inviteTtlHours')}
              value={ttlHours}
              onChange={(e) => setTtlHours(e.target.value)}
            />
            <Button
              size="sm"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              <LucidePlus className="mr-1 size-4" />
              {t('admin.inviteCreate')}
            </Button>
            {generated && (
              <span className="flex items-center gap-2 rounded bg-muted px-2 py-1 font-mono text-sm">
                {generated}
                <button
                  type="button"
                  aria-label={t('admin.inviteCopy')}
                  onClick={() => {
                    navigator.clipboard?.writeText(generated);
                    message.success(t('admin.inviteCopied'));
                  }}
                >
                  <LucideCopy className="size-4" />
                </button>
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant={statusFilter === '' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('')}
            >
              {t('admin.inviteAll')}
            </Button>
            {STATUS_OPTIONS.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={statusFilter === s ? 'default' : 'outline'}
                onClick={() => setStatusFilter(s)}
              >
                {t(`admin.inviteStatus_${s}`)}
              </Button>
            ))}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.inviteCode')}</TableHead>
                <TableHead>{t('admin.inviteEmail')}</TableHead>
                <TableHead>{t('admin.inviteStatus')}</TableHead>
                <TableHead>{t('admin.inviteExpires')}</TableHead>
                <TableHead>{t('admin.inviteActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.code}>
                  <TableCell className="font-mono text-xs">{item.code}</TableCell>
                  <TableCell>{item.email ?? '-'}</TableCell>
                  <TableCell>{t(`admin.inviteStatus_${item.status}`)}</TableCell>
                  <TableCell>{formatEpoch(item.expires_at)}</TableCell>
                  <TableCell>
                    {item.status === 'pending' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={revokeMutation.isPending}
                        onClick={() => {
                          if (window.confirm(t('admin.inviteRevokeConfirm'))) {
                            revokeMutation.mutate(item.code);
                          }
                        }}
                      >
                        <LucideRotateCcw className="mr-1 size-4" />
                        {t('admin.inviteRevoke')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && !invitesQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {t('admin.inviteEmpty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
