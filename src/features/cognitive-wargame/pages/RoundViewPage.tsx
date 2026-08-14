/**
 * RoundViewPage 推演监控 / 导演台（P3.0-5 重写：想定列表 + 主从联动 Tab 视图）。
 *
 * 布局：
 * - 想定列表大框：标题（想定列表）内嵌 搜索（名称/ID/描述），刷新按钮在框右上角
 * - 想定列表：一次拉取全部想定（limit 100），每页 5 条前端分页；行点击选中并同步 URL（/rounds/:id）
 * - 选中想定后下方展开卡片：基本信息 / 历史回放 / 态势分析 / 知识图谱 / 评估报告
 *
 * - 正在推演：每 10s 轮询 /scenarios/{id}/status，行内显示"正在推演"徽章 + 控制面板按钮
 * - 控制面板 Dialog：启动推演 / 暂停 / 恢复 / 注入干预（叙事注入/状态修改/否决策略）
 * - 实时事件流：useSseEvents 订阅，anomaly.detected/intervention.applied/round.* 实时展示
 * - 干预历史：store.interventions（SSE 增量 + fetchInterventions 全量）
 * - 异常告警：store.anomalies（SSE anomaly.detected 增量）
 * - 回合历史：api.getMetricsHistory
 */
import { EmptyCard } from '@/components/empty/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
import { Input } from '@/components/ui/input';
import { IntellectPagination } from '@/components/ui/intellect-pagination';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { LayoutGrid, List, RefreshCw } from 'lucide-react';
import {
  api,
  type InterventionRequest,
  type Metrics,
  type Scenario,
  type ScenarioTaskStatus,
} from '../api';
import ScenarioKGView from '../components/scenario-kg-view';
import ScenarioMetricsView from '../components/scenario-metrics-view';
import ScenarioPlaybackView from '../components/scenario-playback-view';
import ScenarioReportView from '../components/scenario-report-view';
import WargameSectionLayout from '../components/section-menu';
import { useSseEvents, type CognitiveEvent } from '../hooks/use-sse-events';
import { WargamePath } from '../routes';
import { useWargameStore } from '../store';
import { t } from 'i18next';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

const MAX_LIVE_EVENTS = 50;

const PAGE_SIZE = 5;
const MAX_SCENARIOS_LIMIT = 100;
const TASK_POLL_INTERVAL_MS = 5000;

type InterventionKind = InterventionRequest['type'];

interface InjectForm {
  kind: InterventionKind;
  round: number;
  reason: string;
  // narrative_inject
  text: string;
  stance: string;
  valence: number;
  // agent_override
  agentId: string;
  fieldName: string;
  fieldValue: string;
  // strategy_veto
  strategyId: string;
}

const DEFAULT_INJECT: InjectForm = {
  kind: 'narrative_inject',
  round: 1,
  reason: '',
  text: '',
  stance: 'neutral',
  valence: 0,
  agentId: '',
  fieldName: '',
  fieldValue: '',
  strategyId: '',
};
const RoundViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    scenarios,
    loading,
    currentScenario,
    loadScenario,
    currentRound,
    setCurrentRound,
    interventions,
    anomalies,
    fetchInterventions,
    addIntervention,
    addAnomaly,
    clearEvents,
    setCurrentTaskId,
    fetchScenarios,
  } = useWargameStore();

  // 列表工具条状态
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  // 控制面板 Dialog：当前打开控制面板的想定 ID（仅"正在推演"的想定行可打开）
  const [controlScenarioId, setControlScenarioId] = useState<string | null>(null);
  // 想定最近推演任务状态（轮询 /status，用于显示"正在推演"）
  const [taskStatusMap, setTaskStatusMap] = useState<
    Record<string, ScenarioTaskStatus>
  >({});

  // 基本信息（完整详情）
  const [scenarioDetail, setScenarioDetail] = useState<Scenario | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 导演控制台状态
  const [liveEvents, setLiveEvents] = useState<CognitiveEvent[]>([]);
  const [history, setHistory] = useState<Metrics[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [injectOpen, setInjectOpen] = useState(false);
  const [inject, setInject] = useState<InjectForm>(DEFAULT_INJECT);
  // 历史信息 Tabs 当前激活项（控制面板内，受控以支持回合历史自动跟随）
  const [historyTab, setHistoryTab] = useState('interventions');

  // 实时事件流 / 回合历史滚动跟随（上滑超 40px 暂停跟随，回到底部恢复）
  const liveViewportRef = useRef<HTMLDivElement>(null);
  const liveFollowRef = useRef(true);
  const roundsViewportRef = useRef<HTMLDivElement>(null);
  const roundsFollowRef = useRef(true);

  const handleLiveScroll = useCallback(() => {
    const vp = liveViewportRef.current;
    if (!vp) return;
    liveFollowRef.current =
      vp.scrollHeight - vp.scrollTop - vp.clientHeight < 40;
  }, []);

  const handleRoundsScroll = useCallback(() => {
    const vp = roundsViewportRef.current;
    if (!vp) return;
    roundsFollowRef.current =
      vp.scrollHeight - vp.scrollTop - vp.clientHeight < 40;
  }, []);

  // 实时事件流：内容更新且用户未上翻时自动滚到底部（最新在底部）
  useEffect(() => {
    const vp = liveViewportRef.current;
    if (vp && liveFollowRef.current) {
      vp.scrollTop = vp.scrollHeight;
    }
  }, [liveEvents]);

  // 回合历史：数据刷新且当前激活该 tab、用户未上翻时自动滚到底部
  useEffect(() => {
    const vp = roundsViewportRef.current;
    if (historyTab === 'rounds' && vp && roundsFollowRef.current) {
      vp.scrollTop = vp.scrollHeight;
    }
  }, [history, historyTab]);

  // SSE 跟随：控制面板打开时订阅该想定，否则订阅当前选中的想定
  const sseScenarioId = controlScenarioId ?? (id ?? null);

  const refreshHistory = useCallback(async (scenarioId: string) => {
    if (!scenarioId) return;
    setHistoryLoading(true);
    try {
      const h = await api
        .getMetricsHistory(scenarioId)
        .catch(() => [] as Metrics[]);
      setHistory(h);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // 想定任务状态：拉取指定想定的推演任务状态（轮询 + SSE 事件触发）
  const refreshTaskStatuses = useCallback(async (ids: string[]) => {
    const entries = await Promise.all(
      ids.map(async (scenarioId) => {
        try {
          return [
            scenarioId,
            await api.getScenarioTaskStatus(scenarioId),
          ] as const;
        } catch {
          return null;
        }
      }),
    );
    setTaskStatusMap((prev) => {
      const next = { ...prev };
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      return next;
    });
  }, []);

  // SSE 事件回调：分发到 store + 维护实时事件流
  const handleEvent = useCallback(
    (event: CognitiveEvent) => {
      // 实时事件流（时间升序：最新在底部，截断保留最新 MAX_LIVE_EVENTS 条）
      setLiveEvents((prev) => [...prev, event].slice(-MAX_LIVE_EVENTS));

      switch (event.type) {
        case 'anomaly.detected':
          addAnomaly(event.payload as unknown as Parameters<typeof addAnomaly>[0]);
          break;
        case 'intervention.applied':
          addIntervention(
            event.payload as unknown as Parameters<typeof addIntervention>[0],
          );
          break;
        case 'scenario.round.completed': {
          // F2: 事件名从 round.completed 改为 scenario.round.completed
          // F24: round_num 在 payload 内，兼容顶层 round_id
          const roundNum =
            (event.payload as { round_num?: number }).round_num ?? event.round_id;
          if (roundNum) {
            setCurrentRound(roundNum);
            refreshHistory(sseScenarioId ?? '');
          }
          if (sseScenarioId) {
            refreshTaskStatuses([sseScenarioId]);
          }
          break;
        }
        case 'scenario.canceled':
          // R3: 真正中断（未 RUNNING），清除当前任务
          setCurrentTaskId(null);
          if (sseScenarioId) {
            refreshTaskStatuses([sseScenarioId]);
          }
          break;
        case 'scenario.cancel_requested':
          // R3: RUNNING 任务请求取消（仅标记），任务仍在运行，保留 taskId
          break;
        case 'scenario.round.started': {
          // R4: 回合开始，更新 currentRound 以反映进行中的回合
          const startedRoundNum =
            (event.payload as { round_num?: number }).round_num ?? event.round_id;
          if (startedRoundNum) {
            setCurrentRound(startedRoundNum);
          }
          if (sseScenarioId) {
            refreshTaskStatuses([sseScenarioId]);
          }
          break;
        }
        case 'system.degraded':
          // F23: Redis 降级告警，事件已入 liveEvents 流，无需额外处理
          break;
        default:
          break;
      }
    },
    // refreshHistory 随 id 变化重建；store action 为 zustand 稳定引用，无需全量 deps
    [
      refreshHistory,
      refreshTaskStatuses,
      sseScenarioId,
      addAnomaly,
      addIntervention,
      setCurrentRound,
      setCurrentTaskId,
    ],
  );

  const { connected, error } = useSseEvents({
    scenarioId: sseScenarioId,
    onEvent: handleEvent,
  });

  // 想定列表：一次性拉取全部想定（后端 limit 上限 100），前端按每页 5 条分页
  useEffect(() => {
    fetchScenarios(MAX_SCENARIOS_LIMIT, 0);
  }, [fetchScenarios]);

  // 从想定管理"执行过程"跳转而来（?control=1）：自动打开该想定的控制面板
  useEffect(() => {
    if (searchParams.get('control') === '1' && id) {
      setControlScenarioId(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 选中想定：加载完整详情并重置事件流（干预历史/回合历史由控制面板 Dialog 按需加载）
  useEffect(() => {
    if (!id) {
      clearEvents();
      setScenarioDetail(null);
      return;
    }
    clearEvents();
    loadScenario(id);
    setDetailLoading(true);
    api
      .getScenario(id)
      .then(setScenarioDetail)
      .catch(() => setScenarioDetail(null))
      .finally(() => setDetailLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 打开控制面板：重置事件流并加载该想定的干预历史 / 回合历史
  useEffect(() => {
    if (!controlScenarioId) {
      setLiveEvents([]);
      return;
    }
    clearEvents();
    setLiveEvents([]);
    fetchInterventions(controlScenarioId);
    refreshHistory(controlScenarioId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlScenarioId]);

  // 客户端过滤：搜索词（名称 / ID / 描述）
  const filteredScenarios = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scenarios.filter((s) => {
      if (
        q &&
        !`${s.id} ${s.name} ${s.description ?? ''}`.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [scenarios, search]);

  // 当前页数据（客户端分页）
  const totalPages = Math.max(1, Math.ceil(filteredScenarios.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageScenarios = useMemo(
    () =>
      filteredScenarios.slice(
        (safeCurrentPage - 1) * pageSize,
        safeCurrentPage * pageSize,
      ),
    [filteredScenarios, safeCurrentPage, pageSize],
  );

  // 搜索变化时回到第一页
  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  // 想定任务状态轮询：每 5s 拉取当前页想定的推演状态，用于显示"正在推演"


  useEffect(() => {
    const ids = pageScenarios.map((s) => s.id);
    if (ids.length === 0) return;
    refreshTaskStatuses(ids);
    const timer = window.setInterval(
      () => refreshTaskStatuses(ids),
      TASK_POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [pageScenarios, refreshTaskStatuses]);

  // 是否"正在推演"：任务状态为 running/pending/started，或 running 中处于暂停
  const isRunning = (s: Scenario): boolean => {
    const st = taskStatusMap[s.id];
    if (!st) return false;
    const status = (st.status ?? '').toLowerCase();
    return (
      ['running', 'pending', 'started'].includes(status) ||
      (status === 'running' && st.paused === true)
    );
  };

  // 当前打开控制面板 Dialog 的想定
  const controlScenario = controlScenarioId
    ? scenarios.find((s) => s.id === controlScenarioId) ?? null
    : null;

  // 控制面板对应想定是否正在执行（启动按钮置灰）
  const controlRunning = controlScenario
    ? isRunning(controlScenario)
    : false;

  // 任务终态文本（running 由徽章展示；idle 等同未执行，保持列表状态）
  const taskStatusText = (s: Scenario): string | null => {
    const st = taskStatusMap[s.id];
    if (!st) return null;
    const status = (st.status ?? '').toLowerCase();
    return ['done', 'failed', 'canceled'].includes(status) ? st.status : null;
  };

  // 实时事件流按轮次分组（轮次升序：最新轮次在底部，无轮次事件归"其他"）
  const groupedLiveEvents = useMemo(() => {
    const groups = new Map<string, CognitiveEvent[]>();
    for (const ev of liveEvents) {
      const roundNum =
        ev.round_id ??
        (ev.payload as { round_num?: number } | undefined)?.round_num;
      const key = roundNum == null ? 'other' : String(roundNum);
      const list = groups.get(key);
      if (list) list.push(ev);
      else groups.set(key, [ev]);
    }
    const entries = [...groups.entries()];
    entries.sort((a, b) => {
      if (a[0] === 'other') return 1;
      if (b[0] === 'other') return -1;
      return Number(a[0]) - Number(b[0]);
    });
    return entries;
  }, [liveEvents]);


  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    setActing(true);
    setActionMsg(null);
    try {
      await fn();
      setActionMsg(`✓ ${label}`);
    } catch (err) {
      setActionMsg(
        `✗ ${label}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setActing(false);
    }
  };

  const handleStart = () =>
    runAction(t('cognitiveWargame.director.executionStarted'), async () => {
      const targetId = controlScenarioId ?? id;
      if (!targetId) return;
      const task = await api.executeScenario(targetId);
      setCurrentTaskId(task.task_id);
      setTaskStatusMap((prev) => ({
        ...prev,
        [targetId]: {
          scenario_id: targetId,
          status: 'running',
          task_id: task.task_id,
        },
      }));
      await loadScenario(targetId);
    });

  const handlePause = () =>
    runAction(t('cognitiveWargame.director.pauseSuccess'), () => {
      const targetId = controlScenarioId ?? id;
      if (!targetId) return Promise.resolve();
      return api.pauseScenario(targetId);
    });

  const handleResume = () =>
    runAction(t('cognitiveWargame.director.resumeSuccess'), () => {
      const targetId = controlScenarioId ?? id;
      if (!targetId) return Promise.resolve();
      return api.resumeScenario(targetId);
    });

  const handleCancel = () =>
    runAction(t('cognitiveWargame.director.cancelSuccess'), async () => {
      const targetId = controlScenarioId ?? id;
      if (!targetId) return;
      const taskId = taskStatusMap[targetId]?.task_id;
      if (!taskId) {
        throw new Error(
          t('cognitiveWargame.director.cancelNoTask', {
            defaultValue: '未找到运行中任务',
          }),
        );
      }
      const resp = await api.cancelScenario(targetId, taskId);
      if (resp && resp.canceled === false) {
        throw new Error(
          t('cognitiveWargame.director.cancelRejected', {
            defaultValue: '取消请求未生效',
          }),
        );
      }
      await refreshTaskStatuses([targetId]);
    });

  const handleInject = async () => {
    const targetId = controlScenarioId ?? id;
    if (!targetId) return;
    const req = buildInterventionRequest(inject);
    setActing(true);
    setActionMsg(null);
    try {
      await api.injectIntervention(targetId, req);
      setActionMsg(`✓ ${t('cognitiveWargame.director.injectSuccess')}`);
      setInjectOpen(false);
      setInject(DEFAULT_INJECT);
      await fetchInterventions(targetId);
    } catch (err) {
      setActionMsg(
        `✗ ${t('cognitiveWargame.director.injectFailed')}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setActing(false);
    }
  };

  const handleSelectScenario = (scenarioId: string) => {
    if (id === scenarioId) return;
    navigate(WargamePath.roundView(scenarioId));
  };

  const selectedScenario =
    scenarioDetail ??
    currentScenario ??
    scenarios.find((s) => s.id === id) ??
    null;

  const hasFilters = search.trim() !== '';

  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
        {/* 标题 + 连接状态 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-medium">
              {t('cognitiveWargame.director.title')}
            </h1>
            {id && (
              <Badge variant={connected ? 'success' : 'destructive'}>
                {connected
                  ? t('cognitiveWargame.sse.connected')
                  : t('cognitiveWargame.sse.disconnected')}
              </Badge>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchScenarios(MAX_SCENARIOS_LIMIT, 0)}
            disabled={loading}
          >
            <RefreshCw className="size-4" />
            {t('cognitiveWargame.common.refresh')}
          </Button>
        </div>

        {/* 想定列表：搜索 / 轮次 / 列表 / 分页 合并为一个大框 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">
              {t('cognitiveWargame.scenario.listTitle')}
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
                title={t('cognitiveWargame.rounds.tableView', {
                  defaultValue: '列表视图',
                })}
                aria-label={t('cognitiveWargame.rounds.tableView', {
                  defaultValue: '列表视图',
                })}
              >
                <List className="size-4" />
              </ToggleGroupItem>
              <ToggleGroupItem
                value="cards"
                title={t('cognitiveWargame.rounds.cardView', {
                  defaultValue: '卡片视图',
                })}
                aria-label={t('cognitiveWargame.rounds.cardView', {
                  defaultValue: '卡片视图',
                })}
              >
                <LayoutGrid className="size-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="flex flex-1 flex-col gap-2">
                <Label>{t('cognitiveWargame.rounds.search')}</Label>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('cognitiveWargame.rounds.searchPlaceholder')}
                />
              </div>
            </div>

            <Spin spinning={loading}>
              {pageScenarios.length === 0 ? (
                <EmptyCard
                  title={
                    hasFilters
                      ? t('cognitiveWargame.rounds.noMatch')
                      : t('cognitiveWargame.common.empty')
                  }
                  className="w-full"
                />
              ) : viewMode === 'cards' ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {pageScenarios.map((s) => {
                    const running = isRunning(s);
                    const finishedStatus = taskStatusText(s);

                    return (
                      <Card
                        key={s.id}
                        className={cn(
                          'cursor-pointer transition-colors hover:border-accent-primary',
                          id === s.id && 'border-accent-primary',
                        )}
                        onClick={() => handleSelectScenario(s.id)}
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
                            <Badge
                              variant={running ? 'success' : 'outline'}
                            >
                              {running
                                ? t('cognitiveWargame.rounds.running')
                                : finishedStatus ?? s.status ?? '-'}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="line-clamp-2 min-h-10 text-sm leading-5 text-text-secondary">
                            {s.description ?? '-'}
                          </p>
                          <div className="mt-4 flex items-center justify-between gap-3">
                            <span className="text-xs text-text-disabled">
                              {t('cognitiveWargame.scenario.roundsLimit')}:{' '}
                              {s.rounds_limit ?? '-'}
                            </span>
                            {running && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(
                                  e: ReactMouseEvent<HTMLButtonElement>,
                                ) => {
                                  e.stopPropagation();
                                  setControlScenarioId(s.id);
                                }}
                              >
                                {t('cognitiveWargame.director.controlPanel')}
                              </Button>
                            )}
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
                      <TableHead>{t('cognitiveWargame.scenario.name')}</TableHead>
                      <TableHead>{t('cognitiveWargame.scenario.description')}</TableHead>
                      <TableHead>{t('cognitiveWargame.common.status')}</TableHead>
                      <TableHead>{t('cognitiveWargame.scenario.roundsLimit')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageScenarios.map((s) => (
                      <TableRow
                        key={s.id}
                        className={
                          id === s.id
                            ? 'cursor-pointer bg-bg-input/60'
                            : 'cursor-pointer'
                        }
                        onClick={() => handleSelectScenario(s.id)}
                      >
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell>
                          <span
                            className="block max-w-[280px] truncate"
                            title={s.description}
                          >
                            {s.description || '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {isRunning(s) ? (
                            <div className="flex items-center gap-2">
                              <Badge variant="success">
                                {t('cognitiveWargame.rounds.running')}
                              </Badge>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e: ReactMouseEvent<HTMLButtonElement>) => {
                                  e.stopPropagation();
                                  setControlScenarioId(s.id);
                                }}
                              >
                                {t('cognitiveWargame.director.controlPanel')}
                              </Button>
                            </div>
                          ) : (
                            taskStatusText(s) ?? (s.status || '-')
                          )}
                        </TableCell>
                        <TableCell>{s.rounds_limit ?? '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Spin>
            <IntellectPagination
              current={safeCurrentPage}
              pageSize={pageSize}
              total={filteredScenarios.length}
              onChange={(page, nextPageSize) => {
                setCurrentPage(page);
                setPageSize(nextPageSize);
              }}
            />
          </CardContent>
        </Card>

        {/* 选中想定：展开卡片 */}
        {id && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-lg">
                    {t('cognitiveWargame.director.title')} ·{' '}
                    {selectedScenario?.name ?? id}
                  </CardTitle>
                  <Badge variant="secondary">
                    {selectedScenario?.status || '-'}
                  </Badge>
                  <Badge variant="outline">
                    {t('cognitiveWargame.common.round')}: {currentRound || '-'}
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(WargamePath.scenarioDetail(id))}
                >
                  {t('cognitiveWargame.common.viewDetail')}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="info">
                <TabsList>
                  <TabsTrigger value="info">
                    {t('cognitiveWargame.agents.detail.basicInfo')}
                  </TabsTrigger>
                  <TabsTrigger value="playback">
                    {t('cognitiveWargame.playback.title')}
                  </TabsTrigger>
                  <TabsTrigger value="metrics">
                    {t('cognitiveWargame.metrics.title')}
                  </TabsTrigger>
                  <TabsTrigger value="kg">
                    {t('cognitiveWargame.kg.title')}
                  </TabsTrigger>
                  <TabsTrigger value="reports">
                    {t('cognitiveWargame.report.title')}
                  </TabsTrigger>
                </TabsList>

                {/* Tab 1: 基本信息 */}
                <TabsContent value="info">
                  <Spin spinning={detailLoading}>
                    <dl className="grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-3">
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.rounds.scenarioId')}
                        </dt>
                        <dd className="break-all font-mono">
                          {selectedScenario?.id ?? id}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.scenario.name')}
                        </dt>
                        <dd>{selectedScenario?.name ?? '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.common.status')}
                        </dt>
                        <dd>{selectedScenario?.status || '-'}</dd>
                      </div>
                      <div className="md:col-span-2 xl:col-span-3">
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.scenario.description')}
                        </dt>
                        <dd className="break-all">
                          {selectedScenario?.description || '-'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.scenario.roundsLimit')}
                        </dt>
                        <dd>{selectedScenario?.rounds_limit ?? '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.scenario.roundsCompleted')}
                        </dt>
                        <dd>{selectedScenario?.rounds_completed ?? '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.scenario.redForce')}
                        </dt>
                        <dd>{selectedScenario?.red_force ?? '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.scenario.blueForce')}
                        </dt>
                        <dd>{selectedScenario?.blue_force ?? '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.rounds.totalAgents')}
                        </dt>
                        <dd>{selectedScenario?.total_agents ?? '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.common.createdAt')}
                        </dt>
                        <dd>{selectedScenario?.created_at ?? '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-text-secondary">
                          {t('cognitiveWargame.common.updatedAt')}
                        </dt>
                        <dd>{selectedScenario?.updated_at ?? '-'}</dd>
                      </div>
                    </dl>
                  </Spin>
                </TabsContent>

                {/* Tab 3: 历史回放 */}
                <TabsContent value="playback">
                  <ScenarioPlaybackView scenarioId={id} />
                </TabsContent>

                {/* Tab 4: 态势分析 */}
                <TabsContent value="metrics">
                  <ScenarioMetricsView scenarioId={id} />
                </TabsContent>

                {/* Tab 5: 知识图谱 */}
                <TabsContent value="kg">
                  <ScenarioKGView scenarioId={id} />
                </TabsContent>

                {/* Tab 6: 评估报告 */}
                <TabsContent value="reports">
                  <ScenarioReportView scenarioId={id} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 控制面板 Dialog：仅"正在推演"的想定行可打开 */}
      {controlScenario && (
        <Dialog
          open
          onOpenChange={(open) => !open && setControlScenarioId(null)}
        >
          <DialogContent className="flex h-[80vh] max-h-[80vh] w-[85vw] max-w-[85vw] flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>
                {t('cognitiveWargame.director.controlPanel')} ·{' '}
                {controlScenario.name}
              </DialogTitle>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-4 py-2">

                  {actionMsg && (
                    <p className="text-sm text-text-secondary">{actionMsg}</p>
                  )}
                  {error && (
                    <p className="text-sm text-text-error">{error.message}</p>
                  )}

                  {/* 控制面板 + 实时事件流 */}
                  <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-5">
                    <Card className="flex h-full min-h-0 flex-col lg:col-span-2">
                      <CardHeader>
                        <CardTitle className="text-lg">
                          {t('cognitiveWargame.director.controlPanel')}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3">
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            onClick={handleStart}
                            disabled={acting || controlRunning}
                          >
                            {t('cognitiveWargame.director.startExecution')}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={handleCancel}
                            disabled={acting || !controlRunning}
                          >
                            {t('cognitiveWargame.director.cancelExecution')}
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            onClick={handlePause}
                            disabled={acting}
                          >
                            {t('cognitiveWargame.director.pauseExecution')}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={handleResume}
                            disabled={acting}
                          >
                            {t('cognitiveWargame.director.resumeExecution')}
                          </Button>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => setInjectOpen(true)}
                          disabled={acting}
                        >
                          {t('cognitiveWargame.director.injectNarrative')}
                        </Button>
                      </CardContent>
                    </Card>

                    <Card className="flex h-[40vh] min-h-0 flex-col lg:h-full lg:col-span-3">
                      <CardHeader>
                        <CardTitle className="text-lg">
                          {t('cognitiveWargame.director.liveEvents')}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="min-h-0 flex-1">
                        <ScrollArea
                          className="h-full"
                          viewportRef={liveViewportRef}
                          onViewportScroll={handleLiveScroll}
                        >
                          {liveEvents.length === 0 ? (
                            <div className="text-text-secondary">
                              {t('cognitiveWargame.director.noLiveEvents')}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-3">
                              {groupedLiveEvents.map(([roundKey, events]) => (
                                <div
                                  key={roundKey}
                                  className="rounded border border-border-button p-3"
                                >
                                  <div className="mb-2 flex items-center gap-2">
                                    <Badge variant="outline">
                                      {roundKey === 'other'
                                        ? t(
                                            'cognitiveWargame.director.otherEvents',
                                          )
                                        : `${t(
                                            'cognitiveWargame.common.round',
                                          )} ${roundKey}`}
                                    </Badge>
                                  </div>
                                  <ul className="flex flex-col gap-2">
                                    {events.map((ev, idx) => (
                                      <li
                                        key={`${ev.timestamp}-${idx}`}
                                        className="rounded border border-border-button p-2 text-sm"
                                      >
                                        <div className="flex items-center gap-2">
                                          <Badge variant="secondary">
                                            {ev.type}
                                          </Badge>
                                          {ev.timestamp && (
                                            <span className="text-xs text-text-secondary">
                                              {ev.timestamp}
                                            </span>
                                          )}
                                        </div>
                                        {Object.keys(ev.payload).length > 0 && (
                                          <pre className="mt-1 max-h-32 overflow-auto text-xs text-text-secondary">
                                            {JSON.stringify(ev.payload, null, 2)}
                                          </pre>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          )}
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </div>

                  {/* 干预历史 / 异常告警 / 回合历史 */}
                  <Tabs
                    value={historyTab}
                    onValueChange={setHistoryTab}
                    className="mt-0 flex-none"
                  >
                    <TabsList>
                      <TabsTrigger value="interventions">
                        {t('cognitiveWargame.director.interventionHistory')} (
                        {interventions.length})
                      </TabsTrigger>
                      <TabsTrigger value="anomalies">
                        {t('cognitiveWargame.director.anomalyAlerts')} (
                        {anomalies.length})
                      </TabsTrigger>
                      <TabsTrigger value="rounds">
                        {t('cognitiveWargame.director.roundHistory')} (
                        {history.length})
                      </TabsTrigger>
                    </TabsList>

                    {/* 干预历史 */}
                    <TabsContent value="interventions">
                      <Card className="h-[26vh]">
                        <CardContent className="h-full overflow-y-auto">
                          {interventions.length === 0 ? (
                            <div className="py-4 text-text-secondary">
                              {t('cognitiveWargame.director.noInterventions')}
                            </div>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>
                                    {t('cognitiveWargame.common.type')}
                                  </TableHead>
                                  <TableHead>
                                    {t('cognitiveWargame.common.round')}
                                  </TableHead>
                                  <TableHead>
                                    {t('cognitiveWargame.common.reason')}
                                  </TableHead>
                                  <TableHead>
                                    {t('cognitiveWargame.common.operator')}
                                  </TableHead>
                                  <TableHead>
                                    {t('cognitiveWargame.common.createdAt')}
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {interventions.map((iv) => (
                                  <TableRow key={iv.log_id}>
                                    <TableCell>
                                      {iv.intervention_type}
                                    </TableCell>
                                    <TableCell>{iv.round_num ?? '-'}</TableCell>
                                    <TableCell className="max-w-xs truncate">
                                      {iv.reason ?? '-'}
                                    </TableCell>
                                    <TableCell>{iv.operator ?? '-'}</TableCell>
                                    <TableCell>{iv.created_at ?? '-'}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>

                    {/* 异常告警 */}
                    <TabsContent value="anomalies">
                      <Card className="h-[26vh]">
                        <CardContent className="h-full overflow-y-auto">
                          {anomalies.length === 0 ? (
                            <div className="py-4 text-text-secondary">
                              {t('cognitiveWargame.director.noAnomalies')}
                            </div>
                          ) : (
                            <ul className="flex flex-col gap-2 py-2">
                              {anomalies.map((a, idx) => (
                                <li
                                  key={`${a.timestamp}-${idx}`}
                                  className="rounded border border-border-button p-3"
                                >
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant={
                                        a.severity === 'critical'
                                          ? 'destructive'
                                          : 'secondary'
                                      }
                                    >
                                      {a.severity === 'critical'
                                        ? t('cognitiveWargame.anomaly.critical')
                                        : t('cognitiveWargame.anomaly.warning')}
                                    </Badge>
                                    <span className="font-medium">
                                      {a.type}
                                    </span>
                                    <span className="text-text-secondary">
                                      {t('cognitiveWargame.common.round')}{' '}
                                      {a.round_num}
                                    </span>
                                  </div>
                                  {a.detail?.message ? (
                                    <p className="mt-1 text-sm text-text-secondary">
                                      {String(a.detail.message)}
                                    </p>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>

                    {/* 回合历史 */}
                    <TabsContent value="rounds">
                      <Card className="h-[26vh]">
                        <CardContent
                          ref={roundsViewportRef}
                          onScroll={handleRoundsScroll}
                          className="h-full overflow-y-auto"
                        >
                          <Spin spinning={historyLoading}>
                            {history.length === 0 ? (
                              <div className="py-4 text-text-secondary">
                                {t('cognitiveWargame.common.empty')}
                              </div>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>
                                      {t('cognitiveWargame.common.round')}
                                    </TableHead>
                                    <TableHead>
                                      {t('cognitiveWargame.metrics.redScore')}
                                    </TableHead>
                                    <TableHead>
                                      {t('cognitiveWargame.metrics.blueScore')}
                                    </TableHead>
                                    <TableHead>
                                      {t('cognitiveWargame.metrics.redCognitive')}
                                    </TableHead>
                                    <TableHead>
                                      {t('cognitiveWargame.metrics.blueCognitive')}
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {history.map((m) => (
                                    <TableRow key={m.round}>
                                      <TableCell>{m.round}</TableCell>
                                      <TableCell>
                                        {m.red_score ?? '-'}
                                      </TableCell>
                                      <TableCell>
                                        {m.blue_score ?? '-'}
                                      </TableCell>
                                      <TableCell>
                                        {m.red_cognitive ?? '-'}
                                      </TableCell>
                                      <TableCell>
                                        {m.blue_cognitive ?? '-'}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                          </Spin>
                        </CardContent>
                      </Card>
                    </TabsContent>
                  </Tabs>

            </div>
          </DialogContent>
        </Dialog>
      )}

{/* 注入干预 Dialog */}
      <Dialog open={injectOpen} onOpenChange={setInjectOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {t('cognitiveWargame.director.injectNarrative')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label>{t('cognitiveWargame.director.interventionType')}</Label>
              <Select
                value={inject.kind}
                onValueChange={(v) =>
                  setInject({ ...inject, kind: v as InterventionKind })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="narrative_inject">
                    {t('cognitiveWargame.director.injectNarrative')}
                  </SelectItem>
                  <SelectItem value="agent_override">
                    {t('cognitiveWargame.director.overrideAgent')}
                  </SelectItem>
                  <SelectItem value="strategy_veto">
                    {t('cognitiveWargame.director.vetoStrategy')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label>{t('cognitiveWargame.director.targetRound')}</Label>
                <Input
                  type="number"
                  min={1}
                  value={inject.round}
                  onChange={(e) =>
                    setInject({
                      ...inject,
                      round: Number(e.target.value) || 1,
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('cognitiveWargame.common.reason')}</Label>
                <Input
                  value={inject.reason}
                  onChange={(e) =>
                    setInject({ ...inject, reason: e.target.value })
                  }
                />
              </div>
            </div>

            {inject.kind === 'narrative_inject' && (
              <>
                <div className="flex flex-col gap-2">
                  <Label>{t('cognitiveWargame.director.narrativeText')}</Label>
                  <Textarea
                    value={inject.text}
                    onChange={(e) =>
                      setInject({ ...inject, text: e.target.value })
                    }
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label>{t('cognitiveWargame.director.narrativeStance')}</Label>
                    <Select
                      value={inject.stance}
                      onValueChange={(v) =>
                        setInject({ ...inject, stance: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="positive">positive</SelectItem>
                        <SelectItem value="neutral">neutral</SelectItem>
                        <SelectItem value="negative">negative</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>{t('cognitiveWargame.director.narrativeValence')}</Label>
                    <Input
                      type="number"
                      min={-1}
                      max={1}
                      step={0.1}
                      value={inject.valence}
                      onChange={(e) =>
                        setInject({
                          ...inject,
                          valence: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                </div>
              </>
            )}

            {inject.kind === 'agent_override' && (
              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>{t('cognitiveWargame.director.agentId')}</Label>
                  <Input
                    value={inject.agentId}
                    onChange={(e) =>
                      setInject({ ...inject, agentId: e.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t('cognitiveWargame.director.fieldName')}</Label>
                  <Input
                    value={inject.fieldName}
                    onChange={(e) =>
                      setInject({ ...inject, fieldName: e.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t('cognitiveWargame.director.fieldValue')}</Label>
                  <Input
                    value={inject.fieldValue}
                    onChange={(e) =>
                      setInject({ ...inject, fieldValue: e.target.value })
                    }
                  />
                </div>
              </div>
            )}

            {inject.kind === 'strategy_veto' && (
              <div className="flex flex-col gap-2">
                <Label>{t('cognitiveWargame.director.strategyId')}</Label>
                <Input
                  value={inject.strategyId}
                  onChange={(e) =>
                    setInject({ ...inject, strategyId: e.target.value })
                  }
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInjectOpen(false)}
              disabled={acting}
            >
              {t('cognitiveWargame.common.cancel')}
            </Button>
            <Button onClick={handleInject} disabled={acting}>
              {acting
                ? t('cognitiveWargame.common.loading')
                : t('cognitiveWargame.common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WargameSectionLayout>
  );
};

/** 根据表单类型构造 InterventionRequest。 */
function buildInterventionRequest(form: InjectForm): InterventionRequest {
  const base = { round_num: form.round, reason: form.reason };
  switch (form.kind) {
    case 'narrative_inject':
      return {
        ...base,
        type: 'narrative_inject',
        payload: {
          text: form.text,
          stance: form.stance,
          valence: form.valence,
        },
      };
    case 'agent_override':
      return {
        ...base,
        type: 'agent_override',
        payload: {
          agent_id: form.agentId,
          field: form.fieldName,
          value: form.fieldValue,
        },
      };
    case 'strategy_veto':
      return {
        ...base,
        type: 'strategy_veto',
        payload: { strategy_id: form.strategyId },
      };
  }
}

export default RoundViewPage;
