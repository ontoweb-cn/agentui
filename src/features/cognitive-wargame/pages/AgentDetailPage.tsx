/**
 * AgentDetailPage - Agent detail for G-16.
 */
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
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { t } from 'i18next';
import { type AgentRelation } from '../api';
import AgentAttributesView from '../components/agent-attributes-view';
import WargameSectionLayout from '../components/section-menu';
import { useWargameStore } from '../store';

const RELATION_TYPES = [
  'employed_by',
  'spokesperson_of',
  'member_of',
  'subsidiary_of',
  'belongs_to',
] as const;

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    currentAgent,
    agentRelations,
    loading,
    loadAgent,
    loadAgentRelations,
    deleteAgent,
    createAgentRelation,
    deleteAgentRelation,
  } = useWargameStore();

  const [error, setError] = useState<string | null>(null);
  const [addRelOpen, setAddRelOpen] = useState(false);
  const [relForm, setRelForm] = useState({
    target_agent_id: '',
    relation_type: 'member_of',
  });
  const [relSubmitting, setRelSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      await loadAgent(id);
      await loadAgentRelations(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id, loadAgent, loadAgentRelations]);

  useEffect(() => {
    void load();
  }, [load]);

  const typeLabel = (ty: string) =>
    t(`cognitiveWargame.agents.type.${ty}`, { defaultValue: ty });
  const relLabel = (rt: string) =>
    t(`cognitiveWargame.agents.relation.${rt}`, { defaultValue: rt });
  const statusLabel = (status?: string) =>
    t(`cognitiveWargame.agents.status.${status ?? 'active'}`, {
      defaultValue: status ?? 'active',
    });
  const statusVariant = (status?: string) =>
    status === 'archived' ? ('secondary' as const) : ('success' as const);

  const handleDelete = async () => {
    if (!currentAgent) return;
    if (!confirm(t('cognitiveWargame.agents.deleteConfirm'))) return;
    try {
      await deleteAgent(currentAgent.agent_id);
      navigate('/cognitive-wargame/agents');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submitRelation = async () => {
    if (!id || !relForm.target_agent_id) return;
    setRelSubmitting(true);
    setError(null);
    try {
      await createAgentRelation(id, {
        source_agent_id: id,
        target_agent_id: relForm.target_agent_id,
        relation_type: relForm.relation_type,
      });
      setAddRelOpen(false);
      setRelForm({ target_agent_id: '', relation_type: 'member_of' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRelSubmitting(false);
    }
  };

  const handleDeleteRelation = async (rel: AgentRelation) => {
    if (!id) return;
    try {
      await deleteAgentRelation(id, rel.relation_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/cognitive-wargame/agents')}>
              <ArrowLeft className="size-4" />
              {t('cognitiveWargame.agents.detail.back')}
            </Button>
            <h1 className="text-xl font-medium">{currentAgent?.name ?? id}</h1>
            {currentAgent && <Badge variant="outline">{typeLabel(currentAgent.agent_type)}</Badge>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void handleDelete()}>
              {t('cognitiveWargame.agents.detail.delete')}
            </Button>
          </div>
        </div>

        {error && <p className="text-sm text-text-error">{error}</p>}

        <Spin spinning={loading}>
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
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    {t('cognitiveWargame.agents.detail.basicInfo', { defaultValue: '基本信息' })}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {currentAgent ? (
                    <dl className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <dt className="text-text-secondary">Agent ID</dt>
                        <dd className="font-mono">{currentAgent.agent_id}</dd>
                      </div>
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.agents.form.name')}
                        </dt>
                        <dd>{currentAgent.name}</dd>
                      </div>
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.agents.form.type')}
                        </dt>
                        <dd>
                          <Badge variant="outline">
                            {typeLabel(currentAgent.agent_type)}
                          </Badge>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.agents.table.status', { defaultValue: '状态' })}
                        </dt>
                        <dd>
                          <Badge variant={statusVariant(currentAgent.status)}>
                            {statusLabel(currentAgent.status)}
                          </Badge>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.agents.form.parent')}
                        </dt>
                        <dd className="font-mono">{currentAgent.parent_agent_id ?? '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.agents.form.bio')}
                        </dt>
                        <dd>{currentAgent.bio ?? '-'}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-text-secondary">
                      {t('cognitiveWargame.common.loading', { defaultValue: '加载中' })}
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="relations">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">
                      {t('cognitiveWargame.agents.detail.relations')}
                    </CardTitle>
                    <Button size="sm" onClick={() => setAddRelOpen(true)}>
                      {t('cognitiveWargame.agents.detail.addRelation')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {agentRelations.length === 0 ? (
                    <p className="text-text-secondary">
                      {t('cognitiveWargame.agents.detail.noRelations', { defaultValue: '暂无关系' })}
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('cognitiveWargame.agents.relation.type')}</TableHead>
                          <TableHead>{t('cognitiveWargame.agents.relation.target')}</TableHead>
                          <TableHead>{t('cognitiveWargame.common.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {agentRelations.map((rel) => {
                          const isSource = rel.source_agent_id === id;
                          const otherId = isSource ? rel.target_agent_id : rel.source_agent_id;
                          return (
                            <TableRow key={rel.relation_id}>
                              <TableCell>
                                <Badge variant="outline">{relLabel(rel.relation_type)}</Badge>
                              </TableCell>
                              <TableCell className="font-mono text-sm">{otherId}</TableCell>
                              <TableCell>
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0 text-text-error"
                                  onClick={() => void handleDeleteRelation(rel)}
                                >
                                  {t('cognitiveWargame.common.delete')}
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="attrs">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    {t('cognitiveWargame.agents.detail.attrs')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <AgentAttributesView
                    attributes={currentAgent?.attributes}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </Spin>

        <Dialog open={addRelOpen} onOpenChange={(open) => !open && setAddRelOpen(false)}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{t('cognitiveWargame.agents.detail.addRelation')}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-2">
                <Label>{t('cognitiveWargame.agents.relation.target')}</Label>
                <Input
                  value={relForm.target_agent_id}
                  onChange={(event) =>
                    setRelForm({ ...relForm, target_agent_id: event.target.value })
                  }
                  placeholder={t('cognitiveWargame.agents.relation.target', {
                    defaultValue: '目标 Agent ID',
                  })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('cognitiveWargame.agents.relation.type')}</Label>
                <Select
                  value={relForm.relation_type}
                  onValueChange={(value) =>
                    setRelForm({ ...relForm, relation_type: value })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RELATION_TYPES.map((relationType) => (
                      <SelectItem key={relationType} value={relationType}>
                        {t(`cognitiveWargame.agents.relation.${relationType}`, {
                          defaultValue: relationType,
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setAddRelOpen(false)}
                disabled={relSubmitting}
              >
                {t('cognitiveWargame.agents.form.cancel')}
              </Button>
              <Button onClick={() => void submitRelation()} disabled={relSubmitting}>
                {relSubmitting
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
