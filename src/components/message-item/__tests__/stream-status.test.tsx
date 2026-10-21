import { act, render, screen } from '@testing-library/react';

import { StreamStatus } from '../stream-status';

describe('StreamStatus', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('非流式且无完成记录时不渲染', () => {
    const { container } = render(<StreamStatus isStreaming={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('流式中显示计时与工具数量', () => {
    render(<StreamStatus isStreaming toolCount={2} />);

    expect(screen.getByTestId('stream-status')).toHaveAttribute(
      'data-state',
      'streaming',
    );
    expect(screen.getByText('Working for 0s')).toBeInTheDocument();
    expect(screen.getByText(/2 tools/)).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.getByText('Working for 2s')).toBeInTheDocument();
  });

  it('流式完成后显示 Done in Xs,并在 3 秒后自动隐藏', () => {
    const { rerender } = render(<StreamStatus isStreaming />);

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    rerender(<StreamStatus isStreaming={false} />);

    expect(screen.getByText('Done in 2s')).toBeInTheDocument();
    expect(screen.getByTestId('stream-status')).toHaveAttribute(
      'data-state',
      'done',
    );

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(screen.queryByTestId('stream-status')).not.toBeInTheDocument();
  });

  it('支持外部 startedAt 作为计时起点', () => {
    const now = Date.now();
    render(<StreamStatus isStreaming startedAt={now - 5000} />);

    expect(screen.getByText('Working for 5s')).toBeInTheDocument();
  });

  it('非法/未来 startedAt 回退到当前时间', () => {
    const { rerender } = render(
      <StreamStatus isStreaming startedAt={Number.NaN} />,
    );
    expect(screen.getByText('Working for 0s')).toBeInTheDocument();

    rerender(
      <StreamStatus isStreaming startedAt={Date.now() + 60_000} />,
    );
    expect(screen.getByText('Working for 0s')).toBeInTheDocument();
  });

  it('failed 终态显示 Failed after，而不是 Done', () => {
    const { rerender } = render(<StreamStatus isStreaming />);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    rerender(<StreamStatus isStreaming={false} terminalState="failed" />);

    expect(screen.getByText('Failed after 1s')).toBeInTheDocument();
    expect(screen.getByTestId('stream-status')).toHaveAttribute(
      'data-state',
      'failed',
    );
  });

  it('stopped 终态显示 Stopped after', () => {
    const { rerender } = render(<StreamStatus isStreaming />);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    rerender(<StreamStatus isStreaming={false} terminalState="stopped" />);

    expect(screen.getByText('Stopped after 1s')).toBeInTheDocument();
    expect(screen.getByTestId('stream-status')).toHaveAttribute(
      'data-state',
      'stopped',
    );
  });

  it('第二轮流式不复用上一轮的 startedAt', () => {
    const staleStart = Date.now() - 5000;
    const { rerender } = render(
      <StreamStatus isStreaming startedAt={staleStart} />,
    );
    expect(screen.getByText('Working for 5s')).toBeInTheDocument();

    rerender(<StreamStatus isStreaming={false} startedAt={staleStart} />);
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    rerender(<StreamStatus isStreaming startedAt={staleStart} />);
    expect(screen.getByText('Working for 0s')).toBeInTheDocument();
  });
});
