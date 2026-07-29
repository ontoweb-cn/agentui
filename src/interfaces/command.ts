/**
 * ICommandContext 由 use-send-chat-message.ts 实例化，注入命令执行所需回调
 * - SlashCommand 描述命令元信息（名称、描述 i18n key、参数定义）
 * - 命令通过 callback prop 传入 SlashCommandPalette，避免组件内部实例化 hook
 */

/** 命令参数类型 */
export type CommandArgType = 'model' | 'string';

/** 命令参数定义 */
export interface CommandArg {
  /** 参数名称 i18n key */
  nameKey: string;
  /** 参数类型（model 触发子参数面板） */
  type: CommandArgType;
}

/** Slash 命令元信息 */
export interface SlashCommand {
  /** 命令名（不含 / 前缀） */
  name: string;
  /** 描述 i18n key */
  descKey: string;
  /** 参数定义（可选） */
  arg?: CommandArg;
  /** 是否回显命令文本到消息流（true=不回显，直接执行后清空） */
  noEcho?: boolean;
}

/**
 * 命令上下文：提供命令执行所需回调。
 * 由 use-send-chat-message.ts 实例化，通过 props 注入 SlashCommandPalette。
 */
export interface ICommandContext {
  /** /retry: 重新生成最后一条回复 */
  retry: () => void;
  /** /undo: 撤销最后一条用户消息（删除该消息及其后所有消息，含 server 同步） */
  undo: () => void | Promise<void>;
  /** /status: 查看会话状态（toast 显示 sessionId/streaming 状态） */
  status: () => void;
  /** /usage: 查看上一 turn token 用量（toast 显示） */
  usage: () => void;
  /** /model: 切换模型（参数为模型 name，含 server 持久化） */
  switchModel: (modelName: string) => void | Promise<void>;
}

/**
 * 解析 textarea value 中的 Slash 命令。
 *
 * Q2 修复：抽取公共函数，避免外层 slashCommandVisible 判断与内层 parsed 解析逻辑分散。
 *
 * 规则（Q1 修复：允许 / 后空格）：
 * - 仅当第一行以 / 开头时识别为命令
 * - 格式：/commandName arg1 arg2 ...
 * - / 后允许空格（如 "/ model" 仍能识别命令名为 "model"）
 * - 无 / 前缀或第一行不含 / 时返回 null
 *
 * @param value textarea 完整 value
 * @returns 解析结果：{ commandName, arg } 或 null（非命令模式）
 */
export function parseSlashCommand(value: string): {
  commandName: string;
  arg: string;
} | null {
  if (!value.startsWith('/')) return null;
  const firstLine = value.split('\n')[0];
  // Q1: 允许 / 后紧跟空格（trim commandName 后再匹配）
  const match = firstLine.match(/^\/\s*(\w*)(?:\s+(.*))?$/);
  if (!match) return null;
  return {
    commandName: match[1] ?? '',
    arg: match[2] ?? '',
  };
}

/**
 * 判断 value 是否触发 Slash 命令面板可见。
 * 基于 parseSlashCommand 结果，仅当解析成功且 commandName 非空或 arg 非空时显示面板。
 */
export function isSlashCommandVisible(value: string): boolean {
  const parsed = parseSlashCommand(value);
  if (!parsed) return false;
  // 至少有 commandName 或正在输入参数（arg 非空）
  return parsed.commandName.length > 0 || parsed.arg.length > 0;
}
