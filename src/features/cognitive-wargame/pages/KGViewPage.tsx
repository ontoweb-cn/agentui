/**
 * KGViewPage — 知识图谱（P3.2-2 KGExplorer 增强）。
 *
 * 布局：顶部 GraphView 力导向图 + 下方三 Tab（实体关系/叙事链溯源/关键节点）。
 * - 实体关系：复用原有实体/关系表格
 * - 叙事链溯源：输入 narrative_id + maxHops → api.getNarrativeChain → 链路展示
 * - 关键节点：api.getKeyNodes → 度中心性/介数中心性表格
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, type KGEntity, type KGRelation } from '../api';
import GraphView from '../components/GraphView';
import WargameSectionLayout from '../components/section-menu';
import { t } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';

/** 关键节点条目（后端返回字段松散，用 Record 兜底）。 */
interface KeyNodeEntry {
  id: string;
  degree?: number;
  betweenness?: number;
  [key: string]: unknown;
}

/** 叙事链条目。 */
interface ChainEntry {
  narrative_id: string;
  text?: string;
  stance?: string;
  valence?: number;
  launch_round?: number;
  [key: string]: unknown;
}

const KGViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [entities, setEntities] = useState<KGEntity[]>([]);
  const [relations, setRelations] = useState<KGRelation[]>([]);
  const [loading, setLoading] = useState(false);

  // 叙事链状态
  const [chainInput, setChainInput] = useState('');
  const [maxHops, setMaxHops] = useState(3);
  const [chain, setChain] = useState<ChainEntry[]>([]);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);

  // 关键节点状态
  const [keyNodes, setKeyNodes] = useState<KeyNodeEntry[]>([]);
  const [keyNodesLoading, setKeyNodesLoading] = useState(false);
  const [keyTopN, setKeyTopN] = useState(10);

  const scenarioId = id ?? '';

  const loadKG = useCallback(async () => {
    if (!scenarioId) return;
    setLoading(true);
    try {
      const [ents, rels] = await Promise.all([
        api.getKGEntities(scenarioId),
        api.getKGRelations(scenarioId),
      ]);
      setEntities(ents);
      setRelations(rels);
    } finally {
      setLoading(false);
    }
  }, [scenarioId]);

  const loadKeyNodes = useCallback(async () => {
    if (!scenarioId) return;
    setKeyNodesLoading(true);
    try {
      const raw = await api.getKeyNodes(scenarioId, { limit: keyTopN });
      const nodes = (Array.isArray(raw) ? raw : []).map((item) => {
        const obj = item as Record<string, unknown>;
        return {
          id: String(obj.id ?? obj.node_id ?? obj.entity_id ?? ''),
          degree: typeof obj.degree === 'number' ? obj.degree : undefined,
          betweenness:
            typeof obj.betweenness === 'number' ? obj.betweenness : undefined,
          ...obj,
        } as KeyNodeEntry;
      });
      setKeyNodes(nodes);
    } catch {
      setKeyNodes([]);
    } finally {
      setKeyNodesLoading(false);
    }
  }, [scenarioId, keyTopN]);

  useEffect(() => {
    loadKG();
  }, [loadKG]);

  // 切到关键节点 Tab 时首次加载
  useEffect(() => {
    if (keyNodes.length === 0 && scenarioId) {
      loadKeyNodes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId]);

  const handleSearchChain = async () => {
    if (!scenarioId || !chainInput.trim()) return;
    setChainLoading(true);
    setChainError(null);
    try {
      const raw = await api.getNarrativeChain(scenarioId, chainInput.trim(), maxHops);
      // 后端返回结构松散，尝试提取链路数组
      const data = raw as Record<string, unknown>;
      const chainArr = (data.chain ?? data.narratives ?? data.nodes ?? []) as ChainEntry[];
      setChain(Array.isArray(chainArr) ? chainArr : []);
    } catch (err) {
      setChain([]);
      setChainError(err instanceof Error ? err.message : String(err));
    } finally {
      setChainLoading(false);
    }
  };

  return (
    <WargameSectionLayout>
      <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium">{t('cognitiveWargame.kg.title')}</h1>
        <Button variant="outline" onClick={loadKG} disabled={!scenarioId || loading}>
          {t('cognitiveWargame.common.refresh')}
        </Button>
      </div>

      {/* 顶部图谱可视化 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t('cognitiveWargame.kg.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Spin spinning={loading}>
            {relations.length === 0 && entities.length === 0 ? (
              <EmptyCard
                title={
                  scenarioId
                    ? t('cognitiveWargame.common.empty')
                    : t('cognitiveWargame.common.selectScenario')
                }
                className="w-full"
              />
            ) : (
              <div className="h-80 w-full">
                <GraphView entities={entities} relations={relations} />
              </div>
            )}
          </Spin>
        </CardContent>
      </Card>

      {/* 下方三 Tab */}
      <Tabs defaultValue="entities">
        <TabsList>
          <TabsTrigger value="entities">
            {t('cognitiveWargame.kg.entities')} / {t('cognitiveWargame.kg.relations')}
          </TabsTrigger>
          <TabsTrigger value="chain">
            {t('cognitiveWargame.kg.narrativeChain')}
          </TabsTrigger>
          <TabsTrigger value="keynodes">
            {t('cognitiveWargame.kg.keyNodes')}
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: 实体关系表 */}
        <TabsContent value="entities">
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
        </TabsContent>

        {/* Tab 2: 叙事链溯源 */}
        <TabsContent value="chain">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {t('cognitiveWargame.kg.narrativeChain')}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-2">
                  <Label>narrative_id</Label>
                  <Input
                    value={chainInput}
                    onChange={(e) => setChainInput(e.target.value)}
                    placeholder="n001"
                    className="w-48"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>max hops</Label>
                  <Select
                    value={String(maxHops)}
                    onValueChange={(v) => setMaxHops(Number(v))}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 5].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleSearchChain}
                  disabled={!chainInput.trim() || chainLoading}
                >
                  {t('cognitiveWargame.kg.search')}
                </Button>
              </div>

              {chainError && (
                <p className="text-sm text-text-error">{chainError}</p>
              )}

              <Spin spinning={chainLoading}>
                {chain.length === 0 ? (
                  <EmptyCard
                    title={t('cognitiveWargame.kg.narrativeChain')}
                    className="w-full"
                  />
                ) : (
                  <ol className="flex flex-col gap-2">
                    {chain.map((entry, idx) => (
                      <li
                        key={`${entry.narrative_id}-${idx}`}
                        className="rounded border border-border-button p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{entry.narrative_id}</Badge>
                          {entry.stance && (
                            <span className="text-text-secondary">
                              {entry.stance}
                            </span>
                          )}
                          {entry.launch_round != null && (
                            <span className="text-xs text-text-secondary">
                              {t('cognitiveWargame.common.round')} {entry.launch_round}
                            </span>
                          )}
                        </div>
                        {entry.text && (
                          <p className="mt-1 text-sm text-text-secondary">
                            {entry.text}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </Spin>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: 关键节点 */}
        <TabsContent value="keynodes">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {t('cognitiveWargame.kg.keyNodes')}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-end gap-3">
                <div className="flex flex-col gap-2">
                  <Label>top_n</Label>
                  <Select
                    value={String(keyTopN)}
                    onValueChange={(v) => setKeyTopN(Number(v))}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[5, 10, 20, 50].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  onClick={loadKeyNodes}
                  disabled={keyNodesLoading}
                >
                  {t('cognitiveWargame.common.refresh')}
                </Button>
              </div>

              <Spin spinning={keyNodesLoading}>
                {keyNodes.length === 0 ? (
                  <EmptyCard
                    title={t('cognitiveWargame.common.empty')}
                    className="w-full"
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>id</TableHead>
                        <TableHead>{t('cognitiveWargame.kg.degree')}</TableHead>
                        <TableHead>{t('cognitiveWargame.kg.betweenness')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {keyNodes.map((node) => (
                        <TableRow key={node.id}>
                          <TableCell className="font-medium">{node.id}</TableCell>
                          <TableCell>{node.degree ?? '-'}</TableCell>
                          <TableCell>{node.betweenness ?? '-'}</TableCell>
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
    </WargameSectionLayout>
  );
};

export default KGViewPage;
