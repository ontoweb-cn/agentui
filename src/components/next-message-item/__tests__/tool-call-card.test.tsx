/**
 * ToolCallCard 单元测试（P1 测试补全）
 *
 * 覆盖点（参考 plan §8.1）：
 * - running/completed/failed 三种状态渲染
 * - 折叠/展开交互
 * - result 截断（>800 字符）
 * - safeStringify 处理 object/string/undefined
 * - durationMs 格式化（ms/s）
 */
import { ToolCallRecord } from '@/interfaces/database/chat';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCallCard } from '../tool-call-card';

// mock i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function makeRecord(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    toolCallId: 'tc-1',
    toolName: 'search',
    args: { query: 'hello' },
    result: 'result text',
    preview: 'searching...',
    status: 'completed',
    startedAt: Date.now(),
    durationMs: 1500,
    ...overrides,
  };
}

describe('ToolCallCard', () => {
  it('running 状态显示 spinner 和 running 标签', () => {
    render(<ToolCallCard record={makeRecord({ status: 'running' })} />);
    expect(screen.getByText('toolCall.running')).toBeInTheDocument();
    expect(screen.getByText('search')).toBeInTheDocument();
    expect(screen.getByText('searching...')).toBeInTheDocument();
  });

  it('completed 状态显示完成图标和 completed 标签', () => {
    render(<ToolCallCard record={makeRecord({ status: 'completed' })} />);
    expect(screen.getByText('toolCall.completed')).toBeInTheDocument();
  });

  it('failed 状态显示错误图标和 failed 标签', () => {
    render(<ToolCallCard record={makeRecord({ status: 'failed' })} />);
    expect(screen.getByText('toolCall.failed')).toBeInTheDocument();
  });

  it('默认折叠，点击 header 展开', () => {
    render(<ToolCallCard record={makeRecord()} />);
    // 折叠状态：args/result 不显示
    expect(screen.queryByText('args:')).not.toBeInTheDocument();
    // 点击展开
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('args:')).toBeInTheDocument();
    expect(screen.getByText('result:')).toBeInTheDocument();
  });

  it('defaultOpen=true 时默认展开', () => {
    render(<ToolCallCard record={makeRecord()} defaultOpen={true} />);
    expect(screen.getByText('args:')).toBeInTheDocument();
  });

  it('failed 状态显示 error: 而非 result:', () => {
    render(<ToolCallCard record={makeRecord({ status: 'failed' })} defaultOpen={true} />);
    expect(screen.getByText('error:')).toBeInTheDocument();
    expect(screen.queryByText('result:')).not.toBeInTheDocument();
  });

  it('result 超过 800 字符被截断', () => {
    const longResult = 'x'.repeat(1000);
    render(
      <ToolCallCard
        record={makeRecord({ result: longResult })}
        defaultOpen={true}
      />,
    );
    // 截断后包含 truncation 标记
    expect(screen.getByText(/truncated/)).toBeInTheDocument();
  });

  it('durationMs < 1000 显示 ms 单位', () => {
    render(<ToolCallCard record={makeRecord({ durationMs: 500 })} />);
    expect(screen.getByText('500ms')).toBeInTheDocument();
  });

  it('durationMs >= 1000 显示 s 单位', () => {
    render(<ToolCallCard record={makeRecord({ durationMs: 1500 })} />);
    expect(screen.getByText('1.5s')).toBeInTheDocument();
  });

  it('无 durationMs 时不显示时长', () => {
    render(<ToolCallCard record={makeRecord({ durationMs: undefined })} />);
    // 不存在包含 ms 或 s 的时长标签
    expect(screen.queryByText(/^\d+ms$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+\.\d+s$/)).not.toBeInTheDocument();
  });

  it('args 为对象时 JSON.stringify 格式化', () => {
    render(
      <ToolCallCard
        record={makeRecord({ args: { key: 'value' } })}
        defaultOpen={true}
      />,
    );
    expect(screen.getByText(/"key": "value"/)).toBeInTheDocument();
  });

  it('args 为 string 时直接显示', () => {
    render(
      <ToolCallCard
        record={makeRecord({ args: 'plain string' })}
        defaultOpen={true}
      />,
    );
    expect(screen.getByText('plain string')).toBeInTheDocument();
  });

  it('args 为 undefined 时不显示 args 区块', () => {
    render(
      <ToolCallCard
        record={makeRecord({ args: undefined })}
        defaultOpen={true}
      />,
    );
    expect(screen.queryByText('args:')).not.toBeInTheDocument();
  });
});
