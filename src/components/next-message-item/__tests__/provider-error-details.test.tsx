/**
 * ProviderErrorDetails 单元测试（P3 测试补全）
 *
 * 覆盖点：
 * - string / object / Error 三种 details 类型格式化
 * - 循环引用处理（safeStringify）
 * - function/symbol 类型拒绝
 * - 超长内容截断（>8000 字符）
 * - undefined/null 不渲染
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { ProviderErrorDetails } from '../provider-error-details';

// mock i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ProviderErrorDetails', () => {
  it('undefined details 不渲染', () => {
    const { container } = render(<ProviderErrorDetails details={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('null details 不渲染', () => {
    const { container } = render(<ProviderErrorDetails details={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('空字符串不渲染', () => {
    const { container } = render(<ProviderErrorDetails details="" />);
    expect(container.firstChild).toBeNull();
  });

  it('string details 直接显示', () => {
    render(<ProviderErrorDetails details="error message" />);
    // 默认折叠，需展开
    expect(screen.getByText('error.providerDetails')).toBeInTheDocument();
    fireEvent.click(screen.getByText('error.providerDetails'));
    expect(screen.getByText('error message')).toBeInTheDocument();
  });

  it('object details JSON 格式化', () => {
    render(<ProviderErrorDetails details={{ code: 500, msg: 'fail' }} />);
    fireEvent.click(screen.getByText('error.providerDetails'));
    expect(screen.getByText(/"code": 500/)).toBeInTheDocument();
    expect(screen.getByText(/"msg": "fail"/)).toBeInTheDocument();
  });

  it('Error details 显示 name + message + stack', () => {
    const err = new Error('something failed');
    err.name = 'CustomError';
    render(<ProviderErrorDetails details={err} />);
    fireEvent.click(screen.getByText('error.providerDetails'));
    expect(screen.getByText(/CustomError: something failed/)).toBeInTheDocument();
  });

  it('循环引用对象替换为 [Circular]', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj; // 循环引用
    render(<ProviderErrorDetails details={obj} />);
    fireEvent.click(screen.getByText('error.providerDetails'));
    expect(screen.getByText(/\[Circular\]/)).toBeInTheDocument();
  });

  it('function 类型替换为 [Function]', () => {
    render(<ProviderErrorDetails details={{ fn: () => {} }} />);
    fireEvent.click(screen.getByText('error.providerDetails'));
    expect(screen.getByText(/\[Function\]/)).toBeInTheDocument();
  });

  it('symbol 类型被替换（JSON.stringify 行为兼容）', () => {
    render(<ProviderErrorDetails details={{ sym: Symbol('test') }} />);
    fireEvent.click(screen.getByText('error.providerDetails'));
    // JSON.stringify 对 symbol 属性值的行为：replacer 可能返回 [Symbol] 或 [Symbol: Symbol(test)]
    // 不同 Node.js 版本行为略有差异，断言包含 [Symbol] 前缀即可
    expect(screen.getByText(/\[Symbol/)).toBeInTheDocument();
  });

  it('超长内容截断（>8000 字符）', () => {
    const longText = 'x'.repeat(9000);
    render(<ProviderErrorDetails details={longText} />);
    fireEvent.click(screen.getByText('error.providerDetails'));
    expect(screen.getByText(/truncated, total 9000 chars/)).toBeInTheDocument();
  });

  it('使用 <details> 标签支持原生折叠', () => {
    const { container } = render(
      <ProviderErrorDetails details="error" />,
    );
    expect(container.querySelector('details')).toBeInTheDocument();
    expect(container.querySelector('summary')).toBeInTheDocument();
  });
});
