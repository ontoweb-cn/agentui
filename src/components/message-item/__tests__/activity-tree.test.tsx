import { render, screen, fireEvent } from '@testing-library/react';

import type { ToolCallRecord } from '@/interfaces/database/chat';
import { ActivityTree } from '../activity-tree';

jest.mock('../../next-message-item/tool-call-card', () => ({
  ToolCallCard: ({ record }: { record: ToolCallRecord }) => (
    <div data-testid="tool-call">{record.toolName}</div>
  ),
}));

function makeRecord(
  overrides: Partial<ToolCallRecord> = {},
): ToolCallRecord {
  return {
    toolCallId: 'tool-1',
    toolName: 'search',
    status: 'completed',
    startedAt: 0,
    durationMs: 1000,
    ...overrides,
  };
}

describe('ActivityTree', () => {
  it('空记录不渲染', () => {
    const { container } = render(<ActivityTree records={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('运行中默认展开,展示工具数量、状态与累计时长', () => {
    render(
      <ActivityTree
        records={[
          makeRecord({ toolCallId: '1', toolName: 'search', status: 'running' }),
          makeRecord({ toolCallId: '2', toolName: 'read', durationMs: 2000 }),
        ]}
        isStreaming
      />,
    );

    expect(screen.getByTestId('activity-tree')).toHaveAttribute(
      'data-status',
      'running',
    );
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('2 tools')).toBeInTheDocument();
    expect(screen.getByText('3s')).toBeInTheDocument();
    expect(screen.getByTestId('activity-content')).toBeInTheDocument();
    expect(screen.getAllByTestId('tool-call')).toHaveLength(2);
  });

  it('非流式默认折叠,点击后展开', () => {
    render(
      <ActivityTree
        records={[makeRecord({ toolCallId: '1', toolName: 'search' })]}
      />,
    );

    expect(screen.queryByTestId('activity-content')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('activity-toggle'));
    expect(screen.getByTestId('activity-content')).toBeInTheDocument();
    expect(screen.getByTestId('tool-call')).toHaveTextContent('search');
  });

  it('流式结束后自动折叠(用户未手动操作)', () => {
    const { rerender } = render(
      <ActivityTree
        records={[makeRecord({ toolCallId: '1', status: 'running' })]}
        isStreaming
      />,
    );

    expect(screen.getByTestId('activity-content')).toBeInTheDocument();

    rerender(
      <ActivityTree
        records={[makeRecord({ toolCallId: '1', status: 'completed' })]}
        isStreaming={false}
      />,
    );

    expect(screen.queryByTestId('activity-content')).not.toBeInTheDocument();
  });

  it('有失败工具时状态为 failed', () => {
    render(
      <ActivityTree
        records={[
          makeRecord({ toolCallId: '1', status: 'failed' }),
          makeRecord({ toolCallId: '2', status: 'completed' }),
        ]}
      />,
    );

    expect(screen.getByTestId('activity-tree')).toHaveAttribute(
      'data-status',
      'failed',
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('defaultOpen 可覆盖默认折叠', () => {
    render(
      <ActivityTree
        records={[makeRecord()]}
        defaultOpen
      />,
    );

    expect(screen.getByTestId('activity-content')).toBeInTheDocument();
  });

  it('超过渲染上限时先展示 50 个,可展开/收起', () => {
    const records = Array.from({ length: 55 }, (_, index) =>
      makeRecord({
        toolCallId: `tool-${index}`,
        toolName: `tool-${index}`,
      }),
    );

    render(<ActivityTree records={records} isStreaming />);

    expect(screen.getAllByTestId('tool-call')).toHaveLength(50);
    const showMore = screen.getByTestId('activity-show-more');
    expect(showMore).toHaveTextContent('Show 5 more');

    fireEvent.click(showMore);
    expect(screen.getAllByTestId('tool-call')).toHaveLength(55);

    fireEvent.click(screen.getByTestId('activity-show-less'));
    expect(screen.getAllByTestId('tool-call')).toHaveLength(50);
  });
});
