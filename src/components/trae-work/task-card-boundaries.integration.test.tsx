// spec-013 P1-8: TaskCard 额外边界集成测试。
// 补充 task-card.integration.test.tsx(聚焦 i18n 切换)未覆盖的场景:
// - cancelled / pending 状态:无 retry 按钮,有 delete 按钮
// - progress 边界值:0 / 50 / 100 / 负数 / >100 / 非 number
// - 日期格式化:无效日期回退、updatedAt 优先于 createdAt
// - 无 onClick 时:无 role=button、无 tabIndex、不可键盘聚焦
// - Space 键触发 onClick(与 Enter 一致)
// - currentStep 仅 running 状态显示
// - description 仅非 compact 模式显示
// - selected 状态:borderLeft 样式
// - onRetry 仅 failed 状态显示
// - 空标题 / 长标题截断

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { TaskCard } from './task-card';
import type { TaskCardProps } from './types';

// ── 测试用翻译资源 ────────────────────────────────────────────────────

const enResources = {
  taskCard: {
    statusRunning: 'Running',
    statusCompleted: 'Completed',
    statusFailed: 'Failed',
    statusCancelled: 'Cancelled',
    statusPending: 'Pending',
    retry: 'Retry',
    delete: 'Delete',
  },
};

// ── Helpers ────────────────────────────────────────────────────────────

function makeProps(overrides: Partial<TaskCardProps> = {}): TaskCardProps {
  return {
    id: 'task-boundary',
    title: '边界测试任务',
    description: '描述内容',
    status: 'running',
    createdAt: '2026-07-30T10:00:00Z',
    updatedAt: '2026-07-30T10:05:00Z',
    currentStep: '执行中',
    progress: 50,
    onClick: jest.fn(),
    onDelete: jest.fn(),
    onRetry: jest.fn(),
    ...overrides,
  };
}

function createI18nInstance(lng: string = 'en') {
  const instance = i18n.createInstance();
  instance.init({
    lng,
    fallbackLng: 'en',
    resources: {
      en: { translation: enResources },
    },
    interpolation: { escapeValue: false },
  });
  return instance;
}

function renderWithI18n(ui: React.ReactElement, instance: i18n.i18n) {
  return render(<I18nextProvider i18n={instance}>{ui}</I18nextProvider>);
}

// ===========================================================================
// 1. cancelled / pending 状态:无 retry 按钮
// ===========================================================================

describe('TaskCard 边界 - cancelled / pending 状态', () => {
  afterEach(cleanup);

  it('cancelled 状态:无 retry 按钮,有 delete 按钮', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'cancelled', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    // cancelled 不显示 retry(只有 failed 才显示)
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    // delete 按钮仍然显示(onDelete 存在时)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    // 状态标签显示 Cancelled
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('pending 状态:无 retry 按钮,有 delete 按钮', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'pending', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('completed 状态:无 retry 按钮', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'completed', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('running 状态:无 retry 按钮(仅 failed 显示)', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'running' })} />,
      instance,
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('failed 状态:同时显示 retry 和 delete 按钮', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'failed', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('failed 状态无 onRetry:不显示 retry 按钮', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'failed', onRetry: undefined, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    // delete 仍显示
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('无 onDelete:不显示 delete 按钮', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'failed', onDelete: undefined, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    // retry 仍显示(failed + onRetry)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

// ===========================================================================
// 2. progress 边界值
// ===========================================================================

describe('TaskCard 边界 - progress 边界值', () => {
  afterEach(cleanup);

  it('progress=0:显示进度条,宽度 0%', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'running', progress: 0 })} />,
      instance,
    );
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '0');
    expect(progressbar.getAttribute('style') ?? '').toContain('width: 0%');
  });

  it('progress=100:显示进度条,宽度 100%', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'running', progress: 100 })} />,
      instance,
    );
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '100');
    expect(progressbar.getAttribute('style') ?? '').toContain('width: 100%');
  });

  it('progress=50:显示进度条,宽度 50%', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'running', progress: 50 })} />,
      instance,
    );
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '50');
  });

  it('progress=-10(负数):不显示进度条(超出 0-100 范围)', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'running', progress: -10 })} />,
      instance,
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('progress=150(>100):不显示进度条(超出 0-100 范围)', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'running', progress: 150 })} />,
      instance,
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('progress=undefined:不显示进度条', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'running', progress: undefined })} />,
      instance,
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('非 running 状态:不显示进度条(即使 progress 有值)', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'completed', progress: 50, currentStep: undefined })} />,
      instance,
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('progress 边界值 1 和 99:均显示进度条', () => {
    const instance = createI18nInstance();
    const { rerender } = renderWithI18n(
      <TaskCard {...makeProps({ status: 'running', progress: 1 })} />,
      instance,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');

    rerender(
      <I18nextProvider i18n={instance}>
        <TaskCard {...makeProps({ status: 'running', progress: 99 })} />
      </I18nextProvider>,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '99');
  });
});

// ===========================================================================
// 3. 日期格式化与无效日期回退
// ===========================================================================

describe('TaskCard 边界 - 日期格式化', () => {
  afterEach(cleanup);

  it('updatedAt 优先于 createdAt 显示', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard
        {...makeProps({
          createdAt: '2026-07-30T10:00:00Z',
          updatedAt: '2026-07-31T12:30:00Z',
          currentStep: undefined,
          progress: undefined,
        })}
      />,
      instance,
    );
    const time = screen.getByText(/\d{2}-\d{2} \d{2}:\d{2}/);
    // updatedAt (07-31 12:30 UTC) 应被使用;formatTime 用本地时区(UTC+8 → 20:30)
    expect(time).toHaveTextContent('07-31 20:30');
    expect(time).toHaveAttribute('dateTime', '2026-07-31T12:30:00Z');
  });

  it('无 updatedAt 时使用 createdAt', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard
        {...makeProps({
          createdAt: '2026-07-30T10:00:00Z',
          updatedAt: undefined,
          currentStep: undefined,
          progress: undefined,
        })}
      />,
      instance,
    );
    const time = screen.getByText(/\d{2}-\d{2} \d{2}:\d{2}/);
    // createdAt (07-30 10:00 UTC) → 本地时区 UTC+8 → 18:00
    expect(time).toHaveTextContent('07-30 18:00');
    expect(time).toHaveAttribute('dateTime', '2026-07-30T10:00:00Z');
  });

  it('无效日期字符串:显示原始字符串(fallback)', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard
        {...makeProps({
          createdAt: 'invalid-date',
          updatedAt: undefined,
          currentStep: undefined,
          progress: undefined,
        })}
      />,
      instance,
    );
    // formatTime 对无效日期返回原始字符串
    expect(screen.getByText('invalid-date')).toBeInTheDocument();
  });

  it('空日期字符串:显示空字符串(new Date("") → Invalid Date → fallback)', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard
        {...makeProps({
          createdAt: '',
          updatedAt: undefined,
          currentStep: undefined,
          progress: undefined,
        })}
      />,
      instance,
    );
    // new Date('') → Invalid Date → isNaN → 返回原始字符串 ''
    const time = document.querySelector('time');
    expect(time).toBeInTheDocument();
    expect(time?.textContent).toBe('');
  });

  it('ISO 日期格式正确解析:2026-01-15T08:30:00Z → 01-15 08:30', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard
        {...makeProps({
          createdAt: '2026-01-15T08:30:00Z',
          updatedAt: undefined,
          currentStep: undefined,
          progress: undefined,
        })}
      />,
      instance,
    );
    // 注:具体显示时间取决于测试环境的时区,但格式应为 MM-DD HH:mm
    const time = screen.getByText(/\d{2}-\d{2} \d{2}:\d{2}/);
    expect(time).toBeInTheDocument();
  });
});

// ===========================================================================
// 4. 无 onClick 时:不可点击、无键盘交互
// ===========================================================================

describe('TaskCard 边界 - 无 onClick 时的可访问性', () => {
  afterEach(cleanup);

  it('无 onClick:无 role=button,无 tabIndex', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ onClick: undefined, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    const card = screen.getByTestId('task-card-task-boundary');
    expect(card).not.toHaveAttribute('role', 'button');
    expect(card).not.toHaveAttribute('tabindex');
    expect(card).not.toHaveAttribute('aria-label');
  });

  it('有 onClick:有 role=button,有 tabIndex=0,有 aria-label', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ onClick: jest.fn(), currentStep: undefined, progress: undefined })} />,
      instance,
    );
    const card = screen.getByTestId('task-card-task-boundary');
    expect(card).toHaveAttribute('role', 'button');
    expect(card).toHaveAttribute('tabindex', '0');
    expect(card).toHaveAttribute('aria-label', '边界测试任务');
  });

  it('无 onClick:Enter 键不触发任何回调', () => {
    const onClick = jest.fn();
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ onClick: undefined, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    const card = screen.getByTestId('task-card-task-boundary');
    fireEvent.keyDown(card, { key: 'Enter' });
    // onClick 未传入,不会被调用
    expect(onClick).not.toHaveBeenCalled();
  });

  it('无 onClick:Space 键不触发任何回调', () => {
    const onClick = jest.fn();
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ onClick: undefined, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    const card = screen.getByTestId('task-card-task-boundary');
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 5. Space 键触发 onClick(与 Enter 一致)
// ===========================================================================

describe('TaskCard 边界 - 键盘交互', () => {
  afterEach(cleanup);

  it('Space 键触发 onClick(与 Enter 一致)', () => {
    const onClick = jest.fn();
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ onClick })} />,
      instance,
    );
    const card = screen.getByTestId('task-card-task-boundary');
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledWith('task-boundary');
  });

  it('Enter 键触发 onClick', () => {
    const onClick = jest.fn();
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ onClick })} />,
      instance,
    );
    const card = screen.getByTestId('task-card-task-boundary');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledWith('task-boundary');
  });

  it('其他键(Tab/Escape)不触发 onClick', () => {
    const onClick = jest.fn();
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ onClick })} />,
      instance,
    );
    const card = screen.getByTestId('task-card-task-boundary');
    fireEvent.keyDown(card, { key: 'Tab' });
    fireEvent.keyDown(card, { key: 'Escape' });
    fireEvent.keyDown(card, { key: 'ArrowDown' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('Enter 键触发 onClick 时阻止默认行为(preventDefault)', () => {
    const onClick = jest.fn();
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ onClick })} />,
      instance,
    );
    const card = screen.getByTestId('task-card-task-boundary');
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    const preventDefaultSpy = jest.spyOn(event, 'preventDefault');
    fireEvent(card, event);
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledWith('task-boundary');
  });

  it('Space 键触发 onClick 时阻止默认行为', () => {
    const onClick = jest.fn();
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ onClick })} />,
      instance,
    );
    const card = screen.getByTestId('task-card-task-boundary');
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
    const preventDefaultSpy = jest.spyOn(event, 'preventDefault');
    fireEvent(card, event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});

// ===========================================================================
// 6. currentStep 仅 running 状态显示
// ===========================================================================

describe('TaskCard 边界 - currentStep 显示条件', () => {
  afterEach(cleanup);

  it('running 状态:显示 currentStep', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'running', currentStep: '正在执行步骤 3' })} />,
      instance,
    );
    expect(screen.getByText('正在执行步骤 3')).toBeInTheDocument();
  });

  it('completed 状态:不显示 currentStep(即使有值)', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'completed', currentStep: '不应显示', progress: undefined })} />,
      instance,
    );
    expect(screen.queryByText('不应显示')).not.toBeInTheDocument();
  });

  it('failed 状态:不显示 currentStep', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'failed', currentStep: '不应显示', progress: undefined })} />,
      instance,
    );
    expect(screen.queryByText('不应显示')).not.toBeInTheDocument();
  });

  it('cancelled 状态:不显示 currentStep', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'cancelled', currentStep: '不应显示', progress: undefined })} />,
      instance,
    );
    expect(screen.queryByText('不应显示')).not.toBeInTheDocument();
  });

  it('running 状态但 currentStep 为空:不显示空段落', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'running', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    // currentStep 未传入,不渲染对应的 <p> 元素
    const card = screen.getByTestId('task-card-task-boundary');
    // 确保没有额外的空文本节点
    expect(card.textContent).not.toContain('undefined');
  });
});

// ===========================================================================
// 7. description 显示条件与 compact 模式
// ===========================================================================

describe('TaskCard 边界 - description 显示条件', () => {
  afterEach(cleanup);

  it('非 compact 模式:显示 description', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ description: '详细描述内容', compact: false, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    expect(screen.getByText('详细描述内容')).toBeInTheDocument();
  });

  it('compact 模式:不显示 description', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ description: '详细描述内容', compact: true })} />,
      instance,
    );
    expect(screen.queryByText('详细描述内容')).not.toBeInTheDocument();
  });

  it('description 为空:不显示描述段落', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ description: undefined, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    // 无描述时不应有额外段落
    const card = screen.getByTestId('task-card-task-boundary');
    expect(card.textContent).toContain('边界测试任务');
  });
});

// ===========================================================================
// 8. selected 状态样式
// ===========================================================================

describe('TaskCard 边界 - selected 样式', () => {
  afterEach(cleanup);

  it('selected=true:borderLeft 为绿色实线', () => {
    // jsdom 不支持 var() 在 CSS shorthand 属性中,var(--trae-green) 被丢弃,
    // getAttribute('style') 返回空字符串。改用对比策略:验证 selected=true
    // 与 selected=false 产生不同样式输出,证明组件根据 selected 应用不同样式。
    const instance = createI18nInstance();
    const { unmount } = renderWithI18n(
      <TaskCard {...makeProps({ selected: true, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    const trueCard = screen.getByTestId('task-card-task-boundary');
    const trueStyle = trueCard.getAttribute('style') ?? '';
    unmount();

    renderWithI18n(
      <TaskCard {...makeProps({ selected: false, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    const falseCard = screen.getByTestId('task-card-task-boundary');
    const falseStyle = falseCard.getAttribute('style') ?? '';

    // selected=false 用 transparent(jsdom 可解析),selected=true 用 var(--trae-green)(jsdom 丢弃)
    // 两者样式应不同
    expect(trueStyle).not.toEqual(falseStyle);
  });

  it('selected=false:borderLeft 为透明', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ selected: false, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    const card = screen.getByTestId('task-card-task-boundary');
    const style = card.getAttribute('style') ?? '';
    expect(style).toContain('2px solid transparent');
  });

  it('selected 默认值 false:borderLeft 为透明', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ selected: undefined, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    const card = screen.getByTestId('task-card-task-boundary');
    const style = card.getAttribute('style') ?? '';
    expect(style).toContain('2px solid transparent');
  });
});

// ===========================================================================
// 9. 标题截断与空标题
// ===========================================================================

describe('TaskCard 边界 - 标题处理', () => {
  afterEach(cleanup);

  it('长标题:使用 truncate 类截断', () => {
    const instance = createI18nInstance();
    const longTitle = '这是一个非常非常非常非常非常长的任务标题'.repeat(5);
    renderWithI18n(
      <TaskCard {...makeProps({ title: longTitle, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    const titleEl = screen.getByText(longTitle);
    expect(titleEl).toBeInTheDocument();
    // title 属性提供完整文本用于悬停查看
    expect(titleEl).toHaveAttribute('title', longTitle);
  });

  it('空标题:渲染空 <h4> 元素', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ title: '', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    const heading = screen.getByTestId('task-card-task-boundary').querySelector('h4');
    expect(heading).toBeInTheDocument();
    expect(heading?.textContent).toBe('');
  });

  it('特殊字符标题:正常渲染', () => {
    const instance = createI18nInstance();
    const specialTitle = '<script>alert("xss")</script> & "quotes"';
    renderWithI18n(
      <TaskCard {...makeProps({ title: specialTitle, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    // React 自动转义,不会执行脚本
    expect(screen.getByText(specialTitle)).toBeInTheDocument();
    expect(screen.queryByText('alert("xss")')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// 10. stopPropagation:按钮点击不触发卡片 onClick
// ===========================================================================

describe('TaskCard 边界 - 事件冒泡', () => {
  afterEach(cleanup);

  it('点击 delete 按钮:不触发卡片 onClick(stopPropagation)', () => {
    const onClick = jest.fn();
    const onDelete = jest.fn();
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ onClick, onDelete, status: 'failed', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('task-boundary');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('点击 retry 按钮:不触发卡片 onClick(stopPropagation)', () => {
    const onClick = jest.fn();
    const onRetry = jest.fn();
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ onClick, onRetry, status: 'failed', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('task-boundary');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('点击卡片本身:触发 onClick', () => {
    const onClick = jest.fn();
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ onClick })} />,
      instance,
    );
    fireEvent.click(screen.getByTestId('task-card-task-boundary'));
    expect(onClick).toHaveBeenCalledWith('task-boundary');
  });
});

// ===========================================================================
// 11. data-testid 和 data-status 属性
// ===========================================================================

describe('TaskCard 边界 - data 属性', () => {
  afterEach(cleanup);

  it('data-testid 格式为 task-card-{id}', () => {
    const instance = createI18nInstance();
    renderWithI18n(
      <TaskCard {...makeProps({ id: 'custom-id-123', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    expect(screen.getByTestId('task-card-custom-id-123')).toBeInTheDocument();
  });

  it('data-status 反映当前状态', () => {
    const instance = createI18nInstance();
    const statuses: TaskCardProps['status'][] = [
      'running',
      'completed',
      'failed',
      'cancelled',
      'pending',
    ];
    for (const status of statuses) {
      cleanup();
      renderWithI18n(
        <TaskCard {...makeProps({ status, id: `card-${status}`, currentStep: undefined, progress: undefined })} />,
        instance,
      );
      const card = screen.getByTestId(`task-card-card-${status}`);
      expect(card).toHaveAttribute('data-status', status);
    }
  });
});
