import type { AssetHardware } from '../api';

const ARCH_KEYS = new Set(['x86_64', 'arm64', 'unknown']);
const ACCEL_KEYS = new Set([
  'nvidia',
  'ascend',
  'amd',
  'gpu',
  'cpu',
  'unknown',
]);
const SOURCE_KEYS = new Set(['declared', 'curated', 'inferred', 'unknown']);

function keyOf(value: string | undefined, keys: Set<string>): string {
  return value && keys.has(value) ? value : 'unknown';
}

export function archLabelKey(value?: string): string {
  return `aihub.hardware.arch.${keyOf(value, ARCH_KEYS)}`;
}

export function acceleratorLabelKey(value?: string): string {
  return `aihub.hardware.accel.${keyOf(value, ACCEL_KEYS)}`;
}

export function sourceLabelKey(value?: string): string {
  return `aihub.hardware.sourceValue.${keyOf(value, SOURCE_KEYS)}`;
}

/** 是否有可展示的硬件标注（unknown 不展示徽标）。 */
export function hasHardwareLabel(hardware?: AssetHardware): boolean {
  return Boolean(
    hardware &&
      ((hardware.arch && hardware.arch !== 'unknown') ||
        (hardware.accelerator && hardware.accelerator !== 'unknown') ||
        hardware.accelerator_model),
  );
}
