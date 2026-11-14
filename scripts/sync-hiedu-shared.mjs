#!/usr/bin/env node
// hiedu shared 层同步脚本(仅本地开发命令)。
// 源:intellect-auth 仓 hiedu/web/src/shared(同级 checkout,可用 HIEDU_SHARED_SRC 覆盖)。
// 产物:src/services/hiedu/shared/ 快照 + manifest.json(逐文件 SHA256 + SHARED_VERSION + 源 commit)。
// CI 侧用 check-hiedu-shared.mjs 校验「快照 vs manifest」一致性(单仓可执行);
// 跨仓新鲜度(源仓更新后未同步)由夜间对账作业兜底——见 intellect-auth docs/hiedu-web与AgentUI复用-方案分析.md §8.1。

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const srcDir = process.env.HIEDU_SHARED_SRC
  ? path.resolve(process.env.HIEDU_SHARED_SRC)
  : path.resolve(repoRoot, '..', 'intellect-auth', 'hiedu', 'web', 'src', 'shared');
const destDir = path.resolve(repoRoot, 'src', 'services', 'hiedu', 'shared');

// 自指守卫(评审 R2):源=快照目录时,rmSync 会先删源再崩,清空快照。
{
  const rel = path.relative(destDir, srcDir);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    console.error(`[sync-hiedu-shared] 源目录不能位于快照目录内: ${srcDir}`);
    process.exit(1);
  }
}

if (!existsSync(srcDir)) {
  console.error(
    `[sync-hiedu-shared] 源目录不存在: ${srcDir}\n` +
      '请确认 intellect-auth 与 agentui 为同级 checkout,或设置 HIEDU_SHARED_SRC 指向 hiedu/web/src/shared。',
  );
  process.exit(1);
}

const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts') && f !== 'manifest.json');
if (files.length === 0) {
  console.error(`[sync-hiedu-shared] 源目录无 .ts 文件: ${srcDir}`);
  process.exit(1);
}

// 快照目录整体替换,防止删除源文件后残留旧副本。
rmSync(destDir, { recursive: true, force: true });
mkdirSync(destDir, { recursive: true });

const manifest = { version: '', sourceCommit: '', syncedAt: new Date().toISOString(), files: {} };
for (const file of files) {
  const content = readFileSync(path.join(srcDir, file));
  writeFileSync(path.join(destDir, file), content);
  manifest.files[file] = createHash('sha256').update(content).digest('hex');
  if (file === 'version.ts') {
    const m = /SHARED_VERSION = '([^']+)'/.exec(content.toString());
    if (m) manifest.version = m[1];
  }
}

try {
  manifest.sourceCommit = execSync('git rev-parse --short HEAD', { cwd: path.dirname(srcDir) })
    .toString()
    .trim();
} catch {
  manifest.sourceCommit = 'unknown';
}

writeFileSync(path.join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `[sync-hiedu-shared] 已同步 ${files.length} 个文件(shared@${manifest.version}, 源 ${manifest.sourceCommit}) → ${path.relative(repoRoot, destDir)}`,
);
