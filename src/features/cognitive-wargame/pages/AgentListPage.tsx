/**
 * AgentListPage — Agent 注册表列表（G-16）。
 *
 * 展示 intellect_agents 全量 Agent，支持按类型/状态过滤、创建/编辑/删除。
 * 经 cognitive-wargame 代理 API 读写 intellect-gateway。
 */
import { EmptyCard } from '@/components/empty/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Spin } from '@/components/ui/spin';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { type Agent } from '../api';
import { useWargameStore } from '../store';
import { WargamePath } from '../routes';
import { t } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

const TYPE_OPTIONS = ['', 'individual', 'admin_organ', 'political_party', 'news_media', 'mass'] as const;
const STATUS_OPTIONS = ['', 'active', 'archived'] as const;
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/;

const AgentListPage: React.FC = () => {
  const navigate = useNavigate();
  const { agents, agentsLoading, fetchAgents, fetchAgentTypes, createAgent, updateAgent, deleteAgent } = useWargameStore();

  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  // Create/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [form, setForm] = useState({ agent_id: '', name: '', agent_type: 'individual', bio: '', parent_agent_id: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      await fetchAgents({
        agent_type: typeFilter || undefined,
        status: statusFilter || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [fetchAgents, typeFilter, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetchAgentTypes();
  }, [fetchAgentTypes]);

  const openCreate = () => {
    setEditing(null);
    setForm({ agent_id: '', name: '', agent_type: 'individual', bio: '', parent_agent_id: '' });
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (a: Agent) => {
    setEditing(a);
    setForm({
      agent_id: a.agent_id,
      name: a.name,
      agent_type: a.agent_type,
      bio: a.bio ?? '',
      parent_agent_id: a.parent_agent_id ?? '',
    });
    setError(null);
    setDialogOpen(true);
  };

  const submit = async () => {
    if (!form.agent_id || !form.name) {
      setError(t('cognitiveWargame.agents.form.requiredFields'));
      return;
    }
    if (!editing && !AGENT_ID_RE.test(form.agent_id)) {
      setError(t('cognitiveWargame.agents.form.agentIdFormat'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (editing) {
        await updateAgent(editing.agent_id, {
          name: form.name,
          agent_type: form.agent_type as Agent['agent_type'],
          bio: form.bio || null,
          parent_agent_id: form.parent_agent_id || null,
        });
      } else {
        await createAgent({
          agent_id: form.agent_id,
          name: form.name,
          agent_type: form.agent_type,
          bio: form.bio || undefined,
          parent_agent_id: form.parent_agent_id || undefined,
        });
      }
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (a: Agent) => {
    if (!confirm(t('cognitiveWargame.agents.deleteConfirm', { defaultValue: '确认删除？' }))) return;
    try {
      await deleteAgent(a.agent_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const filtered = search
    ? agents.filter(
        (a) =>
          a.agent_id.toLowerCase().includes(search.toLowerCase()) ||
          a.name.toLowerCase().includes(search.toLowerCase()),
      )
    : agents;

  const typeLabel = (ty: string) => t(`cognitiveWargame.agents.type.${ty}`, { defaultValue: ty });
  const statusVariant = (s?: string): 'default' | 'secondary' | 'success' | 'destructive' | 'outline' => {
    if (s === 'active') return 'success';
    if (s === 'archived') return 'secondary';
    return 'outline';
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium">{t('cognitiveWargame.agents.title')}</h1>
          <p className="text-sm text-text-secondary">{t('cognitiveWargame.agents.subtitle')}</p>
        </div>
        <div className="flex items-end gap-3">
          <Button onClick={openCreate}>{t('cognitiveWargame.agents.list.create')}</Button>
          <Button variant="outline" onClick={load} disabled={agentsLoading}>
            {t('cognitiveWargame.agents.list.refresh')}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-text-error">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('cognitiveWargame.agents.title')} ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex flex-col gap-2">
              <Label>{t('cognitiveWargame.agents.list.filterType')}</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((ty) => (
                    <SelectItem key={ty} value={ty}>
                      {ty ? typeLabel(ty) : t('cognitiveWargame.approval.all', { defaultValue: '全部' })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t('cognitiveWargame.agents.list.filterStatus')}</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s ? t(`cognitiveWargame.agents.status.${s}`, { defaultValue: s }) : t('cognitiveWargame.approval.all', { defaultValue: '全部' })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>&nbsp;</Label>
              <Input
                placeholder={t('cognitiveWargame.agents.list.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-60"
              />
            </div>
          </div>

          <Spin spinning={agentsLoading}>
            {filtered.length === 0 ? (
              <EmptyCard title={t('cognitiveWargame.agents.empty')} className="w-full" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('cognitiveWargame.agents.table.agentId')}</TableHead>
                    <TableHead>{t('cognitiveWargame.agents.table.name')}</TableHead>
                    <TableHead>{t('cognitiveWargame.agents.table.type')}</TableHead>
                    <TableHead>{t('cognitiveWargame.agents.table.status')}</TableHead>
                    <TableHead>{t('cognitiveWargame.agents.table.updatedAt')}</TableHead>
                    <TableHead>{t('cognitiveWargame.agents.table.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a) => (
                    <TableRow key={a.agent_id}>
                      <TableCell className="font-mono text-sm">{a.agent_id}</TableCell>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell><Badge variant="outline">{typeLabel(a.agent_type)}</Badge></TableCell>
                      <TableCell><Badge variant={statusVariant(a.status)}>{t(`cognitiveWargame.agents.status.${a.status ?? 'active'}`, { defaultValue: a.status ?? 'active' })}</Badge></TableCell>
                      <TableCell className="text-sm text-text-secondary">{a.updated_at ?? '-'}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => navigate(WargamePath.agentDetail(a.agent_id))}>
                            {t('cognitiveWargame.common.viewDetail')}
                          </Button>
                          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => openEdit(a)}>
                            {t('cognitiveWargame.agents.detail.edit')}
                          </Button>
                          <Button variant="link" size="sm" className="h-auto p-0 text-text-error" onClick={() => handleDelete(a)}>
                            {t('cognitiveWargame.agents.detail.delete')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Spin>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editing ? t('cognitiveWargame.agents.form.editTitle') : t('cognitiveWargame.agents.form.createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label>{t('cognitiveWargame.agents.form.agentId')}</Label>
              <Input value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })} disabled={!!editing} placeholder={t('cognitiveWargame.agents.form.agentIdPlaceholder')} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t('cognitiveWargame.agents.form.name')}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t('cognitiveWargame.agents.form.type')}</Label>
              <Select value={form.agent_type} onValueChange={(v) => setForm({ ...form, agent_type: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.filter((ty) => ty).map((ty) => (
                    <SelectItem key={ty} value={ty}>{typeLabel(ty)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t('cognitiveWargame.agents.form.bio')}</Label>
              <Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} rows={2} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t('cognitiveWargame.agents.form.parent')}</Label>
              <Input value={form.parent_agent_id} onChange={(e) => setForm({ ...form, parent_agent_id: e.target.value })} placeholder={t('cognitiveWargame.agents.form.parentPlaceholder')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              {t('cognitiveWargame.agents.form.cancel')}
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? t('cognitiveWargame.common.loading') : t('cognitiveWargame.agents.form.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AgentListPage;
