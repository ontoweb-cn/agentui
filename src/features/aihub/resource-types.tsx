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

export function isResourceType(key?: string): key is string {
  return RESOURCE_TYPES.some((item) => item.key === key);
}

export function resourceTypeMeta(key: string): ResourceTypeMeta {
  return (
    RESOURCE_TYPES.find((item) => item.key === key) ?? RESOURCE_TYPES[0]
  );
}
