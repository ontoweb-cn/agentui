// fs-windows-retry 单测:EPERM/EBUSY 短退避重试 + copy-swap 兜底语义
// (install API Windows bug 修复,见 services/fs-windows-retry.ts 头注)

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  rename: vi.fn(),
  cp: vi.fn(),
  rm: vi.fn(),
}));

import { rename, cp, rm } from 'node:fs/promises';
import {
  copySwapFallback,
  isRetriableFsError,
  renameWithWindowsRetry,
} from './fs-windows-retry';

const mockRename = vi.mocked(rename);
const mockCp = vi.mocked(cp);
const mockRm = vi.mocked(rm);

function errno(code: string) {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isRetriableFsError', () => {
  it('EPERM/EBUSY 可重试;ENOENT/EACCES/普通错误不可', () => {
    expect(isRetriableFsError(errno('EPERM'))).toBe(true);
    expect(isRetriableFsError(errno('EBUSY'))).toBe(true);
    expect(isRetriableFsError(errno('ENOENT'))).toBe(false);
    expect(isRetriableFsError(errno('EACCES'))).toBe(false);
    expect(isRetriableFsError(new Error('boom'))).toBe(false);
  });
});

describe('renameWithWindowsRetry', () => {
  it('EPERM 两次后成功:重试生效,共调 rename 3 次', async () => {
    mockRename
      .mockRejectedValueOnce(errno('EPERM'))
      .mockRejectedValueOnce(errno('EBUSY'))
      .mockResolvedValueOnce(undefined);
    await renameWithWindowsRetry('a', 'b', { attempts: 5, baseDelayMs: 1 });
    expect(mockRename).toHaveBeenCalledTimes(3);
  });

  it('重试穷尽仍 EPERM:上抛最后一次错误', async () => {
    mockRename.mockRejectedValue(errno('EPERM'));
    await expect(
      renameWithWindowsRetry('a', 'b', { attempts: 3, baseDelayMs: 1 }),
    ).rejects.toMatchObject({ code: 'EPERM' });
    expect(mockRename).toHaveBeenCalledTimes(3);
  });

  it('非重试错误(EACCES):立即上抛,不重试', async () => {
    mockRename.mockRejectedValue(errno('EACCES'));
    await expect(
      renameWithWindowsRetry('a', 'b', { attempts: 5, baseDelayMs: 1 }),
    ).rejects.toMatchObject({ code: 'EACCES' });
    expect(mockRename).toHaveBeenCalledTimes(1);
  });
});

describe('copySwapFallback', () => {
  it('先拷贝副本再删源;删源走 rm 内建重试参数', async () => {
    mockCp.mockResolvedValueOnce(undefined);
    mockRm.mockResolvedValueOnce(undefined);
    await copySwapFallback('src', 'dst', { attempts: 4, baseDelayMs: 7 });
    expect(mockCp).toHaveBeenCalledWith('src', 'dst', { recursive: true, force: true });
    expect(mockRm).toHaveBeenCalledWith('src', {
      recursive: true,
      force: true,
      maxRetries: 4,
      retryDelay: 7,
    });
  });

  it('删源失败:回滚副本(rm dst)并上抛原错误', async () => {
    mockCp.mockResolvedValueOnce(undefined);
    mockRm
      .mockRejectedValueOnce(errno('EPERM')) // rm src 失败
      .mockResolvedValueOnce(undefined); // 回滚 rm dst
    await expect(copySwapFallback('src', 'dst', { baseDelayMs: 1 })).rejects.toMatchObject({
      code: 'EPERM',
    });
    expect(mockRm).toHaveBeenNthCalledWith(2, 'dst', {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
});
