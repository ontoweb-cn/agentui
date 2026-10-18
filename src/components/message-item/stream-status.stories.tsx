import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { useEffect, useRef, useState } from 'react';

import { StreamStatus } from './stream-status';

const meta = {
  title: 'Message/StreamStatus',
  component: StreamStatus,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof StreamStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 终态需要先经历 streaming → done 的状态迁移,否则组件按设计不渲染。 */
function TerminalStory({
  terminalState,
  elapsedMs,
}: {
  terminalState: 'done' | 'failed' | 'stopped';
  elapsedMs: number;
}) {
  const [streaming, setStreaming] = useState(true);
  const startedAt = useRef(Date.now() - elapsedMs).current;

  useEffect(() => {
    // 同步切到终态,避免 Chromatic 在 100ms 延迟内截到 streaming 中间态。
    setStreaming(false);
  }, []);

  return (
    <StreamStatus
      isStreaming={streaming}
      terminalState={terminalState}
      startedAt={startedAt}
    />
  );
}

export const Streaming: Story = {
  args: { isStreaming: true, toolCount: 2 },
};

export const Done: Story = {
  args: { isStreaming: true },
  render: () => <TerminalStory terminalState="done" elapsedMs={12_000} />,
};

export const Failed: Story = {
  args: { isStreaming: true },
  render: () => <TerminalStory terminalState="failed" elapsedMs={8_000} />,
};

export const Stopped: Story = {
  args: { isStreaming: true },
  render: () => <TerminalStory terminalState="stopped" elapsedMs={5_000} />,
};
