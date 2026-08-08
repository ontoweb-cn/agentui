/**
 * AgentTypePage — Agent 类型字典（G-16）。
 *
 * 展示 intellect_agent_types 类型字典（5 类种子 + 用户扩展）。
 */
import { EmptyCard } from '@/components/empty/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spin } from '@/components/ui/spin';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useWargameStore } from '../store';
import { t } from 'i18next';
import { useEffect } from 'react';

const AgentTypePage: React.FC = () => {
  const { agentTypes, typesLoading, fetchAgentTypes } = useWargameStore();

  useEffect(() => {
    fetchAgentTypes();
  }, [fetchAgentTypes]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-medium">{t('cognitiveWargame.agents.types.title')}</h1>
        <Button variant="outline" onClick={() => fetchAgentTypes()} disabled={typesLoading}>
          {t('cognitiveWargame.common.refresh')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('cognitiveWargame.agents.types.title')} ({agentTypes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Spin spinning={typesLoading}>
            {agentTypes.length === 0 ? (
              <EmptyCard title={t('cognitiveWargame.common.empty')} className="w-full" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('cognitiveWargame.agents.types.typeCode')}</TableHead>
                    <TableHead>{t('cognitiveWargame.agents.types.typeName')}</TableHead>
                    <TableHead>{t('cognitiveWargame.agents.types.parentType')}</TableHead>
                    <TableHead>{t('cognitiveWargame.agents.types.sortOrder')}</TableHead>
                    <TableHead>{t('cognitiveWargame.agents.types.isActive')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentTypes.map((ty) => (
                    <TableRow key={ty.type_code}>
                      <TableCell className="font-mono text-sm">{ty.type_code}</TableCell>
                      <TableCell className="font-medium">{ty.type_name}</TableCell>
                      <TableCell className="text-text-secondary">{ty.parent_type_code ?? '-'}</TableCell>
                      <TableCell>{ty.sort_order}</TableCell>
                      <TableCell><Badge variant={ty.is_active ? 'success' : 'secondary'}>{ty.is_active ? t('cognitiveWargame.agents.status.active') : t('cognitiveWargame.agents.status.archived')}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Spin>
        </CardContent>
      </Card>
    </div>
  );
};

export default AgentTypePage;
