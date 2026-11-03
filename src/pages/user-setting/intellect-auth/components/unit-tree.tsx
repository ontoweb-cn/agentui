import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Unit } from '@/services/hiedu/api';
import { StatusBadge } from './state';

export interface UnitTreeNode extends Unit {
  children: UnitTreeNode[];
}

/** 把扁平 units 列表按 parent_id 组装成树；父节点缺失时按根节点处理。 */
export function buildTree(units: Unit[]): UnitTreeNode[] {
  const nodes = new Map<number, UnitTreeNode>();
  for (const unit of units) {
    nodes.set(unit.id, { ...unit, children: [] });
  }

  const roots: UnitTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent =
      node.parent_id && node.parent_id > 0
        ? nodes.get(node.parent_id)
        : undefined;
    if (parent && parent.id !== node.id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const compare = (a: UnitTreeNode, b: UnitTreeNode) =>
    a.path.localeCompare(b.path) || a.id - b.id;
  roots.sort(compare);
  for (const node of nodes.values()) {
    node.children.sort(compare);
  }
  return roots;
}

export function UnitTree({
  nodes,
  expanded,
  onToggle,
  actions,
  depth = 0,
}: {
  nodes: UnitTreeNode[];
  expanded: ReadonlySet<number>;
  onToggle: (id: number) => void;
  actions?: (node: UnitTreeNode) => ReactNode;
  depth?: number;
}) {
  if (nodes.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1">
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const open = expanded.has(node.id);
        return (
          <li key={node.id}>
            <div
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg-secondary',
              )}
              style={{ paddingLeft: `${depth * 20 + 8}px` }}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6 shrink-0 text-text-secondary"
                onClick={() => onToggle(node.id)}
                disabled={!hasChildren}
                aria-expanded={hasChildren ? open : undefined}
                aria-label={
                  hasChildren ? (open ? '折叠' : '展开') : '无下级'
                }
              >
                {hasChildren ? (open ? '−' : '+') : '·'}
              </Button>
              <span className="text-sm font-medium text-text-primary">
                {node.name}
              </span>
              {node.short_name ? (
                <span className="text-xs text-text-secondary">
                  {node.short_name}
                </span>
              ) : null}
              <code className="rounded bg-bg-secondary px-1 text-xs text-text-secondary">
                {node.unit_code}
              </code>
              <StatusBadge status={node.status} />
              {node.idp_projection ? (
                <span className="rounded-md bg-bg-secondary px-1.5 py-0.5 text-xs text-text-secondary">
                  IdP 投影
                </span>
              ) : null}
              {actions ? (
                <span className="ml-auto flex items-center gap-1">
                  {actions(node)}
                </span>
              ) : null}
            </div>
            {hasChildren && open ? (
              <UnitTree
                nodes={node.children}
                expanded={expanded}
                onToggle={onToggle}
                actions={actions}
                depth={depth + 1}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
