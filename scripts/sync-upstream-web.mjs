#!/usr/bin/env node
/**
 * T3.6 上游子树同步机制(定案:archive + rsync 对比,非 git subtree 根前缀)。
 *
 * 用法:
 *   node scripts/sync-upstream-web.mjs --dry-run
 *   node scripts/sync-upstream-web.mjs --apply
 *   node scripts/sync-upstream-web.mjs --apply --prune-deletes   # 显式允许删除本仓有、上游无的文件
 *
 * 前置:
 *   git remote get-url upstream   # 需指向 RAGFlow / 上游 web 仓库
 *   git fetch upstream
 *
 * 行为:
 *   1. `git archive upstream/main web` 解压到临时目录(若上游无 web/ 前缀则用 `.`)
 *   2. rsync 对比写入本仓 `src/`(默认**不** --delete;见 --prune-deletes)
 *   3. --apply 时写入工作树,不自动 commit;冲突由人工解决后提交
 *
 * 安全约定(评审加固):
 *   - 永不覆盖 ee/、鉴权/请求层、i18n overlay 装载链等本仓常驻差异面
 *   - --delete 默认关闭,避免误删本仓独有守卫文件
 *   - 合入前必须 git diff + 人工/安全审阅
 *
 * 节奏:建议每月一次。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const pruneDeletes = args.has('--prune-deletes');
// --apply 且未同时带 --dry-run 才真正写入;单独 --dry-run 或默认均为演练。
const dryRun = !apply || args.has('--dry-run');

const ROOT = new URL('..', import.meta.url).pathname;

/** 本仓常驻差异 / 安全敏感路径:同步时永不覆盖或删除。 */
const EXCLUDES = [
  'ee/',
  // i18n:共享语言包可 cherry-pick 时手工处理;装载链与 overlay 不可被上游冲掉
  'locales/config.ts',
  'locales/en.ts',
  'locales/zh.ts',
  // 鉴权与 HTTP 层
  'utils/next-request.ts',
  'utils/request.ts',
  'utils/authorization-util.ts',
  'utils/enterprise-session.ts',
  'utils/notification.ts',
  // 注册与路由挂载(ee 入口)
  'features/_registry.ts',
  'routes.tsx',
  'main.tsx',
];

function sh(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

function main() {
  console.log(
    `[sync-upstream-web] mode=${apply && !dryRun ? 'apply' : 'dry-run'}` +
      ` prune-deletes=${pruneDeletes ? 'on' : 'off'}`,
  );
  if (pruneDeletes && !apply) {
    console.warn(
      '提示:--prune-deletes 仅在 --apply 时生效;当前为 dry-run,只会预览删除。',
    );
  }

  let remotes = '';
  try {
    remotes = sh('git', ['remote']);
  } catch {
    console.error('git remote failed');
    process.exit(1);
  }
  if (!remotes.split('\n').includes('upstream')) {
    console.error(
      '缺少 remote `upstream`。请先: git remote add upstream <ragflow-or-web-url>',
    );
    process.exit(2);
  }

  console.log('fetch upstream…');
  try {
    sh('git', ['fetch', 'upstream', '--prune']);
  } catch (e) {
    console.error('git fetch upstream 失败:', e.stderr || e.message);
    process.exit(3);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'agentui-upstream-'));
  const archivePath = join(tmp, 'web.tar');
  const extractDir = join(tmp, 'extract');
  mkdirSync(extractDir);

  // 优先 archive `web` 子树;失败则 archive 整棵 main(兼容上游即 web 根)。
  let prefix = 'web';
  try {
    sh('git', [
      'archive',
      '--format=tar',
      '--output',
      archivePath,
      'upstream/main',
      'web',
    ]);
  } catch {
    prefix = '.';
    console.warn('upstream/main 无 web/ 前缀,改 archive 仓库根');
    sh('git', [
      'archive',
      '--format=tar',
      '--output',
      archivePath,
      'upstream/main',
    ]);
  }

  sh('tar', ['-xf', archivePath, '-C', extractDir]);
  const srcDir = prefix === 'web' ? join(extractDir, 'web') : extractDir;
  if (!existsSync(srcDir)) {
    console.error('解压后找不到源目录', srcDir);
    process.exit(4);
  }

  const rsyncArgs = [
    '-a',
    dryRun ? '--dry-run' : '',
    // 评审加固:默认不 --delete;需显式 --prune-deletes
    pruneDeletes ? '--delete' : '',
    '--itemize-changes',
    ...EXCLUDES.flatMap((e) => ['--exclude', e]),
    '--exclude',
    '.git/',
    `${srcDir}/`,
    join(ROOT, 'src') + '/',
  ].filter(Boolean);

  console.log('rsync', rsyncArgs.join(' '));
  const result = spawnSync('rsync', rsyncArgs, {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    console.error('rsync failed', result.status);
    rmSync(tmp, { recursive: true, force: true });
    process.exit(result.status || 5);
  }

  rmSync(tmp, { recursive: true, force: true });
  if (apply && !dryRun) {
    console.log(
      '已写入工作树。请 git diff 人工审阅(含安全敏感路径)后再提交。' +
        ' ee/、locales/config、鉴权/请求层未被覆盖。' +
        (pruneDeletes
          ? ' 已启用 --prune-deletes:请重点核对删除项。'
          : ' 未启用删除;上游已删文件需人工清理。'),
    );
  } else {
    console.log(
      'dry-run 完成。确认后: node scripts/sync-upstream-web.mjs --apply' +
        ' [可选 --prune-deletes]。每月建议执行一次。',
    );
  }
}

main();
