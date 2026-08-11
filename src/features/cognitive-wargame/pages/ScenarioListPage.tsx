/**
 * ScenarioListPage — 想定列表（P3.0-5 增强）。
 *
 * P3.0-5: 新增"创建想定"Dialog + 表格操作列（查看/删除/启动推演）。
 * 使用 shadcn Dialog / Input / Textarea / Button 组件。
 */
import { EmptyCard } from '@/components/empty/empty';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { api, type Scenario } from '../api';
import WargameSectionLayout from '../components/section-menu';
import { WargamePath } from '../routes';
import { useWargameStore } from '../store';
import { useFetchUserInfo } from '@/hooks/use-user-setting-request';
import { t } from 'i18next';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

interface CreateFormData {
  name: string;
  description: string;
  rounds: number;
  redForce: string;
  blueForce: string;
}

const DEFAULT_FORM: CreateFormData = {
  name: '',
  description: '',
  rounds: 6,
  redForce: '红方',
  blueForce: '蓝方',
};

const RUNNING_TASK_STATUS = new Set(['pending', 'running']);
const FINISHED_TASK_STATUS = new Set([
  'done',
  'completed',
  'failed',
  'canceled',
]);

function createScenarioId(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${slug || 'scenario'}-${Date.now().toString(36)}`;
}

const ScenarioListPage: React.FC = () => {
  const { scenarios, loading, total, fetchScenarios } = useWargameStore();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormData>(DEFAULT_FORM);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [executingTasks, setExecutingTasks] = useState<Record<string, string>>(
    {},
  );
  // 审批人身份：X-Actor 头透传当前用户 id（落 submitted_by，评审 #3 修复提交侧）
  const { data: userInfo } = useFetchUserInfo();

  useEffect(() => {
    fetchScenarios(20, 0);
  }, [fetchScenarios]);

  useEffect(() => {
    const entries = Object.entries(executingTasks).filter(([, taskId]) =>
      Boolean(taskId),
    );
    if (!entries.length) return;

    const timer = window.setInterval(() => {
      entries.forEach(([scenarioId, taskId]) => {
        api
          .getTaskStatus(scenarioId, taskId)
          .then((info) => {
            if (RUNNING_TASK_STATUS.has(info.status)) return;
            if (FINISHED_TASK_STATUS.has(info.status)) {
              setExecutingTasks((current) => {
                const next = { ...current };
                delete next[scenarioId];
                return next;
              });
              void fetchScenarios(20, 0);
            }
          })
          .catch((err) => {
            setExecutingTasks((current) => {
              const next = { ...current };
              delete next[scenarioId];
              return next;
            });
            setActionError(err instanceof Error ? err.message : String(err));
          });
      });
    }, 2000);

    return () => window.clearInterval(timer);
  }, [executingTasks, fetchScenarios]);

  const handleCreate = async () => {
    if (!createForm.name.trim()) {
      setActionError(t('cognitiveWargame.scenario.createName'));
      return;
    }
    if (createForm.rounds < 2) {
      setActionError('回合数至少需要 2 才能创建想定');
      return;
    }
    setCreating(true);
    setActionError(null);
    try {
      const name = createForm.name.trim();
      const scenarioId = createScenarioId(name);
      const rounds = Number.isFinite(createForm.rounds)
        ? Math.max(2, Math.floor(createForm.rounds))
        : 2;
      await api.generateScenario({
        scenario_id: scenarioId,
        name,
        rounds,
        red_force: createForm.redForce,
        blue_force: createForm.blueForce,
        description: createForm.description,
      });
      api.cacheScenarioDescription(scenarioId, createForm.description);
      setCreateOpen(false);
      setCreateForm(DEFAULT_FORM);
      await fetchScenarios(20, 0);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t('cognitiveWargame.scenario.createFailed'),
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('cognitiveWargame.scenario.deleteConfirm'))) return;
    try {
      await api.deleteScenario(id);
      await fetchScenarios(20, 0);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExecute = async (id: string) => {
    if (!window.confirm(t('cognitiveWargame.scenario.executeConfirm'))) return;
    setExecutingTasks((current) => ({ ...current, [id]: '' }));
    setActionError(null);
    try {
      const task = await api.executeScenario(id);
      setExecutingTasks((current) => ({ ...current, [id]: task.task_id }));
      await fetchScenarios(20, 0);
    } catch (err) {
      setExecutingTasks((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSubmitApproval = async (s: Scenario) => {
    const title = window.prompt(
      t('cognitiveWargame.approval.submitTitle'),
      `${s.name} ${t('cognitiveWargame.approval.title')}`,
    );
    if (!title?.trim()) return;
    setApprovalBusy(s.id);
    setActionError(null);
    try {
      await api.submitApproval(
        {
          resource_type: 'scenario',
          resource_id: s.id,
          title: title.trim(),
        },
        userInfo?.id,
      );
      setActionError(t('cognitiveWargame.approval.submitSuccess'));
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : t('cognitiveWargame.approval.submitFailed'),
      );
    } finally {
      setApprovalBusy(null);
    }
  };

  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">
          {t('cognitiveWargame.scenario.listTitle')}
        </h1>
        <div className="flex items-center gap-2">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>{t('cognitiveWargame.scenario.createTitle')}</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>
                  {t('cognitiveWargame.scenario.createTitle')}
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="scenario-name">
                    {t('cognitiveWargame.scenario.createName')}
                  </Label>
                  <Input
                    id="scenario-name"
                    value={createForm.name}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, name: e.target.value })
                    }
                    placeholder="test-scenario-001"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="scenario-desc">
                    {t('cognitiveWargame.scenario.createDescription')}
                  </Label>
                  <Textarea
                    id="scenario-desc"
                    value={createForm.description}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, description: e.target.value })
                    }
                    rows={2}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="scenario-rounds">
                    {t('cognitiveWargame.scenario.createRounds')}
                  </Label>
                  <Input
                    id="scenario-rounds"
                    type="number"
                    min={2}
                    max={50}
                    value={createForm.rounds}
                    onChange={(e) => {
                      const rounds = e.currentTarget.valueAsNumber;
                      setCreateForm({
                        ...createForm,
                        rounds: Number.isFinite(rounds)
                          ? Math.max(2, Math.floor(rounds))
                          : 2,
                      });
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="scenario-red">
                      {t('cognitiveWargame.scenario.createRedForce')}
                    </Label>
                    <Input
                      id="scenario-red"
                      value={createForm.redForce}
                      onChange={(e) =>
                        setCreateForm({ ...createForm, redForce: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="scenario-blue">
                      {t('cognitiveWargame.scenario.createBlueForce')}
                    </Label>
                    <Input
                      id="scenario-blue"
                      value={createForm.blueForce}
                      onChange={(e) =>
                        setCreateForm({ ...createForm, blueForce: e.target.value })
                      }
                    />
                  </div>
                </div>
                {actionError && (
                  <p className="text-sm text-text-error">{actionError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  disabled={creating}
                >
                  {t('cognitiveWargame.common.cancel')}
                </Button>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating
                    ? t('cognitiveWargame.common.loading')
                    : t('cognitiveWargame.common.create')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={() => fetchScenarios(20, 0)}>
            {t('cognitiveWargame.common.refresh')}
          </Button>
        </div>
      </div>

      {actionError && !createOpen && (
        <p className="text-sm text-text-error">{actionError}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t('cognitiveWargame.scenario.listTitle')} ({total})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Spin spinning={loading}>
            {scenarios.length === 0 ? (
              <EmptyCard
                title={t('cognitiveWargame.common.empty')}
                className="w-full"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t('cognitiveWargame.scenario.name')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.scenario.description')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.common.status')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.scenario.roundsLimit')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.common.createdAt')}
                    </TableHead>
                    <TableHead>
                      {t('cognitiveWargame.common.actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scenarios.map((s) => {
                    const executing =
                      s.id in executingTasks || s.status === 'running';

                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="max-w-xs truncate">
                          {s.description ?? '-'}
                        </TableCell>
                        <TableCell>{s.status ?? '-'}</TableCell>
                        <TableCell>{s.rounds_limit ?? '-'}</TableCell>
                        <TableCell>{s.created_at ?? '-'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0"
                              onClick={() =>
                                navigate(WargamePath.scenarioDetail(s.id))
                              }
                            >
                              {t('cognitiveWargame.common.viewDetail')}
                            </Button>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0"
                              disabled={executing}
                              onClick={() => handleExecute(s.id)}
                            >
                              {executing
                                ? t('cognitiveWargame.scenario.executing', {
                                    defaultValue: '正在推演',
                                  })
                                : t('cognitiveWargame.common.execute')}
                            </Button>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0"
                              disabled={approvalBusy === s.id}
                              onClick={() => handleSubmitApproval(s)}
                            >
                              {approvalBusy === s.id
                                ? t('cognitiveWargame.common.loading')
                                : t('cognitiveWargame.approval.submit')}
                            </Button>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-text-error"
                              onClick={() => handleDelete(s.id)}
                            >
                              {t('cognitiveWargame.common.delete')}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Spin>
        </CardContent>
      </Card>
      </div>
    </WargameSectionLayout>
  );
};

export default ScenarioListPage;
