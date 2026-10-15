/**
 * 自包含边界守卫(docs/plugin-development-guide.md §4):
 * 产物自包含的前提是源码零"计划外裸导入"——所有 bare import 必须声明在
 * package.json dependencies(@agentui/plugin-sdk 类型/helper 允许,打包为
 * 零运行时代价)。CI 执行,违规即红。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const allowed = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
  '@agentui/plugin-sdk',
]);

const BARE_IMPORT_RE = /(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      entries.push(...walk(full));
    } else if (/\.(tsx?|mjs|jsx)$/.test(name)) {
      entries.push(full);
    }
  }
  return entries;
}

const violations = [];
for (const file of walk(join(root, 'src'))) {
  const source = readFileSync(file, 'utf-8');
  for (const match of source.matchAll(BARE_IMPORT_RE)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (!spec || spec.startsWith('.') || spec.startsWith('/')) {
      continue; // 相对导入:打包内解析
    }
    const bare = spec.startsWith('@')
      ? spec.split('/').slice(0, 2).join('/')
      : spec.split('/')[0];
    if (!allowed.has(bare)) {
      violations.push(`${file}: '${spec}'(未声明依赖 '${bare}')`);
    }
  }
}

if (violations.length > 0) {
  console.error('外部导入边界违规(裸导入未声明依赖,产物无法自包含):');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('外部导入边界检查通过');
