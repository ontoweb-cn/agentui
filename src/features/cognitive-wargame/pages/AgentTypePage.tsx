/**
 * AgentTypePage - agent type dictionary.
 */
import { EmptyCard } from '@/components/empty/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spin } from '@/components/ui/spin';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { t } from 'i18next';
import WargameSectionLayout from '../components/section-menu';
import { useWargameStore } from '../store';

export default function AgentTypePage() {
  const { agentTypes, typesLoading, fetchAgentTypes } = useWargameStore();

  useEffect(() => {
    void fetchAgentTypes();
  }, [fetchAgentTypes]);

  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-medium">{t('cognitiveWargame.agents.types.title')}</h1>
          <Button variant="outline" onClick={() => void fetchAgentTypes()} disabled={typesLoading}>
            <RefreshCw className="size-4" />
            {t('cognitiveWargame.common.refresh')}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t('cognitiveWargame.agents.types.title')} ({agentTypes.length})
            </CardTitle>
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
                    {agentTypes.map((agentType) => (
                      <TableRow key={agentType.type_code}>
                        <TableCell className="font-mono text-sm">
                          {agentType.type_code}
                        </TableCell>
                        <TableCell className="font-medium">{agentType.type_name}</TableCell>
                        <TableCell className="text-text-secondary">
                          {agentType.parent_type_code ?? '-'}
                        </TableCell>
                        <TableCell>{agentType.sort_order}</TableCell>
                        <TableCell>
                          <Badge variant={agentType.is_active ? 'success' : 'secondary'}>
                            {agentType.is_active
                              ? t('cognitiveWargame.agents.status.active')
                              : t('cognitiveWargame.agents.types.inactive')}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Spin>
          </CardContent>
        </Card>
      </div>
    </WargameSectionLayout>
  );
}
