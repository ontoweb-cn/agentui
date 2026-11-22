import {
  LucideBot,
  LucideBox,
  LucideDatabase,
  LucideLayoutGrid,
  LucidePlug,
  LucideSparkles,
  LucideWorkflow,
  LucideWrench,
  type LucideIcon,
} from 'lucide-react';

export interface ResourceTypeMeta {
  /** 与后端 markets 的 slug 一致 */
  key: string;
  icon: LucideIcon;
  /** 后端未返回 label 时的 i18n 兜底键 */
  labelKey: string;
}

/**
 * 资源类型顺序与图标。
 *
 * 菜单名称优先取后端 markets.label（zh/en），缺失时回退 aihub.type.* 词条。
 */
export const RESOURCE_TYPES: ResourceTypeMeta[] = [
  { key: 'models', icon: LucideBox, labelKey: 'aihub.type.models' },
  { key: 'datasets', icon: LucideDatabase, labelKey: 'aihub.type.datasets' },
  { key: 'agents', icon: LucideBot, labelKey: 'aihub.type.agents' },
  { key: 'skills', icon: LucideSparkles, labelKey: 'aihub.type.skills' },
  { key: 'tools', icon: LucideWrench, labelKey: 'aihub.type.tools' },
  { key: 'mcps', icon: LucidePlug, labelKey: 'aihub.type.mcps' },
  { key: 'solutions', icon: LucideWorkflow, labelKey: 'aihub.type.solutions' },
  { key: 'apps', icon: LucideLayoutGrid, labelKey: 'aihub.type.apps' },
];

export const DEFAULT_RESOURCE_TYPE = 'models';

const SAFE_TYPE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/i;

/**
 * 路由参数校验：只约束可安全用于 URL 的 slug 形态。
 *
 * 具体类型是否存在由后端 `/markets` 决定（配置新增类型无需改前端白名单）。
 */
export function isSafeResourceType(key?: string): key is string {
  return Boolean(key && SAFE_TYPE_PATTERN.test(key));
}
