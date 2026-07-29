/**
 * SelectedTextReply — 选中文本回复浮动按钮（P3）
 *
 * 参考 webui setupSelectionReplyButton (ui.js L7510-7620)。
 *
 * 评审决策：
 * - PS5: selectionchange 事件 debounce 150ms，避免鼠标移动频繁触发
 * - PS6: 监听 scroll/resize 事件隐藏按钮，避免按钮跟随滚动错位
 * - PS7: 多 chat box 模式下不渲染（由调用方 isDebugMode=false 控制）
 * - PS12: 引用文本限制 2000 字符，trim 空白行
 *
 * P3 评审修复：
 * - S4: 限制选区最大长度 10000 字符，超大选区不显示按钮
 * - Q3: chatRootRef 类型明确为 HTMLDivElement，调用方需配合 <div> 或 <section>
 * - Q8: 删除未使用的 buttonRef
 * - Q9: useCallback 依赖改为 []，注释说明 ref 是可变容器
 * - Q12: 截断边界条件修复，用原始 text.length 判断是否截断
 *
 * 行为：
 * - 用户在 chatRootRef 区域选中非空文本时，显示"引用回复"浮动按钮
 * - 点击按钮：将选中文本格式化为 Markdown 引用，追加到 textarea value
 * - 滚动/resize/selection 清空时隐藏按钮
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Quote } from 'lucide-react';

const DEBOUNCE_MS = 150;
const MAX_QUOTE_LENGTH = 2000;
// S4: 选区最大长度限制，超大选区不显示按钮（避免 formatQuote 性能问题）
const MAX_SELECTION_LENGTH = 10000;

interface SelectedTextReplyProps {
  /** 监听选区的根节点 ref（Q3: 建议挂载到 <section> 或 <div> 上） */
  chatRootRef: React.RefObject<HTMLElement>;
  /** 追加引用文本到 textarea value */
  onQuote: (quotedText: string) => void;
}

interface ButtonPosition {
  top: number;
  left: number;
}

function formatQuote(text: string): string {
  // Q12: 记录原始长度，用于判断是否真的截断
  const originalLength = text.length;
  // PS12: trim 空白行 + 截断超长文本
  const trimmed = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .slice(0, MAX_QUOTE_LENGTH);

  if (!trimmed) return '';

  // M4 修复:仅在 trimmed 非空时才显示截断提示。
  // 原 originalLength > MAX_QUOTE_LENGTH 在纯空白文本场景下会误判为截断,
  // 导致 finalText='\n...(truncated)' 向 textarea 插入无内容的截断提示。
  const isTruncated = originalLength > MAX_QUOTE_LENGTH && trimmed.length > 0;
  const finalText = isTruncated ? `${trimmed}\n...(truncated)` : trimmed;

  // Markdown 引用：每行前加 >
  return `\n> ${finalText.split('\n').join('\n> ')}\n\n`;
}

function isSelectionWithin(selection: Selection, root: HTMLElement): boolean {
  if (selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer);
}

export function SelectedTextReply({
  chatRootRef,
  onQuote,
}: SelectedTextReplyProps) {
  const { t } = useTranslation();
  const [position, setPosition] = useState<ButtonPosition | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

  // Q9: useCallback 依赖为 []，因为 chatRootRef 是 ref 对象（引用稳定），
  // 其 .current 是可变容器，闭包内始终读取最新值，无需重新创建 callback
  const updateButton = useCallback(() => {
    const root = chatRootRef.current;
    if (!root) {
      setPosition(null);
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !isSelectionWithin(selection, root)) {
      setPosition(null);
      setSelectedText('');
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      setPosition(null);
      setSelectedText('');
      return;
    }

    // S4: 超大选区不显示按钮，避免 formatQuote 性能问题
    if (text.length > MAX_SELECTION_LENGTH) {
      setPosition(null);
      setSelectedText('');
      return;
    }

    // 获取选区位置，按钮定位在选区右下方
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      // 选区不可见（如某些浏览器中折叠选区）
      setPosition(null);
      return;
    }

    setSelectedText(text);
    setPosition({
      top: rect.bottom + 8,
      left: rect.left + rect.width / 2 - 40, // 按钮宽度 80px，居中
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Q9: chatRootRef 是 ref，引用稳定，无需作为依赖

  // PS5: selectionchange debounce 150ms
  useEffect(() => {
    const handler = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(updateButton, DEBOUNCE_MS);
    };
    document.addEventListener('selectionchange', handler);
    return () => {
      document.removeEventListener('selectionchange', handler);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [updateButton]);

  // PS6: 滚动/resize 时隐藏按钮
  useEffect(() => {
    const hide = () => setPosition(null);
    const root = chatRootRef.current;
    // 监听 window scroll（capture=true 捕获所有滚动容器）
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    if (root) {
      root.addEventListener('scroll', hide);
    }
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      if (root) {
        root.removeEventListener('scroll', hide);
      }
    };
  }, [chatRootRef]);

  const handleClick = useCallback(() => {
    if (!selectedText) return;
    const quote = formatQuote(selectedText);
    if (quote) {
      onQuote(quote);
    }
    // 清空选区并隐藏按钮
    window.getSelection()?.removeAllRanges();
    setPosition(null);
    setSelectedText('');
  }, [selectedText, onQuote]);

  if (!position) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      className="fixed z-50 flex items-center gap-1 px-2 py-1 text-xs rounded-md border bg-popover shadow-md hover:bg-muted"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      data-testid="selected-text-reply-button"
    >
      <Quote className="h-3 w-3" />
      <span>{t('selectedReply.button')}</span>
    </button>
  );
}
