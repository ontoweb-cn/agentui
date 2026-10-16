/**
 * 运行时插件路由(PawAPP 式动态装载,参考 docs/cognitive-wargame-plugin-migration-design.md)。
 *
 * 路径映射(Vite proxy rewrite 去掉 /api/bff):
 *   前端 GET  /api/bff/plugins                      → BFF /plugins            列出已装插件元数据(仅 enabled)
 *   前端 GET  /api/bff/plugins/:id/files/*          → BFF /plugins/:id/files/* 静态产物(JS/CSS)
 *   前端 POST /api/bff/plugins/install              → BFF /plugins/install     从本地路径安装
 *   前端 POST /api/bff/plugins/:id/{enable,disable} → BFF /plugins/:id/{enable,disable} 启停(不动文件)
 *   前端 DELETE /api/bff/plugins/:id                → BFF /plugins/:id         卸载
 *
 * chat 能力路由(/plugins/:id/chat/*)在 plugins-chat.ts(含守卫链与
 * capabilities 门控);启停状态与审计存储在 services/plugin-store.ts。
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
import { Hono, type Context } from 'hono';
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

import { fileURLToPath } from 'node:url';

import {
  appendPluginAudit,
  isPluginDisabled,
  PLUGINS_DIR,
  readPluginState,
  writePluginState,
} from '../services/plugin-store';

const __dirname = dirname(fileURLToPath(import.meta.url));

// zip 上传通道防护上限(spec §9.5):制品 ≤100MB、条目 ≤4000、
// 解压总量 ≤512MB(admin token 守卫下的纵深防御,非安全边界)。
const MAX_ZIP_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 4000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

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
  labelKey?: string;
  description?: string;
  descriptionKey?: string;
  icon?: string;
  order?: number;
  entry: string;
  peer?: { react?: string };
  /**
   * 插件开发依据的宿主 API 版本区间(如 '^1.3.0';第三方生态兼容策略,
   * 语义见 @agentui/plugin-sdk satisfiesApiVersion)。缺省视为任意版本;
   * 格式非法在安装侧拒绝(此处),区间不满足由宿主装载侧标记不兼容
   * (卡片可见+明确原因)——格式与语义双端分工,避免判定漂移。
   */
  apiVersion?: string;
  /** 词条产物声明(#7):列表接口读取并内联下发,宿主 i18n init 后注入。 */
  i18n?: { files: Record<string, string> };
  /**
   * 插件后端声明(#5):type=proxy 时 BFF 提供 /plugins/:id/proxy/* 流式透传
   * (SSE 友好)。target 默认回环,可经 app.json 覆盖。
   */
  backend?: { type: 'proxy'; target: string };
  /**
   * 能力声明(chat SDK,docs/chat-sse-sdk-design.md):插件运行时消费宿主
   * 能力的显式清单。chat 路由逐请求校验,未声明 403——运维门控(额度消费
   * 显式清单)而非安全边界(同源信任模型)。未知值容忍(前向兼容)。
   */
  capabilities?: string[];
  /**
   * 插件档位(canvas-stage4 spec §9.2):'host' = Tier B 共享面插件
   * (路由并入宿主 registry);缺省/'app' = Tier A 窄面自包含。
   * 未知值在安装侧拒绝(格式硬校验);运行时侧对未知值按 'app' 容忍
   * (前向兼容,双端分工同 apiVersion)。
   */
  type?: 'app' | 'host';
  /**
   * Tier B 共享面契约版本区间(如 '^1.1.0'),格式校验同 apiVersion;
   * 语义判定(区间是否满足宿主 SHARED_API_VERSION)在宿主装载侧。
   */
  sharedVersion?: string;
  /**
   * Tier B 声明式路由表:注册期免拉 bundle 的路由清单,每条必须落在
   * path 前缀下(运行时注册侧复核,本侧做格式与前缀硬校验)。
   */
  routes?: string[];
  /** Tier B CSS 产物路径(校验规则同 entry;宿主装载时幂等注入 <link>)。 */
  style?: string;
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
export function validateEntry(entry: string): string | null {
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
export function validateMountPath(path: string): string | null {
  if (!/^\/[a-z0-9][a-z0-9-]*$/i.test(path)) {
    return 'path 必须形如 /<slug>(字母数字与连字符)';
  }
  if (RESERVED_MOUNT_PATHS.has(path.toLowerCase())) {
    return `path "${path}" 与宿主保留路由冲突`;
  }
  return null;
}

/**
 * 校验插件后端代理目标(评审 M1/SSRF 纵深防御),两个信任级别:
 *
 * 严格级(插件 app.json 声明的 target,不受控输入):仅允许
 * 回环(localhost/127.0.0.0/8/::1)与 RFC1918 私网段——拒绝公网地址、
 * 链路本地段(如 169.254.169.254 云元数据)以及一切 DNS 主机名
 * (无法静态判断解析结果)。
 *
 * 宽松级(部署者经 BFF_PLUGIN_BACKEND_OVERRIDES 显式声明的 target,
 * 受控输入):容器/k8s 网络中后端是服务名或 host.docker.internal,
 * 只做结构与协议校验——部署者为自己的 env 负责,且 BFF 仅绑定容器内
 * 回环,代理入口不对外。
 */
export function validateBackendTarget(
  target: string,
  opts: { fromOverride?: boolean } = {},
): string | null {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return 'backend.target 不是合法 URL';
  }
  if (!/^https?:$/.test(url.protocol)) {
    return 'backend.target 仅支持 http(s)';
  }
  if (opts.fromOverride) {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    const isLoopback = a === 127;
    const isPrivate =
      a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
    if (isLoopback || isPrivate) {
      return null;
    }
    return `backend.target 主机 ${host} 非回环/私网地址`;
  }
  if (host === 'localhost' || host === '::1') {
    return null;
  }
  return `backend.target 主机 ${host} 非回环/私网地址(且非 localhost)`;
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

/**
 * 解析 BFF_PLUGIN_BACKEND_OVERRIDES(#2b 部署形态):
 * 形如 "cognitive-wargame=http://wargamesrv:9385,other=http://10.0.0.2:9000"。
 * 仅在 install 时应用并重过 SSRF 校验(见 install handler)。
 */
export function parseBackendOverrides(): Map<string, string> {
  const raw = process.env.BFF_PLUGIN_BACKEND_OVERRIDES;
  const map = new Map<string, string>();
  if (!raw) {
    return map;
  }
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const id = pair.slice(0, eq).trim();
    const target = pair.slice(eq + 1).trim();
    if (id && target) {
      map.set(id, target);
    }
  }
  return map;
}

export const pluginsRoutes = new Hono();

/** 单语言词条内联上限,超限跳过并告警(词条应精简或拆分)。 */
const I18N_INLINE_LIMIT = 200 * 1024;

/**
 * 把插件声明的词条产物内联进元数据(#7):
 * 宿主在 i18n init 后同步注入,插件 JS 未装载时卡片文案即可本地化。
 * 读取失败/超限时静默跳过(卡片回退 app.json 的 label 字面值)。
 */
async function inlineI18nResources(
  pluginDir: string,
  meta: PluginAppJson,
): Promise<void> {
  if (!meta.i18n?.files) {
    return;
  }
  const resources: Record<string, unknown> = {};
  for (const [lang, relPath] of Object.entries(meta.i18n.files)) {
    if (!/^[\w-]+$/.test(lang) || !/^[\w./-]+$/.test(relPath)) {
      continue;
    }
    const file = resolve(pluginDir, relPath);
    if (!file.startsWith(`${resolve(pluginDir)}${sep}`)) {
      continue;
    }
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > I18N_INLINE_LIMIT) {
        if (info.isFile()) {
          console.warn(
            `[plugins] ${meta.id} 词条 ${lang} 超过 ${I18N_INLINE_LIMIT}B,跳过内联`,
          );
        }
        continue;
      }
      resources[lang] = JSON.parse(await readFile(file, 'utf-8'));
    } catch {
      // 词条缺失不阻塞插件注册
    }
  }
  if (Object.keys(resources).length > 0) {
    (meta as PluginAppJson & { i18nResources?: Record<string, unknown> })
      .i18nResources = resources;
  }
}

/**
 * apiVersion 区间格式硬校验(安装/列表双侧生效):支持 `*`、`^1.2.3`、
 * `~1.2.3`、`>=1.2`、`>1`、`=1.2.3`、裸 `1.2.3`(按 >= 语义)。
 * 正则与 @agentui/plugin-sdk parseApiVersionRange 保持同构(该包负责
 * 语义判定,本侧只拦格式非法——双端分工见 PluginAppJson.apiVersion 注释)。
 */
export function isValidApiVersionRange(range: unknown): range is string {
  if (typeof range !== 'string') {
    return false;
  }
  const trimmed = range.trim();
  return (
    trimmed === '*' ||
    /^(\^|~|>=|>|=)?\s*\d+(?:\.\d+){0,2}$/.test(trimmed)
  );
}

/**
 * zip 条目名合法性(zip-slip 防护,spec §9.5):绝对路径、反斜杠
 * (Windows 分隔符混淆)、'..' 段一律拒收。adm-zip 的 addFile 会规范化
 * 条目名,但解析外部制品时保留原始名——防护必须在解析侧生效。
 */
export function validateZipEntryName(name: string): string | null {
  if (
    name.startsWith('/') ||
    name.includes('\\') ||
    name.split('/').includes('..')
  ) {
    return `zip 条目路径非法: ${name.slice(0, 100)}`;
  }
  return null;
}

/** 读取并校验单个插件目录的 app.json;缺失或校验不过均返回 null(列表层跳过)。 */
export async function readPluginMeta(
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
    if (meta.backend && validateBackendTarget(meta.backend.target)) {
      return null;
    }
    if (/[^\w.-]/.test(meta.id)) {
      return null;
    }
    if (meta.apiVersion !== undefined && !isValidApiVersionRange(meta.apiVersion)) {
      return null;
    }
    if (
      meta.type !== undefined &&
      meta.type !== 'app' &&
      meta.type !== 'host'
    ) {
      return null;
    }
    if (
      meta.sharedVersion !== undefined &&
      !isValidApiVersionRange(meta.sharedVersion)
    ) {
      return null;
    }
    if (meta.style !== undefined && validateEntry(meta.style)) {
      return null;
    }
    if (meta.routes !== undefined) {
      if (
        !Array.isArray(meta.routes) ||
        meta.routes.length === 0 ||
        meta.routes.length > 20 ||
        meta.routes.some(
          (route) =>
            typeof route !== 'string' ||
            !route.startsWith('/') ||
            route.split('/').includes('..') ||
            !(route === meta.path || route.startsWith(`${meta.path}/`)),
        )
      ) {
        return null;
      }
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
  // 启停过滤(#16):disabled 的插件不进列表——卡片/路由/词条随宿主下次
  // 加载整体消失;产物目录保留,enable 即恢复。
  const { states } = await readPluginState();
  const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });
  const metas: PluginAppJson[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const meta = await readPluginMeta(join(PLUGINS_DIR, entry.name));
    if (!meta) continue;
    if (states[meta.id]?.enabled === false) continue;
    await inlineI18nResources(join(PLUGINS_DIR, entry.name), meta);
    metas.push(meta);
  }
  return c.json(metas);
});

pluginsRoutes.get('/plugins/:id/files/*', async (c) => {
  const id = c.req.param('id');
  if (/[^\w.-]/.test(id)) {
    return c.text('Forbidden', 403);
  }
  // 启停门控(评审 P1):disabled 插件的产物不可下载(kill switch 关数据面)
  if (await isPluginDisabled(id)) {
    return c.text('Not Found', 404);
  }
  const rest = c.req.path.replace(/^\/plugins\/[^/]+\/files\//, '');
  // 路径穿越防护:解析后必须仍在该插件目录内
  const pluginRoot = resolve(PLUGINS_DIR, id);
  const target = resolve(pluginRoot, rest);
  if (!target.startsWith(`${pluginRoot}${sep}`)) {
    return c.text('Forbidden', 403);
  }
  let info;
  try {
    info = await stat(target);
    if (!info.isFile()) {
      return c.text('Not Found', 404);
    }
  } catch {
    return c.text('Not Found', 404);
  }

  // ETag/304(#8):产物重装后 mtime/size 变化即失效;命中省去 5MB 重传
  const etag = `"${info.size}-${Math.round(info.mtimeMs)}"`;
  // ETag 头先于 304 判断设置,确保 304 响应也携带 ETag(评审 L1,RFC 建议)
  c.header('ETag', etag);
  if (c.req.header('If-None-Match') === etag) {
    return c.newResponse(null, 304);
  }

  const ext = target.slice(target.lastIndexOf('.'));
  c.header('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
  // hash 文件名方案(#2b 部署形态)落地前保守禁缓存,靠 ETag 协商
  c.header('Cache-Control', 'no-cache');
  // 流式响应(#8):大产物(约 5MB)不再整读进内存
  const stream = Readable.toWeb(
    createReadStream(target),
  ) as ReadableStream<Uint8Array>;
  return c.body(stream);
});

/**
 * 从本地目录安装插件的共享流程(local 与 zip 两通道复用):
 * 元数据校验 → entry 存在性 → backend override 叠加 → 原子换入 PLUGINS_DIR。
 */
async function installPluginFromDirectory(
  c: Context,
  source: string,
  auditSource: string,
): Promise<Response> {
  const meta = await readPluginMeta(source);
  if (!meta) {
    // 针对性诊断(install 是一次性交互,重读 raw 安全):app.json 可解析且
    // 唯一失效点是 apiVersion/sharedVersion 格式时,给出可自助修复的明确
    // 指引;其余情形保持既有笼统文案(不向调用方枚举校验器内部细节)
    try {
      const raw = JSON.parse(
        await readFile(join(source, 'app.json'), 'utf-8'),
      ) as { apiVersion?: unknown; sharedVersion?: unknown };
      for (const [field, value] of [
        ['apiVersion', raw?.apiVersion],
        ['sharedVersion', raw?.sharedVersion],
      ] as const) {
        if (value !== undefined && !isValidApiVersionRange(value)) {
          return c.text(
            `app.json ${field} 格式非法: ${String(value)}(支持 *、^1.3.0、~1.3、>=1.3、=1.3.0、裸版本)`,
            400,
          );
        }
      }
    } catch {
      // app.json 缺失/坏 JSON:走下方既有文案
    }
    return c.text(
      'source 目录缺少合法 app.json(id/path/label/entry 缺失或校验不过)',
      400,
    );
  }
  const sourceEntry = join(source, meta.entry);
  if (!existsSync(sourceEntry)) {
    return c.text(`entry 产物不存在: ${meta.entry}(先构建插件)`, 400);
  }

  // 部署形态 #2b:backend.target 覆盖采用「运行时叠加」语义:
  // - 落盘 app.json 始终保留插件原始声明(readPluginMeta 对其走严格
  //   IP 白名单,不受控文件不可被注入主机名);
  // - override 来自部署者 env(受控输入,宽松级校验,允许服务名/
  //   host.docker.internal),由代理路由每请求叠加(effectiveTarget),
  //   改 env 重启即生效,无需重装插件。
  const override = parseBackendOverrides().get(meta.id);
  if (override) {
    const overrideError = validateBackendTarget(override, {
      fromOverride: true,
    });
    if (overrideError) {
      return c.text(
        `BFF_PLUGIN_BACKEND_OVERRIDES 中 ${meta.id} 的 target 非法: ${overrideError}`,
        400,
      );
    }
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

  // install ≠ enable(#16):重装只刷新产物,不触碰 plugin-state.json——
  // 对 disabled 插件重装后仍是 disabled(entrypoint 重装同理,状态存活)。
  await appendPluginAudit({
    action: 'install',
    pluginId: meta.id,
    version: meta.version ?? null,
    source: auditSource,
  });

  return c.json({
    installed: meta.id,
    version: meta.version ?? null,
    backendTargetOverride: override ?? null,
  });
}

pluginsRoutes.post('/plugins/install', async (c) => {
  if (!isAdminRequest(c.req)) {
    return c.text('Forbidden: 需要有效的 X-Plugin-Admin-Token', 403);
  }
  const contentType = c.req.header('content-type') ?? '';

  // ---- zip 上传通道(E 批次,canvas-stage4 spec §9.5):multipart form-data,
  // 字段 file=制品 zip,可选 expectedSha256=发布方随行哈希做端到端校验。
  // 默认停用(BFF_PLUGIN_INSTALL_SOURCES 含 'zip' 才开),不改变存量部署姿态。
  if (contentType.includes('multipart/form-data')) {
    if (!allowedInstallSources().has('zip')) {
      return c.text('zip 上传安装已被 BFF_PLUGIN_INSTALL_SOURCES 禁用', 403);
    }
    const declaredSize = Number(c.req.header('content-length') ?? '0');
    if (declaredSize > MAX_ZIP_UPLOAD_BYTES) {
      return c.text(`zip 制品超过上限 ${MAX_ZIP_UPLOAD_BYTES}B`, 413);
    }
    const body = await c.req.parseBody().catch(() => null);
    const file = body?.file;
    if (!(file instanceof File)) {
      return c.text('缺少 multipart 字段 file(zip 制品)', 400);
    }
    if (file.size > MAX_ZIP_UPLOAD_BYTES) {
      return c.text(`zip 制品超过上限 ${MAX_ZIP_UPLOAD_BYTES}B`, 413);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const expected = (() => {
      const raw =
        (typeof body?.expectedSha256 === 'string'
          ? body.expectedSha256
          : undefined) ?? c.req.header('X-Plugin-Archive-Sha256');
      return raw?.trim().toLowerCase() || undefined;
    })();
    if (expected && /^[0-9a-f]{64}$/.test(expected) && expected !== sha256) {
      return c.text(
        `sha256 不匹配: 期望 ${expected.slice(0, 12)}…,实际 ${sha256.slice(0, 12)}…`,
        400,
      );
    }

    // 解压防护四件套:zip-slip(路径穿越/绝对路径/反斜杠)、炸弹封顶
    // (条目数+解压总量)、符号链接条目拒收、单根目录自动探测。
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      return c.text('zip 制品无法解析(损坏或非 zip 格式)', 400);
    }
    const entries = zip.getEntries();
    if (entries.length === 0 || entries.length > MAX_ZIP_ENTRIES) {
      return c.text(
        `zip 条目数 ${entries.length} 越界(1..${MAX_ZIP_ENTRIES})`,
        400,
      );
    }
    let totalUncompressed = 0;
    for (const entry of entries) {
      const invalidName = validateZipEntryName(entry.entryName);
      if (invalidName) {
        return c.text(invalidName, 400);
      }
      if (entry.isDirectory) {
        continue;
      }
      const attrs = Number(entry.attr >>> 16);
      if ((attrs & 0o170000) === 0o120000) {
        return c.text(
          `zip 条目为符号链接,已拒收: ${entry.entryName.slice(0, 100)}`,
          400,
        );
      }
      totalUncompressed += entry.header.size;
      if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
        return c.text(
          `zip 解压总量超过上限 ${MAX_ZIP_UNCOMPRESSED_BYTES}B(疑似压缩炸弹)`,
          400,
        );
      }
    }
    // 单根目录探测:app.json 在根,或所有条目共享唯一顶层目录(GitHub
    // 式 repo-x.y.z/ 前缀)→ 剥离前缀。
    const hasRootManifest = entries.some((entry) => entry.entryName === 'app.json');
    let stripPrefix = '';
    if (!hasRootManifest) {
      const roots = new Set(
        entries.map((entry) => entry.entryName.split('/')[0]),
      );
      const rootManifests = [...roots].filter((root) =>
        entries.some((entry) => entry.entryName === `${root}/app.json`),
      );
      if (rootManifests.length !== 1) {
        return c.text('zip 中未找到 app.json(根目录或唯一单层子目录)', 400);
      }
      stripPrefix = `${rootManifests[0]}/`;
    }

    const staging = join(
      PLUGINS_DIR,
      `.staging-zip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    );
    try {
      mkdirSync(staging, { recursive: true });
      zip.getEntries().forEach((entry) => {
        if (entry.isDirectory) {
          return;
        }
        const rel = entry.entryName.slice(stripPrefix.length);
        if (!rel) {
          return;
        }
        const target = join(staging, rel);
        if (!target.startsWith(`${resolve(staging)}${sep}`)) {
          throw new Error(`zip 条目越出暂存目录: ${rel}`);
        }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, entry.getData());
      });
      return await installPluginFromDirectory(c, staging, `zip-upload sha256=${sha256}`);
    } catch (error) {
      return c.text(
        error instanceof Error ? error.message : 'zip 解压失败',
        400,
      );
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  // ---- local 目录通道(既有形态):绝对本地路径,entrypoint 烤入插件
  // 与本机开发共用。
  if (!allowedInstallSources().has('local')) {
    return c.text('本地路径安装已被 BFF_PLUGIN_INSTALL_SOURCES 禁用', 403);
  }
  const body = await c.req.json<{ source?: string }>().catch(() => null);
  const source = body?.source;
  if (!source || !resolve(source).startsWith('/')) {
    return c.text('source 必须是绝对本地路径', 400);
  }
  return await installPluginFromDirectory(c, source, source);
});

/**
 * 启停路由(#16,API-first,UI 后置):enable/disable 只写 plugin-state.json,
 * 不动安装目录。幂等;插件须已安装(404);与 install/delete 同一 admin token
 * 守卫。状态文件每请求读写(无内存缓存),天然进程重启免疫。
 */
async function setPluginEnabled(
  c: Context,
  id: string,
  enabled: boolean,
): Promise<Response> {
  if (!isAdminRequest(c.req)) {
    return c.text('Forbidden: 需要有效的 X-Plugin-Admin-Token', 403);
  }
  if (/[^\w.-]/.test(id)) {
    return c.text('Forbidden', 403);
  }
  const dest = resolve(PLUGINS_DIR, id);
  if (!dest.startsWith(`${PLUGINS_DIR}${sep}`) || !existsSync(dest)) {
    return c.text('Not Found', 404);
  }
  if (enabled) {
    // enable 校验清单(评审 P3):损坏安装本就被列表过滤,启用必然"200 却
    // 不可见"——显式拒绝;disable 保持宽松(遮蔽损坏安装是合法操作)
    const meta = await readPluginMeta(dest);
    if (!meta) {
      return c.text('app.json 缺失或非法,无法启用', 400);
    }
  }
  const state = await readPluginState();
  state.states[id] = { enabled, updatedAt: new Date().toISOString() };
  await writePluginState(state);
  await appendPluginAudit({ action: enabled ? 'enable' : 'disable', pluginId: id });
  return c.json({ id, enabled });
}

pluginsRoutes.post('/plugins/:id/enable', (c) =>
  setPluginEnabled(c, c.req.param('id'), true),
);

pluginsRoutes.post('/plugins/:id/disable', (c) =>
  setPluginEnabled(c, c.req.param('id'), false),
);

/**
 * 插件后端代理(#5):流式透传,SSE 友好;查询串(含 ?token=)原样透传。
 *
 * 鉴权决策(评审 M2,明示):本路由不套 authMiddleware——安全边界为
 * 「BFF 回环绑定(127.0.0.1)+ 上游 wargamesrv 自身 token 鉴权」,
 * 与既有 /api/v1/wargame nginx 通道暴露面一致;SSE 走 ?token= 由上游校验。
 * 若未来放开 BFF_HOST 或上游长期无鉴权,须在此加 authMiddleware。
 */
pluginsRoutes.all('/plugins/:id/proxy/*', async (c) => {
  const id = c.req.param('id');
  if (/[^\w.-]/.test(id)) {
    return c.text('Forbidden', 403);
  }
  // 启停门控(评审 P1):disabled 插件的后端代理通道切断——停用是断路,
  // 事故止血时流量必须停;404 不向匿名探测者泄露「存在但已停用」
  if (await isPluginDisabled(id)) {
    return c.text('Not Found', 404);
  }
  const pluginDir = resolve(PLUGINS_DIR, id);
  if (!pluginDir.startsWith(`${PLUGINS_DIR}${sep}`) || !existsSync(pluginDir)) {
    return c.text('Not Found', 404);
  }
  const meta = await readPluginMeta(pluginDir);
  // SSRF 纵深防御 + override 语义(评审 M1/M2):
  // - effective target 优先取部署者 override(env 受控输入,宽松级校验,
  //   允许服务名/host.docker.internal),**override 存在即生效**——即使插件
  //   app.json 未声明 backend 段也可凭 override 启用代理(部署者直觉语义);
  // - 落盘值(插件 app.json 声明,不受控)走严格 IP 白名单,
  //   防安装与代理之间 app.json 被篡改成任意外部地址。
  const override = parseBackendOverrides().get(id);
  const declaredTarget =
    meta?.backend?.type === 'proxy' ? meta.backend.target : undefined;
  const effectiveTarget = override ?? declaredTarget;
  if (!effectiveTarget) {
    return c.text(`插件 ${id} 未声明 proxy 后端`, 503);
  }
  const targetError = validateBackendTarget(effectiveTarget, {
    fromOverride: Boolean(override),
  });
  if (targetError) {
    return c.text(targetError, 503);
  }
  const target = new URL(effectiveTarget);

  const rest = c.req.path.replace(/^\/plugins\/[^/]+\/proxy/, '');
  const incoming = new URL(c.req.url);
  const upstream = new URL(
    `${target.pathname.replace(/\/$/, '')}${rest}`,
    target,
  );
  upstream.search = incoming.search;

  // 复制安全相关的请求头;Host 由 undici 按 target 自动设置
  const headers = new Headers();
  for (const name of ['authorization', 'content-type', 'accept', 'cookie', 'last-event-id']) {
    const value = c.req.header(name);
    if (value) {
      headers.set(name, value);
    }
  }

  // 上游首字节超时(评审 L7):挂起的上游(connect/TTFB 不返回)会长期占用
  // 连接;限时到即 504。响应头到达后清除——SSE 长连接与其余慢 body 不受限。
  // env 手误(非正数字)回退默认值——NaN 会使 setTimeout 立即触发,全量 504(评审 M1)
  const rawTimeoutMs = Number(
    process.env.BFF_PLUGIN_PROXY_TTFB_TIMEOUT_MS ?? 30_000,
  );
  const timeoutMs =
    Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0 ? rawTimeoutMs : 30_000;
  const abort = new AbortController();
  const ttfbTimer = setTimeout(() => abort.abort(), timeoutMs);

  const upstreamResp = await fetch(upstream, {
    method: c.req.method,
    headers,
    body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
    redirect: 'manual',
    signal: abort.signal,
    // @ts-expect-error Node fetch 需要 duplex 才能转发请求流
    duplex: 'half',
  }).catch(() => null);
  clearTimeout(ttfbTimer);
  if (!upstreamResp) {
    const timedOut = abort.signal.aborted;
    return c.text(
      timedOut
        ? `插件后端响应超时(${timeoutMs}ms): ${effectiveTarget}`
        : `插件后端不可达: ${effectiveTarget}`,
      timedOut ? 504 : 502,
    );
  }

  // fetch 已自动解压,不能复制压缩与长度相关头
  const skipHeaders = [
    'content-encoding',
    'content-length',
    'transfer-encoding',
    'connection',
  ];

  // 返回原生 Response:Hono 的 c.body/newResponse Data 类型对 undici 的
  // ReadableStream 泛型不兼容,而流式透传 + 任意 status 正是原生构造器的形态
  const respHeaders = new Headers();
  upstreamResp.headers.forEach((value, name) => {
    if (!skipHeaders.includes(name)) {
      respHeaders.set(name, value);
    }
  });
  respHeaders.set('X-Accel-Buffering', 'no');
  respHeaders.set('Cache-Control', 'no-store');
  return new Response(upstreamResp.body, {
    status: upstreamResp.status,
    headers: respHeaders,
  });
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
  // 卸载同时清除启停状态(#16):重装回默认 enabled,不残留陈旧 disabled
  const state = await readPluginState();
  if (state.states[id]) {
    delete state.states[id];
    await writePluginState(state);
  }
  await appendPluginAudit({ action: 'uninstall', pluginId: id });
  return c.json({ removed: id });
});
