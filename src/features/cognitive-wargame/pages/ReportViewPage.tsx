/**
 * ReportViewPage — 评估报告（P3.2-3 + P3.4-2 评估中心增强）。
 *
 * 四 Tab：
 * - 回合报告：选 round → 同步获取 → Markdown 渲染
 * - 蒙特卡洛：参数表单 → 异步提交 → 2s 轮询任务状态 → 结果 Markdown 渲染
 * - 回测：参数表单 → 异步提交 → 轮询 → Markdown
 * - 反事实：参数表单 → 异步提交 → 轮询 → 统计数据渲染为 Markdown
 *
 * 后端异步任务经 TaskManager 执行，状态经 GET /scenarios/{id}/status?task_id= 轮询，
 * 结果经 GET /reports/result/{task_id} 获取（含 content 字段，P3.4-2 内联 Markdown 文本）。
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { api, type Report, type TaskStatus } from '../api';
import WargameSectionLayout from '../components/section-menu';
import { t } from 'i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useParams } from 'react-router';

type AsyncKind = 'monte_carlo' | 'backtest' | 'counterfactual';

/** 异步报告任务状态（来自后端 TaskInfo.status：pending/running/done/failed/canceled）。 */
type TaskState = string | null;

interface AsyncReportState {
  taskId: string | null;
  status: TaskState;
  content: string;
  raw: Record<string, unknown> | null;
  error: string | null;
}

/** 轮询间隔（ms）。 */
const POLL_INTERVAL = 2000;

/** 将反事实统计结果渲染为 Markdown（后端无 markdown_path，前端构建）。 */
function renderCounterfactualMarkdown(r: Record<string, unknown>): string {
  const scenarioId = String(r.scenario_id ?? '');
  const intervention = String(r.intervention ?? '');
  const ir = r.intervention_round;
  const n = r.n_samples;
  const npg = r.n_per_group;
  const delta = (r.delta ?? {}) as Record<string, number>;
  const ci = (r.ci_95 ?? {}) as Record<string, number[]>;
  const control = (r.control ?? {}) as Record<
    string,
    { mean: number; std: number }
  >;
  const treatment = (r.treatment ?? {}) as Record<
    string,
    { mean: number; std: number }
  >;

  const lines: string[] = [
    '# 反事实分析报告',
    '',
    `- **想定**：${scenarioId}`,
    `- **干预**：${intervention} @ round ${String(ir ?? '')}`,
    `- **样本**：N=${String(n ?? '')}（每组 ${String(npg ?? '')}）`,
    '- **Δ** = treatment − control（95% CI via t 分布）',
    '',
    '## Δ 与 95% CI',
    '',
    '| 指标 | Δ | 95% CI |',
    '|---|---|---|',
  ];
  Object.keys(delta).forEach((m) => {
    const c = ci[m];
    const ciStr = Array.isArray(c) ? `[${c.join(', ')}]` : '-';
    lines.push(`| ${m} | ${delta[m]} | ${ciStr} |`);
  });
  lines.push('', '## 控制组 / 处理组统计（mean ± std）', '', '| 指标 | Control | Treatment |', '|---|---|---|');
  const metrics = Array.from(
    new Set([...Object.keys(control), ...Object.keys(treatment)]),
  );
  metrics.forEach((m) => {
    const c = control[m];
    const tt = treatment[m];
    const cStr = c ? `${c.mean} ± ${c.std}` : '-';
    const tStr = tt ? `${tt.mean} ± ${tt.std}` : '-';
    lines.push(`| ${m} | ${cStr} | ${tStr} |`);
  });
  lines.push('');
  return lines.join('\n');
}

/** 从异步任务结果中提取 Markdown 文本。 */
function extractContent(
  result: Record<string, unknown>,
  kind: AsyncKind,
): string {
  if (typeof result.content === 'string' && result.content) {
    return result.content;
  }
  if (kind === 'counterfactual') {
    return renderCounterfactualMarkdown(result);
  }
  return '';
}

/** 异步报告 Hook：提交 → 轮询 → 取结果。卸载时清理定时器。 */
function useAsyncReport(scenarioId: string, kind: AsyncKind) {
  const [state, setState] = useState<AsyncReportState>({
    taskId: null,
    status: null,
    content: '',
    raw: null,
    error: null,
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // useRef 闭包修复：轮询回调读取最新的 scenarioId，避免 stale closure
  const scenarioRef = useRef(scenarioId);
  scenarioRef.current = scenarioId;

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchResult = useCallback(
    async (tid: string) => {
      try {
        const result = await api.getReportResult(tid);
        setState((s) => ({
          ...s,
          content: extractContent(result, kind),
          raw: result,
          status: 'done',
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [kind],
  );

  const poll = useCallback(
    (tid: string) => {
      stopPolling();
      timerRef.current = setInterval(async () => {
        try {
          const info = await api.getTaskStatus(scenarioRef.current, tid);
          if (info.status === 'done') {
            stopPolling();
            setState((s) => ({ ...s, status: 'done' }));
            await fetchResult(tid);
          } else if (
            info.status === 'failed' ||
            info.status === 'canceled'
          ) {
            stopPolling();
            setState((s) => ({
              ...s,
              status: 'failed',
              error: info.error ?? t('cognitiveWargame.report.taskFailed'),
            }));
          } else {
            setState((s) => ({ ...s, status: info.status, taskId: tid }));
          }
        } catch (err) {
          stopPolling();
          setState((s) => ({
            ...s,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      }, POLL_INTERVAL);
    },
    [stopPolling, fetchResult],
  );

  const submit = useCallback(
    async (task: Promise<TaskStatus>) => {
      stopPolling();
      setState({
        taskId: null,
        status: 'pending',
        content: '',
        raw: null,
        error: null,
      });
      try {
        const info = await task;
        setState((s) => ({ ...s, taskId: info.task_id, status: info.status }));
        if (info.status === 'done') {
          await fetchResult(info.task_id);
        } else if (info.status === 'failed' || info.status === 'canceled') {
          setState((s) => ({
            ...s,
            status: 'failed',
            error: info.error ?? t('cognitiveWargame.report.taskFailed'),
          }));
        } else {
          poll(info.task_id);
        }
      } catch (err) {
        setState((s) => ({
          ...s,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [stopPolling, poll, fetchResult],
  );

  // 卸载时停止轮询
  useEffect(() => () => stopPolling(), [stopPolling]);

  return { ...state, submit };
}

/** 参数表单 + 提交 + 任务状态 + Markdown 渲染（蒙特卡洛/回测/反事实共用）。 */
const AsyncReportTab: React.FC<{ kind: AsyncKind; scenarioId: string }> = ({
  kind,
  scenarioId,
}) => {
  const { status, content, raw, error, submit } = useAsyncReport(
    scenarioId,
    kind,
  );

  // 蒙特卡洛参数
  const [n, setN] = useState(100);
  const [rounds, setRounds] = useState(5);
  const [seedBase, setSeedBase] = useState(42);
  // 回测参数
  const [eventIdsStr, setEventIdsStr] = useState('');
  // 反事实参数
  const [interventionRound, setInterventionRound] = useState(3);
  const [intervention, setIntervention] = useState('suppress_narrative');
  const [controlSeed, setControlSeed] = useState(42);
  const [treatmentSeed, setTreatmentSeed] = useState(43);
  const [nSamples, setNSamples] = useState(50);

  const running = status === 'pending' || status === 'running';

  const titleKey =
    kind === 'monte_carlo'
      ? 'cognitiveWargame.report.monteCarlo'
      : kind === 'backtest'
        ? 'cognitiveWargame.report.backtest'
        : 'cognitiveWargame.report.counterfactual';

  const handleSubmit = () => {
    if (!scenarioId) return;
    if (kind === 'monte_carlo') {
      if (n < 1) return;
      submit(api.runMonteCarlo(scenarioId, { n, rounds, seed_base: seedBase }));
    } else if (kind === 'backtest') {
      const ids = eventIdsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      submit(api.runBacktest(scenarioId, { event_ids: ids.length ? ids : undefined }));
    } else {
      if (nSamples < 2) return;
      submit(
        api.runCounterfactual(scenarioId, {
          intervention_round: interventionRound,
          intervention,
          control_seed: controlSeed,
          treatment_seed: treatmentSeed,
          n_samples: nSamples,
        }),
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t(titleKey)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          {kind === 'monte_carlo' && (
            <>
              <ParamField label={t('cognitiveWargame.report.nSimulations')}>
                <Input
                  type="number"
                  min={1}
                  value={n}
                  onChange={(e) => setN(Number(e.target.value))}
                  className="w-28"
                />
              </ParamField>
              <ParamField label={t('cognitiveWargame.report.rounds')}>
                <Input
                  type="number"
                  min={1}
                  value={rounds}
                  onChange={(e) => setRounds(Number(e.target.value))}
                  className="w-24"
                />
              </ParamField>
              <ParamField label={t('cognitiveWargame.report.seedBase')}>
                <Input
                  type="number"
                  value={seedBase}
                  onChange={(e) => setSeedBase(Number(e.target.value))}
                  className="w-28"
                />
              </ParamField>
            </>
          )}
          {kind === 'backtest' && (
            <div className="flex flex-col gap-2">
              <Label>{t('cognitiveWargame.report.eventIds')}</Label>
              <Input
                value={eventIdsStr}
                onChange={(e) => setEventIdsStr(e.target.value)}
                placeholder="evt-1,evt-2"
                className="w-72"
              />
              <span className="text-xs text-text-secondary">
                {t('cognitiveWargame.report.eventIdsHint')}
              </span>
            </div>
          )}
          {kind === 'counterfactual' && (
            <>
              <ParamField label={t('cognitiveWargame.report.interventionRound')}>
                <Input
                  type="number"
                  min={0}
                  value={interventionRound}
                  onChange={(e) => setInterventionRound(Number(e.target.value))}
                  className="w-24"
                />
              </ParamField>
              <div className="flex flex-col gap-2">
                <Label>{t('cognitiveWargame.report.intervention')}</Label>
                <Select value={intervention} onValueChange={setIntervention}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="suppress_narrative">
                      suppress_narrative
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ParamField label={t('cognitiveWargame.report.controlSeed')}>
                <Input
                  type="number"
                  value={controlSeed}
                  onChange={(e) => setControlSeed(Number(e.target.value))}
                  className="w-28"
                />
              </ParamField>
              <ParamField label={t('cognitiveWargame.report.treatmentSeed')}>
                <Input
                  type="number"
                  value={treatmentSeed}
                  onChange={(e) => setTreatmentSeed(Number(e.target.value))}
                  className="w-28"
                />
              </ParamField>
              <ParamField label={t('cognitiveWargame.report.nSamples')}>
                <Input
                  type="number"
                  min={2}
                  value={nSamples}
                  onChange={(e) => setNSamples(Number(e.target.value))}
                  className="w-28"
                />
              </ParamField>
            </>
          )}
          <Button onClick={handleSubmit} disabled={!scenarioId || running}>
            {running
              ? t('cognitiveWargame.report.taskRunning')
              : t('cognitiveWargame.report.run')}
          </Button>
        </div>

        {status && <TaskBadge status={status} error={error} />}
        {running && (
          <p className="text-sm text-text-secondary">
            {t('cognitiveWargame.report.pollingHint')}
          </p>
        )}
        {error && <p className="text-sm text-text-error">{error}</p>}

        <ReportContent content={content} raw={raw} kind={kind} />
      </CardContent>
    </Card>
  );
};

/** 回合报告 Tab：同步获取 + Markdown 渲染。 */
const RoundReportTab: React.FC<{ scenarioId: string }> = ({ scenarioId }) => {
  const [round, setRound] = useState(1);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!scenarioId || round < 1) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.getReport(scenarioId, 'round', round);
      setReport(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [scenarioId, round]);

  useEffect(() => {
    load();
  }, [load]);

  const content =
    (report as (Report & { content?: string }) | null)?.content ?? '';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {t('cognitiveWargame.report.roundReport')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <ParamField label={t('cognitiveWargame.common.round')}>
            <Input
              type="number"
              min={1}
              value={round}
              onChange={(e) => setRound(Number(e.target.value))}
              className="w-24"
            />
          </ParamField>
          <Button variant="outline" onClick={load} disabled={!scenarioId || loading}>
            {t('cognitiveWargame.common.refresh')}
          </Button>
        </div>
        {error && <p className="text-sm text-text-error">{error}</p>}
        <Spin spinning={loading}>
          <ReportContent content={content} raw={null} kind="round" />
        </Spin>
      </CardContent>
    </Card>
  );
};

/** 单个参数字段（label + 控件）布局。 */
const ParamField: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex flex-col gap-2">
    <Label>{label}</Label>
    {children}
  </div>
);

/** 任务状态 Badge。 */
const TaskBadge: React.FC<{ status: string; error: string | null }> = ({
  status,
  error,
}) => {
  const variant =
    status === 'done'
      ? 'default'
      : status === 'failed' || status === 'canceled'
        ? 'destructive'
        : 'secondary';
  const labelKey =
    status === 'done'
      ? 'cognitiveWargame.report.taskDone'
      : status === 'failed' || status === 'canceled'
        ? 'cognitiveWargame.report.taskFailed'
        : status === 'running'
          ? 'cognitiveWargame.report.taskRunning'
          : 'cognitiveWargame.report.taskPending';
  return (
    <div className="flex items-center gap-2">
      <Badge variant={variant}>{t(labelKey)}</Badge>
      {error && (
        <span className="text-xs text-text-secondary">{error}</span>
      )}
    </div>
  );
};

/** Markdown 渲染区域，空态提示。 */
const ReportContent: React.FC<{
  content: string;
  raw: Record<string, unknown> | null;
  kind: AsyncKind | 'round';
}> = ({ content, raw, kind }) => {
  if (!content) {
    return (
      <div className="flex h-48 items-center justify-center rounded border border-dashed border-border-button text-text-secondary">
        {t('cognitiveWargame.report.markdownEmpty')}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <article className="prose prose-sm max-w-none dark:prose-invert">
        <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
      </article>
      {kind === 'counterfactual' && raw && (
        <details className="text-xs text-text-secondary">
          <summary>{t('cognitiveWargame.report.resultStats')}</summary>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words">
            {JSON.stringify(raw, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

const ReportViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const scenarioId = id ?? '';
  const [tab, setTab] = useState('round');

  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">
          {t('cognitiveWargame.report.title')}
        </h1>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="round">
            {t('cognitiveWargame.report.roundReport')}
          </TabsTrigger>
          <TabsTrigger value="monte_carlo">
            {t('cognitiveWargame.report.monteCarlo')}
          </TabsTrigger>
          <TabsTrigger value="backtest">
            {t('cognitiveWargame.report.backtest')}
          </TabsTrigger>
          <TabsTrigger value="counterfactual">
            {t('cognitiveWargame.report.counterfactual')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="round">
          <RoundReportTab scenarioId={scenarioId} />
        </TabsContent>
        <TabsContent value="monte_carlo">
          <AsyncReportTab kind="monte_carlo" scenarioId={scenarioId} />
        </TabsContent>
        <TabsContent value="backtest">
          <AsyncReportTab kind="backtest" scenarioId={scenarioId} />
        </TabsContent>
        <TabsContent value="counterfactual">
          <AsyncReportTab kind="counterfactual" scenarioId={scenarioId} />
        </TabsContent>
      </Tabs>
      </div>
    </WargameSectionLayout>
  );
};

export default ReportViewPage;
