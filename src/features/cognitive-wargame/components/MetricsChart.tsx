/**
 * MetricsChart — 态势指标趋势图（P3.4-1）。
 *
 * 基于 recharts 折线图，展示红蓝得分 + 红蓝认知态势随回合变化趋势。
 * 数据源：api.getMetricsHistory → Metrics[]。
 */
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Metrics } from '../api';
import { t } from 'i18next';

interface MetricsChartProps {
  history: Metrics[];
  height?: number;
  /** 是否显示认知态势线（默认 true）；仅看得分时可关闭。 */
  showCognitive?: boolean;
}

const MetricsChart: React.FC<MetricsChartProps> = ({
  history,
  height = 280,
  showCognitive = true,
}) => {
  const data = history.map((m) => ({
    round: `R${m.round}`,
    redScore: m.red_score ?? null,
    blueScore: m.blue_score ?? null,
    redCog: m.red_cognitive ?? null,
    blueCog: m.blue_cognitive ?? null,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="round" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line
          type="monotone"
          dataKey="redScore"
          name={t('cognitiveWargame.metrics.redScore')}
          stroke="#ef4444"
          dot={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="blueScore"
          name={t('cognitiveWargame.metrics.blueScore')}
          stroke="#3b82f6"
          dot={false}
          connectNulls
        />
        {showCognitive && (
          <>
            <Line
              type="monotone"
              dataKey="redCog"
              name={t('cognitiveWargame.metrics.redCognitive')}
              stroke="#f87171"
              strokeDasharray="4 4"
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="blueCog"
              name={t('cognitiveWargame.metrics.blueCognitive')}
              stroke="#60a5fa"
              strokeDasharray="4 4"
              dot={false}
              connectNulls
            />
          </>
        )}
      </LineChart>
    </ResponsiveContainer>
  );
};

export default MetricsChart;
