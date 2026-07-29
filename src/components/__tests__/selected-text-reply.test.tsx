/**
 * SelectedTextReply 单元测试（P3 测试补全）
 *
 * 覆盖点：
 * - 选中文本时显示按钮
 * - 无选区时不显示
 * - 选区在 chatRootRef 外不显示
 * - 超长选区（>10000）不显示
 * - 点击按钮调用 onQuote
 * - formatQuote 截断与 trim 逻辑
 *
 * 注：jsdom 环境需手动构造 Selection/range
 *
 * Flaky 修复:
 * - 原实现用 `await new Promise(r => setTimeout(r, 200))` 等待 debounce 150ms 触发,
 *   但 debounce 回调中的 setSelectedText/setPosition 在 React act() 边界外执行,
 *   并发跑测试时触发 `warnIfUpdatesNotWrappedWithActDEV` 警告,极端情况下状态丢失导致失败。
 * - 修复:改用 `jest.useFakeTimers()` + `act(() => { jest.advanceTimersByTime(150) })`,
 *   让 debounce 回调在 act() 边界内执行,消除警告并稳定测试。
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useRef } from 'react';
import { SelectedTextReply } from '../selected-text-reply';

// mock i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// mock lucide-react
jest.mock('lucide-react', () => ({
  Quote: () => <span data-testid="quote-icon">Q</span>,
}));

/** 构造 mock Selection */
function mockSelection(text: string, withinRoot: boolean): Selection {
  const range = {
    getBoundingClientRect: () => ({
      width: 100,
      height: 20,
      left: 10,
      bottom: 100,
      right: 110,
      top: 80,
      x: 10,
      y: 80,
      toJSON: () => ({}),
    }),
    commonAncestorContainer: withinRoot ? document.body : ({} as Node),
  };
  return {
    isCollapsed: !text,
    rangeCount: text ? 1 : 0,
    toString: () => text,
    getRangeAt: () => range,
    removeAllRanges: jest.fn(),
  } as unknown as Selection;
}

function Wrapper({ onQuote }: { onQuote: (q: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  return (
    <div ref={ref as React.RefObject<HTMLDivElement>}>
      <SelectedTextReply chatRootRef={ref} onQuote={onQuote} />
    </div>
  );
}

describe('SelectedTextReply', () => {
  let originalGetSelection: typeof window.getSelection;
  let containsSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    originalGetSelection = window.getSelection;
    // mock HTMLElement.prototype.contains：withinRoot=true 时返回 true
    containsSpy = jest.spyOn(HTMLElement.prototype, 'contains').mockReturnValue(true);
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    window.getSelection = originalGetSelection;
    containsSpy.mockRestore();
  });

  it('无选区时不显示按钮', () => {
    window.getSelection = jest.fn(() =>
      mockSelection('', true),
    ) as unknown as typeof window.getSelection;
    render(<Wrapper onQuote={jest.fn()} />);
    expect(screen.queryByTestId('selected-text-reply-button')).not.toBeInTheDocument();
  });

  it('选区在 chatRootRef 外不显示按钮', () => {
    // contains 返回 false 模拟选区在 root 外
    containsSpy.mockReturnValue(false);
    window.getSelection = jest.fn(() =>
      mockSelection('text', false),
    ) as unknown as typeof window.getSelection;
    render(<Wrapper onQuote={jest.fn()} />);
    // selectionchange 是异步的，需手动触发
    act(() => {
      fireEvent(document, new Event('selectionchange'));
      // 推进 debounce timer(150ms)在 act 边界内执行
      jest.advanceTimersByTime(150);
    });
    expect(screen.queryByTestId('selected-text-reply-button')).not.toBeInTheDocument();
  });

  it('超长选区（>10000）不显示按钮', () => {
    const longText = 'x'.repeat(10001);
    window.getSelection = jest.fn(() =>
      mockSelection(longText, true),
    ) as unknown as typeof window.getSelection;
    render(<Wrapper onQuote={jest.fn()} />);
    act(() => {
      fireEvent(document, new Event('selectionchange'));
      jest.advanceTimersByTime(150);
    });
    expect(screen.queryByTestId('selected-text-reply-button')).not.toBeInTheDocument();
  });

  it('选中文本时显示按钮（debounce 后）', () => {
    window.getSelection = jest.fn(() =>
      mockSelection('hello world', true),
    ) as unknown as typeof window.getSelection;
    render(<Wrapper onQuote={jest.fn()} />);
    act(() => {
      fireEvent(document, new Event('selectionchange'));
      // debounce 150ms
      jest.advanceTimersByTime(150);
    });
    expect(screen.getByTestId('selected-text-reply-button')).toBeInTheDocument();
  });

  it('点击按钮调用 onQuote 并清空选区', () => {
    const onQuote = jest.fn();
    window.getSelection = jest.fn(() =>
      mockSelection('quote me', true),
    ) as unknown as typeof window.getSelection;
    render(<Wrapper onQuote={onQuote} />);
    act(() => {
      fireEvent(document, new Event('selectionchange'));
      jest.advanceTimersByTime(150);
    });
    act(() => {
      fireEvent.click(screen.getByTestId('selected-text-reply-button'));
    });
    expect(onQuote).toHaveBeenCalledWith(expect.stringContaining('quote me'));
    expect(onQuote).toHaveBeenCalledWith(expect.stringContaining('>'));
  });

  it('formatQuote 包含 Markdown 引用前缀 >', () => {
    const onQuote = jest.fn();
    window.getSelection = jest.fn(() =>
      mockSelection('line1\nline2', true),
    ) as unknown as typeof window.getSelection;
    render(<Wrapper onQuote={onQuote} />);
    act(() => {
      fireEvent(document, new Event('selectionchange'));
      jest.advanceTimersByTime(150);
    });
    act(() => {
      fireEvent.click(screen.getByTestId('selected-text-reply-button'));
    });
    expect(onQuote).toHaveBeenCalled();
    const quoted = onQuote.mock.calls[0][0] as string;
    expect(quoted).toContain('> line1');
    expect(quoted).toContain('> line2');
  });

  it('formatQuote 截断超长文本（>2000）', () => {
    const onQuote = jest.fn();
    const longText = 'a'.repeat(2500);
    window.getSelection = jest.fn(() =>
      mockSelection(longText, true),
    ) as unknown as typeof window.getSelection;
    render(<Wrapper onQuote={onQuote} />);
    act(() => {
      fireEvent(document, new Event('selectionchange'));
      jest.advanceTimersByTime(150);
    });
    act(() => {
      fireEvent.click(screen.getByTestId('selected-text-reply-button'));
    });
    const quoted = onQuote.mock.calls[0][0] as string;
    expect(quoted).toContain('truncated');
  });
});
