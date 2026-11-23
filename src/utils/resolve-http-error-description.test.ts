import { resolveHttpErrorDescription } from './resolve-http-error-description';

const statusFallback = (status: number) => `message.${status}`;

describe('resolveHttpErrorDescription', () => {
  it('prefers server response.data.message over status fallback', () => {
    expect(
      resolveHttpErrorDescription(
        {
          response: {
            status: 400,
            statusText: 'Bad Request',
            data: { message: 'web_search_api_key is required for tavily' },
          },
        },
        statusFallback,
      ),
    ).toBe('web_search_api_key is required for tavily');
  });

  it('falls back to RetcodeMessage / statusText when message absent', () => {
    expect(
      resolveHttpErrorDescription(
        {
          response: { status: 400, statusText: 'Bad Request', data: {} },
        },
        statusFallback,
      ),
    ).toBe('message.400');
  });

  it('ignores blank server messages', () => {
    expect(
      resolveHttpErrorDescription(
        {
          response: {
            status: 500,
            statusText: 'Internal Server Error',
            data: { message: '   ' },
          },
        },
        statusFallback,
      ),
    ).toBe('message.500');
  });

  it('returns undefined without a status', () => {
    expect(
      resolveHttpErrorDescription({ response: {} }, statusFallback),
    ).toBeUndefined();
    expect(resolveHttpErrorDescription({}, statusFallback)).toBeUndefined();
  });
});
