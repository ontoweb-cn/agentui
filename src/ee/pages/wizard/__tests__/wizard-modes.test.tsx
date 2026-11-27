// wizard-ent-sso-mode v1.4 + §14:向导双卡形态的组件测试。
// 覆盖:5 张选型卡(含 SSO 卡)、非 SSO 连接步纯后端表单、SSO 连接步(公开来源/只读回调)、
// 切卡重置、探测请求携带 setupProfile、第 3 步重渲染循环回归。
// 断言用英文文案(jest 的 i18n 以 en 资源初始化,含 src/ee/locales/en-private.ts)。

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes as RouterRoutes } from 'react-router';

import { Routes } from '@/constants/routes';
import WizardPage from '../index';

const mockFetchWizardBackendTypes = jest.fn();
const mockFetchWizardStatus = jest.fn();
const mockProbeWizardBackend = jest.fn();

jest.mock('@/services/wizard-service', () => ({
  fetchWizardBackendTypes: () => mockFetchWizardBackendTypes(),
  fetchWizardStatus: () => mockFetchWizardStatus(),
  probeWizardBackend: (req: unknown) => mockProbeWizardBackend(req),
  setupWizardBackend: jest.fn(),
  fetchWizardSsoProviders: jest.fn(),
}));

// toast 容器不在被测范围
jest.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));

const ENTERPRISE_CAPS = {
  canvas: true,
  knowledgeBase: true,
  memory: true,
  mcp: true,
  multiTenant: true,
  modelManagement: true,
};
const PLAIN_CAPS = { ...ENTERPRISE_CAPS, multiTenant: false, modelManagement: false };

const OPTIONS = [
  {
    optionId: 'enterprise-sso',
    type: 'intellect-enterprise',
    setupProfile: 'enterprise-sso',
    label: 'Intellect Enterprise (SSO)',
    description: 'Unified authentication (SSO) sign-in; teams/projects with multi-tenancy',
    defaultEndpoint: 'http://localhost:9091',
    capabilities: ENTERPRISE_CAPS,
    credentialKind: 'bearer-token',
  },
  {
    optionId: 'enterprise-non-sso',
    type: 'intellect-enterprise',
    setupProfile: 'enterprise-non-sso',
    label: 'Intellect Enterprise (Non-SSO)',
    description: 'Member password sign-in; teams/projects with multi-tenancy',
    defaultEndpoint: 'http://localhost:9091',
    capabilities: ENTERPRISE_CAPS,
    credentialKind: 'bearer-token',
  },
  {
    optionId: 'intellect-community',
    type: 'intellect-community',
    label: 'Intellect Community',
    description: 'Pure Agent runtime',
    defaultEndpoint: 'http://localhost:9091',
    capabilities: PLAIN_CAPS,
    credentialKind: 'bearer-token',
  },
  {
    optionId: 'hermes',
    type: 'hermes',
    label: 'HERMES',
    description: 'HERMES protocol backend',
    defaultEndpoint: 'http://localhost:9091',
    capabilities: PLAIN_CAPS,
    credentialKind: 'bearer-token',
  },
  {
    optionId: 'agent-scope',
    type: 'agent-scope',
    label: 'AgentScope',
    description: 'AgentScope multi-agent framework',
    defaultEndpoint: 'http://localhost:5000',
    capabilities: PLAIN_CAPS,
    credentialKind: 'bearer-token',
  },
];

const STATUS_FIRST_INSTALL = {
  needsSetup: true,
  bootstrapEnabled: true,
  backendCount: 0,
  hasEnterpriseBackend: false,
};

function seedDraft(draft: Record<string, unknown>) {
  window.localStorage.setItem('wizard-draft', JSON.stringify(draft));
}

/** 凭据不进 localStorage,向导从 sessionStorage 的独立键恢复(A5) */
function seedCredentials(credentials: { token: string }) {
  window.sessionStorage.setItem(
    'wizard-draft-credentials',
    JSON.stringify({ email: '', password: '', ...credentials }),
  );
}

function enterpriseDraft() {
  return {
    selectedOptionId: 'enterprise-non-sso',
    selectedType: 'intellect-enterprise',
    endpoint: 'http://localhost:9091',
    credentialKind: 'bearer-token',
  };
}

function enterpriseSsoDraft() {
  return {
    selectedOptionId: 'enterprise-sso',
    selectedType: 'intellect-enterprise',
    endpoint: 'http://localhost:9091',
    credentialKind: 'bearer-token',
    ssoPublicOrigin: 'https://ai.wust.edu.cn',
  };
}

function renderWizard(entry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <RouterRoutes>
          <Route path={Routes.Wizard} element={<WizardPage />} />
          <Route path={Routes.Root} element={<div data-testid="home" />} />
        </RouterRoutes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WizardPage 企业双卡形态(wizard-ent-sso-mode v1.4 / §14)', () => {
  // 本套件每条用例都要渲染完整向导页(5 卡 + radix ScrollArea/RadioGroup),
  // 单条耗时 1.8–3.5s;全量并行(--maxWorkers=4)时 CPU 争抢会超过 jest 默认
  // 5s 超时导致假失败。此处给足余量,断言本身不变。
  jest.setTimeout(30000);

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockFetchWizardBackendTypes.mockResolvedValue({ data: { options: OPTIONS } });
    mockFetchWizardStatus.mockResolvedValue({ data: STATUS_FIRST_INSTALL });
    mockProbeWizardBackend.mockReset();
  });

  beforeAll(() => {
    // radix ScrollArea 依赖 ResizeObserver,jsdom 未实现
    const resizeObserver = { observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() };
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = resizeObserver;
    Element.prototype.scrollIntoView = jest.fn();
  });

  it('选型页:5 张卡(含 SSO 卡),全部展示默认端点,非 SSO 卡说明不含 SSO 字样', async () => {
    renderWizard('/wizard?step=2');
    await screen.findByRole('radio', { name: /Intellect Enterprise \(SSO\)/ });

    expect(screen.getByRole('radio', { name: /member password sign-in/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Intellect Community/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /HERMES/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /AgentScope/ })).toBeInTheDocument();
    // §14:SSO 卡恢复
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getAllByText(/Default endpoint/)).toHaveLength(5);
    // 非 SSO 卡说明不含 SSO
    expect(screen.getByText(/member password sign-in/)).toBeInTheDocument();
  });

  it('企业连接步:非 SSO 卡为纯后端表单,没有任何统一认证内容', async () => {
    seedDraft(enterpriseDraft());
    seedCredentials({ token: 'ent-key' });
    renderWizard('/wizard?step=3');

    expect(await screen.findByLabelText('Backend Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Endpoint')).toBeInTheDocument();
    expect(screen.getByLabelText('Bearer Token')).toBeInTheDocument();
    expect(screen.getByLabelText('Intellect Tenant ID')).toBeInTheDocument();

    // 非 SSO 卡不展示统一认证内容
    expect(screen.queryByLabelText('Public origin')).not.toBeInTheDocument();
    expect(screen.queryByText('Callback URL (register it in the auth app ia-intellect-team under redirectUris)')).not.toBeInTheDocument();
    expect(screen.queryByText('Login channels')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('企业连接步:SSO 卡隐藏后端名,展示公开来源与只读回调地址', async () => {
    seedDraft(enterpriseSsoDraft());
    seedCredentials({ token: 'ent-key' });
    renderWizard('/wizard?step=3');

    expect(await screen.findByLabelText('Public origin')).toBeInTheDocument();
    // SSO 模式隐藏 Backend Name(BFF 用默认名)
    expect(screen.queryByLabelText('Backend Name')).not.toBeInTheDocument();
    // 回调地址只读展示
    expect(
      screen.getByText('https://ai.wust.edu.cn/api/bff/auth/oauth/callback'),
    ).toBeInTheDocument();
  });

  it('切卡重置:企业卡与社区卡互切不串内容(第 3 步重渲染循环回归)', async () => {
    renderWizard('/wizard?step=2');
    await screen.findByRole('radio', { name: /member password sign-in/ });

    fireEvent.click(screen.getByRole('radio', { name: /member password sign-in/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByLabelText('Intellect Tenant ID')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('radio', { name: /Intellect Community/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // 社区卡无租户 ID;且此前的重渲染循环会让本用例卡死,能走完即回归通过
    expect(await screen.findByLabelText('Endpoint')).toBeInTheDocument();
    expect(screen.queryByText('Intellect Tenant ID')).not.toBeInTheDocument();
  });

  it('探测请求携带所选卡的 setupProfile,非 SSO 不带 sso', async () => {
    seedDraft(enterpriseDraft());
    seedCredentials({ token: 'ent-key' });
    mockProbeWizardBackend.mockResolvedValue({
      data: { healthy: true, capabilities: ENTERPRISE_CAPS },
    });
    renderWizard('/wizard?step=4');

    // §14:probe 需带 setupProfile 以走 BFF 的模式判定
    await screen.findByText('Backend is reachable');
    const payload = mockProbeWizardBackend.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'intellect-enterprise',
      setupProfile: 'enterprise-non-sso',
    });
    expect(payload).not.toHaveProperty('sso');
  });
});
