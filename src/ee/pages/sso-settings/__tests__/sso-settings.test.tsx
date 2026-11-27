// wizard-ent-sso-mode v1.4:统一认证设置页(管理页扩展)组件测试。
// 覆盖:① 前置状态卡(绑定后端/三态密钥/检测按钮)、启用守卫(后端未绑定禁用)、
// 渠道预览勾选与手动兜底联动。断言用英文文案(jest i18n 含 ee en-private)。

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import AdminSsoSettings from '../index';

const mockGetSsoAdminConfig = jest.fn();
const mockGetSsoAdminProviders = jest.fn();
const mockSaveSsoAdminConfig = jest.fn();
const mockResetSsoAdminConfig = jest.fn();

jest.mock('@/services/sso-admin-service', () => ({
  getSsoAdminConfig: (check?: boolean) => mockGetSsoAdminConfig(check),
  getSsoAdminProviders: () => mockGetSsoAdminProviders(),
  saveSsoAdminConfig: (payload: unknown) => mockSaveSsoAdminConfig(payload),
  resetSsoAdminConfig: () => mockResetSsoAdminConfig(),
}));

jest.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));

function baseView(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      enabled: false,
      publicOrigin: '',
      providers: null,
      silentRelogin: true,
    },
    runtime: null,
    sources: {
      enabled: 'env',
      publicOrigin: 'env',
      providers: 'env',
      silentRelogin: 'env',
      stateSecret: 'env',
    },
    stateSecretConfigured: false,
    stateSecretStatus: 'unset',
    boundBackend: null,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminSsoSettings />
    </QueryClientProvider>,
  );
}

describe('AdminSsoSettings v1.4 管理页扩展', () => {
  beforeAll(() => {
    // radix Switch/Checkbox 依赖 ResizeObserver,jsdom 未实现
    const resizeObserver = { observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() };
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = resizeObserver;
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    mockGetSsoAdminConfig.mockReset();
    mockGetSsoAdminProviders.mockReset();
    mockSaveSsoAdminConfig.mockReset();
    mockResetSsoAdminConfig.mockReset();
  });

  it('P-01: 前置状态卡展示绑定后端与渠道预览;勾选与手动输入联动', async () => {
    mockGetSsoAdminConfig.mockResolvedValue({
      data: baseView({
        stateSecretStatus: 'set',
        stateSecretConfigured: true,
        boundBackend: { id: 'ent-default', endpoint: 'http://gw.example' },
      }),
    });
    mockGetSsoAdminProviders.mockResolvedValue({
      data: {
        providers: [{ id: 'intellect-auth', displayName: 'Unified auth', icon: 'sso' }],
        misconfigured: [],
      },
    });
    renderPage();

    expect(
      await screen.findByText('Enterprise backend: ent-default (http://gw.example)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Set')).toBeInTheDocument();

    // 渠道预览:未勾选(白名单 null = 全部)→ 手动输入应为空
    const checkbox = await screen.findByRole('checkbox', { name: /Unified auth/ });
    expect(checkbox).not.toBeChecked();
    const manual = screen.getByLabelText(/Channel allowlist/) as HTMLInputElement;
    expect(manual.value).toBe('');

    // 勾选 → 手动输入同步为渠道 id
    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/Channel allowlist/) as HTMLInputElement).value,
      ).toBe('intellect-auth');
    });
  });

  it('P-02: 后端未绑定 → 启用开关禁用并提示', async () => {
    mockGetSsoAdminConfig.mockResolvedValue({ data: baseView() });
    mockGetSsoAdminProviders.mockRejectedValue(new Error('no backend'));
    renderPage();

    const enable = await screen.findByRole('switch', {
      name: /Enable unified authentication/,
    });
    // 等待 config 查询完成后再断言守卫(首屏 data 未返回时不禁用)
    await waitFor(() => expect(enable).toBeDisabled());
    // 同根文案出现两处(前置状态卡警示 + 开关旁提示),用 getAllByText 断言
    expect(screen.getAllByText(/No enterprise backend is bound/).length).toBeGreaterThanOrEqual(2);
  });

  // §14(BFF-as-RP 移除):stateSecret 不再参与签名/启动校验,重启失败警示已废弃;
  // 本用例固化为"三态徽章照常展示 + 启用后提示该密钥已不再使用"
  it('P-03: 密钥三态显示;启用后提示 stateSecret 已废弃(不再有重启失败警示)', async () => {
    mockGetSsoAdminConfig.mockResolvedValue({
      data: baseView({
        stateSecretStatus: 'invalid',
        stateSecretConfigured: false,
        boundBackend: { id: 'ent-default', endpoint: 'http://gw.example' },
      }),
    });
    mockGetSsoAdminProviders.mockResolvedValue({
      data: { providers: [], misconfigured: [] },
    });
    renderPage();

    expect(await screen.findByText('Set but shorter than 32 characters')).toBeInTheDocument();
    // 未启用时无提示
    expect(screen.queryByText(/no longer used/i)).not.toBeInTheDocument();
    // 废弃的重启失败警示不应再出现
    expect(screen.queryByText(/the BFF will fail/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: /Enable unified authentication/ }));
    expect(
      await screen.findByText(/no longer used/i),
    ).toBeInTheDocument();
  });

  it('P-04: 保存 → 以解析后的白名单调用 service(空=不过滤 null)', async () => {
    mockGetSsoAdminConfig.mockResolvedValue({
      data: baseView({
        stateSecretStatus: 'set',
        stateSecretConfigured: true,
        boundBackend: { id: 'ent-default', endpoint: 'http://gw.example' },
        config: {
          enabled: false,
          publicOrigin: 'https://site.example.com',
          providers: null,
          silentRelogin: true,
        },
      }),
    });
    mockGetSsoAdminProviders.mockResolvedValue({
      data: { providers: [], misconfigured: [] },
    });
    mockSaveSsoAdminConfig.mockResolvedValue({ data: baseView() });
    renderPage();

    // 等待 useEffect 将生效配置填入表单后再保存
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/Public origin/) as HTMLInputElement).value,
      ).toBe('https://site.example.com'),
    );
    const save = await screen.findByRole('button', { name: 'Save' });
    fireEvent.click(save);
    await waitFor(() => {
      expect(mockSaveSsoAdminConfig).toHaveBeenCalledWith({
        enabled: false,
        publicOrigin: 'https://site.example.com',
        providers: null,
        silentRelogin: true,
      });
    });
  });
});
