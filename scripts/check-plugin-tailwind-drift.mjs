#!/usr/bin/env node
/**
 * 插件 Tailwind 主题令牌漂移哨兵(中期评审 #14 的触发器,2026-10-14)。
 *
 * 自包含插件形态下,主题令牌靠拷贝同步(插件 tailwind config 是宿主的副本)
 * ——漂移会使插件在暗色/语义色上与宿主不一致。本脚本对比两侧「映射到 CSS
 * 变量的令牌键集合」(colors 等 `'x': 'var(--...)'` 形态,即最易漂移的主题
 * 令牌面),diff 非空即退出码 1。
 *
 * 用法:
 *   node scripts/check-plugin-tailwind-drift.mjs [--plugin <config路径>] [--host <config路径>]
 * 默认 host=./tailwind.config.js,plugin 依次探测
 * ../cognitive-wargame/web/agentui、../cognitive-wargame/web/qwenpaw。
 * 建议接入插件仓库 CI 与宿主 CI。
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function extractVarTokenKeys(configPath) {
  const source = readFileSync(configPath, 'utf-8');
  const keys = new Set();
  const re = /'([^']+)'\s*:\s*'var\(--[^']+\)'/g;
  let m;
  while ((m = re.exec(source))) {
    keys.add(m[1]);
  }
  return keys;
}

const hostPath = path.resolve(argValue('--host') ?? 'tailwind.config.js');
const pluginCandidates = [
  argValue('--plugin'),
  '../cognitive-wargame/web/agentui/tailwind.config.cjs',
  '../cognitive-wargame/web/agentui/tailwind.config.js',
  '../cognitive-wargame/web/qwenpaw/tailwind.config.cjs',
  '../cognitive-wargame/web/qwenpaw/tailwind.config.js',
].filter(Boolean);
const pluginPath = pluginCandidates.map((p) => path.resolve(p)).find((p) => existsSync(p));

if (!existsSync(hostPath)) {
  console.error(`[tailwind-drift] 宿主配置不存在: ${hostPath}`);
  process.exit(2);
}
if (!pluginPath) {
  console.error(
    '[tailwind-drift] 未找到插件 tailwind 配置(可用 --plugin 指定);跳过对比(退出 0)',
  );
  process.exit(0);
}

const hostTokens = extractVarTokenKeys(hostPath);
const pluginTokens = extractVarTokenKeys(pluginPath);
const missingInPlugin = [...hostTokens].filter((k) => !pluginTokens.has(k)).sort();
const extraInPlugin = [...pluginTokens].filter((k) => !hostTokens.has(k)).sort();

console.log(
  `[tailwind-drift] host=${hostPath} (${hostTokens.size} 令牌) | plugin=${pluginPath} (${pluginTokens.size} 令牌)`,
);
if (missingInPlugin.length === 0 && extraInPlugin.length === 0) {
  console.log('[tailwind-drift] ✅ 令牌零漂移');
  process.exit(0);
}
if (missingInPlugin.length > 0) {
  console.error(`[tailwind-drift] ❌ 插件缺失宿主令牌 ${missingInPlugin.length} 个:\n  ${missingInPlugin.join('\n  ')}`);
}
if (extraInPlugin.length > 0) {
  console.error(`[tailwind-drift] ⚠️ 插件多出令牌 ${extraInPlugin.length} 个(需评估是否回灌宿主):\n  ${extraInPlugin.join('\n  ')}`);
}
process.exit(1);
