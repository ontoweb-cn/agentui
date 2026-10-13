/**
 * 运行时插件路由(PawAPP 式动态装载,参考 docs/cognitive-wargame-plugin-migration-design.md)。
 *
 * 路径映射(Vite proxy rewrite 去掉 /api/bff):
 *   前端 GET  /api/bff/plugins                      → BFF /plugins            列出已装插件元数据
 *   前端 GET  /api/bff/plugins/:id/files/*          → BFF /plugins/:id/files/* 静态产物(JS/CSS)
 *   前端 POST /api/bff/plugins/install              → BFF /plugins/install     从本地路径安装
 *   前端 DELETE /api/bff/plugins/:id                → BFF /plugins/:id         卸载
 *
 * 安装目录:bff/data/plugins/<id>/,内含 app.json 与 ui/ 产物子树。
 *
 * 安全模型(评审 H1/H2 修复):
 * - 列表/文件路由公开(插件产物不涉密,与 SPA 同源消费);
 * - install/delete 是变更面,必须携带 X-Plugin-Admin-Token 且与
 *   BFF_PLUGIN_INSTALL_TOKEN 环境变量一致;该 env 未设置时 fail-closed(403),
 *   避免「无门槛安装任意本地目录并对外提供下载」;
 * - 安装来源开关 BFF_PLUGIN_INSTALL_SOURCES(默认仅 local),git/zip 来源预留;
 * - entry/mount path 走白名单校验,阻断以 '..' 越出插件目录的拷贝与路由劫持
 *   (见 validateEntry/validateMountPath)。
 */
import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = resolve(__dirname, '../../data/plugins');

/** entry 顶层子目录白名单:插件产物只允许落在这些子树下。 */
const ENTRY_ROOT_ALLOWLIST = ['ui', 'assets', 'dist'];

/**
 * mount path 黑名单:与宿主既有路由冲突的路径禁止注册
 * (防止插件卡片/路由顶替登录页、admin、核心功能页)。
 */
const RESERVED_MOUNT_PATHS = new Set([
  '/',
  '/login',
  '/login-next',
  '/admin',
  '/wizard',
  '/applications',
  '/tasks',
  '/knowledge',
  '/memories',
  '/user-setting',
  '/document',
]);

interface PluginAppJson {
  id: string;
  name?: string;
  version?: string;
  path: string;
  label: string;
  description?: string;
  icon?: string;
  order?: number;
  entry: string;
  peer?: { react?: string };
}

const MIME_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

/**
 * 校验插件入口产物路径(H2):
 * - 必须是相对路径,段中不得含 '..',不得含反斜杠(防 Windows 分隔符混淆);
 * - 顶层子目录必须在白名单内,保证 cp 目标始终位于插件目录内。
 */
function validateEntry(entry: string): string | null {
  if (
    !entry ||
    entry.startsWith('/') ||
    entry.includes('\\') ||
    entry.split('/').includes('..')
  ) {
    return 'entry 必须是相对路径且不含 ".." 段';
  }
  const entryRoot = entry.split('/')[0];
  if (!ENTRY_ROOT_ALLOWLIST.includes(entryRoot)) {
    return `entry 顶层目录必须是 ${ENTRY_ROOT_ALLOWLIST.join('/')} 之一,当前为 "${entryRoot}"`;
  }
  return null;
}

/**
 * 校验挂载路径(H2/H3 纵深防御):
 * - 形态 ^/slug,slug 为字母数字与连字符,避免 '/'、参数段、编码穿越;
 * - 不得命中宿主保留路由。
 */
function validateMountPath(path: string): string | null {
  if (!/^\/[a-z0-9][a-z0-9-]*$/i.test(path)) {
    return 'path 必须形如 /<slug>(字母数字与连字符)';
  }
  if (RESERVED_MOUNT_PATHS.has(path.toLowerCase())) {
    return `path "${path}" 与宿主保留路由冲突`;
  }
  return null;
}

/** 变更接口鉴权(H1):常量时间比较,未配置 token 时一律拒绝。 */
function isAdminRequest(req: { header(name: string): string | undefined }): boolean {
  const expected = process.env.BFF_PLUGIN_INSTALL_TOKEN;
  if (!expected) {
    return false;
  }
  const provided = req.header('X-Plugin-Admin-Token') ?? '';
  if (provided.length !== expected.length) {
    return false;
  }
  // 粗粒度常量时间比较,避免本地计时侧信道
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function allowedInstallSources(): Set<string> {
  return new Set(
    (process.env.BFF_PLUGIN_INSTALL_SOURCES ?? 'local')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export const pluginsRoutes = new Hono();

/** 读取并校验单个插件目录的 app.json;缺失或校验不过均返回 null(列表层跳过)。 */
async function readPluginMeta(
  pluginDir: string,
): Promise<PluginAppJson | null> {
  const manifestPath = join(pluginDir, 'app.json');
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    const meta = JSON.parse(raw) as PluginAppJson;
    if (!meta?.id || !meta?.path || !meta?.entry || !meta?.label) {
      return null;
    }
    if (validateMountPath(meta.path) || validateEntry(meta.entry)) {
      return null;
    }
    if (/[^\w.-]/.test(meta.id)) {
      return null;
    }
    return meta;
  } catch {
    return null;
  }
}

pluginsRoutes.get('/plugins', async (c) => {
  if (!existsSync(PLUGINS_DIR)) {
    return c.json([]);
  }
  const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });
  const metas: PluginAppJson[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const meta = await readPluginMeta(join(PLUGINS_DIR, entry.name));
    if (meta) metas.push(meta);
  }
  return c.json(metas);
});

pluginsRoutes.get('/plugins/:id/files/*', async (c) => {
  const id = c.req.param('id');
  if (/[^\w.-]/.test(id)) {
    return c.text('Forbidden', 403);
  }
  const rest = c.req.path.replace(/^\/plugins\/[^/]+\/files\//, '');
  // 路径穿越防护:解析后必须仍在该插件目录内
  const pluginRoot = resolve(PLUGINS_DIR, id);
  const target = resolve(pluginRoot, rest);
  if (!target.startsWith(`${pluginRoot}${sep}`)) {
    return c.text('Forbidden', 403);
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) {
      return c.text('Not Found', 404);
    }
  } catch {
    return c.text('Not Found', 404);
  }
  const ext = target.slice(target.lastIndexOf('.'));
  const body = await readFile(target);
  c.header(
    'Content-Type',
    MIME_TYPES[ext] ?? 'application/octet-stream',
  );
  // 产物按内容寻址前不可变缓存;开发环境保守禁缓存
  c.header('Cache-Control', 'no-cache');
  return c.body(new Uint8Array(body));
});

pluginsRoutes.post('/plugins/install', async (c) => {
  if (!isAdminRequest(c.req)) {
    return c.text('Forbidden: 需要有效的 X-Plugin-Admin-Token', 403);
  }
  if (!allowedInstallSources().has('local')) {
    return c.text('本地路径安装已被 BFF_PLUGIN_INSTALL_SOURCES 禁用', 403);
  }
  const body = await c.req.json<{ source?: string }>().catch(() => null);
  const source = body?.source;
  if (!source || !resolve(source).startsWith('/')) {
    return c.text('source 必须是绝对本地路径', 400);
  }
  const meta = await readPluginMeta(source);
  if (!meta) {
    return c.text(
      'source 目录缺少合法 app.json(id/path/label/entry 缺失或校验不过)',
      400,
    );
  }
  const sourceEntry = join(source, meta.entry);
  if (!existsSync(sourceEntry)) {
    return c.text(`entry 产物不存在: ${meta.entry}(先构建插件)`, 400);
  }

  const dest = join(PLUGINS_DIR, meta.id);
  // 原子性:先拷到临时目录,成功后整体换入,失败不残留半成品
  const staging = join(PLUGINS_DIR, `.staging-${meta.id}`);
  await rm(staging, { recursive: true, force: true });
  await rm(dest, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await cp(join(source, 'app.json'), join(staging, 'app.json'));
    const entryRoot = meta.entry.split('/')[0];
    await cp(join(source, entryRoot), join(staging, entryRoot), {
      recursive: true,
    });
    await mkdir(dirname(dest), { recursive: true });
    await cp(staging, dest, { recursive: true });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  return c.json({ installed: meta.id, version: meta.version ?? null });
});

pluginsRoutes.delete('/plugins/:id', async (c) => {
  if (!isAdminRequest(c.req)) {
    return c.text('Forbidden: 需要有效的 X-Plugin-Admin-Token', 403);
  }
  const id = c.req.param('id');
  if (/[^\w.-]/.test(id)) {
    return c.text('Forbidden', 403);
  }
  const dest = resolve(PLUGINS_DIR, id);
  if (!dest.startsWith(`${PLUGINS_DIR}${sep}`)) {
    return c.text('Forbidden', 403);
  }
  if (!existsSync(dest)) {
    return c.text('Not Found', 404);
  }
  await rm(dest, { recursive: true, force: true });
  return c.json({ removed: id });
});
