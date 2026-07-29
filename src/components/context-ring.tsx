/**
 * ContextRing — 上一 turn token 用量显示（P2）
 *
 * 参考 webui ctxIndicator (index.html L805-813, ui.js L2427-2530)。
 *
 * 数据源限制（重要）：
 * - BFF usage 事件仅在 turn 结束时（run.completed）发送一次
 * - webui context ring 的实时数据源是 metering / context_status 事件（流式中持续推送），
 *   但 Constitution Principle IV 的 8 值 StreamChunk 枚举不包含 metering 类型，BFF 无法透传
 * - 本组件只能显示"上一 turn 的 token 用量"，无法实时显示"当前 turn 的 token 占用"
 *
 * UI：
 * - SVG 圆环（r=9.75，circumference=61.261056745）
 * - strokeDashoffset = circumference * (1 - pct/100)
 * - 颜色阈值：<50% 默认 / 50-75% 黄色 / >75% 红色
 * - tooltip 显示详细 token 数、context length
 */
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface ContextRingProps {
  /** 上一 turn 的 prompt token 数（来自 usage 事件） */
  promptTokens: number;
  /** context length，默认 128000 */
  contextLength?: number;
  /** 上一 turn 的 completion token 数 */
  completionTokens?: number;
}

const DEFAULT_CONTEXT_LENGTH = 128000;
const RADIUS = 9.75;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈ 61.26

function getColorClass(pct: number): string {
  if (pct > 75) return 'text-destructive';
  if (pct > 50) return 'text-yellow-500';
  return 'text-muted-foreground';
}

function ContextRingImpl({
  promptTokens,
  contextLength = DEFAULT_CONTEXT_LENGTH,
  completionTokens,
}: ContextRingProps) {
  const { t } = useTranslation();

  const pct = useMemo(() => {
    if (contextLength <= 0) return 0;
    return Math.min(100, (promptTokens / contextLength) * 100);
  }, [promptTokens, contextLength]);

  const dashOffset = useMemo(
    () => CIRCUMFERENCE * (1 - pct / 100),
    [pct],
  );

  const colorClass = getColorClass(pct);

  const tooltipText = useMemo(() => {
    const parts = [
      `${t('context.prompt')}: ${promptTokens}`,
      `${t('context.length')}: ${contextLength}`,
    ];
    if (completionTokens !== undefined) {
      parts.push(`${t('context.completion')}: ${completionTokens}`);
    }
    parts.push(`${t('context.usage')}: ${pct.toFixed(1)}%`);
    return parts.join('\n');
  }, [t, promptTokens, contextLength, completionTokens, pct]);

  // 无 token 数据时不显示
  if (promptTokens <= 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center p-1 hover:bg-muted/50 rounded"
          data-testid="context-ring"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            className={colorClass}
          >
            {/* 背景圆环 */}
            <circle
              cx="12"
              cy="12"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeOpacity="0.2"
            />
            {/* 进度圆环 */}
            <circle
              cx="12"
              cy="12"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 12 12)"
            />
            {/* 中心百分比文本 */}
            <text
              x="12"
              y="15"
              textAnchor="middle"
              fontSize="7"
              fill="currentColor"
              className="font-mono"
            >
              {Math.round(pct)}%
            </text>
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="whitespace-pre-wrap text-xs">{tooltipText}</div>
      </TooltipContent>
    </Tooltip>
  );
}

export const ContextRing = memo(ContextRingImpl);
