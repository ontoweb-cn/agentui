/**
 * SlashCommandPalette 单元测试（P3 测试补全）
 *
 * 覆盖点（参考 plan §8.1）：
 * - 命令过滤（输入 /r 匹配 retry）
 * - 键盘导航（↑↓/Enter/Esc）
 * - 子参数加载（/model 触发模型列表）
 * - 点击外部关闭
 * - visible=false 时不渲染
 * - IME 输入不拦截
 *
 * 注：需 mock useFetchAllAddedModels（React Query hook）
 *
 * 历史问题修复：
 * - OOM 根因：原 mock `useFetchAllAddedModels: () => ({ data: [...] })` 每次返回新数组引用，
 *   导致组件 useEffect([parsed, allModels]) 无限触发 setModelSubArgs([]) → setState 循环。
 *   修复：用模块级常量 MOCK_MODELS，保证 data 引用稳定。
 * - 键盘测试失败：组件 keydown handler 校验 document.activeElement.tagName === 'TEXTAREA'，
 *   jsdom 默认 activeElement=body，handler 提前 return。修复：键盘测试前置创建 textarea 并 focus()。
 */
import { ICommandContext } from '@/interfaces/command';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SlashCommandPalette } from '../slash-command-palette';

// mock i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// 模块级常量：保证 data 引用稳定，避免 useEffect 无限触发
const MOCK_MODELS = [
  { name: 'gpt-4', provider_name: 'openai', instance_name: 'default' },
  { name: 'claude-3', provider_name: 'anthropic', instance_name: 'default' },
];

// mock useFetchAllAddedModels：返回稳定的 data 引用
// （React Query 在生产环境也会缓存 data 引用，此 mock 行为与生产一致）
jest.mock('@/hooks/use-llm-request', () => ({
  useFetchAllAddedModels: () => ({ data: MOCK_MODELS, loading: false }),
}));

const mockContext: ICommandContext = {
  retry: jest.fn(),
  undo: jest.fn(),
  status: jest.fn(),
  usage: jest.fn(),
  switchModel: jest.fn(),
};

/**
 * 创建并 focus 一个 textarea，使 document.activeElement.tagName === 'TEXTAREA'。
 * 组件 keydown handler 校验 activeElement 是 textarea 时才拦截按键。
 */
function setupFocusedTextarea(): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);
  textarea.focus();
  return textarea;
}

describe('SlashCommandPalette', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    // 清理可能残留的 textarea
    document.querySelectorAll('textarea').forEach((t) => t.remove());
  });

  it('visible=false 时不渲染', () => {
    render(
      <SlashCommandPalette
        value="/retry"
        visible={false}
        context={mockContext}
        onCommandExecuted={jest.fn()}
        onRequestClose={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('slash-command-palette')).not.toBeInTheDocument();
  });

  it('输入 / 显示所有命令', () => {
    render(
      <SlashCommandPalette
        value="/"
        visible={true}
        context={mockContext}
        onCommandExecuted={jest.fn()}
        onRequestClose={jest.fn()}
      />,
    );
    // BUILTIN_COMMANDS 有 5 个：retry/undo/status/usage/model
    expect(screen.getByText('/retry')).toBeInTheDocument();
    expect(screen.getByText('/undo')).toBeInTheDocument();
    expect(screen.getByText('/status')).toBeInTheDocument();
    expect(screen.getByText('/usage')).toBeInTheDocument();
    expect(screen.getByText('/model')).toBeInTheDocument();
  });

  it('输入 /r 仅匹配 retry', () => {
    render(
      <SlashCommandPalette
        value="/r"
        visible={true}
        context={mockContext}
        onCommandExecuted={jest.fn()}
        onRequestClose={jest.fn()}
      />,
    );
    expect(screen.getByText('/retry')).toBeInTheDocument();
    expect(screen.queryByText('/undo')).not.toBeInTheDocument();
  });

  it('输入 /xyz 无匹配时不渲染', () => {
    render(
      <SlashCommandPalette
        value="/xyz"
        visible={true}
        context={mockContext}
        onCommandExecuted={jest.fn()}
        onRequestClose={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('slash-command-palette')).not.toBeInTheDocument();
  });

  it('点击命令项执行并调用 onCommandExecuted', () => {
    const onCommandExecuted = jest.fn();
    render(
      <SlashCommandPalette
        value="/retry"
        visible={true}
        context={mockContext}
        onCommandExecuted={onCommandExecuted}
        onRequestClose={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByText('/retry'));
    expect(mockContext.retry).toHaveBeenCalled();
    expect(onCommandExecuted).toHaveBeenCalled();
  });

  it('/model 无 arg 时按 Enter 调用 onRequestClose（不执行 switchModel）', () => {
    const onRequestClose = jest.fn();
    setupFocusedTextarea();
    render(
      <SlashCommandPalette
        value="/model"
        visible={true}
        context={mockContext}
        onCommandExecuted={jest.fn()}
        onRequestClose={onRequestClose}
      />,
    );
    // 按 Enter 触发执行（/model 无 arg → executeCommand 内调用 onRequestClose 后 return）
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(mockContext.switchModel).not.toHaveBeenCalled();
    expect(onRequestClose).toHaveBeenCalled();
  });

  it('/model gpt 触发子参数列表', () => {
    render(
      <SlashCommandPalette
        value="/model gpt"
        visible={true}
        context={mockContext}
        onCommandExecuted={jest.fn()}
        onRequestClose={jest.fn()}
      />,
    );
    // 子参数列表显示匹配的模型
    expect(screen.getByText('gpt-4')).toBeInTheDocument();
  });

  it('点击模型名调用 switchModel', () => {
    const onCommandExecuted = jest.fn();
    render(
      <SlashCommandPalette
        value="/model gpt"
        visible={true}
        context={mockContext}
        onCommandExecuted={onCommandExecuted}
        onRequestClose={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByText('gpt-4'));
    expect(mockContext.switchModel).toHaveBeenCalledWith('gpt-4');
    expect(onCommandExecuted).toHaveBeenCalled();
  });

  it('键盘 ArrowDown 切换选中项', () => {
    setupFocusedTextarea();
    render(
      <SlashCommandPalette
        value="/"
        visible={true}
        context={mockContext}
        onCommandExecuted={jest.fn()}
        onRequestClose={jest.fn()}
      />,
    );
    // 初始 selectedIndex=0，第一个命令是 retry
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveClass('bg-muted');
    // ArrowDown 切换到第二个
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(items[1]).toHaveClass('bg-muted');
  });

  it('键盘 ArrowUp 在首项回环到最后项', () => {
    setupFocusedTextarea();
    render(
      <SlashCommandPalette
        value="/"
        visible={true}
        context={mockContext}
        onCommandExecuted={jest.fn()}
        onRequestClose={jest.fn()}
      />,
    );
    const items = screen.getAllByRole('listitem');
    // 初始 selectedIndex=0，ArrowUp 回环到最后
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    const lastIdx = items.length - 1;
    expect(items[lastIdx]).toHaveClass('bg-muted');
  });

  it('键盘 Enter 执行当前选中命令', () => {
    const onCommandExecuted = jest.fn();
    setupFocusedTextarea();
    render(
      <SlashCommandPalette
        value="/retry"
        visible={true}
        context={mockContext}
        onCommandExecuted={onCommandExecuted}
        onRequestClose={jest.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(mockContext.retry).toHaveBeenCalled();
    expect(onCommandExecuted).toHaveBeenCalled();
  });

  it('键盘 Escape 调用 onRequestClose', () => {
    const onRequestClose = jest.fn();
    setupFocusedTextarea();
    render(
      <SlashCommandPalette
        value="/retry"
        visible={true}
        context={mockContext}
        onCommandExecuted={jest.fn()}
        onRequestClose={onRequestClose}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onRequestClose).toHaveBeenCalled();
  });

  it('IME 输入时（keyCode 229）不拦截键盘事件', () => {
    setupFocusedTextarea();
    render(
      <SlashCommandPalette
        value="/retry"
        visible={true}
        context={mockContext}
        onCommandExecuted={jest.fn()}
        onRequestClose={jest.fn()}
      />,
    );
    // isComposing=true（用 keyCode 229 模拟）时 Enter 应被忽略
    fireEvent.keyDown(document, { key: 'Enter', keyCode: 229 });
    expect(mockContext.retry).not.toHaveBeenCalled();
  });

  it('textarea 未聚焦时不拦截键盘事件', () => {
    // 不调用 setupFocusedTextarea，activeElement=body
    render(
      <SlashCommandPalette
        value="/retry"
        visible={true}
        context={mockContext}
        onCommandExecuted={jest.fn()}
        onRequestClose={jest.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: 'Enter' });
    // handler 提前 return，retry 不被调用
    expect(mockContext.retry).not.toHaveBeenCalled();
  });

  it('点击外部触发 onRequestClose', () => {
    const onRequestClose = jest.fn();
    render(
      <SlashCommandPalette
        value="/retry"
        visible={true}
        context={mockContext}
        onCommandExecuted={jest.fn()}
        onRequestClose={onRequestClose}
      />,
    );
    // 模拟点击面板外部（document.body 不在 container 内）
    fireEvent.mouseDown(document.body);
    expect(onRequestClose).toHaveBeenCalled();
  });

  it('点击面板内部不触发 onRequestClose', () => {
    const onRequestClose = jest.fn();
    render(
      <SlashCommandPalette
        value="/retry"
        visible={true}
        context={mockContext}
        onCommandExecuted={jest.fn()}
        onRequestClose={onRequestClose}
      />,
    );
    // 点击面板内部
    fireEvent.mouseDown(screen.getByTestId('slash-command-palette'));
    expect(onRequestClose).not.toHaveBeenCalled();
  });
});
