#!/usr/bin/env node
// hiedu shared 层漂移门禁:校验 src/services/hiedu/shared/ 快照与 manifest.json 的
// SHA256 一致。快照被手工改动而未重跑 sync-hiedu-shared.mjs 即失败;若文件与
// manifest 被同时改动则本门禁不可见(以 PR 评审 + 夜间跨仓对账兜底,见复用方案 §8.1)。
// 单仓可执行(不依赖同级 checkout);禁止静默跳过。

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const dir = path.resolve(repoRoot, 'src', 'services', 'hiedu', 'shared');
const manifestPath = path.join(dir, 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error('[check-hiedu-shared] manifest.json 缺失:请运行 npm run sync:hiedu-shared');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!manifest || typeof manifest.files !== 'object' || manifest.files === null) {
  console.error('[check-hiedu-shared] manifest.json 缺少 files 键(损坏?请重跑 sync:hiedu-shared)');
  process.exit(1);
}
const errors = [];
const seen = new Set();

for (const [file, expected] of Object.entries(manifest.files)) {
  seen.add(file);
  const p = path.join(dir, file);
  if (!existsSync(p)) {
    errors.push(`缺失: ${file}`);
    continue;
  }
  const actual = createHash('sha256').update(readFileSync(p)).digest('hex');
  if (actual !== expected) {
    errors.push(`内容漂移: ${file}(手工改动?请以源仓为准重跑 sync:hiedu-shared)`);
  }
}
for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
  if (!seen.has(file)) errors.push(`快照多出未登记文件: ${file}(重跑 sync:hiedu-shared 刷新 manifest)`);
}

if (errors.length > 0) {
  console.error(`[check-hiedu-shared] hiedu shared 快照不一致(shared@${manifest.version}):\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`[check-hiedu-shared] 快照与 manifest 一致(shared@${manifest.version}, ${seen.size} 文件)`);
