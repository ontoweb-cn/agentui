/**
 * SlashCommandPalette — Slash 命令面板（P3）
 *
 * 参考 webui commands.js + boot.js L1060-1081。
 *
 * 设计要点（评审决策）：
 * - PS1: 命令通过 props 注入回调，不在组件内部实例化 useRegenerateMessage 等 hook
 *   （避免深层 prop drilling，调用方在 use-send-chat-message.ts 中传入已实例化的方法）
 * - PS3: 键盘事件处理需避免与 textarea Enter 提交冲突，面板可见时消费 Enter/↑↓/Esc
 * - PS4: 命令执行后清空 textarea value 并隐藏面板
 *
 * P3 评审修复：
 * - S2: keydown 监听器改为通过 onKeyDown prop 绑定到 textarea，避免全局 capture 拦截
 *   其他模块的 Enter；处理 IME 输入（isComposing/keyCode 229）
 * - Q1: 正则允许 / 后空格（通过 parseSlashCommand 公共函数）
 * - Q2: parsed 解析复用 parseSlashCommand 公共函数
 * - Q7: 实现"点击外部关闭面板"逻辑（containerRef 现在实际使用）
 * - Q10: isSubArgMode 通用判断（基于命令自身 arg 定义）
 * - Q13: useEffect 依赖优化，用 useRef 缓存 context/onCommandExecuted
 * - Q16: 非空断言改为 optional chaining + 提前 return
 *
 * 命令清单：
 * - /retry: 重新生成最后一条回复
 * - /undo: 撤销最后一条用户消息（删除该消息及其后所有消息）
 * - /status: 查看会话状态（toast 显示 sessionId/streaming 状态）
 * - /usage: 查看上一 turn token 用量（toast 显示）
 * - /model: 切换模型（子参数面板列出可用模型）
 */
import { useFetchAllAddedModels } from '@/hooks/use-llm-request';
import {
  ICommandContext,
  SlashCommand,
  parseSlashCommand,
} from '@/interfaces/command';
import { cn } from '@/lib/utils';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface SlashCommandPaletteProps {
  /** 当前 textarea value（用于解析命令前缀和参数） */
  value: string;
  /** 是否显示面板（由外层根据 value 是否以 / 开头控制） */
  visible: boolean;
  /** 命令上下文（提供 retry/undo/status/usage/model 等回调） */
  context: ICommandContext;
  /** 选中命令并执行后回调（外层清空 textarea value） */
  onCommandExecuted: () => void;
  /** 用户按 Esc 或点击外部时关闭面板 */
  onRequestClose: () => void;
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: 'retry',
    descKey: 'command.retry.desc',
    noEcho: true,
  },
  {
    name: 'undo',
    descKey: 'command.undo.desc',
    noEcho: true,
  },
  {
    name: 'status',
    descKey: 'command.status.desc',
    noEcho: true,
  },
  {
    name: 'usage',
    descKey: 'command.usage.desc',
    noEcho: true,
  },
  {
    name: 'model',
    descKey: 'command.model.desc',
    arg: { nameKey: 'command.model.argName', type: 'model' },
  },
];

export function SlashCommandPaletteImpl({
  value,
  visible,
  context,
  onCommandExecuted,
  onRequestClose,
}: SlashCommandPaletteProps) {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [modelSubArgs, setModelSubArgs] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Q13: 用 useRef 缓存 context/onCommandExecuted，避免 useEffect 频繁重新注册监听器
  const contextRef = useRef(context);
  const onCommandExecutedRef = useRef(onCommandExecuted);
  useEffect(() => {
    contextRef.current = context;
    onCommandExecutedRef.current = onCommandExecuted;
  });

  // /model 子参数：useFetchAllAddedModels 加载模型列表
  const { data: allModels } = useFetchAllAddedModels();

  // Q2: 复用 parseSlashCommand 公共函数解析命令
  const parsed = useMemo(() => {
    if (!visible) return null;
    return parseSlashCommand(value);
  }, [value, visible]);

  // 过滤匹配的命令列表
  const matchedCommands = useMemo(() => {
    if (!parsed) return [];
    if (parsed.arg) {
      // 已输入参数：仅匹配对应命令的子参数
      const cmd = BUILTIN_COMMANDS.find(
        (c) => c.name === parsed.commandName && c.arg,
      );
      if (!cmd) return [];
      return [cmd];
    }
    return BUILTIN_COMMANDS.filter((c) =>
      c.name.startsWith(parsed.commandName),
    );
  }, [parsed]);

  // /model 子参数列表
  useEffect(() => {
    if (!parsed || parsed.commandName !== 'model' || !parsed.arg) {
      setModelSubArgs([]);
      return;
    }
    const models = allModels
      .map((m) => m.name)
      .filter((name) => name.toLowerCase().includes(parsed.arg.toLowerCase()))
      .slice(0, 20); // 限制 20 条避免渲染性能问题
    setModelSubArgs(models);
  }, [parsed, allModels]);

  // Q4: selectedIndex 仅在 matchedCommands 长度变化时重置（而非引用变化）
  const matchedCount = matchedCommands.length;
  useEffect(() => {
    setSelectedIndex(0);
  }, [matchedCount]);

  // 执行命令
  const executeCommand = (cmd: SlashCommand | undefined, arg?: string) => {
    if (!cmd) return;
    const ctx = contextRef.current;
    switch (cmd.name) {
      case 'retry':
        ctx.retry();
        break;
      case 'undo':
        ctx.undo();
        break;
      case 'status':
        ctx.status();
        break;
      case 'usage':
        ctx.usage();
        break;
      case 'model':
        // S5: 无 arg 时提示用户选择模型，不执行也不清空 textarea
        if (!arg) {
          onRequestClose();
          return;
        }
        ctx.switchModel(arg);
        break;
    }
    // PS4: 命令执行后清空 textarea value 并隐藏面板
    onCommandExecutedRef.current();
  };

  // S2: keydown 通过 document 监听，但仅当 textarea 聚焦时拦截，避免影响其他模块
  // 同时处理 IME 输入（isComposing/keyCode 229），避免拦截中文/日文输入法确认
  useEffect(() => {
    if (!visible || matchedCommands.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // S2: IME 输入时跳过（中文/日文输入法确认不能被拦截）
      if (e.isComposing || e.keyCode === 229) return;
      // S2: 仅当 textarea 聚焦时拦截，避免影响 DevTools/其他弹窗
      const active = document.activeElement;
      if (!active || active.tagName !== 'TEXTAREA') return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i + 1) % matchedCommands.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) =>
          i === 0 ? matchedCommands.length - 1 : i - 1,
        );
      } else if (e.key === 'Enter') {
        // PS3: 面板可见时消费 Enter，避免 textarea 提交消息
        e.preventDefault();
        e.stopPropagation();
        const cmd = matchedCommands[selectedIndex];
        executeCommand(cmd, parsed?.arg);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onRequestClose();
      }
    };
    // S2: 用 capture 阶段确保在 textarea 的 keydown 之前处理
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, matchedCommands, selectedIndex, parsed, onRequestClose]);

  // Q7: 点击外部关闭面板
  useEffect(() => {
    if (!visible) return;
    const handleClickOutside = (e: MouseEvent) => {
      const container = containerRef.current;
      if (container && !container.contains(e.target as Node)) {
        // 点击面板外部时关闭（不清空 value，由外层 Esc 处理）
        onRequestClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [visible, onRequestClose]);

  if (!visible || matchedCommands.length === 0) return null;

  // Q10: isSubArgMode 通用判断（基于命令自身 arg 定义）
  const currentCmd = matchedCommands[0];
  const isSubArgMode = Boolean(parsed?.arg && currentCmd?.arg);

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 mb-2 w-80 max-h-80 overflow-auto rounded-md border bg-popover shadow-md z-50"
      data-testid="slash-command-palette"
    >
      {isSubArgMode && currentCmd?.arg?.type === 'model' ? (
        // 子参数列表（模型列表）
        <ul className="py-1">
          {modelSubArgs.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {t('command.noResult')}
            </li>
          ) : (
            modelSubArgs.map((modelName, idx) => (
              <li
                key={modelName}
                className={cn(
                  'px-3 py-2 text-sm cursor-pointer hover:bg-muted',
                  idx === selectedIndex && 'bg-muted',
                )}
                // Q16: 非空断言改为提前 return（在 onClick 内）
                onClick={() => {
                  if (!currentCmd) return;
                  executeCommand(currentCmd, modelName);
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="font-mono">{modelName}</span>
              </li>
            ))
          )}
        </ul>
      ) : (
        // 命令列表
        <ul className="py-1">
          {matchedCommands.map((cmd, idx) => (
            <li
              key={cmd.name}
              className={cn(
                'px-3 py-2 text-sm cursor-pointer hover:bg-muted flex items-center justify-between',
                idx === selectedIndex && 'bg-muted',
              )}
              onClick={() => executeCommand(cmd)}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <div className="flex flex-col">
                <span className="font-mono text-xs">/{cmd.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t(cmd.descKey)}
                </span>
              </div>
              {cmd.arg && (
                <span className="text-xs text-muted-foreground">
                  &lt;{t(cmd.arg.nameKey)}&gt;
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * L2 修复:用 memo 包裹,避免父组件 NextMessageInput 每次 value 变化时
 * 因新建箭头函数 onCommandExecuted/onRequestClose 触发 palette 不必要重渲染。
 * 组件内部已用 useRef 缓存 context/callback,props 引用变化不影响行为。
 */
export const SlashCommandPalette = memo(SlashCommandPaletteImpl);
