/**
 * Provenance: ported from upstream RAGFlow web/ use-reveal-submit-errors.test.tsx
 * (base 91c702e);harness JSX 按上游断言语义还原(fetch 取回时 JSX 被剥离)。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useRevealSubmitErrors } from './use-reveal-submit-errors';

const scrollIntoViewMock = jest.fn();

beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

beforeEach(() => {
  scrollIntoViewMock.mockClear();
});

function Harness() {
  const {
    formContainerRef,
    handleInvalidSubmit,
    modelSettingOpen,
    advancedSettingOpen,
    naiveSettingOpen,
    agenticSettingOpen,
  } = useRevealSubmitErrors();

  return (
    <div>
      <span data-testid="model-open">{String(modelSettingOpen)}</span>
      <span data-testid="advanced-open">{String(advancedSettingOpen)}</span>
      <span data-testid="naive-open">{String(naiveSettingOpen)}</span>
      <span data-testid="agentic-open">{String(agenticSettingOpen)}</span>
      <button type="button" onClick={handleInvalidSubmit}>
        save
      </button>
      <div ref={formContainerRef}>
        <p id="name-form-item-message">Name is required</p>
      </div>
    </div>
  );
}

describe('useRevealSubmitErrors', () => {
  it('keeps all sections collapsed initially', () => {
    render(<Harness />);

    expect(screen.getByTestId('model-open')).toHaveTextContent('false');
    expect(screen.getByTestId('advanced-open')).toHaveTextContent('false');
    expect(screen.getByTestId('naive-open')).toHaveTextContent('false');
    expect(screen.getByTestId('agentic-open')).toHaveTextContent('false');
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('expands all sections and scrolls to the first error on invalid submit', () => {
    render(<Harness />);

    fireEvent.click(screen.getByText('save'));

    expect(screen.getByTestId('model-open')).toHaveTextContent('true');
    expect(screen.getByTestId('advanced-open')).toHaveTextContent('true');
    expect(screen.getByTestId('naive-open')).toHaveTextContent('true');
    expect(screen.getByTestId('agentic-open')).toHaveTextContent('true');
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
    expect(scrollIntoViewMock.mock.instances[0]).toBe(
      screen.getByText('Name is required'),
    );
  });

  it('scrolls again on every repeated invalid submit', () => {
    render(<Harness />);

    fireEvent.click(screen.getByText('save'));
    fireEvent.click(screen.getByText('save'));

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
  });
});
