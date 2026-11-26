/**
 * SsoStore — 统一认证运行时配置(wizard-sso-followup A7 / 设计评审 R14)。
 *
 * 文件:bff/data/sso-config.json(可入库,不含敏感凭证)。
 * 字段:enabled / publicOrigin / providers / silentRelogin —— stateSecret **永不落盘**,
 *       仍由 BFF_SSO_STATE_SECRET 环境变量提供(Constitution Token Security)。
 * 合并语义:sso-config.loadSsoConfig() 中 runtime 文件整体优先于 env(逐字段);
 *       文件缺失/损坏/schema 不符 → 纯 env(向后兼容,删除文件即回滚)。
 * 读写:每次按需读(与"按需读 env"哲学一致),BFF 单实例规模下无性能问题。
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');
const CONFIG_FILE = resolve(DATA_DIR, 'sso-config.json');

export const ssoRuntimeConfigSchema = z.object({
  enabled: z.boolean(),
  publicOrigin: z.string().min(1),
  /** null = 不过滤(以网关 enabled/usage 为准);数组 = 白名单 */
  providers: z.array(z.string().min(1)).nullable(),
  silentRelogin: z.boolean(),
  /** §14 登出三项(可选;旧文件缺省仍可读) */
  oauthClientId: z.string().min(1).optional(),
  idpIssuer: z.string().min(1).optional(),
  idpLogoutUrl: z.string().min(1).optional(),
  /** ISO 时间戳,管理页展示用 */
  updatedAt: z.string().min(1),
});

export type SsoRuntimeConfig = z.infer<typeof ssoRuntimeConfigSchema>;

export type SsoRuntimeConfigInput = Omit<SsoRuntimeConfig, 'updatedAt'>;

/**
 * 读取运行时配置。文件缺失/损坏/校验失败返回 null(调用方回落 env)。
 */
export function readSsoRuntimeConfig(
  filePath: string = CONFIG_FILE,
): SsoRuntimeConfig | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    const parsed = ssoRuntimeConfigSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(
        `[sso-store] invalid sso-config.json, falling back to env: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
      );
      return null;
    }
    return parsed.data;
  } catch (err) {
    console.warn(
      `[sso-store] failed to read sso-config.json, falling back to env: ${(err as Error).message}`,
    );
    return null;
  }
}

/** 可选字符串字段:trim 后空串归一为 undefined(不写入文件)。 */
function normalizeOptionalString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? undefined : trimmed;
}

/**
 * 归一化并写入运行时配置:
 * - publicOrigin 去首尾空白与尾部斜杠;
 * - providers 逐项 trim、去空、去重;空数组归一为 null(不过滤)。
 */
export function writeSsoRuntimeConfig(
  input: SsoRuntimeConfigInput,
  filePath: string = CONFIG_FILE,
): SsoRuntimeConfig {
  const providerList = Array.isArray(input.providers)
    ? Array.from(
        new Set(
          input.providers
            .map((p) => (typeof p === 'string' ? p.trim() : ''))
            .filter((p) => p !== ''),
        ),
      )
    : null;
  const oauthClientId = normalizeOptionalString(input.oauthClientId);
  const idpIssuer = normalizeOptionalString(input.idpIssuer);
  const idpLogoutUrl = normalizeOptionalString(input.idpLogoutUrl);
  const config: SsoRuntimeConfig = {
    enabled: input.enabled,
    publicOrigin: input.publicOrigin.trim().replace(/\/+$/, ''),
    providers: providerList && providerList.length > 0 ? providerList : null,
    silentRelogin: input.silentRelogin,
    // 空串归一为 undefined(不写入文件)
    ...(oauthClientId ? { oauthClientId } : {}),
    ...(idpIssuer ? { idpIssuer } : {}),
    ...(idpLogoutUrl ? { idpLogoutUrl } : {}),
    updatedAt: new Date().toISOString(),
  };
  // 写前自校验(防御性):失败即抛,不产生半成品文件
  ssoRuntimeConfigSchema.parse(config);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

/**
 * 删除运行时配置(回滚到 env 兜底)。
 */
export function clearSsoRuntimeConfig(filePath: string = CONFIG_FILE): void {
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath);
    } catch (err) {
      console.warn(`[sso-store] failed to remove sso-config.json: ${(err as Error).message}`);
    }
  }
}
