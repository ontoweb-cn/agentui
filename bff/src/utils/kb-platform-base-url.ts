/** kb-platform (Go) 上游 origin。未设置时默认本地 9381。尾部斜杠会被去掉。 */
const DEFAULT_KB_PLATFORM_URL = 'http://127.0.0.1:9381';

export function getKbPlatformBaseUrl(): string {
  const raw = process.env.KB_PLATFORM_URL?.trim() || DEFAULT_KB_PLATFORM_URL;
  return raw.replace(/\/+$/, '');
}

/**
 * 将 BFF 剥前缀后的 platform 相对路径拼成上游 `/api/v1/platform/...`。
 * @returns 合法路径，或空串表示拒绝（路径含非法字符）
 */
export function joinKbPlatformApiPath(platformSuffix: string): string {
  const suffix =
    platformSuffix === '' || platformSuffix === '/'
      ? ''
      : platformSuffix.startsWith('/')
        ? platformSuffix
        : `/${platformSuffix}`;
  if (suffix.includes('..')) {
    return '';
  }
  if (suffix !== '' && !/^\/[A-Za-z0-9_./-]*$/.test(suffix)) {
    return '';
  }
  return `/api/v1/platform${suffix}`;
}

/** 完整上游 URL（含 query）。platformSuffix 非法时返回空串。 */
export function buildKbPlatformUpstreamUrl(
  platformSuffix: string,
  search: string,
): string {
  const apiPath = joinKbPlatformApiPath(platformSuffix);
  if (!apiPath) {
    return '';
  }
  const query =
    search === ''
      ? ''
      : search.startsWith('?')
        ? search
        : `?${search}`;
  return `${getKbPlatformBaseUrl()}${apiPath}${query}`;
}