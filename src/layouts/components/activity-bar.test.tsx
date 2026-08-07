// spec-013 P1-6: ActivityBar Jest 单元测试
// 覆盖:桌面端渲染/移动端 tab bar 模式/footer 自定义/模式切换回调/设置入口

import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';

import { ActivityBar } from './activity-bar';

// mock react-router Link 为简单 <a>
jest.mock('react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={to} {...(rest as Record<string, unknown>)}>
      {children}
    </a>
  ),
}));

jest.mock('@/routes', () => ({
  Routes: {
    Root: '/',
    UserSetting: '/user-setting',
  },
}));

describe('ActivityBar', () => {
  it('桌面端渲染模式导航 + 设置入口', () => {
    render(<ActivityBar value="work" onChange={jest.fn()} />);

    // nav 元素
    expect(screen.getByTestId('activity-bar')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '模式导航' })).toBeInTheDocument();

    // ModeSwitcher 内部渲染三个 radio
    expect(screen.getByRole('radio', { name: 'Work' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Code' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Canvas' })).toHaveAttribute('aria-checked', 'false');

    // 设置入口
    expect(screen.getByTestId('activity-bar-settings')).toBeInTheDocument();
    expect(screen.getByLabelText('设置')).toBeInTheDocument();
  });

  it('data-mode 属性反映当前模式', () => {
    const { rerender } = render(<ActivityBar value="work" onChange={jest.fn()} />);
    expect(screen.getByTestId('activity-bar')).toHaveAttribute('data-mode', 'work');

    rerender(<ActivityBar value="code" onChange={jest.fn()} />);
    expect(screen.getByTestId('activity-bar')).toHaveAttribute('data-mode', 'code');

    rerender(<ActivityBar value="canvas" onChange={jest.fn()} />);
    expect(screen.getByTestId('activity-bar')).toHaveAttribute('data-mode', 'canvas');
  });

  it('点击模式触发 onChange 回调', () => {
    const onChange = jest.fn();
    render(<ActivityBar value="work" onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Code' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('code');

    fireEvent.click(screen.getByRole('radio', { name: 'Canvas' }));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith('canvas');
  });

  it('点击当前激活模式不触发 onChange', () => {
    const onChange = jest.fn();
    render(<ActivityBar value="work" onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Work' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('设置入口链接到 UserSetting', () => {
    render(<ActivityBar value="work" onChange={jest.fn()} />);
    const settingsLink = screen.getByTestId('activity-bar-settings');
    expect(settingsLink).toHaveAttribute('href', '/user-setting');
  });

  it('移动端模式(mobile=true)渲染底部 tab bar', () => {
    render(<ActivityBar value="work" onChange={jest.fn()} mobile />);

    // 渲染 mobile testid,不渲染桌面端 testid
    expect(screen.getByTestId('activity-bar-mobile')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-bar')).not.toBeInTheDocument();

    // 仍渲染模式切换
    expect(screen.getByRole('radio', { name: 'Work' })).toHaveAttribute('aria-checked', 'true');
  });

  it('自定义 footer 内容', () => {
    render(
      <ActivityBar
        value="work"
        onChange={jest.fn()}
        footer={<button data-testid="custom-footer">自定义</button>}
      />,
    );

    expect(screen.getByTestId('custom-footer')).toBeInTheDocument();
    // 默认设置入口不渲染
    expect(screen.queryByTestId('activity-bar-settings')).not.toBeInTheDocument();
  });

  it('移动端自定义 footer 内容', () => {
    render(
      <ActivityBar
        value="work"
        onChange={jest.fn()}
        mobile
        footer={<button data-testid="custom-footer-mobile">自定义</button>}
      />,
    );

    expect(screen.getByTestId('custom-footer-mobile')).toBeInTheDocument();
  });

  it('垂直模式 ModeSwitcher 有 data-orientation=vertical', () => {
    render(<ActivityBar value="work" onChange={jest.fn()} />);
    const modeSwitcher = screen.getByTestId('mode-switcher');
    expect(modeSwitcher).toHaveAttribute('data-orientation', 'vertical');
  });

  it('移动端水平模式 ModeSwitcher 有 data-orientation=horizontal', () => {
    render(<ActivityBar value="work" onChange={jest.fn()} mobile />);
    const modeSwitcher = screen.getByTestId('mode-switcher');
    expect(modeSwitcher).toHaveAttribute('data-orientation', 'horizontal');
  });
});
