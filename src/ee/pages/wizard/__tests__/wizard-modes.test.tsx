// wizard-ent-sso-mode v1.3:向导企业双模式的组件测试。
// 覆盖:两种模式下第 3 步的渲染差异、切卡重置、"新增后端"场景隐藏 SSO 模式卡、
// SSO 模式验证步的租户 ID 手填回退。断言用英文文案(jest 的 i18n 以 en 资源初始化,
// 含 src/ee/locales/en-private.ts 的 wizard.* 键)。

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
    label: 'Enterprise (SSO mode)',
    description: 'Sign in with SSO',
    defaultEndpoint: 'http://localhost:9091',
    capabilities: ENTERPRISE_CAPS,
    credentialKind: 'bearer-token',
  },
  {
    optionId: 'enterprise-password',
    type: 'intellect-enterprise',
    setupProfile: 'enterprise-password',
    label: 'Enterprise (non-SSO mode)',
    description: 'Sign in with member password',
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
];

const STATUS_FIRST_INSTALL = {
  needsSetup: true,
  bootstrapEnabled: true,
  backendCount: 0,
  hasEnterpriseBackend: false,
};

const TENANT_ID = '0123456789abcdef0123456789abcdef';

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

/** SSO 模式的第 3 步草稿(旧草稿里不再有 sso.enabled) */
function ssoDraft() {
  return {
    selectedOptionId: 'enterprise-sso',
    selectedType: 'intellect-enterprise',
    setupProfile: 'enterprise-sso',
    endpoint: 'http://localhost:9091',
    credentialKind: 'bearer-token',
    sso: { publicOrigin: 'http://localhost', providers: [], silentRelogin: true },
  };
}

function passwordDraft() {
  return {
    selectedOptionId: 'enterprise-password',
    selectedType: 'intellect-enterprise',
    setupProfile: 'enterprise-password',
    endpoint: 'http://localhost:9091',
    credentialKind: 'bearer-token',
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

/** 等待选项列表加载完成("non-SSO mode" 也含 "SSO mode" 字样,正则需锚定卡名开头) */
async function waitForOptions() {
  await screen.findByRole('radio', { name: /Enterprise \(SSO mode\)/ });
}

describe('WizardPage 企业双模式(wizard-ent-sso-mode v1.3)', () => {
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

  it('SSO 模式第 3 步只采集认证网关与统一认证信息,没有后端字段', async () => {
    seedDraft(ssoDraft());
    renderWizard('/wizard?step=3');

    expect(await screen.findByLabelText('Authentication gateway')).toBeInTheDocument();
    expect(screen.getByLabelText('Gateway service key')).toBeInTheDocument();
    expect(screen.getByText('Login channels')).toBeInTheDocument();
    expect(screen.getByText('Public origin')).toBeInTheDocument();

    // 后端概念不出现
    expect(screen.queryByText('Backend Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Intellect Tenant ID')).not.toBeInTheDocument();

    // 没有"启用 SSO"开关:唯一的开关是"会话过期后静默重登"
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    expect(screen.queryByText(/Enable unified authentication/i)).not.toBeInTheDocument();
  });

  it('非 SSO 模式第 3 步是纯后端连接表单,没有任何统一认证内容', async () => {
    seedDraft(passwordDraft());
    renderWizard('/wizard?step=3');

    expect(await screen.findByLabelText('Backend Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Endpoint')).toBeInTheDocument();
    expect(screen.getByLabelText('Bearer Token')).toBeInTheDocument();
    expect(screen.getByLabelText('Intellect Tenant ID')).toBeInTheDocument();

    expect(screen.queryByText('Login channels')).not.toBeInTheDocument();
    expect(screen.queryByText('Public origin')).not.toBeInTheDocument();
    expect(screen.queryByText('Gateway service key')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('选择类型页:两张企业卡各讲各的,SSO 卡不展示后端能力与默认端点', async () => {
    renderWizard('/wizard?step=2');
    await waitForOptions();

    // 非 SSO 卡说明不含 SSO 字样
    expect(screen.getByText('Sign in with member password')).toBeInTheDocument();
    expect(screen.getByText('SSO')).toBeInTheDocument();

    // 默认端点只出现在非 SSO 卡上(密码卡 + Community 卡)
    expect(screen.getAllByText(/Default endpoint/)).toHaveLength(2);
  });

  it('切卡会重置:SSO 卡的统一认证内容不会带进非 SSO 卡', async () => {
    renderWizard('/wizard?step=2');
    await waitForOptions();

    fireEvent.click(screen.getByRole('radio', { name: /Enterprise \(SSO mode\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByLabelText('Gateway service key')).toBeInTheDocument();
    expect(screen.getByText('Login channels')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('radio', { name: /non-SSO mode/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByLabelText('Backend Name')).toBeInTheDocument();
    expect(screen.queryByText('Gateway service key')).not.toBeInTheDocument();
    expect(screen.queryByText('Login channels')).not.toBeInTheDocument();
  });

  it('"新增后端"场景下已有企业后端时隐藏 SSO 模式卡并给出指引', async () => {
    mockFetchWizardStatus.mockResolvedValue({
      data: { ...STATUS_FIRST_INSTALL, needsSetup: false, hasEnterpriseBackend: true },
    });
    renderWizard('/wizard?mode=add&step=2');
    await screen.findByRole('radio', { name: /non-SSO mode/ });

    expect(screen.getByText(/SSO mode is not offered here/)).toBeInTheDocument();
    // 仍可选非 SSO 企业卡
    expect(screen.getByRole('radio', { name: /non-SSO mode/ })).toBeInTheDocument();
    // 隐藏后不再有 SSO 徽章
    expect(screen.queryByText('SSO')).not.toBeInTheDocument();
  });

  it('SSO 验证步:租户 ID 自动识别失败时回退为手填,填对才能继续', async () => {
    seedDraft(ssoDraft());
    seedCredentials({ token: 'server-key' });
    mockProbeWizardBackend.mockResolvedValue({
      data: {
        healthy: false,
        error: '网关未返回企业租户 ID,请手动填写(32 位 hex)。',
        sso: {
          gatewayOk: true,
          tenantId: null,
          keyValid: true,
          providersOk: true,
          providerCount: 1,
        },
      },
    });
    renderWizard('/wizard?step=4');

    const manualInput = await screen.findByLabelText(
      /could not be detected automatically/,
    );
    // 探测请求带上了 SSO 模式标记与网关服务密钥
    expect(mockProbeWizardBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'intellect-enterprise',
        setupProfile: 'enterprise-sso',
        token: 'server-key',
      }),
    );
    expect(screen.getByText('Gateway service key is valid')).toBeInTheDocument();

    const continueButton = screen.getByRole('button', { name: 'Continue' });
    expect(continueButton).toBeDisabled();

    fireEvent.change(manualInput, { target: { value: 'not-a-tenant-id' } });
    expect(continueButton).toBeDisabled();

    fireEvent.change(manualInput, { target: { value: TENANT_ID } });
    expect(continueButton).toBeEnabled();
  });
});
