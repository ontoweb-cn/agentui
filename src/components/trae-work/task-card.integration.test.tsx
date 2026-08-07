// spec-013 P1-8: TaskCard i18n 集成测试。
// 验证 task-card 组件在多语言切换下的行为:
// - 状态标签随 i18n 语言切换更新
// - aria-label / title 随语言切换更新
// - 缺失翻译 key 的回退行为
// - 多语言下的渲染一致性
// 与 task-card.test.tsx(单元测试)互补,本文件聚焦 i18n 跨语言场景。

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

const zhResources = {
  taskCard: {
    statusRunning: '进行中',
    statusCompleted: '已完成',
    statusFailed: '失败',
    statusCancelled: '已取消',
    statusPending: '待处理',
    retry: '重试',
    delete: '删除',
  },
};

const arResources = {
  taskCard: {
    statusRunning: 'قيد التشغيل',
    statusCompleted: 'مكتمل',
    statusFailed: 'فشل',
    statusCancelled: 'ملغى',
    statusPending: 'قيد الانتظار',
    retry: 'إعادة المحاولة',
    delete: 'حذف',
  },
};

// ── Helpers ────────────────────────────────────────────────────────────

function makeProps(overrides: Partial<TaskCardProps> = {}): TaskCardProps {
  return {
    id: 'task-i18n',
    title: '测试任务',
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

/** 创建带指定语言资源的 i18n 实例 */
function createI18nInstance(resources: Record<string, unknown>, lng: string = 'en') {
  const instance = i18n.createInstance();
  instance.init({
    lng,
    fallbackLng: 'en',
    resources: {
      en: { translation: enResources },
      zh: { translation: zhResources },
      ar: { translation: arResources },
      ...(resources as Record<string, unknown>),
    },
    interpolation: { escapeValue: false },
  });
  return instance;
}

/** 用指定 i18n 实例渲染组件 */
function renderWithI18n(ui: React.ReactElement, instance: typeof i18n) {
  return render(<I18nextProvider i18n={instance}>{ui}</I18nextProvider>);
}

// ===========================================================================
// 1. 状态标签 i18n 切换
// ===========================================================================

describe('TaskCard i18n 集成 - 状态标签多语言', () => {
  afterEach(cleanup);

  it('en:所有状态标签为英文', () => {
    const instance = createI18nInstance({}, 'en');
    const statuses: Array<{ status: TaskCardProps['status']; expected: string }> = [
      { status: 'running', expected: 'Running' },
      { status: 'completed', expected: 'Completed' },
      { status: 'failed', expected: 'Failed' },
      { status: 'cancelled', expected: 'Cancelled' },
      { status: 'pending', expected: 'Pending' },
    ];

    for (const { status, expected } of statuses) {
      cleanup();
      renderWithI18n(
        <TaskCard {...makeProps({ status, currentStep: undefined, progress: undefined })} />,
        instance,
      );
      expect(screen.getByText(expected)).toBeInTheDocument();
    }
  });

  it('zh:所有状态标签为中文', () => {
    const instance = createI18nInstance({}, 'zh');
    const statuses: Array<{ status: TaskCardProps['status']; expected: string }> = [
      { status: 'running', expected: '进行中' },
      { status: 'completed', expected: '已完成' },
      { status: 'failed', expected: '失败' },
      { status: 'cancelled', expected: '已取消' },
      { status: 'pending', expected: '待处理' },
    ];

    for (const { status, expected } of statuses) {
      cleanup();
      renderWithI18n(
        <TaskCard {...makeProps({ status, currentStep: undefined, progress: undefined })} />,
        instance,
      );
      expect(screen.getByText(expected)).toBeInTheDocument();
    }
  });

  it('ar:所有状态标签为阿拉伯语(RTL 语言)', () => {
    const instance = createI18nInstance({}, 'ar');
    const statuses: Array<{ status: TaskCardProps['status']; expected: string }> = [
      { status: 'running', expected: 'قيد التشغيل' },
      { status: 'completed', expected: 'مكتمل' },
      { status: 'failed', expected: 'فشل' },
      { status: 'cancelled', expected: 'ملغى' },
      { status: 'pending', expected: 'قيد الانتظار' },
    ];

    for (const { status, expected } of statuses) {
      cleanup();
      renderWithI18n(
        <TaskCard {...makeProps({ status, currentStep: undefined, progress: undefined })} />,
        instance,
      );
      expect(screen.getByText(expected)).toBeInTheDocument();
    }
  });
});

// ===========================================================================
// 2. 操作按钮 aria-label / title i18n 切换
// ===========================================================================

describe('TaskCard i18n 集成 - 操作按钮多语言', () => {
  afterEach(cleanup);

  it('en:retry 按钮 aria-label 和 title 为 "Retry"', () => {
    const instance = createI18nInstance({}, 'en');
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'failed', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    expect(retryBtn).toHaveAttribute('aria-label', 'Retry');
    expect(retryBtn).toHaveAttribute('title', 'Retry');
  });

  it('zh:retry 按钮 aria-label 和 title 为 "重试"', () => {
    const instance = createI18nInstance({}, 'zh');
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'failed', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    const retryBtn = screen.getByRole('button', { name: '重试' });
    expect(retryBtn).toHaveAttribute('aria-label', '重试');
    expect(retryBtn).toHaveAttribute('title', '重试');
  });

  it('en:delete 按钮 aria-label 和 title 为 "Delete"', () => {
    const instance = createI18nInstance({}, 'en');
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'failed', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    const deleteBtn = screen.getByRole('button', { name: 'Delete' });
    expect(deleteBtn).toHaveAttribute('aria-label', 'Delete');
    expect(deleteBtn).toHaveAttribute('title', 'Delete');
  });

  it('zh:delete 按钮 aria-label 和 title 为 "删除"', () => {
    const instance = createI18nInstance({}, 'zh');
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'failed', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    const deleteBtn = screen.getByRole('button', { name: '删除' });
    expect(deleteBtn).toHaveAttribute('aria-label', '删除');
    expect(deleteBtn).toHaveAttribute('title', '删除');
  });

  it('ar:retry/delete 按钮为阿拉伯语', () => {
    const instance = createI18nInstance({}, 'ar');
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'failed', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حذف' })).toBeInTheDocument();
  });
});

// ===========================================================================
// 3. 动态语言切换(rerender with different i18n)
// ===========================================================================

describe('TaskCard i18n 集成 - 动态语言切换', () => {
  afterEach(cleanup);

  it('语言切换 en → zh:状态标签从 Running 变为 进行中', () => {
    const instance = createI18nInstance({}, 'en');
    const { rerender } = renderWithI18n(
      <TaskCard {...makeProps({ status: 'running', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    expect(screen.getByText('Running')).toBeInTheDocument();

    // 切换到中文
    instance.changeLanguage('zh');
    rerender(
      <I18nextProvider i18n={instance}>
        <TaskCard {...makeProps({ status: 'running', currentStep: undefined, progress: undefined })} />
      </I18nextProvider>,
    );
    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
  });

  it('语言切换 zh → en:状态标签从 失败 变为 Failed', () => {
    const instance = createI18nInstance({}, 'zh');
    const { rerender } = renderWithI18n(
      <TaskCard {...makeProps({ status: 'failed', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    expect(screen.getByText('失败')).toBeInTheDocument();

    instance.changeLanguage('en');
    rerender(
      <I18nextProvider i18n={instance}>
        <TaskCard {...makeProps({ status: 'failed', currentStep: undefined, progress: undefined })} />
      </I18nextProvider>,
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('语言切换 en → ar:RTL 语言下状态标签更新', () => {
    const instance = createI18nInstance({}, 'en');
    const { rerender } = renderWithI18n(
      <TaskCard {...makeProps({ status: 'completed', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    expect(screen.getByText('Completed')).toBeInTheDocument();

    instance.changeLanguage('ar');
    rerender(
      <I18nextProvider i18n={instance}>
        <TaskCard {...makeProps({ status: 'completed', currentStep: undefined, progress: undefined })} />
      </I18nextProvider>,
    );
    expect(screen.getByText('مكتمل')).toBeInTheDocument();
  });
});

// ===========================================================================
// 4. 缺失翻译 key 回退行为
// ===========================================================================

describe('TaskCard i18n 集成 - 翻译 key 回退', () => {
  afterEach(cleanup);

  it('语言资源缺失 key 时回退到 en(fallbackLng)', () => {
    // 创建只含部分翻译的语言实例
    const instance = i18n.createInstance();
    instance.init({
      lng: 'fr',
      fallbackLng: 'en',
      resources: {
        en: { translation: enResources },
        fr: {
          translation: {
            taskCard: {
              statusRunning: 'En cours',
              // 其他 key 缺失,应回退到 en
            },
          },
        },
      },
      interpolation: { escapeValue: false },
    });

    renderWithI18n(
      <TaskCard {...makeProps({ status: 'running', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    // statusRunning 有法语翻译
    expect(screen.getByText('En cours')).toBeInTheDocument();

    cleanup();
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'failed', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    // statusFailed 缺失法语翻译 → 回退到 en "Failed"
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('完全缺失语言的 key 回退到 en', () => {
    const instance = i18n.createInstance();
    instance.init({
      lng: 'klingon',
      fallbackLng: 'en',
      resources: {
        en: { translation: enResources },
      },
      interpolation: { escapeValue: false },
    });

    renderWithI18n(
      <TaskCard {...makeProps({ status: 'running', currentStep: undefined, progress: undefined })} />,
      instance,
    );
    // klingon 无资源,回退到 en
    expect(screen.getByText('Running')).toBeInTheDocument();
  });
});

// ===========================================================================
// 5. compact 模式下不渲染状态标签
// ===========================================================================

describe('TaskCard i18n 集成 - compact 模式 i18n 行为', () => {
  afterEach(cleanup);

  it('compact 模式不渲染状态标签(任何语言)', () => {
    const enInstance = createI18nInstance({}, 'en');
    const { rerender } = renderWithI18n(
      <TaskCard {...makeProps({ compact: true })} />,
      enInstance,
    );
    expect(screen.queryByText('Running')).not.toBeInTheDocument();

    // 切换到 zh
    const zhInstance = createI18nInstance({}, 'zh');
    rerender(
      <I18nextProvider i18n={zhInstance}>
        <TaskCard {...makeProps({ compact: true })} />
      </I18nextProvider>,
    );
    expect(screen.queryByText('进行中')).not.toBeInTheDocument();
  });

  it('compact 模式不渲染操作按钮(任何语言)', () => {
    const enInstance = createI18nInstance({}, 'en');
    renderWithI18n(
      <TaskCard {...makeProps({ compact: true, status: 'failed' })} />,
      enInstance,
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

// ===========================================================================
// 6. 交互行为在不同语言下保持一致
// ===========================================================================

describe('TaskCard i18n 集成 - 交互行为语言无关性', () => {
  afterEach(cleanup);

  it('zh:点击 retry 按钮正确触发 onRetry 回调', () => {
    const onRetry = jest.fn();
    const instance = createI18nInstance({}, 'zh');
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'failed', onRetry, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledWith('task-i18n');
  });

  it('ar:点击 delete 按钮正确触发 onDelete 回调', () => {
    const onDelete = jest.fn();
    const instance = createI18nInstance({}, 'ar');
    renderWithI18n(
      <TaskCard {...makeProps({ status: 'failed', onDelete, currentStep: undefined, progress: undefined })} />,
      instance,
    );
    fireEvent.click(screen.getByRole('button', { name: 'حذف' }));
    expect(onDelete).toHaveBeenCalledWith('task-i18n');
  });

  it('zh:点击卡片正确触发 onClick 回调', () => {
    const onClick = jest.fn();
    const instance = createI18nInstance({}, 'zh');
    renderWithI18n(
      <TaskCard {...makeProps({ onClick })} />,
      instance,
    );
    fireEvent.click(screen.getByTestId('task-card-task-i18n'));
    expect(onClick).toHaveBeenCalledWith('task-i18n');
  });

  it('ar:Enter 键触发 onClick(语言无关)', () => {
    const onClick = jest.fn();
    const instance = createI18nInstance({}, 'ar');
    renderWithI18n(
      <TaskCard {...makeProps({ onClick })} />,
      instance,
    );
    const card = screen.getByTestId('task-card-task-i18n');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledWith('task-i18n');
  });
});

// ===========================================================================
// 7. 状态颜色不随语言变化(视觉一致性)
// ===========================================================================

describe('TaskCard i18n 集成 - 状态颜色语言无关', () => {
  afterEach(cleanup);

  it('running 状态颜色在 en/zh/ar 下一致', () => {
    const enInstance = createI18nInstance({}, 'en');
    const { rerender } = renderWithI18n(
      <TaskCard {...makeProps({ status: 'running', currentStep: undefined, progress: undefined })} />,
      enInstance,
    );
    const enCard = screen.getByTestId('task-card-task-i18n');
    const enStatusColor = enCard.querySelector('span[style]')?.getAttribute('style');

    const zhInstance = createI18nInstance({}, 'zh');
    rerender(
      <I18nextProvider i18n={zhInstance}>
        <TaskCard {...makeProps({ status: 'running', currentStep: undefined, progress: undefined })} />
      </I18nextProvider>,
    );
    const zhCard = screen.getByTestId('task-card-task-i18n');
    const zhStatusColor = zhCard.querySelector('span[style]')?.getAttribute('style');

    // 状态圆点颜色应一致(语言不影响视觉)
    expect(enStatusColor).toBe(zhStatusColor);
  });

  it('failed 状态颜色在 en/zh 下一致', () => {
    const enInstance = createI18nInstance({}, 'en');
    const { rerender } = renderWithI18n(
      <TaskCard {...makeProps({ status: 'failed', currentStep: undefined, progress: undefined })} />,
      enInstance,
    );
    const enCard = screen.getByTestId('task-card-task-i18n');
    const enStatusColor = enCard.querySelector('span[style]')?.getAttribute('style');

    const zhInstance = createI18nInstance({}, 'zh');
    rerender(
      <I18nextProvider i18n={zhInstance}>
        <TaskCard {...makeProps({ status: 'failed', currentStep: undefined, progress: undefined })} />
      </I18nextProvider>,
    );
    const zhCard = screen.getByTestId('task-card-task-i18n');
    const zhStatusColor = zhCard.querySelector('span[style]')?.getAttribute('style');

    expect(enStatusColor).toBe(zhStatusColor);
  });
});
