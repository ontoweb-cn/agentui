/**
 * KGViewPage — 知识图谱。
 *
 * 顶部为图可视化占位区域，下方分两列展示实体与关系列表。
 */
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spin } from '@/components/ui/spin';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, type KGEntity, type KGRelation } from '../api';
import { t } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';

const KGViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [entities, setEntities] = useState<KGEntity[]>([]);
  const [relations, setRelations] = useState<KGRelation[]>([]);
  const [loading, setLoading] = useState(false);

  const loadKG = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [ents, rels] = await Promise.all([
        api.getKGEntities(id),
        api.getKGRelations(id),
      ]);
      setEntities(ents);
      setRelations(rels);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadKG();
  }, [loadKG]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">{t('cognitiveWargame.kg.title')}</h1>
        <Button variant="outline" onClick={loadKG} disabled={!id}>
          {t('cognitiveWargame.common.refresh')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t('cognitiveWargame.kg.graphPlaceholder')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-72 items-center justify-center rounded border border-dashed border-border-button text-text-secondary">
            {t('cognitiveWargame.kg.graphPlaceholder')}
          </div>
        </CardContent>
      </Card>

      <Spin spinning={loading}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {t('cognitiveWargame.kg.entities')} ({entities.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>subject</TableHead>
                    <TableHead>type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entities.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.subject}</TableCell>
                      <TableCell>{e.type ?? '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {t('cognitiveWargame.kg.relations')} ({relations.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>subject</TableHead>
                    <TableHead>predicate</TableHead>
                    <TableHead>object</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relations.map((r, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{r.subject}</TableCell>
                      <TableCell>{r.predicate}</TableCell>
                      <TableCell>{r.object}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </Spin>
    </div>
  );
};

export default KGViewPage;
