/**
 * ReasoningPanel 单元测试（P1 测试补全）
 *
 * 覆盖点（参考 plan §8.1）：
 * - 流式中显示 liveReasoning，自动展开
 * - 流完成显示 reasoning 累积，默认折叠
 * - partial <think> 标签剥离
 * - 用户手动展开/折叠覆盖自动行为
 * - 无内容时不渲染
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { ReasoningPanel } from '../reasoning-panel';

// mock i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// mock MarkdownContent 避免依赖完整 markdown 解析
jest.mock('@/components/next-markdown-content', () => {
  return function MockMarkdownContent({ content }: { content: string }) {
    return <div data-testid="markdown-content">{content}</div>;
  };
});

describe('ReasoningPanel', () => {
  it('无 reasoning 和 liveReasoning 时不渲染', () => {
    const { container } = render(
      <ReasoningPanel reasoning="" isStreaming={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('流式中显示 liveReasoning（优先于 reasoning）', () => {
    render(
      <ReasoningPanel
        reasoning="accumulated"
        liveReasoning="live text"
        isStreaming={true}
      />,
    );
    expect(screen.getByTestId('markdown-content')).toHaveTextContent('live text');
  });

  it('流式中无 liveReasoning 时回退到 reasoning', () => {
    render(
      <ReasoningPanel
        reasoning="accumulated"
        liveReasoning=""
        isStreaming={true}
      />,
    );
    expect(screen.getByTestId('markdown-content')).toHaveTextContent('accumulated');
  });

  it('流完成显示 reasoning 累积', () => {
    render(
      <ReasoningPanel reasoning="final reasoning" isStreaming={false} />,
    );
    // 折叠状态，需点击展开
    expect(screen.queryByTestId('markdown-content')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('markdown-content')).toHaveTextContent('final reasoning');
  });

  it('剥离 partial <think> 标签', () => {
    render(
      <ReasoningPanel
        reasoning="<think>hidden reasoning</think>visible"
        isStreaming={false}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    const content = screen.getByTestId('markdown-content');
    expect(content).toHaveTextContent('visible');
    expect(content).not.toHaveTextContent('<think>');
  });

  it('流式中自动展开（有内容时）', () => {
    render(
      <ReasoningPanel
        reasoning=""
        liveReasoning="thinking..."
        isStreaming={true}
      />,
    );
    expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
    expect(screen.getByText('reasoning.thinking')).toBeInTheDocument();
  });

  it('流完成显示 thinking 标签', () => {
    render(
      <ReasoningPanel reasoning="content" isStreaming={false} />,
    );
    expect(screen.getByText('reasoning.show')).toBeInTheDocument();
  });

  it('用户手动折叠覆盖自动展开', () => {
    render(
      <ReasoningPanel
        reasoning=""
        liveReasoning="thinking..."
        isStreaming={true}
      />,
    );
    // 流式中自动展开
    expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
    // 用户手动折叠
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByTestId('markdown-content')).not.toBeInTheDocument();
  });

  it('流式开始时重置手动状态', () => {
    const { rerender } = render(
      <ReasoningPanel reasoning="" liveReasoning="" isStreaming={false} />,
    );
    // 流完成：无内容不渲染
    // 切换到流式中
    rerender(
      <ReasoningPanel
        reasoning=""
        liveReasoning="new thinking"
        isStreaming={true}
      />,
    );
    // 手动状态应被重置，自动展开
    expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
  });
});
