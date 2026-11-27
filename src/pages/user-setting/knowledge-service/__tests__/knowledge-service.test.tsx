import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import KnowledgeServicePage from '../index';

const mockGetKbConnection = jest.fn();
const mockSaveKbConnection = jest.fn();
const mockTestKbConnection = jest.fn();

jest.mock('@/services/kb-connection-service', () => ({
  getKbConnection: () => mockGetKbConnection(),
  saveKbConnection: (payload: unknown) => mockSaveKbConnection(payload),
  testKbConnection: (payload: unknown) => mockTestKbConnection(payload),
}));

jest.mock('@/components/spotlight', () => ({
  __esModule: true,
  default: () => null,
}));

type Connection = {
  configured: boolean;
  endpoint: string;
  tokenConfigured: boolean;
  revision: number;
  version: string | null;
  versionError: string | null;
};

const baseConnection = (overrides: Partial<Connection> = {}): Connection => ({
  configured: true,
  endpoint: 'https://kb.example.com',
  tokenConfigured: true,
  revision: 4,
  version: '1.2.3',
  versionError: null,
  ...overrides,
});

const envelope = (data: unknown) => ({
  data: { code: 0, message: 'ok', data },
});

const renderPage = () => render(<KnowledgeServicePage />);

beforeEach(() => {
  mockGetKbConnection.mockReset();
  mockSaveKbConnection.mockReset();
  mockTestKbConnection.mockReset();
});

describe('KnowledgeServicePage', () => {
  it('403 时显示无权限状态且不渲染可编辑表单', async () => {
    mockGetKbConnection.mockRejectedValueOnce({
      response: { status: 403, data: { message: 'Forbidden' } },
    });

    renderPage();

    expect(
      await screen.findByText(
        'You do not have permission to manage the knowledge base service.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('kb-service-endpoint-input'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('kb-connection-save-button'),
    ).not.toBeInTheDocument();
  });

  it('未绑定时提示未配置，初次保存必须输入 Token', async () => {
    mockGetKbConnection.mockResolvedValueOnce(
      envelope(
        baseConnection({
          configured: false,
          endpoint: '',
          tokenConfigured: false,
          revision: 0,
          version: null,
        }),
      ),
    );

    renderPage();

    expect(await screen.findByText('Not configured')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save and enable' }),
    ).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText('Service URL'), {
      target: { value: 'https://kb.example.com' },
    });
    fireEvent.click(screen.getByTestId('kb-connection-save-button'));

    expect(
      await screen.findByText(
        'A service access token is required for initial configuration.',
      ),
    ).toBeInTheDocument();
    expect(mockSaveKbConnection).not.toHaveBeenCalled();
  });

  it('URL 改动且 Token 留空时，测试和保存都在前端拒绝', async () => {
    mockGetKbConnection.mockResolvedValueOnce(envelope(baseConnection()));

    renderPage();

    fireEvent.change(
      await screen.findByDisplayValue('https://kb.example.com'),
      { target: { value: 'https://kb-new.example.com' } },
    );
    fireEvent.click(screen.getByTestId('kb-connection-test-button'));

    const message =
      'The service URL has changed. Re-enter the service access token to test or save.';
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(mockTestKbConnection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('kb-connection-save-button'));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(mockSaveKbConnection).not.toHaveBeenCalled();
  });

  it('保存成功清空 Token、更新配置并提示尚未验证', async () => {
    mockGetKbConnection.mockResolvedValueOnce(
      envelope(
        baseConnection({
          configured: false,
          endpoint: '',
          tokenConfigured: false,
          revision: 0,
          version: null,
        }),
      ),
    );
    mockSaveKbConnection.mockResolvedValueOnce(
      envelope(
        baseConnection({
          endpoint: 'https://kb.example.com',
          revision: 5,
          version: '9.9.9',
        }),
      ),
    );

    renderPage();

    fireEvent.change(await screen.findByLabelText('Service URL'), {
      target: { value: '  https://kb.example.com  ' },
    });
    fireEvent.change(screen.getByLabelText('Service access token'), {
      target: { value: 'service-secret' },
    });
    fireEvent.click(screen.getByTestId('kb-connection-save-button'));

    await waitFor(() =>
      expect(mockSaveKbConnection).toHaveBeenCalledWith({
        endpoint: 'https://kb.example.com',
        serviceToken: 'service-secret',
        revision: 0,
      }),
    );
    expect(
      await screen.findByTestId('kb-connection-saved-unverified'),
    ).toHaveTextContent('Saved successfully, but not verified yet.');

    const tokenInput = screen.getByLabelText(
      'Service access token',
    ) as HTMLInputElement;
    expect(tokenInput.value).toBe('');
    expect(tokenInput.placeholder).toBe(
      'Saved; leave blank to keep it unchanged',
    );
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.queryByText('9.9.9')).not.toBeInTheDocument();
  });

  it('409 时提示配置变化或活跃 Run，并可重新加载', async () => {
    mockGetKbConnection.mockResolvedValueOnce(envelope(baseConnection()));
    mockSaveKbConnection.mockRejectedValueOnce({
      response: { status: 409, data: { message: 'Conflict' } },
    });

    renderPage();

    fireEvent.click(await screen.findByTestId('kb-connection-save-button'));
    expect(
      await screen.findByTestId('kb-connection-conflict'),
    ).toHaveTextContent(
      'The configuration has changed, or an active Run is preventing the binding change.',
    );

    mockGetKbConnection.mockResolvedValueOnce(
      envelope(
        baseConnection({
          endpoint: 'https://kb-latest.example.com',
          revision: 6,
        }),
      ),
    );
    fireEvent.click(screen.getByTestId('kb-connection-reload-button'));

    expect(
      await screen.findByDisplayValue('https://kb-latest.example.com'),
    ).toBeInTheDocument();
    expect(mockGetKbConnection).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByTestId('kb-connection-conflict'),
    ).not.toBeInTheDocument();
  });

  it('页内展示测试失败详情，字段变更后使旧结果失效', async () => {
    mockGetKbConnection.mockResolvedValueOnce(envelope(baseConnection()));
    mockTestKbConnection.mockResolvedValueOnce(
      envelope({
        success: false,
        stage: 'authentication',
        message: 'Bad service token',
        version: null,
        upstreamStatus: 401,
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByTestId('kb-connection-test-button'));

    expect(
      await screen.findByTestId('kb-connection-test-result'),
    ).toBeInTheDocument();
    expect(screen.getByText('Authentication')).toBeInTheDocument();
    expect(screen.getByText('Bad service token')).toBeInTheDocument();
    expect(screen.getByText('401')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Service access token'), {
      target: { value: 'new-service-secret' },
    });
    expect(
      screen.queryByTestId('kb-connection-test-result'),
    ).not.toBeInTheDocument();
  });
});
