/**
 * ScenarioListPage — 想定列表（P3.0-5 增强）。
 *
 * P3.0-5: 新增"创建想定"Dialog + 表格操作列（查看/删除/启动推演）。
 * 使用 shadcn Dialog / Input / Textarea / Button 组件。
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IntellectPagination } from '@/components/ui/intellect-pagination';
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api, type Scenario } from '../api';
import WargameSectionLayout from '../components/section-menu';
import { WargamePath } from '../routes';
import { useWargameStore } from '../store';
import { useFetchUserInfo } from '@/hooks/use-user-setting-request';
import { t } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Activity,
  ClipboardCheck,
  Eye,
  LayoutGrid,
  List,
  Play,
  Trash2,
} from 'lucide-react';

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

const DEFAULT_PAGE_SIZE = 10;

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
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [actionError, setActionError] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [executingTasks, setExecutingTasks] = useState<Record<string, string>>(
    {},
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // 审批人身份：X-Actor 头透传当前用户 id（落 submitted_by，评审 #3 修复提交侧）
  const { data: userInfo } = useFetchUserInfo();

  const load = useCallback(() => {
    return fetchScenarios(pageSize, (currentPage - 1) * pageSize);
  }, [currentPage, fetchScenarios, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

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
              void load();
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
  }, [executingTasks, load]);

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
      setCreateOpen(false);
      setCreateForm(DEFAULT_FORM);
      await load();
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
      await load();
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
      await load();
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

  const handlePaginationChange = (page: number, size: number) => {
    setCurrentPage(page);
    setPageSize(size);
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
          <Button variant="outline" onClick={() => void load()}>
            {t('cognitiveWargame.common.refresh')}
          </Button>
        </div>
      </div>

      {actionError && !createOpen && (
        <p className="text-sm text-text-error">{actionError}</p>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-lg">
              {t('cognitiveWargame.scenario.listTitle')} ({total})
            </CardTitle>
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
            >
              <ToggleGroupItem
                value="table"
                title={t('cognitiveWargame.scenario.tableView', {
                  defaultValue: '列表视图',
                })}
                aria-label={t('cognitiveWargame.scenario.tableView', {
                  defaultValue: '列表视图',
                })}
              >
                <List className="size-4" />
              </ToggleGroupItem>
              <ToggleGroupItem
                value="cards"
                title={t('cognitiveWargame.scenario.cardView', {
                  defaultValue: '卡片视图',
                })}
                aria-label={t('cognitiveWargame.scenario.cardView', {
                  defaultValue: '卡片视图',
                })}
              >
                <LayoutGrid className="size-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CardHeader>
        <CardContent>
          <Spin spinning={loading}>
            {scenarios.length === 0 ? (
              <EmptyCard
                title={t('cognitiveWargame.common.empty')}
                className="w-full"
              />
            ) : viewMode === 'cards' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {scenarios.map((s) => {
                  const executing =
                    s.id in executingTasks || s.status === 'running';

                  return (
                    <Card
                      key={s.id}
                      className="transition-colors hover:border-accent-primary"
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <CardTitle className="truncate text-base">
                              {s.name}
                            </CardTitle>
                            <p className="mt-1 truncate font-mono text-xs text-text-disabled">
                              {s.id}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Badge variant="outline">{s.status ?? '-'}</Badge>
                            <span
                              title={
                                executing
                                  ? t('cognitiveWargame.scenario.executing', {
                                      defaultValue: '正在推演',
                                    })
                                  : t('cognitiveWargame.scenario.notExecuting', {
                                      defaultValue: '未执行推演',
                                    })
                              }
                              className={
                                executing
                                  ? 'text-accent-primary'
                                  : 'text-text-disabled'
                              }
                            >
                              <Activity className="size-4" />
                            </span>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="line-clamp-2 min-h-10 text-sm leading-5 text-text-secondary">
                          {s.description ?? '-'}
                        </p>
                        <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-text-secondary">
                          <div>
                            <div className="text-text-disabled">
                              {t('cognitiveWargame.scenario.roundsLimit')}
                            </div>
                            <div className="mt-1">{s.rounds_limit ?? '-'}</div>
                          </div>
                          <div>
                            <div className="text-text-disabled">
                              {t('cognitiveWargame.scenario.redForce')}
                            </div>
                            <div className="mt-1">{s.red_force ?? '-'}</div>
                          </div>
                          <div>
                            <div className="text-text-disabled">
                              {t('cognitiveWargame.scenario.blueForce')}
                            </div>
                            <div className="mt-1">{s.blue_force ?? '-'}</div>
                          </div>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <span className="text-xs text-text-disabled">
                            {s.created_at ?? '-'}
                          </span>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={t('cognitiveWargame.common.viewDetail')}
                              aria-label={t('cognitiveWargame.common.viewDetail')}
                              onClick={() =>
                                navigate(WargamePath.scenarioDetail(s.id))
                              }
                            >
                              <Eye className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={executing}
                              title={
                                executing
                                  ? t('cognitiveWargame.scenario.executing', {
                                      defaultValue: '正在推演',
                                    })
                                  : t('cognitiveWargame.common.execute')
                              }
                              aria-label={
                                executing
                                  ? t('cognitiveWargame.scenario.executing', {
                                      defaultValue: '正在推演',
                                    })
                                  : t('cognitiveWargame.common.execute')
                              }
                              onClick={() => handleExecute(s.id)}
                            >
                              <Play className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={approvalBusy === s.id}
                              title={t('cognitiveWargame.approval.submit')}
                              aria-label={t('cognitiveWargame.approval.submit')}
                              onClick={() => handleSubmitApproval(s)}
                            >
                              <ClipboardCheck className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-text-error"
                              title={t('cognitiveWargame.common.delete')}
                              aria-label={t('cognitiveWargame.common.delete')}
                              onClick={() => handleDelete(s.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
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
                        <TableCell className="max-w-40 truncate">
                          {s.description ?? '-'}
                        </TableCell>
                        <TableCell>
                          {s.status ?? '-'}
                          {s.status === 'running' && (
                            <Button
                              variant="link"
                              size="sm"
                              asChild
                              className="ml-2 h-auto p-0"
                            >
                              <Link to={WargamePath.roundView(s.id)}>
                                {t('cognitiveWargame.director.taskProgress')}
                              </Link>
                            </Button>
                          )}
                        </TableCell>
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
          <div className="mt-4">
            <IntellectPagination
              current={currentPage}
              pageSize={pageSize}
              total={total}
              onChange={handlePaginationChange}
            />
          </div>
        </CardContent>
      </Card>
      </div>
    </WargameSectionLayout>
  );
};

export default ScenarioListPage;
