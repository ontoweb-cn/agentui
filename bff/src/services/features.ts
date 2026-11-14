/**
 * 系统级能力解析（features）。
 *
 * 统一认证能力默认关闭，只有显式 INTELLECT_AUTH_ENABLED=true 且
 * hiedu 断言代理配置完整时才放行；任一条件不满足一律 false（fail-closed）。
 *
 * 解析结果在进程内缓存：环境变量与密钥在进程生命周期内不变，
 * 避免每次请求重复解析 PEM。
 */

import { loadHieduConfig } from './hiedu-assertion';
import type { HieduConfigResult } from './hiedu-assertion';
import { loadAihubConfig } from './aihub-assertion';
import type { AihubConfigResult } from './aihub-assertion';
import type { Features } from '../types/features';

export type HieduConfigLoader = (
  env: NodeJS.ProcessEnv,
) => HieduConfigResult;

export type AihubConfigLoader = (
  env: NodeJS.ProcessEnv,
) => AihubConfigResult;

function isEnabledFlag(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true';
}

/**
 * 纯函数解析（供测试注入 env / config loader）。
 */
export function resolveFeatures(
  env: NodeJS.ProcessEnv = process.env,
  configLoader: HieduConfigLoader = loadHieduConfig,
  aihubLoader: AihubConfigLoader = loadAihubConfig,
): Features {
  const enabled = isEnabledFlag(env.INTELLECT_AUTH_ENABLED);
  const aihubEnabled = isEnabledFlag(env.AIHUB_ENABLED);
  return {
    'intellect-auth': enabled && configLoader(env).ok,
    aihub: aihubEnabled && aihubLoader(env).ok,
  };
}

let cachedFeatures: Features | undefined;

/** 生产用：进程内缓存的能力结果。 */
export function getFeatures(): Features {
  cachedFeatures ??= resolveFeatures();
  return cachedFeatures;
}

/** 测试用：清除进程内缓存。 */
export function resetFeaturesCacheForTests(): void {
  cachedFeatures = undefined;
}

/** 总闸判定：false 时 hiedu 代理与内置页面同时不可用。 */
export function isIntellectAuthEnabled(): boolean {
  return getFeatures()['intellect-auth'];
}

/** aihub 总闸判定：false 时「资源」入口与代理同时不可用。 */
export function isAihubEnabled(): boolean {
  return getFeatures().aihub;
}
