/**
 * ReportViewPage — 评估报告。
 *
 * 左侧报告类型列表，右侧 Markdown 渲染占位区域。
 */
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spin } from '@/components/ui/spin';
import { api, type Report } from '../api';
import { t } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';

/** 内置报告类型，可作为列表项展示。 */
const REPORT_TYPES = ['summary', 'red', 'blue', 'cognitive'];

const ReportViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [activeType, setActiveType] = useState<string>('summary');
  const [loading, setLoading] = useState(false);

  const loadReport = useCallback(
    async (type: string) => {
      if (!id) return;
      setLoading(true);
      try {
        const r = await api.getReport(id, type);
        setReport(r);
      } catch {
        setReport(null);
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    loadReport(activeType);
  }, [activeType, loadReport]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">
          {t('cognitiveWargame.report.title')}
        </h1>
        <Button
          variant="outline"
          onClick={() => loadReport(activeType)}
          disabled={!id}
        >
          {t('cognitiveWargame.common.refresh')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">
              {t('cognitiveWargame.report.listTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {REPORT_TYPES.map((type) => (
                <li key={type}>
                  <Button
                    variant={type === activeType ? 'default' : 'outline'}
                    className="w-full justify-start"
                    onClick={() => setActiveType(type)}
                  >
                    {type}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg">
              {report?.title ?? activeType}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Spin spinning={loading}>
              {report?.content ? (
                <pre className="whitespace-pre-wrap break-words text-sm">
                  {report.content}
                </pre>
              ) : (
                <div className="flex h-48 items-center justify-center rounded border border-dashed border-border-button text-text-secondary">
                  {t('cognitiveWargame.report.contentPlaceholder')}
                </div>
              )}
            </Spin>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ReportViewPage;
