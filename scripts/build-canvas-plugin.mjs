#!/usr/bin/env node
/**
 * canvas Tier B 插件产物装配(canvas-stage4-independent-build-spec.md §9.2):
 * 1. 在 packages/canvas-plugin 跑 vite lib 构建(单例外部化 + 多 chunk ESM
 *    + i18n JSON 发射);
 * 2. app.json + ui/ 装配进 deploy/plugin-bundles/canvas/ —— Dockerfile
 *    production 阶段叠加 COPY 进 /opt/bundled-plugins/,entrypoint 幂等安装。
 * 产物不入 git(.gitignore),镜像构建时生成;本地开发用 scripts/install-plugin.sh
 * 直接从仓库目录安装(免 deploy 目录中转)。
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'packages/canvas-plugin');
const outDir = join(pkgDir, 'ui/dist');
const bundleDir = join(root, 'deploy/plugin-bundles/canvas');

const build = spawnSync('npx', ['vite', 'build'], {
  cwd: pkgDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (build.status !== 0) {
  process.exitCode = build.status ?? 1;
  process.exit(process.exitCode);
}

for (const required of [
  join(outDir, 'index.js'),
  join(outDir, 'index.css'),
  join(pkgDir, 'ui/locales/zh.json'),
  join(pkgDir, 'ui/locales/en.json'),
]) {
  if (!existsSync(required)) {
    console.error(`[build-canvas-plugin] 产物缺失: ${required}`);
    process.exit(1);
  }
}

rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(bundleDir, { recursive: true });
cpSync(join(pkgDir, 'app.json'), join(bundleDir, 'app.json'));
cpSync(join(pkgDir, 'ui'), join(bundleDir, 'ui'), { recursive: true });

const sizeOf = (path) => {
  const s = statSync(path);
  return s.isDirectory()
    ? `${readdirSync(path).length} entries`
    : `${(s.size / 1024).toFixed(1)} KB`;
};
console.log('[build-canvas-plugin] 装配完成:');
for (const name of ['app.json', 'ui/dist/index.js', 'ui/dist/index.css', 'ui/locales']) {
  console.log(`  ${name}: ${sizeOf(join(bundleDir, name))}`);
}
