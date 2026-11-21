/**
 * Windows 文件句柄残留下的目录换入辅助(install API Windows bug 修复)。
 *
 * 背景:plugins.ts 原子换入 rename(dest→.retired) 在 Windows 上只要目录内
 * 有进程持句柄(杀毒/索引服务/files 路由泄漏 fd)即抛 EPERM→500,确定性复现;
 * Linux 不受影响。修复方向 = EPERM 短退避重试 + copy-swap 兜底(评审记录见
 * wargame 插件本地验证拓扑记忆与 plugins.ts 原子换入注释)。
 *
 * 语义:重试仅针对 Windows 句柄竞态码(EPERM/EBUSY);copy-swap 兜底以
 * 「拷贝副本→删源」替代「改名」,原子性弱于 rename,但调用方不变式
 * (dest 任一时刻要么旧版要么新版)由调用方按下方注释维护。
 */

const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY']);

export function isRetriableFsError(err: unknown): boolean {
  return RETRYABLE_CODES.has((err as NodeJS.ErrnoException)?.code ?? '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * rename 带短退避重试(指数 50ms→800ms,默认 5 次)。
 * 仅重试 EPERM/EBUSY;ENOENT/EACCES 等照常上抛(ENOENT 语义由调用方处理)。
 */
export async function renameWithWindowsRetry(
  src: string,
  dest: string,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<void> {
  const attempts = opts.attempts ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 50;
  const { rename } = await import('node:fs/promises');
  for (let i = 0; ; i++) {
    try {
      await rename(src, dest);
      return;
    } catch (err) {
      if (!isRetriableFsError(err) || i >= attempts - 1) {
        throw err;
      }
      await sleep(baseDelayMs * 2 ** i);
    }
  }
}

/**
 * rename 重试穷尽后的兜底:拷贝 src→dest 副本,再删源(带 rm 内建重试)。
 * 删源失败时回滚副本(保持调用前状态)并上抛——调用方据此维护
 * 「dest 非空/旧装原位」不变式。
 */
export async function copySwapFallback(
  src: string,
  dest: string,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<void> {
  const { cp, rm } = await import('node:fs/promises');
  await cp(src, dest, { recursive: true, force: true });
  try {
    await rm(src, {
      recursive: true,
      force: true,
      maxRetries: opts.attempts ?? 5,
      retryDelay: opts.baseDelayMs ?? 100,
    });
  } catch (err) {
    await rm(dest, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
      () => {},
    );
    throw err;
  }
}
