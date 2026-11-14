#!/usr/bin/env node
// hiedu shared 层漂移门禁:校验 src/services/hiedu/shared/ 快照与 manifest.json 的
// SHA256 一致。任何对快照的手工改动都会使校验失败——必须回退手改,或在源仓
// (intellect-auth hiedu/web/src/shared)修改后重跑 sync-hiedu-shared.mjs。
// 单仓可执行(不依赖同级 checkout);禁止静默跳过(评审 §8.1)。

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
