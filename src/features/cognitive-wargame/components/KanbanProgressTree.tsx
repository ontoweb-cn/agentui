/**
 * KANBAN 进度树组件（v3.1 阶段二）。
 *
 * 嵌套卡片展示 task 树（root → 回合 → 叙事/传播），按 metadata.task_kind 区分层级，
 * 按 round_num 排序回合。用现有 Badge 组件映射 KANBAN 9 态着色。
 */
import { Badge } from '@/components/ui/badge';
import type { KanbanTask } from '../hooks/use-kanban-progress';

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'success'
  | 'destructive'
  | 'outline';

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  triage: 'secondary',
  todo: 'secondary',
  scheduled: 'secondary',
  ready: 'outline',
  running: 'default',
  blocked: 'destructive',
  review: 'outline',
  done: 'success',
  archived: 'secondary',
};

const STATUS_LABELS: Record<string, string> = {
  triage: '待分诊',
  todo: '待办',
  scheduled: '已排程',
  ready: '就绪',
  running: '运行中',
  blocked: '阻塞',
  review: '审核中',
  done: '已完成',
  archived: '已归档',
};

interface TaskNode {
  task: KanbanTask;
  children: TaskNode[];
}

/**
 * buildTree - 按 metadata.task_kind 分层构建 task 树
 *
 * 简化说明（R2）：
 * - 回合间不用 task_links 顺序依赖，靠 metadata.task_kind + round_num 表达归属
 * - 无 round_num 的子任务（narrative/propagation）按 created_at 时间窗口归属回合
 *   （本回合 created_at 到下回合 created_at 之间）
 * - 这与 task_links 父子关系不同，是显示层简化，非契约违约
 *   （anomaly task 的 parents=[root_id]，但显示时挂到对应回合下）
 */
function buildTree(tasks: KanbanTask[]): TaskNode[] {
  // 简化：假设 tasks 已含 parent 信息（实际需从 task_links 查询，此处用 metadata.task_kind 排序）
  // 按 task_kind 分层：root → round → narrative/propagation
  const roots = tasks.filter((t) => t.metadata?.task_kind === 'root');
  const rounds = tasks
    .filter((t) => t.metadata?.task_kind === 'round')
    .sort(
      (a, b) =>
        (a.metadata?.round_num ?? 0) - (b.metadata?.round_num ?? 0),
    );
  const others = tasks.filter(
    (t) => !['root', 'round'].includes(t.metadata?.task_kind ?? ''),
  );

  return roots.map((root) => ({
    task: root,
    children: rounds.map((round, roundIdx) => {
      const roundNum = round.metadata?.round_num;
      const nextRound =
        roundIdx < rounds.length - 1 ? rounds[roundIdx + 1] : null;
      const children = others.filter((o) => {
        // 优先按 metadata.round_num 精确匹配回合
        if (o.metadata?.round_num != null) {
          return o.metadata.round_num === roundNum;
        }
        // 无 round_num 的子 task（如 narrative/propagation）：按时间窗口归属
        // 本回合 created_at 到下一回合 created_at 之间
        const afterThisRound = o.created_at >= round.created_at;
        const beforeNextRound = nextRound
          ? o.created_at < nextRound.created_at
          : true;
        return afterThisRound && beforeNextRound;
      });
      return {
        task: round,
        children: children.map((o) => ({ task: o, children: [] })),
      };
    }),
  }));
}

function TaskCard({ node, depth }: { node: TaskNode; depth: number }) {
  const { task, children } = node;
  const variant = STATUS_VARIANTS[task.status] ?? 'secondary';
  const label = STATUS_LABELS[task.status] ?? task.status;

  return (
    <div style={{ marginLeft: depth * 16, marginBottom: 4 }}>
      <div className="flex items-center gap-2">
        <span>{task.title}</span>
        <Badge variant={variant}>{label}</Badge>
      </div>
      {children.length > 0 && (
        <div>
          {children.map((child) => (
            <TaskCard key={child.task.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function KanbanProgressTree({ tasks }: { tasks: KanbanTask[] }) {
  const tree = buildTree(tasks);
  if (tree.length === 0) {
    return <div className="text-text-secondary">暂无进度数据</div>;
  }
  return (
    <div className="kanban-progress-tree">
      {tree.map((node) => (
        <TaskCard key={node.task.id} node={node} depth={0} />
      ))}
    </div>
  );
}
