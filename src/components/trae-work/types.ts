// spec-013 P0-3: TRAE Work 组件共享类型
// 对齐 components-api.md §2

/** 任务状态(对应 TaskCard) */
export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'pending';

/** 进度节点类型(对应 TaskProgress) */
export type ProgressNodeType = 'tool_call' | 'thinking' | 'artifact' | 'error';

/** 进度节点状态 */
export type ProgressNodeStatus = 'running' | 'completed' | 'failed' | 'skipped';

/** 工作模式(对应 ModeSwitcher) */
export type WorkMode = 'work' | 'code' | 'canvas';

/** 进度节点(对应 TaskProgress) */
export interface ProgressNode {
  id: string;
  type: ProgressNodeType;
  title: string;
  status: ProgressNodeStatus;
  startedAt?: string;
  endedAt?: string;
  content?: React.ReactNode;
  children?: ProgressNode[];
}

/** TaskCard Props(对应 components-api.md §2.1) */
export interface TaskCardProps {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt?: string;
  currentStep?: string;
  progress?: number;
  onClick?: (id: string) => void;
  onDelete?: (id: string) => void;
  onRetry?: (id: string) => void;
  selected?: boolean;
  compact?: boolean;
}

/** ToolPanel Props(对应 components-api.md §2.3) */
export interface ToolPanelProps {
  id: string;
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  actions?: React.ReactNode;
  loading?: boolean;
  empty?: React.ReactNode;
  disabled?: boolean;
  badge?: number;
}

/** TaskProgress Props(对应 components-api.md §2.2) */
export interface TaskProgressProps {
  nodes: ProgressNode[];
  defaultExpanded?: string[];
  expanded?: string[];
  onExpandedChange?: (expanded: string[]) => void;
  showTimestamp?: boolean;
  autoScroll?: boolean;
}

/** ModeSwitcher Props(对应 components-api.md §2.4) */
export interface ModeSwitcherProps {
  value: WorkMode;
  onChange: (mode: WorkMode) => void;
  availableModes?: WorkMode[];
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  showLabels?: boolean;
}
