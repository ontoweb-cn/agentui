/**
 * TruncatedText 单元测试
 *
 * 覆盖点:
 * - 无 tooltip 时渲染纯元素(不渲染 tooltip、不可聚焦)
 * - 内容溢出(scrollWidth > clientWidth)时,聚焦后展示 tooltip
 * - 内容未溢出时,聚焦也不展示 tooltip(避免冗余提示)
 *
 * 注:jsdom 中 scrollWidth/clientWidth 默认均为 0(相等,即视为未溢出),
 * 溢出场景通过 Object.defineProperty 在实例上伪造尺寸。
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TruncatedText } from '../truncated-text';

const renderWithProvider = (ui: React.ReactElement) =>
  render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);

const mockOverflow = (el: HTMLElement, scroll: number, client: number) => {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scroll });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: client });
};

describe('TruncatedText', () => {
  it('无 tooltip 时渲染纯元素且不可聚焦', () => {
    renderWithProvider(
      <TruncatedText className="truncate" testId="plain">
        短文本
      </TruncatedText>,
    );
    const el = screen.getByTestId('plain');
    expect(el).toHaveTextContent('短文本');
    expect(el).not.toHaveAttribute('tabindex');
  });

  it('溢出时聚焦后展示 tooltip', async () => {
    const { container } = renderWithProvider(
      <TruncatedText className="truncate" testId="clip" tooltip="完整内容">
        超长内容
      </TruncatedText>,
    );
    const trigger = container.querySelector('[data-testid="clip"]') as HTMLElement;
    expect(trigger).toHaveAttribute('tabindex');
    mockOverflow(trigger, 200, 100);

    await act(async () => {
      fireEvent.focus(trigger);
    });

    expect(await screen.findByRole('tooltip')).toHaveTextContent('完整内容');
  });

  it('未溢出时聚焦也不展示 tooltip', async () => {
    const { container } = renderWithProvider(
      <TruncatedText className="truncate" testId="short" tooltip="完整内容">
        短内容
      </TruncatedText>,
    );
    const trigger = container.querySelector('[data-testid="short"]') as HTMLElement;
    // jsdom 默认 scrollWidth === clientWidth(0 === 0),视为未溢出
    mockOverflow(trigger, 100, 100);

    await act(async () => {
      fireEvent.focus(trigger);
    });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
