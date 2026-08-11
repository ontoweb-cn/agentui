/**
 * RoundViewPage — 导演台（P3.0-5 重写）。
 *
 * 布局：想定信息栏 + 控制面板/实时事件流（左右分栏）+ 底部 Tab（干预历史/异常告警/回合历史）。
 *
 * - 控制面板：启动推演 / 暂停 / 恢复 / 注入干预（叙事注入·状态修改·策略否决）
 * - 实时事件流：useSseEvents 订阅，anomaly.detected/intervention.applied/round.* 实时展示
 * - 干预历史：store.interventions（SSE 增量 + fetchInterventions 全量）
 * - 异常告警：store.anomalies（SSE anomaly.detected 增量）
 * - 回合历史：api.getMetricsHistory
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
import { Input } from '@/components/ui/input';
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
import { api, type InterventionRequest, type Metrics } from '../api';
import WargameSectionLayout from '../components/section-menu';
import { useSseEvents, type CognitiveEvent } from '../hooks/use-sse-events';
import { WargameRoutes } from '../routes';
import { useWargameStore } from '../store';
import { t } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

const MAX_LIVE_EVENTS = 50;

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
  const {
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
  } = useWargameStore();

  const [liveEvents, setLiveEvents] = useState<CognitiveEvent[]>([]);
  const [history, setHistory] = useState<Metrics[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [injectOpen, setInjectOpen] = useState(false);
  const [inject, setInject] = useState<InjectForm>(DEFAULT_INJECT);

  const refreshHistory = useCallback(async () => {
    if (!id) return;
    setHistoryLoading(true);
    try {
      const h = await api.getMetricsHistory(id).catch(() => [] as Metrics[]);
      setHistory(h);
    } finally {
      setHistoryLoading(false);
    }
  }, [id]);

  // SSE 事件回调：分发到 store + 维护实时事件流
  const handleEvent = useCallback(
    (event: CognitiveEvent) => {
      // 实时事件流（新事件置顶，截断至 MAX_LIVE_EVENTS）
      setLiveEvents((prev) => [event, ...prev].slice(0, MAX_LIVE_EVENTS));

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
            refreshHistory();
          }
          break;
        }
        case 'scenario.canceled':
          // R3: 真正中断（未 RUNNING），清除当前任务
          setCurrentTaskId(null);
          break;
        case 'scenario.cancel_requested':
          // R3: RUNNING 任务请求取消（仅标记），任务仍在运行，保留 taskId
          // UI 可显示"取消请求已提交"提示，由后续迭代补
          break;
        case 'scenario.round.started': {
          // R4: 回合开始，更新 currentRound 以反映进行中的回合
          const startedRoundNum =
            (event.payload as { round_num?: number }).round_num ?? event.round_id;
          if (startedRoundNum) {
            setCurrentRound(startedRoundNum);
          }
          break;
        }
        case 'system.degraded':
          // F23: Redis 降级警告，事件已入 liveEvents 流，无需额外处理
          break;
        default:
          break;
      }
    },
    // refreshHistory 随 id 变化重建；store action 为 zustand 稳定引用，无需入 deps
    [refreshHistory, addAnomaly, addIntervention, setCurrentRound, setCurrentTaskId],
  );

  const { connected, error } = useSseEvents({
    scenarioId: id ?? null,
    onEvent: handleEvent,
  });

  useEffect(() => {
    if (!id) {
      clearEvents();
      return;
    }
    clearEvents();
    loadScenario(id);
    fetchInterventions(id);
    refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    setActing(true);
    setActionMsg(null);
    try {
      await fn();
      setActionMsg(`✅ ${label}`);
    } catch (err) {
      setActionMsg(
        `❌ ${label}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setActing(false);
    }
  };

  const handleStart = () =>
    runAction(t('cognitiveWargame.director.executionStarted'), async () => {
      const task = await api.executeScenario(id!);
      setCurrentTaskId(task.task_id);
      await loadScenario(id!);
    });

  const handlePause = () =>
    runAction(t('cognitiveWargame.director.pauseSuccess'), () =>
      api.pauseScenario(id!),
    );

  const handleResume = () =>
    runAction(t('cognitiveWargame.director.resumeSuccess'), () =>
      api.resumeScenario(id!),
    );

  const handleInject = async () => {
    const req = buildInterventionRequest(inject);
    setActing(true);
    setActionMsg(null);
    try {
      await api.injectIntervention(id!, req);
      setActionMsg(`✅ ${t('cognitiveWargame.director.injectSuccess')}`);
      setInjectOpen(false);
      setInject(DEFAULT_INJECT);
      await fetchInterventions(id!);
    } catch (err) {
      setActionMsg(
        `❌ ${t('cognitiveWargame.director.injectFailed')}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setActing(false);
    }
  };

  // 无 id（/rounds index 路由）：提示选择想定
  if (!id) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <EmptyCard
          title={t('cognitiveWargame.director.selectScenarioFirst')}
          className="w-full"
        />
        <Link
          to={WargameRoutes.Scenarios}
          className="text-text-primary underline"
        >
          {t('cognitiveWargame.scenario.listTitle')} →
        </Link>
      </div>
    );
  }

  const scenarioName = currentScenario?.name ?? id;
  const scenarioStatus = currentScenario?.status ?? '-';

  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
      {/* 想定信息栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-medium">
            {t('cognitiveWargame.director.title')} · {scenarioName}
          </h1>
          <Badge variant="secondary">{scenarioStatus}</Badge>
          <Badge variant="outline">
            {t('cognitiveWargame.common.round')}: {currentRound || '-'}
          </Badge>
        </div>
        <Badge variant={connected ? 'success' : 'destructive'}>
          {connected
            ? t('cognitiveWargame.sse.connected')
            : t('cognitiveWargame.sse.disconnected')}
        </Badge>
      </div>

      {actionMsg && (
        <p className="text-sm text-text-secondary">{actionMsg}</p>
      )}
      {error && (
        <p className="text-sm text-text-error">{error.message}</p>
      )}

      {/* 控制面板 + 实时事件流 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 控制面板 */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">
              {t('cognitiveWargame.director.controlPanel')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button onClick={handleStart} disabled={acting}>
              {t('cognitiveWargame.director.startExecution')}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={handlePause} disabled={acting}>
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

        {/* 实时事件流 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">
              {t('cognitiveWargame.director.liveEvents')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-72">
              {liveEvents.length === 0 ? (
                <div className="text-text-secondary">
                  {t('cognitiveWargame.director.noLiveEvents')}
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {liveEvents.map((ev, idx) => (
                    <li
                      key={`${ev.timestamp}-${idx}`}
                      className="rounded border border-border-button p-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{ev.type}</Badge>
                        {ev.round_id != null && (
                          <span className="text-text-secondary">
                            {t('cognitiveWargame.common.round')} {ev.round_id}
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
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* 底部 Tab：干预历史 / 异常告警 / 回合历史 */}
      <Tabs defaultValue="interventions">
        <TabsList>
          <TabsTrigger value="interventions">
            {t('cognitiveWargame.director.interventionHistory')} (
            {interventions.length})
          </TabsTrigger>
          <TabsTrigger value="anomalies">
            {t('cognitiveWargame.director.anomalyAlerts')} ({anomalies.length})
          </TabsTrigger>
          <TabsTrigger value="rounds">
            {t('cognitiveWargame.director.roundHistory')} ({history.length})
          </TabsTrigger>
        </TabsList>

        {/* 干预历史 */}
        <TabsContent value="interventions">
          <Card>
            <CardContent>
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
                        <TableCell>{iv.intervention_type}</TableCell>
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
          <Card>
            <CardContent>
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
                        <span className="font-medium">{a.type}</span>
                        <span className="text-text-secondary">
                          {t('cognitiveWargame.common.round')} {a.round_num}
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
          <Card>
            <CardContent>
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
                          <TableCell>{m.red_score ?? '-'}</TableCell>
                          <TableCell>{m.blue_score ?? '-'}</TableCell>
                          <TableCell>{m.red_cognitive ?? '-'}</TableCell>
                          <TableCell>{m.blue_cognitive ?? '-'}</TableCell>
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
      </div>
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
