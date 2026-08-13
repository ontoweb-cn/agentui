/**
 * AgentListPage - Agent register list for G-16.
 */
import { cn } from '@/lib/utils';
import { EmptyCard } from '@/components/empty/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IntellectPagination } from '@/components/ui/intellect-pagination';
import { Input } from '@/components/ui/input';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Activity,
  ArrowRight,
  Eye,
  LayoutGrid,
  List,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { t } from 'i18next';
import { type Agent, type AgentRelation } from '../api';
import AgentAttributesView from '../components/agent-attributes-view';
import { RequireRole } from '../components/require-role';
import SkillAssignPanel from '../components/skill-assign-panel';
import WargameSectionLayout from '../components/section-menu';
import { WargamePath } from '../routes';
import { useWargameStore } from '../store';

const ALL_FILTER = 'all';
const DEFAULT_PAGE_SIZE = 10;
const TYPE_OPTIONS = [
  ALL_FILTER,
  'individual',
  'admin_organ',
  'political_party',
  'news_media',
  'mass',
] as const;
const STATUS_OPTIONS = [ALL_FILTER, 'active', 'archived'] as const;
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/;

export default function AgentListPage() {
  const navigate = useNavigate();
  const {
    agents,
    agentTotal,
    currentAgent,
    agentRelations,
    agentsLoading,
    loading: detailLoading,
    error: storeError,
    fetchAgents,
    fetchAgentTypes,
    loadAgent,
    loadAgentRelations,
    createAgent,
    updateAgent,
    deleteAgent,
  } = useWargameStore();

  const [typeFilter, setTypeFilter] = useState<string>(ALL_FILTER);
  const [statusFilter, setStatusFilter] = useState<string>(ALL_FILTER);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [form, setForm] = useState({
    agent_id: '',
    name: '',
    agent_type: 'individual',
    bio: '',
    parent_agent_id: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningAgentIds = useMemo(() => new Set<string>(), []);

  const load = useCallback(async () => {
    setError(null);
    try {
      await fetchAgents({
        agent_type: typeFilter === ALL_FILTER ? undefined : typeFilter,
        status: statusFilter === ALL_FILTER ? undefined : statusFilter,
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [currentPage, fetchAgents, pageSize, typeFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchAgentTypes();
  }, [fetchAgentTypes]);

  const filteredAgents = useMemo(() => {
    if (!search) return agents;
    const q = search.toLowerCase();
    return agents.filter((agent) =>
      `${agent.agent_id} ${agent.name}`.toLowerCase().includes(q),
    );
  }, [agents, search]);

  const typeLabel = (ty: string) =>
    t(`cognitiveWargame.agents.type.${ty}`, { defaultValue: ty });
  const relLabel = (rt: string) =>
    t(`cognitiveWargame.agents.relation.${rt}`, { defaultValue: rt });
  const statusLabel = (status?: string) =>
    t(`cognitiveWargame.agents.status.${status ?? 'active'}`, {
      defaultValue: status ?? 'active',
    });
  const statusVariant = (status?: string) => {
    if (status === 'active') return 'success' as const;
    if (status === 'archived') return 'secondary' as const;
    return 'outline' as const;
  };

  const resetDetailSelection = () => {
    setSelectedAgentId(null);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      agent_id: '',
      name: '',
      agent_type: 'individual',
      bio: '',
      parent_agent_id: '',
    });
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (agent: Agent) => {
    setEditing(agent);
    setForm({
      agent_id: agent.agent_id,
      name: agent.name,
      agent_type: agent.agent_type,
      bio: agent.bio ?? '',
      parent_agent_id: agent.parent_agent_id ?? '',
    });
    setError(null);
    setDialogOpen(true);
  };

  const selectAgent = async (agentId: string) => {
    setSelectedAgentId(agentId);
    setError(null);
    try {
      await loadAgent(agentId);
      await loadAgentRelations(agentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (agent: Agent) => {
    if (!confirm(t('cognitiveWargame.agents.deleteConfirm', { defaultValue: '确认删除？' }))) {
      return;
    }
    try {
      await deleteAgent(agent.agent_id);
      if (selectedAgentId === agent.agent_id) {
        resetDetailSelection();
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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

    if (form.parent_agent_id && !AGENT_ID_RE.test(form.parent_agent_id)) {
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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaginationChange = (page: number, size: number) => {
    setCurrentPage(page);
    setPageSize(size);
    resetDetailSelection();
  };

  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-medium">{t('cognitiveWargame.agents.title')}</h1>
            <p className="text-sm text-text-secondary">{t('cognitiveWargame.agents.subtitle')}</p>
          </div>
          <div className="flex items-end gap-3">
            <RequireRole>
              <Button onClick={openCreate}>{t('cognitiveWargame.agents.list.create')}</Button>
            </RequireRole>
            <Button variant="outline" onClick={() => void load()} disabled={agentsLoading}>
              <RefreshCw className="size-4" />
              {t('cognitiveWargame.agents.list.refresh')}
            </Button>
          </div>
        </div>

        {(error || storeError) && (
          <p className="text-sm text-text-error">{error || storeError}</p>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t('cognitiveWargame.agents.title')} ({search ? `${filteredAgents.length}/${agentTotal}` : agentTotal})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="flex flex-col gap-2">
                <Label>{t('cognitiveWargame.agents.list.filterType')}</Label>
                <Select
                  value={typeFilter}
                  onValueChange={(value) => {
                    setTypeFilter(value);
                    setCurrentPage(1);
                    resetDetailSelection();
                  }}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((ty) => (
                      <SelectItem key={ty} value={ty}>
                        {ty === ALL_FILTER
                          ? t('cognitiveWargame.agents.list.all', { defaultValue: '全部' })
                          : typeLabel(ty)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('cognitiveWargame.agents.list.filterStatus')}</Label>
                <Select
                  value={statusFilter}
                  onValueChange={(value) => {
                    setStatusFilter(value);
                    setCurrentPage(1);
                    resetDetailSelection();
                  }}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status === ALL_FILTER
                          ? t('cognitiveWargame.agents.list.all', { defaultValue: '全部' })
                          : statusLabel(status)}
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
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setCurrentPage(1);
                    resetDetailSelection();
                  }}
                  className="w-60"
                />
              </div>
              <ToggleGroup
                type="single"
                value={viewMode}
                onValueChange={(value) => {
                  if (value) {
                    setViewMode(value as 'table' | 'cards');
                  }
                }}
                variant="outline"
                size="sm"
                className="ml-auto self-end"
              >
                <ToggleGroupItem
                  value="table"
                  title={t('cognitiveWargame.agents.list.tableView')}
                  aria-label={t('cognitiveWargame.agents.list.tableView')}
                >
                  <List className="size-4" />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="cards"
                  title={t('cognitiveWargame.agents.list.cardView')}
                  aria-label={t('cognitiveWargame.agents.list.cardView')}
                >
                  <LayoutGrid className="size-4" />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <Spin spinning={agentsLoading}>
              {filteredAgents.length === 0 ? (
                <EmptyCard title={t('cognitiveWargame.agents.empty')} className="w-full" />
              ) : viewMode === 'cards' ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {filteredAgents.map((agent) => (
                    <Card
                      key={agent.agent_id}
                      className={cn(
                        'cursor-pointer transition-colors hover:border-accent-primary',
                        selectedAgentId === agent.agent_id && 'border-accent-primary',
                      )}
                      onClick={() => void selectAgent(agent.agent_id)}
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <CardTitle className="truncate text-base">
                              {agent.name}
                            </CardTitle>
                            <p className="mt-1 truncate font-mono text-xs text-text-disabled">
                              {agent.agent_id}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1.5">
                            <Badge variant="outline">
                              {typeLabel(agent.agent_type)}
                            </Badge>
                            <Badge variant={statusVariant(agent.status)}>
                              {statusLabel(agent.status)}
                            </Badge>
                            <span
                              title={
                                runningAgentIds.has(agent.agent_id)
                                  ? t('cognitiveWargame.agents.running', {
                                      defaultValue: '运行中',
                                    })
                                  : t('cognitiveWargame.agents.notRunning', {
                                      defaultValue: '未运行',
                                    })
                              }
                              className={cn(
                                'inline-flex size-7 items-center justify-center rounded',
                                runningAgentIds.has(agent.agent_id)
                                  ? 'text-accent-primary'
                                  : 'text-text-disabled',
                              )}
                            >
                              <Activity className="size-4" />
                            </span>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-hidden rounded border border-border-button">
                          <table className="w-full border-collapse text-[11px]">
                            <thead>
                              <tr className="border-b border-border-button bg-bg-input/50 text-left text-text-secondary">
                                <th className="px-2 py-1.5 font-normal">
                                  {t('cognitiveWargame.agents.cardTable.action', {
                                    defaultValue: '动作',
                                  })}
                                </th>
                                <th className="px-2 py-1.5 font-normal">
                                  {t(
                                    'cognitiveWargame.agents.cardTable.interface',
                                    {
                                      defaultValue: '接口',
                                    },
                                  )}
                                </th>
                                <th className="px-2 py-1.5 font-normal">HTTP</th>
                                <th className="px-2 py-1.5 font-normal">code</th>
                                <th className="px-2 py-1.5 font-normal">
                                  {t('cognitiveWargame.agents.cardTable.target', {
                                    defaultValue: '目标',
                                  })}
                                </th>
                                <th className="px-2 py-1.5 font-normal">
                                  {t('cognitiveWargame.agents.cardTable.result', {
                                    defaultValue: '结果',
                                  })}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="text-text-disabled">
                                <td className="px-2 py-1.5">-</td>
                                <td className="px-2 py-1.5">-</td>
                                <td className="px-2 py-1.5">-</td>
                                <td className="px-2 py-1.5">-</td>
                                <td className="px-2 py-1.5">-</td>
                                <td className="px-2 py-1.5">-</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <span className="text-xs text-text-disabled">
                            {agent.updated_at ?? '-'}
                          </span>
                          <div
                            className="flex shrink-0 items-center gap-2"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={t('cognitiveWargame.common.viewDetail')}
                              aria-label={t('cognitiveWargame.common.viewDetail')}
                              onClick={() =>
                                navigate(WargamePath.agentDetail(agent.agent_id))
                              }
                            >
                              <Eye className="size-3.5" />
                            </Button>
                            <RequireRole>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                title={t('cognitiveWargame.agents.detail.edit')}
                                aria-label={t('cognitiveWargame.agents.detail.edit')}
                                onClick={() => openEdit(agent)}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-text-error"
                                title={t('cognitiveWargame.agents.detail.delete')}
                                aria-label={t('cognitiveWargame.agents.detail.delete')}
                                onClick={() => void handleDelete(agent)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </RequireRole>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
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
                    {filteredAgents.map((agent) => (
                      <TableRow
                        key={agent.agent_id}
                        className={selectedAgentId === agent.agent_id ? 'bg-bg-input/60' : ''}
                        onClick={() => void selectAgent(agent.agent_id)}
                      >
                        <TableCell className="font-mono text-sm">{agent.agent_id}</TableCell>
                        <TableCell className="font-medium">{agent.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{typeLabel(agent.agent_type)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(agent.status)}>
                            {statusLabel(agent.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-text-secondary">
                          {agent.updated_at ?? '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0"
                              onClick={() => navigate(WargamePath.agentDetail(agent.agent_id))}
                            >
                              {t('cognitiveWargame.common.viewDetail')}
                              <ArrowRight className="size-3.5" />
                            </Button>
                            <RequireRole>
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto p-0"
                                onClick={() => openEdit(agent)}
                              >
                                {t('cognitiveWargame.agents.detail.edit')}
                              </Button>
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-text-error"
                                onClick={() => void handleDelete(agent)}
                              >
                                {t('cognitiveWargame.agents.detail.delete')}
                              </Button>
                            </RequireRole>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Spin>

            <div className="mt-4">
              <IntellectPagination
                current={currentPage}
                pageSize={pageSize}
                total={agentTotal}
                onChange={handlePaginationChange}
              />
            </div>
          </CardContent>
        </Card>

        {selectedAgentId && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-lg">
                  {currentAgent?.name ?? t('cognitiveWargame.agents.detail.basicInfo', { defaultValue: '基本信息' })}
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(WargamePath.agentDetail(selectedAgentId))}
                >
                  {t('cognitiveWargame.common.viewDetail')}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Spin spinning={detailLoading}>
                {currentAgent && currentAgent.agent_id === selectedAgentId ? (
                  <Tabs defaultValue="info">
                    <TabsList>
                      <TabsTrigger value="info">
                        {t('cognitiveWargame.agents.detail.basicInfo', { defaultValue: '基本信息' })}
                      </TabsTrigger>
                      <TabsTrigger value="relations">
                        {t('cognitiveWargame.agents.detail.relations')} ({agentRelations.length})
                      </TabsTrigger>
                      <TabsTrigger value="attrs">
                        {t('cognitiveWargame.agents.detail.attrs')}
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="info">
                      <dl className="grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-3">
                        <div>
                          <dt className="text-text-secondary">Agent ID</dt>
                          <dd className="break-all font-mono">{currentAgent.agent_id}</dd>
                        </div>
                        <div>
                          <dt className="text-text-secondary">{t('cognitiveWargame.agents.form.name')}</dt>
                          <dd>{currentAgent.name}</dd>
                        </div>
                        <div>
                          <dt className="text-text-secondary">{t('cognitiveWargame.agents.form.type')}</dt>
                          <dd>
                            <Badge variant="outline">{typeLabel(currentAgent.agent_type)}</Badge>
                          </dd>
                        </div>
                        <div>
                          <dt className="text-text-secondary">{t('cognitiveWargame.agents.table.status')}</dt>
                          <dd>
                            <Badge variant={statusVariant(currentAgent.status)}>
                              {statusLabel(currentAgent.status)}
                            </Badge>
                          </dd>
                        </div>
                        <div>
                          <dt className="text-text-secondary">{t('cognitiveWargame.agents.form.parent')}</dt>
                          <dd className="break-all font-mono">{currentAgent.parent_agent_id ?? '-'}</dd>
                        </div>
                        <div>
                          <dt className="text-text-secondary">{t('cognitiveWargame.agents.form.bio')}</dt>
                          <dd>{currentAgent.bio ?? '-'}</dd>
                        </div>
                      </dl>
                    </TabsContent>

                    <TabsContent value="relations">
                      {agentRelations.length === 0 ? (
                        <p className="text-sm text-text-secondary">
                          {t('cognitiveWargame.agents.detail.noRelations')}
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t('cognitiveWargame.agents.relation.type')}</TableHead>
                              <TableHead>{t('cognitiveWargame.agents.relation.source')}</TableHead>
                              <TableHead>{t('cognitiveWargame.agents.relation.target')}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {agentRelations.map((relation: AgentRelation) => (
                              <TableRow key={relation.relation_id}>
                                <TableCell>
                                  <Badge variant="outline">
                                    {relLabel(relation.relation_type)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono text-sm">
                                  {relation.source_agent_id}
                                </TableCell>
                                <TableCell className="font-mono text-sm">
                                  {relation.target_agent_id}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </TabsContent>

                    <TabsContent value="attrs">
                      <SkillAssignPanel agentId={selectedAgentId} />
                      <AgentAttributesView
                        attributes={currentAgent.attributes}
                      />
                    </TabsContent>
                  </Tabs>
                ) : (
                  <p className="text-sm text-text-secondary">
                    {t('cognitiveWargame.common.loading')}
                  </p>
                )}
              </Spin>
            </CardContent>
          </Card>
        )}

        <Dialog open={dialogOpen} onOpenChange={(open) => !open && setDialogOpen(false)}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>
                {editing
                  ? t('cognitiveWargame.agents.form.editTitle')
                  : t('cognitiveWargame.agents.form.createTitle')}
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-2">
                <Label>{t('cognitiveWargame.agents.form.agentId')}</Label>
                <Input
                  value={form.agent_id}
                  onChange={(event) => setForm({ ...form, agent_id: event.target.value })}
                  disabled={!!editing}
                  placeholder={t('cognitiveWargame.agents.form.agentIdPlaceholder')}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('cognitiveWargame.agents.form.name')}</Label>
                <Input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('cognitiveWargame.agents.form.type')}</Label>
                <Select
                  value={form.agent_type}
                  onValueChange={(value) => setForm({ ...form, agent_type: value })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.filter((ty) => ty !== ALL_FILTER).map((ty) => (
                      <SelectItem key={ty} value={ty}>
                        {typeLabel(ty)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('cognitiveWargame.agents.form.bio')}</Label>
                <Textarea
                  value={form.bio}
                  onChange={(event) => setForm({ ...form, bio: event.target.value })}
                  rows={2}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('cognitiveWargame.agents.form.parent')}</Label>
                <Input
                  value={form.parent_agent_id}
                  onChange={(event) =>
                    setForm({ ...form, parent_agent_id: event.target.value })
                  }
                  placeholder={t('cognitiveWargame.agents.form.parentPlaceholder')}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={submitting}
              >
                {t('cognitiveWargame.agents.form.cancel')}
              </Button>
              <Button onClick={() => void submit()} disabled={submitting}>
                {submitting
                  ? t('cognitiveWargame.common.loading')
                  : t('cognitiveWargame.agents.form.submit')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </WargameSectionLayout>
  );
}
