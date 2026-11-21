// 原子换入回滚回归(quality-security-review-20261121 #1 / P2):
// staging→dest 的 rename 重试穷尽 + copySwapFallback 兜底自身失败时,
// 必须回滚 retired→dest,保持"dest 任一时刻非空"不变式,并向调用方上抛。
//
// 隔离方式与 plugins.test 相同:BFF_PLUGINS_DIR 指向临时目录(动态 import 前设置);
// fs-windows-retry 部分 mock——renameWithWindowsRetry 可编程失败,copySwapFallback
// 可编程失败,isRetriableFsError 保持真实实现(回滚分支依赖其判定)。

import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../services/fs-windows-retry', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../services/fs-windows-retry')
  >();
  return {
    ...actual,
    renameWithWindowsRetry: vi.fn(),
    copySwapFallback: vi.fn(),
  };
});

import {
  copySwapFallback,
  renameWithWindowsRetry,
} from '../services/fs-windows-retry';

const mockRename = vi.mocked(renameWithWindowsRetry);
const mockCopySwap = vi.mocked(copySwapFallback);

let fixtureDir: string;
let actualRename: typeof renameWithWindowsRetry;

function errno(code: string) {
  return Object.assign(new Error(code), { code });
}

async function writeSource(id: string, marker: string) {
  const source = await mkdtemp(join(tmpdir(), 'agentui-swap-src-'));
  await mkdir(join(source, 'ui/dist'), { recursive: true });
  await writeFile(
    join(source, 'app.json'),
    JSON.stringify({
      id,
      path: `/${id}`,
      label: 'x',
      entry: 'ui/dist/index.js',
      backend: { type: 'proxy', target: 'http://127.0.0.1:9385' },
    }),
  );
  await writeFile(join(source, 'ui/dist/index.js'), marker);
  return source;
}

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'agentui-swap-test-'));
  process.env.BFF_PLUGINS_DIR = fixtureDir;
  process.env.BFF_PLUGIN_STATE_FILE = join(fixtureDir, 'plugin-state.json');
  process.env.BFF_PLUGIN_AUDIT_FILE = join(fixtureDir, 'plugin-audit.jsonl');
  process.env.BFF_PLUGIN_INSTALL_TOKEN = 'test-admin-token';
  await import('./plugins');
  const actual = await vi.importActual<
    typeof import('../services/fs-windows-retry')
  >('../services/fs-windows-retry');
  actualRename = actual.renameWithWindowsRetry;
  // 默认透传真实实现;失败场景在用例内逐调用覆写
  mockRename.mockImplementation(actual.renameWithWindowsRetry);
  mockCopySwap.mockImplementation(actual.copySwapFallback);
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
  delete process.env.BFF_PLUGINS_DIR;
  delete process.env.BFF_PLUGIN_STATE_FILE;
  delete process.env.BFF_PLUGIN_AUDIT_FILE;
  delete process.env.BFF_PLUGIN_INSTALL_TOKEN;
});

async function install(source: string) {
  const { pluginsRoutes } = await import('./plugins');
  return pluginsRoutes.request('/plugins/install', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Plugin-Admin-Token': 'test-admin-token',
    },
    body: JSON.stringify({ source }),
  });
}

describe('原子换入回滚(评审 P2 #1)', () => {
  it('兜底自身失败 → 回滚 retired→dest,dest 保持旧装,上抛 500', async () => {
    const id = 'swap-rb';
    const sourceV1 = await writeSource(id, 'export const v1 = 1');
    // 首装(真实实现)→ dest 存在旧装
    const res1 = await install(sourceV1);
    expect(res1.status).toBe(200);
    const destAppJson = join(fixtureDir, id, 'app.json');
    const oldJson = await readFile(destAppJson, 'utf-8');

    // 第二次安装:dest→retired 真实移动成功,staging→dest 强制 EPERM,
    // copySwapFallback 兜底也抛 EPERM → 触发回滚分支
    const sourceV2 = await writeSource(id, 'export const v2 = 2');
    mockRename.mockImplementationOnce((src, dest) => actualRename(src, dest));
    mockRename.mockImplementationOnce(async () => {
      throw errno('EPERM'); // staging→dest 失败
    });
    mockCopySwap.mockRejectedValueOnce(errno('EPERM'));

    const res2 = await install(sourceV2);
    expect(res2.status).toBe(500);

    // 不变式:dest 恢复为旧装
    expect(await readFile(destAppJson, 'utf-8')).toBe(oldJson);
    expect(await readFile(join(fixtureDir, id, 'ui/dist/index.js'), 'utf-8')).toBe(
      'export const v1 = 1',
    );
    // 瞬态目录清理:retired 已随回滚移回,staging 由 finally 清理
    const entries = await readdir(fixtureDir);
    expect(entries.filter((e) => e.startsWith(`.retired-${id}`))).toHaveLength(0);
    expect(entries.filter((e) => e.startsWith(`.staging-${id}`))).toHaveLength(0);

    await rm(sourceV1, { recursive: true, force: true });
    await rm(sourceV2, { recursive: true, force: true });
    mockRename.mockReset();
    mockCopySwap.mockReset();
  });
});
