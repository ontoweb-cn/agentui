/**
 * GraphView — 知识图谱 / 社交网络关系图（P3.4-1）。
 *
 * 基于 @antv/g6 v5 力导向布局渲染实体-关系图。
 * - 节点颜色按实体 type 映射（红方/蓝方/Agent/媒体/叙事/默认灰）
 * - 边粗细按 weight 映射
 * - 节点集合 = entities ∪ relations 端点（仅传 relations 也能成图）
 * - 空数据时由父组件展示 EmptyCard，本组件不渲染
 */
import { Graph } from '@antv/g6';
import { useIsDarkTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import type { KGEntity, KGRelation } from '../api';
import { useEffect, useRef } from 'react';

interface GraphViewProps {
  entities?: KGEntity[];
  relations: KGRelation[];
  className?: string;
}

/** 实体类型 → 颜色（子串匹配，命中即用）。 */
const NODE_COLOR_RULES: Array<[string, string]> = [
  ['red', '#ef4444'],
  ['blue', '#3b82f6'],
  ['agent', '#10b981'],
  ['media', '#f59e0b'],
  ['narrative', '#8b5cf6'],
  ['institution', '#6366f1'],
];
const DEFAULT_NODE_COLOR = '#6b7280';

function colorFor(type?: string): string {
  if (!type) return DEFAULT_NODE_COLOR;
  const key = type.toLowerCase();
  const hit = NODE_COLOR_RULES.find(([k]) => key.includes(k));
  return hit ? hit[1] : DEFAULT_NODE_COLOR;
}

const GraphView: React.FC<GraphViewProps> = ({
  entities = [],
  relations,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDark = useIsDarkTheme();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 无数据：不创建图（父组件展示 EmptyCard）
    if (relations.length === 0 && entities.length === 0) {
      return;
    }

    // 节点集合 = entities ∪ relations 端点
    const entityMap = new Map<string, KGEntity>();
    entities.forEach((e) => entityMap.set(e.id, e));
    const nodeIds = new Set<string>(entityMap.keys());
    relations.forEach((r) => {
      nodeIds.add(r.subject);
      nodeIds.add(r.object);
    });

    const nodes = Array.from(nodeIds).map((id) => {
      const ent = entityMap.get(id);
      const type = ent?.type ?? ent?.subject;
      return {
        id,
        data: { label: ent?.subject ?? id, type },
        style: { fill: colorFor(type) },
      };
    });

    const edges = relations.map((r, i) => ({
      id: `e-${i}-${r.subject}-${r.object}`,
      source: r.subject,
      target: r.object,
      data: { weight: r.weight, predicate: r.predicate },
      style: {
        lineWidth: Math.min(Math.max((r.weight ?? 1) * 1.5, 1), 6),
      },
    }));

    // 对齐 codebase 既有 G6 v5 用法（force-graph.tsx）：构造时不传 data，
    // 用 setData + render 两步渲染
    const graph = new Graph({
      container,
      autoFit: 'view',
      autoResize: true,
      behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
      layout: {
        type: 'force',
        preventOverlap: true,
        nodeSize: 40,
        linkDistance: 120,
        animated: false,
      },
      node: {
        style: {
          size: 28,
          fill: (d: { data?: { type?: string } }) => colorFor(d.data?.type),
          labelText: (d: { data?: { label?: string }; id: string }) =>
            d.data?.label ?? d.id,
          labelFill: isDark ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)',
          labelFontSize: 10,
          labelOffsetY: 22,
          labelPlacement: 'bottom',
        },
      },
      edge: {
        style: {
          stroke: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
        },
      },
    });

    graph.setData({ nodes, edges });
    graph.render();

    return () => {
      graph.destroy();
    };
  }, [entities, relations, isDark]);

  return (
    <div ref={containerRef} className={cn('h-full w-full', className)} />
  );
};

export default GraphView;
