/**
 * 插件状态与审计存储(自 bff/src/routes/plugins.ts 拆出,chat 档位进场时)。
 *
 * - 启停状态:bff/data/plugin-state.json——**必须在安装目录之外**:entrypoint
 *   每次容器启动无条件重装(覆盖安装目录),状态文件才能存活。
 *   原子写(tmp+rename)+ 损坏大声告警(kill switch 不得静默失效,评审 P2)。
 * - 审计:JSONL 追加写,超过 AUDIT_MAX_BYTES 轮换为 .1(单代,评审 P3);
 *   写失败只告警不阻塞主操作(审计是观测面)。
 *
 * 目录/文件路径经 env 注入(BFF_PLUGINS_DIR/BFF_PLUGIN_STATE_FILE/
 * BFF_PLUGIN_AUDIT_FILE),测试依赖 import 时求值——须在动态 import 前 set。
 */
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PLUGINS_DIR = process.env.BFF_PLUGINS_DIR
  ? resolve(process.env.BFF_PLUGINS_DIR)
  : resolve(__dirname, '../../data/plugins');

const STATE_FILE = process.env.BFF_PLUGIN_STATE_FILE
  ? resolve(process.env.BFF_PLUGIN_STATE_FILE)
  : resolve(__dirname, '../../data/plugin-state.json');

const AUDIT_FILE = process.env.BFF_PLUGIN_AUDIT_FILE
  ? resolve(process.env.BFF_PLUGIN_AUDIT_FILE)
  : resolve(__dirname, '../../data/plugin-audit.jsonl');

/** 审计单文件上限(字节),超过轮换为 .1。 */
const AUDIT_MAX_BYTES = Number(process.env.BFF_PLUGIN_AUDIT_MAX_BYTES ?? 5 * 1024 * 1024);

/** 启停状态落盘形态;缺文件 = 全部 enabled(向后兼容既有部署)。 */
export interface PluginStateFile {
  schema: 1;
  states: Record<string, { enabled: boolean; updatedAt: string }>;
}

export async function readPluginState(): Promise<PluginStateFile> {
  let raw: string;
  try {
    raw = await readFile(STATE_FILE, 'utf-8');
  } catch (err) {
    // 缺失文件是首次运行的正常形态(全 enabled),静默;损坏/不可读必须
    // 大声告警(评审 P2):kill switch 不得静默失效
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.error('[plugin-store] plugin-state.json 读取失败,按全 enabled 处理:', err);
    }
    return { schema: 1, states: {} };
  }
  try {
    const parsed = JSON.parse(raw) as PluginStateFile;
    if (parsed?.schema === 1 && parsed.states instanceof Object) {
      return parsed;
    }
    console.error('[plugin-store] plugin-state.json schema 不符,按全 enabled 处理(请修复该文件)');
  } catch (err) {
    console.error('[plugin-store] plugin-state.json 解析失败(文件损坏?),按全 enabled 处理:', err);
  }
  return { schema: 1, states: {} };
}

export async function writePluginState(state: PluginStateFile): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  // 原子写(评审 P2):tmp+rename,写入中途崩溃不留截断 JSON——截断文件会在
  // 下次读取时按全 enabled 处理,kill switch 向打开方向静默失效。
  // 并发 read-modify-write 丢更新(两个启停操作交错)为已知限制:
  // 仅 admin 面、操作频率极低,不引入锁。
  const tmp = `${STATE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
  await rename(tmp, STATE_FILE);
}

/** 启停门控(评审 P1):disabled 的插件连数据面一起切断(404,不泄露存在性)。 */
export async function isPluginDisabled(id: string): Promise<boolean> {
  return (await readPluginState()).states[id]?.enabled === false;
}

export type PluginAuditAction = 'install' | 'uninstall' | 'enable' | 'disable';

/**
 * 审计追加:变更操作成功后落一行 JSONL。文件超过 AUDIT_MAX_BYTES 轮换为
 * `.1`(单代覆盖,评审 P3:无身份归因——共享 admin token 无身份可记,按人
 * 鉴权体系落地后一并扩展)。写入失败只告警不阻塞主操作。
 */
export async function appendPluginAudit(entry: {
  action: PluginAuditAction;
  pluginId: string;
  version?: string | null;
  source?: string | null;
}): Promise<void> {
  try {
    await mkdir(dirname(AUDIT_FILE), { recursive: true });
    try {
      const info = await stat(AUDIT_FILE);
      if (info.isFile() && info.size > AUDIT_MAX_BYTES) {
        await rename(AUDIT_FILE, `${AUDIT_FILE}.1`);
      }
    } catch {
      // 文件不存在:无需轮换
    }
    const line = `${JSON.stringify({
      ts: new Date().toISOString(),
      outcome: 'ok',
      ...entry,
    })}\n`;
    await appendFile(AUDIT_FILE, line, 'utf-8');
  } catch (err) {
    console.warn('[plugin-store] 审计写入失败(不影响主操作):', err);
  }
}

/** 插件安装目录(供路由层构造路径与存在性检查)。 */
export function pluginDir(id: string): string {
  return resolve(PLUGINS_DIR, id);
}

/** 插件目录存在且未越出安装根。 */
export function pluginDirExists(id: string): boolean {
  const dir = pluginDir(id);
  return dir.startsWith(`${PLUGINS_DIR}${sep}`) && existsSync(dir);
}
