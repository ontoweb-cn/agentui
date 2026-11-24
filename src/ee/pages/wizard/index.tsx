// spec-010 v8 B-6: Wizard 首次安装向导(6 步状态机)。
// T2.5 ee overlay:agentui 私有页面迁入 src/ee/pages/wizard——共享层
// (src/pages 之外的可 cherry-pick 面)不再承载 Intellect 专有逻辑;
// 约定:共享代码只 import '@/ee/*',不得反向内联(见 CLAUDE.md)。
// Constitution Principle I (BFF-Mediated Frontend): 前端经 BFF Wizard 路由完成首次配置。
//
// 状态机(m7):
// - Step 1-2: 刷新重置到 Step 1
// - Step 3-4: 表单暂存到 localStorage `wizard-draft`,刷新后回到 Step 3
// - Step 5-6: 刷新检测后端是否已配置(GET /wizard/status),有则跳 /,无则回 Step 3
// - Probe 失败:停留在 Step 4 显示错误,允许修改后重试
// - Setup 成功:清空 wizard-draft,跳转 /
//
// wizard-ent-sso-mode v1.3:两张企业卡走不同的第 3–6 步——
// - SSO 模式:只采集认证网关与统一认证信息(网关地址、网关服务密钥、登录渠道、
//   公开来源、引导密钥),企业后端由 BFF 自动登记,租户 ID 自动识别(识别不到才手填);
// - 非 SSO 模式:纯后端连接(名称/端点/凭据/租户 ID),不含任何统一认证内容。
//
// 路由:/wizard (不经过 AuthWrapper,首次安装无 admin token)
// URL query:?step=N 控制步骤,?mode=add 从 Admin 页跳转过来(已有后端时新增)

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  LucideCheck,
  LucideChevronLeft,
  LucideChevronRight,
  LucideX,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

import { Routes } from '@/constants/routes';
import {
  fetchWizardBackendTypes,
  fetchWizardStatus,
  probeWizardBackend,
  setupWizardBackend,
  type BackendType,
  type CredentialKind,
  type HarnessCapabilities,
  type WizardBackendTypeOption,
  type WizardProbeRequest,
  type WizardProbeResponse,
  type WizardProbeSso,
  type WizardSetupProfile,
  type WizardSetupResponse,
} from '@/services/wizard-service';
import { SsoSection, INITIAL_WIZARD_DRAFT_SSO, type WizardDraftSso } from './sso-section';

// ---------------------------------------------------------------------------
// Local types & constants
// ---------------------------------------------------------------------------

const DRAFT_STORAGE_KEY = 'wizard-draft';
// A5(wizard-sso-followup/R8):凭据不进 localStorage —— 另存 sessionStorage
// (标签页生命周期:刷新保留、关标签即清、不长期落盘)。
const DRAFT_CREDENTIALS_STORAGE_KEY = 'wizard-draft-credentials';
/** 企业版实例级租户 ID(Rust 版网关要求 32 位 hex) */
const TENANT_ID_RE = /^[0-9a-fA-F]{32}$/;
/** 公开来源地址:必须是绝对的 http(s) URL(是否强制 https 由 BFF 启动校验裁决) */
function isValidOrigin(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

interface WizardDraftCredentials {
  token: string;
  email: string;
  password: string;
}
const WIZARD_STEPS = 6;

interface WizardDraft {
  /** 选型主键(§8 R1);企业双卡靠此区分 */
  selectedOptionId: string | null;
  selectedType: BackendType | null;
  setupProfile?: WizardSetupProfile;
  name: string;
  endpoint: string;
  credentialKind: CredentialKind;
  token: string;
  email: string;
  password: string;
  intellectTenantId: string;
  defaultForTenant: boolean;
  /** wizard-sso(P2): SSO 配置(stateSecret 除外 —— 密钥仅内存态,不进 localStorage) */
  sso: WizardDraftSso;
}

const INITIAL_DRAFT: WizardDraft = {
  selectedOptionId: null,
  selectedType: null,
  setupProfile: undefined,
  name: '',
  endpoint: '',
  credentialKind: 'bearer-token',
  token: '',
  email: '',
  password: '',
  intellectTenantId: '',
  defaultForTenant: true,
  sso: INITIAL_WIZARD_DRAFT_SSO,
};

/** 前端按 optionId 覆盖 BFF 英文化 label(§8 R7) */
function optionDisplayLabel(
  opt: WizardBackendTypeOption,
  t: (key: string, opts?: { defaultValue: string }) => string,
): string {
  if (opt.optionId === 'enterprise-sso') {
    return t('wizard.types.enterpriseSso', { defaultValue: '企业版（SSO模式）' });
  }
  if (opt.optionId === 'enterprise-password') {
    return t('wizard.types.enterprisePassword', {
      defaultValue: '企业版（非SSO模式）',
    });
  }
  return opt.label;
}

function optionDisplayDescription(
  opt: WizardBackendTypeOption,
  t: (key: string, opts?: { defaultValue: string }) => string,
): string {
  if (opt.optionId === 'enterprise-sso') {
    return t('wizard.types.enterpriseSsoDesc', {
      defaultValue: '统一认证登录;只需配置认证网关与统一认证信息',
    });
  }
  if (opt.optionId === 'enterprise-password') {
    return t('wizard.types.enterprisePasswordDesc', {
      defaultValue: '使用成员账号密码登录',
    });
  }
  return opt.description;
}

// ---------------------------------------------------------------------------
// Draft persistence helpers
// ---------------------------------------------------------------------------

function loadDraft(): WizardDraft {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    let base = INITIAL_DRAFT;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WizardDraft>;
      // A5:历史草稿中的凭据字段不再从 localStorage 恢复(防长期残留)
      delete parsed.token;
      delete parsed.email;
      delete parsed.password;
      base = { ...INITIAL_DRAFT, ...parsed };
      // v1.3:旧草稿的 sso 里可能带 enabled(启用状态现由模式推定),只保留仍在用的字段
      if (parsed.sso) {
        base = {
          ...base,
          sso: {
            publicOrigin:
              typeof parsed.sso.publicOrigin === 'string'
                ? parsed.sso.publicOrigin
                : '',
            providers: Array.isArray(parsed.sso.providers)
              ? parsed.sso.providers
              : [],
            silentRelogin: parsed.sso.silentRelogin !== false,
          },
        };
      }
      // §8 R6:旧草稿仅有 selectedType=enterprise、无 optionId/profile → 清空选型,禁止静默当 SSO
      if (
        base.selectedType === 'intellect-enterprise' &&
        !base.selectedOptionId &&
        !base.setupProfile
      ) {
        base = {
          ...base,
          selectedType: null,
          selectedOptionId: null,
          setupProfile: undefined,
          sso: { ...INITIAL_WIZARD_DRAFT_SSO },
        };
      }
    }
    try {
      const credRaw = sessionStorage.getItem(DRAFT_CREDENTIALS_STORAGE_KEY);
      if (credRaw) {
        const cred = JSON.parse(credRaw) as Partial<WizardDraftCredentials>;
        return {
          ...base,
          token: cred.token ?? base.token,
          email: cred.email ?? base.email,
          password: cred.password ?? base.password,
        };
      }
    } catch {
      // sessionStorage 不可用时静默降级(仅丢凭据,其余草稿保留)
    }
    return base;
  } catch {
    return INITIAL_DRAFT;
  }
}

function saveDraft(draft: WizardDraft): void {
  try {
    // A5:凭据剥离到 sessionStorage,localStorage 只存非敏感配置
    const { token, email, password, ...rest } = draft;
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(rest));
    const credentials: WizardDraftCredentials = { token, email, password };
    sessionStorage.setItem(
      DRAFT_CREDENTIALS_STORAGE_KEY,
      JSON.stringify(credentials),
    );
  } catch {
    // 存储不可用时静默忽略(隐私模式等)
  }
}

function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    // A5:凭据随草稿一并清理
    sessionStorage.removeItem(DRAFT_CREDENTIALS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

function Stepper({
  current,
  isSsoMode,
}: {
  current: number;
  isSsoMode: boolean;
}) {
  const { t } = useTranslation();
  const labels = useMemo(
    () =>
      isSsoMode
        ? [
            t('wizard.step.welcome', { defaultValue: 'Welcome' }),
            t('wizard.step.selectType', { defaultValue: 'Select Type' }),
            t('wizard.step.ssoSetup', { defaultValue: 'Unified sign-in' }),
            t('wizard.step.verify', { defaultValue: 'Verify' }),
            t('wizard.step.confirm', { defaultValue: 'Confirm' }),
            t('wizard.step.done', { defaultValue: 'Done' }),
          ]
        : [
            t('wizard.step.welcome', { defaultValue: 'Welcome' }),
            t('wizard.step.selectType', { defaultValue: 'Select Type' }),
            t('wizard.step.connection', { defaultValue: 'Connection' }),
            t('wizard.step.probe', { defaultValue: 'Probe' }),
            t('wizard.step.confirm', { defaultValue: 'Confirm' }),
            t('wizard.step.done', { defaultValue: 'Done' }),
          ],
    [t, isSsoMode],
  );
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {labels.map((label, i) => {
        const stepNum = i + 1;
        const isCurrent = stepNum === current;
        const isDone = stepNum < current;
        return (
          <div key={stepNum} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                isCurrent
                  ? 'bg-primary text-primary-foreground'
                  : isDone
                    ? 'bg-primary/10 text-primary'
                    : 'bg-bg-muted text-text-secondary'
              }`}
            >
              <span className="flex items-center justify-center size-5 rounded-full border border-current text-xs">
                {isDone ? '✓' : stepNum}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </div>
            {stepNum < WIZARD_STEPS && (
              <div className="w-4 h-px bg-border" aria-hidden />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step components
// ---------------------------------------------------------------------------

function StepWelcome({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation();
  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>
          {t('wizard.welcome.title', { defaultValue: 'Welcome to Setup' })}
        </CardTitle>
        <CardDescription>
          {t('wizard.welcome.description', {
            defaultValue:
              'This wizard guides you through first-time setup: sign in to the enterprise edition with unified authentication (SSO) or with member passwords, or connect Intellect Community, HERMES, AgentScope and other backends.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-text-secondary">
        <p>
          {t('wizard.welcome.steps', {
            defaultValue:
              'You will: select a type → fill in the corresponding settings → verify → confirm → done.',
          })}
        </p>
        <p>
          {t('wizard.welcome.note', {
            defaultValue:
              'Credentials are sent over HTTPS only and never echoed back. Anything that must go into deployment configuration is provided as an .env snippet.',
          })}
        </p>
      </CardContent>
      <CardFooter>
        <Button onClick={onNext}>
          {t('wizard.welcome.start', { defaultValue: 'Start Setup' })}
        </Button>
      </CardFooter>
    </Card>
  );
}

function StepSelectType({
  options,
  selectedOptionId,
  onSelect,
  onNext,
  onBack,
  ssoCardHidden = false,
}: {
  options: WizardBackendTypeOption[];
  selectedOptionId: string | null;
  onSelect: (option: WizardBackendTypeOption) => void;
  onNext: () => void;
  onBack: () => void;
  /** wizard-ent-sso-mode v1.3 D5:SSO 模式卡因已有企业后端而被隐藏时给出指引 */
  ssoCardHidden?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card className="max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>
          {t('wizard.selectType.title', {
            defaultValue: 'Select Backend Type',
          })}
        </CardTitle>
        <CardDescription>
          {t('wizard.selectType.description', {
            defaultValue:
              'Choose the harness backend platform you want to connect to.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={selectedOptionId ?? ''}
          onValueChange={(v) => {
            const opt = options.find((o) => o.optionId === v);
            if (opt) onSelect(opt);
          }}
          className="grid grid-cols-1 md:grid-cols-2 gap-3"
        >
          {options.map((opt) => (
            <label
              key={opt.optionId}
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                selectedOptionId === opt.optionId
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-border-hover'
              }`}
            >
              <RadioGroupItem
                value={opt.optionId}
                id={`backend-option-${opt.optionId}`}
                className="mt-1"
              />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="font-medium truncate">
                    {optionDisplayLabel(opt, t)}
                  </span>
                  {opt.setupProfile === 'enterprise-sso' && (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      SSO
                    </Badge>
                  )}
                  {opt.setupProfile === 'enterprise-password' && (
                    <Badge variant="outline" className="text-xs shrink-0">
                      {t('wizard.types.passwordBadge', {
                        defaultValue: '密码',
                      })}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-text-secondary">
                  {optionDisplayDescription(opt, t)}
                </p>
                  {/* SSO 模式卡只讲统一认证:不展示后端能力徽章与默认端点(v1.3) */}
                  {opt.setupProfile !== 'enterprise-sso' && (
                    <>
                      <div className="flex flex-wrap gap-1 pt-1">
                        {opt.capabilities.canvas && (
                          <Badge variant="secondary" className="text-xs">
                            {t('wizard.cap.canvas', { defaultValue: 'Canvas' })}
                          </Badge>
                        )}
                        {opt.capabilities.knowledgeBase && (
                          <Badge variant="secondary" className="text-xs">
                            {t('wizard.cap.knowledgeBase', {
                              defaultValue: 'KnowledgeBase',
                            })}
                          </Badge>
                        )}
                        {opt.capabilities.multiTenant && (
                          <Badge variant="secondary" className="text-xs">
                            {t('wizard.cap.multiTenant', {
                              defaultValue: 'MultiTenant',
                            })}
                          </Badge>
                        )}
                        {opt.capabilities.modelManagement && (
                          <Badge variant="secondary" className="text-xs">
                            {t('wizard.cap.modelManagement', {
                              defaultValue: 'ModelMgmt',
                            })}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary pt-1">
                        {t('wizard.selectType.defaultEndpoint', {
                          defaultValue: 'Default endpoint',
                        })}
                        : <code>{opt.defaultEndpoint}</code>
                      </p>
                    </>
                  )}
                </div>
              </label>
            ))}
        </RadioGroup>
        {ssoCardHidden && (
          <p className="mt-3 text-xs text-text-secondary">
            {t('wizard.selectType.ssoCardHidden', {
              defaultValue:
                'An enterprise backend already exists, so SSO mode is not offered here. To adjust unified authentication, go to System → Unified authentication settings.',
            })}
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-between">
        <Button variant="ghost" onClick={onBack}>
          <LucideChevronLeft className="size-4 mr-1" />
          {t('common.back', { defaultValue: 'Back' })}
        </Button>
        <Button disabled={!selectedOptionId} onClick={onNext}>
          {t('common.next', { defaultValue: 'Next' })}
          <LucideChevronRight className="size-4 ml-1" />
        </Button>
      </CardFooter>
    </Card>
  );
}

function StepConnectionForm({
  draft,
  option,
  ssoSecret,
  onSsoChange,
  onSsoSecretChange,
  update,
  onNext,
  onBack,
}: {
  draft: WizardDraft;
  option: WizardBackendTypeOption | undefined;
  /** wizard-sso(P2): 引导密钥仅内存态 */
  ssoSecret: string;
  onSsoChange: (patch: Partial<WizardDraftSso>) => void;
  onSsoSecretChange: (secret: string) => void;
  update: (patch: Partial<WizardDraft>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const isEnterprise = draft.selectedType === 'intellect-enterprise';
  const isEnterpriseSso = draft.setupProfile === 'enterprise-sso';

  // 自动填充默认 endpoint(首次进入时)
  // 注:adminTokenEnvVar 由 BFF 自动生成 HARNESS_<ID>_TOKEN,前端不再收集该字段
  // 仅在草稿缺值或与选项不一致时写回:无条件写回会与 option 引用变化互相触发,
  // 形成重渲染循环,也会覆盖用户已填内容(设计 §9 Q2)
  useEffect(() => {
    if (!option) return;
    if (!draft.endpoint) {
      update({ endpoint: option.defaultEndpoint });
    }
    if (draft.credentialKind !== option.credentialKind) {
      update({ credentialKind: option.credentialKind });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option]);

  // SSO 模式卡:进入本步时预填公开来源地址
  useEffect(() => {
    if (!isEnterpriseSso) return;
    if (!draft.sso.publicOrigin.trim()) {
      onSsoChange({ publicOrigin: window.location.origin });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnterpriseSso]);

  const valid = useMemo(() => {
    if (!draft.endpoint.trim()) return false;
    // SSO 模式只采集统一认证信息:认证网关 + 网关服务密钥 + 公开来源 + 引导密钥(v1.3 §10)
    if (isEnterpriseSso) {
      if (!draft.token.trim()) return false;
      if (!isValidOrigin(draft.sso.publicOrigin.trim())) return false;
      if (!ssoSecret || ssoSecret.length < 32) return false;
      return true;
    }
    if (!draft.name.trim()) return false;
    if (draft.credentialKind === 'bearer-token' && !draft.token.trim()) {
      return false;
    }
    if (
      draft.credentialKind === 'email-password' &&
      (!draft.email.trim() || !draft.password.trim())
    ) {
      return false;
    }
    // m4 修复(P3):intellect-enterprise 的 intellectTenantId 必须为 32 位 hex
    if (isEnterprise) {
      const tenantId = draft.intellectTenantId.trim();
      if (!tenantId) return false;
      if (!TENANT_ID_RE.test(tenantId)) return false;
    }
    return true;
  }, [draft, isEnterprise, isEnterpriseSso, ssoSecret]);

  // wizard-ent-sso-mode v1.3:SSO 模式的第 3 步只采集认证网关与统一认证信息,
  // 不出现后端名称 / 租户 ID(企业后端由 BFF 自动登记、租户 ID 自动识别)
  if (isEnterpriseSso) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>
            {t('wizard.ssoSetup.title', { defaultValue: 'Unified sign-in settings' })}
          </CardTitle>
          <CardDescription>
            {t('wizard.ssoSetup.description', {
              defaultValue:
                'Enter the authentication gateway and unified sign-in details. The enterprise backend is registered automatically; there is nothing else to configure.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wizard-endpoint">
              {t('wizard.ssoSetup.gateway', { defaultValue: 'Authentication gateway' })}
            </Label>
            <Input
              id="wizard-endpoint"
              value={draft.endpoint}
              onChange={(e) => update({ endpoint: e.target.value })}
              placeholder="https://<host>/intellect-gateway"
            />
            <p className="text-xs text-text-secondary">
              {t('wizard.ssoSetup.gatewayHint', {
                defaultValue:
                  'Use the gateway base URL (not the web UI address). Login channels and tenant details are read from here.',
              })}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wizard-token">
              {t('wizard.ssoSetup.serverKey', { defaultValue: 'Gateway service key' })}
            </Label>
            <Input
              id="wizard-token"
              type="password"
              value={draft.token}
              onChange={(e) => update({ token: e.target.value })}
              placeholder="API_SERVER_KEY"
            />
            <p className="text-xs text-text-secondary">
              {t('wizard.ssoSetup.serverKeyHint', {
                defaultValue:
                  'The gateway API_SERVER_KEY. Sign-in callback exchange and login requests are authenticated with it. Sent over HTTPS only and never echoed back.',
              })}
            </p>
          </div>
          <SsoSection
            value={draft.sso}
            secret={ssoSecret}
            endpoint={draft.endpoint}
            onChange={onSsoChange}
            onSecretChange={onSsoSecretChange}
          />
        </CardContent>
        <CardFooter className="justify-between">
          <Button variant="ghost" onClick={onBack}>
            <LucideChevronLeft className="size-4 mr-1" />
            {t('common.back', { defaultValue: 'Back' })}
          </Button>
          <Button disabled={!valid} onClick={onNext}>
            {t('wizard.ssoSetup.verify', { defaultValue: 'Verify and continue' })}
            <LucideChevronRight className="size-4 ml-1" />
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>
          {t('wizard.connection.title', {
            defaultValue: 'Connection Information',
          })}
        </CardTitle>
        <CardDescription>
          {t('wizard.connection.description', {
            defaultValue:
              'Enter the backend endpoint and credentials. Token is sent over HTTPS and not stored in plaintext.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="wizard-name">
            {t('wizard.connection.name', { defaultValue: 'Backend Name' })}
          </Label>
          <Input
            id="wizard-name"
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Intellect Enterprise Default"
          />
          <p className="text-xs text-text-secondary">
            {t('wizard.connection.nameHint', {
              defaultValue:
                '用于生成 backendId（kebab-case，如 intellect-rag-default）。BFF 会基于此自动生成 adminTokenEnvVar（HARNESS_<ID>_TOKEN）。仅允许字母、数字、连字符。',
            })}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="wizard-endpoint">
            {t('wizard.connection.endpoint', { defaultValue: 'Endpoint' })}
          </Label>
          <Input
            id="wizard-endpoint"
            value={draft.endpoint}
            onChange={(e) => update({ endpoint: e.target.value })}
            placeholder="http://localhost:9380"
          />
        </div>

        {draft.credentialKind === 'bearer-token' && (
          <div className="space-y-2">
            <Label htmlFor="wizard-token">
              {t('wizard.connection.token', { defaultValue: 'Bearer Token' })}
            </Label>
            <Input
              id="wizard-token"
              type="password"
              value={draft.token}
              onChange={(e) => update({ token: e.target.value })}
              placeholder="sk-..."
            />
          </div>
        )}
        {draft.credentialKind === 'email-password' && (
          <>
            <div className="space-y-2">
              <Label htmlFor="wizard-email">
                {t('wizard.connection.email', { defaultValue: 'Email' })}
              </Label>
              <Input
                id="wizard-email"
                type="email"
                value={draft.email}
                onChange={(e) => update({ email: e.target.value })}
                placeholder="admin@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wizard-password">
                {t('wizard.connection.password', {
                  defaultValue: 'Password',
                })}
              </Label>
              <Input
                id="wizard-password"
                type="password"
                value={draft.password}
                onChange={(e) => update({ password: e.target.value })}
              />
            </div>
          </>
        )}

        {isEnterprise && (
          <div className="space-y-2">
            <Label htmlFor="wizard-tenant-id">
              {t('wizard.connection.intellectTenantId', {
                defaultValue: 'Intellect Tenant ID',
              })}
            </Label>
            <Input
              id="wizard-tenant-id"
              value={draft.intellectTenantId}
              onChange={(e) => update({ intellectTenantId: e.target.value })}
              placeholder="32 位 hex (e.g. 0123456789abcdef0123456789abcdef)"
              aria-invalid={
                draft.intellectTenantId.trim().length > 0 &&
                !/^[0-9a-fA-F]{32}$/.test(draft.intellectTenantId.trim())
              }
            />
            {draft.intellectTenantId.trim().length > 0 &&
              !/^[0-9a-fA-F]{32}$/.test(draft.intellectTenantId.trim()) && (
                <p className="text-xs text-destructive">
                  {t('wizard.connection.intellectTenantIdError', {
                    defaultValue:
                      '格式错误:必须为 32 位 hex(0-9, a-f)',
                  })}
                </p>
              )}
            <p className="text-xs text-text-secondary">
              {t('wizard.connection.intellectTenantIdHint', {
                defaultValue:
                  '从 intellect-team INTELLECT_TENANT_ID env var 复制(Rust 版本要求 32 位 hex)',
              })}
            </p>
          </div>
        )}

      </CardContent>
      <CardFooter className="justify-between">
        <Button variant="ghost" onClick={onBack}>
          <LucideChevronLeft className="size-4 mr-1" />
          {t('common.back', { defaultValue: 'Back' })}
        </Button>
        <Button disabled={!valid} onClick={onNext}>
          {t('wizard.connection.probe', { defaultValue: 'Probe Connection' })}
          <LucideChevronRight className="size-4 ml-1" />
        </Button>
      </CardFooter>
    </Card>
  );
}

/** SSO 模式"验证"步的一条结论:通过 / 未通过 / 无法判定(不阻断) */
function VerifyRow({
  state,
  label,
  detail,
}: {
  state: 'ok' | 'failed' | 'unknown';
  label: string;
  detail?: string;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 shrink-0 size-4">
        {state === 'ok' && (
          <LucideCheck className="size-4 text-accent-primary-text" />
        )}
        {state === 'failed' && <LucideX className="size-4 text-destructive" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={state === 'failed' ? 'text-destructive' : 'text-text-primary'}>
          {label}
        </span>
        {detail && (
          <span className="block text-xs text-text-secondary break-all">
            {detail}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * wizard-ent-sso-mode v1.3:SSO 模式的第 4 步"验证"。
 * 逐项展示认证网关 / 租户 ID / 网关服务密钥 / 统一认证服务四项结论;
 * 网关可达但未返回租户 ID 时回退为手填(D7),其余三项照常展示。
 */
function StepSsoVerify({
  sso,
  isProbing,
  manualTenantId,
  onManualTenantChange,
  onRetry,
  onNext,
  onBack,
}: {
  sso: WizardProbeSso;
  isProbing: boolean;
  manualTenantId: string;
  onManualTenantChange: (value: string) => void;
  onRetry: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const trimmedTenant = manualTenantId.trim();
  const needManualTenant = sso.gatewayOk && !sso.tenantId;
  const tenantResolved = !!sso.tenantId || TENANT_ID_RE.test(trimmedTenant);
  // keyValid === null:网关没有可供校验的受保护端点,不算失败
  const checksPassed =
    sso.gatewayOk && sso.keyValid !== false && sso.providersOk;
  const canContinue = checksPassed && tenantResolved;

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>{t('wizard.verify.title', { defaultValue: 'Verify' })}</CardTitle>
        <CardDescription>
          {t('wizard.verify.description', {
            defaultValue:
              'Checking the authentication gateway, the gateway service key and the unified sign-in service.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <VerifyRow
          state={sso.gatewayOk ? 'ok' : 'failed'}
          label={
            sso.gatewayOk
              ? t('wizard.verify.gatewayOk', {
                  defaultValue: 'Authentication gateway is reachable',
                })
              : t('wizard.verify.gatewayFailed', {
                  defaultValue: 'Authentication gateway is unreachable',
                })
          }
        />
        {needManualTenant ? (
          <div className="space-y-2">
            <Label htmlFor="wizard-sso-tenant-id">
              {t('wizard.verify.tenantManual', {
                defaultValue:
                  'The enterprise tenant ID could not be detected automatically. Enter it manually.',
              })}
            </Label>
            <Input
              id="wizard-sso-tenant-id"
              value={manualTenantId}
              onChange={(e) => onManualTenantChange(e.target.value)}
              placeholder="32-char hex"
              aria-invalid={
                trimmedTenant.length > 0 && !TENANT_ID_RE.test(trimmedTenant)
              }
            />
            <p className="text-xs text-text-secondary">
              {t('wizard.connection.intellectTenantIdHint', {
                defaultValue:
                  'Copy from intellect-team INTELLECT_TENANT_ID env var (Rust version requires 32-char hex)',
              })}
            </p>
          </div>
        ) : (
          <VerifyRow
            state={sso.tenantId ? 'ok' : 'unknown'}
            label={t('wizard.verify.tenantDetected', {
              defaultValue: 'Enterprise tenant ID detected',
            })}
            detail={sso.tenantId ?? undefined}
          />
        )}
        <VerifyRow
          state={sso.keyValid === false ? 'failed' : sso.keyValid ? 'ok' : 'unknown'}
          label={
            sso.keyValid === false
              ? t('wizard.verify.keyInvalid', {
                  defaultValue: 'Gateway service key is invalid',
                })
              : sso.keyValid
                ? t('wizard.verify.keyValid', {
                    defaultValue: 'Gateway service key is valid',
                  })
                : t('wizard.verify.keyUnknown', {
                    defaultValue:
                      'The gateway exposes no endpoint to check the key; it will be verified when first used.',
                  })
          }
        />
        <VerifyRow
          state={sso.providersOk ? 'ok' : 'failed'}
          label={
            sso.providersOk
              ? t('wizard.verify.providersOk', {
                  defaultValue: 'Unified sign-in service is available',
                })
              : t('wizard.verify.providersFailed', {
                  defaultValue: 'Unified sign-in service is unreachable',
                })
          }
          detail={
            sso.providersOk && sso.providerCount === 0
              ? t('wizard.verify.providersNoChannel', {
                  defaultValue:
                    'The gateway has no login channel configured yet. You can add one later in System → Unified authentication settings.',
                })
              : undefined
          }
        />
      </CardContent>
      <CardFooter className="justify-between">
        <Button variant="ghost" onClick={onBack}>
          <LucideChevronLeft className="size-4 mr-1" />
          {t('common.back', { defaultValue: 'Back' })}
        </Button>
        {checksPassed ? (
          <Button disabled={!canContinue} onClick={onNext}>
            {t('wizard.probe.continue', { defaultValue: 'Continue' })}
            <LucideChevronRight className="size-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={onRetry} disabled={isProbing}>
            {t('wizard.probe.retry', { defaultValue: 'Retry' })}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function StepProbeResult({
  probeResult,
  isProbing,
  isSsoMode = false,
  manualTenantId,
  onManualTenantChange,
  onRetry,
  onNext,
  onBack,
}: {
  probeResult: WizardProbeResponse | null;
  isProbing: boolean;
  /** wizard-ent-sso-mode v1.3:SSO 模式渲染"验证"卡 */
  isSsoMode?: boolean;
  /** 租户 ID 自动识别失败时的手填值 */
  manualTenantId: string;
  onManualTenantChange: (value: string) => void;
  onRetry: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  // SSO 模式且 BFF 返回了验证明细:走独立验证卡(仍在探测或旧 BFF 无明细时回落通用卡)
  if (isSsoMode && probeResult?.sso) {
    return (
      <StepSsoVerify
        sso={probeResult.sso}
        isProbing={isProbing}
        manualTenantId={manualTenantId}
        onManualTenantChange={onManualTenantChange}
        onRetry={onRetry}
        onNext={onNext}
        onBack={onBack}
      />
    );
  }
  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>
          {t(isSsoMode ? 'wizard.verify.title' : 'wizard.probe.title', {
            defaultValue: 'Connection Probe',
          })}
        </CardTitle>
        <CardDescription>
          {t('wizard.probe.description', {
            defaultValue:
              'Verifying backend reachability and discovering capabilities.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isProbing && (
          <p className="text-sm text-text-secondary">
            {t('wizard.probe.probing', { defaultValue: 'Probing...' })}
          </p>
        )}
        {probeResult?.healthy && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <LucideCheck className="size-4 text-accent-primary-text" />
              <span>
                {t('wizard.probe.healthy', {
                  defaultValue: 'Backend is reachable',
                })}
              </span>
            </div>
            {/* P3(wizard-sso):RAG 插件探测随向导 RAG 区块移除,相关提示删除 */}
            {probeResult.capabilities && (
              <div className="space-y-2">
                <p className="text-xs text-text-secondary">
                  {t('wizard.probe.capabilities', {
                    defaultValue: 'Discovered capabilities',
                  })}
                  :
                </p>
                <div className="flex flex-wrap gap-1">
                  {(
                    Object.entries(probeResult.capabilities) as Array<
                      [keyof HarnessCapabilities, boolean]
                    >
                  )
                    .filter(([, v]) => v)
                    .map(([k]) => (
                      <Badge key={k} variant="secondary" className="text-xs">
                        {k}
                      </Badge>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
        {probeResult && !probeResult.healthy && (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              {t('wizard.probe.failed', { defaultValue: 'Probe failed' })}
            </p>
            <p className="text-xs text-text-secondary">{probeResult.error}</p>
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-between">
        <Button variant="ghost" onClick={onBack}>
          <LucideChevronLeft className="size-4 mr-1" />
          {t('common.back', { defaultValue: 'Back' })}
        </Button>
        {probeResult?.healthy ? (
          <Button onClick={onNext}>
            {t('wizard.probe.continue', { defaultValue: 'Continue' })}
            <LucideChevronRight className="size-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={onRetry} disabled={isProbing}>
            {t('wizard.probe.retry', { defaultValue: 'Retry' })}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function StepConfirm({
  draft,
  setupResult,
  isSettingUp,
  isSsoMode,
  detectedTenantId,
  onConfirm,
  onBack,
}: {
  draft: WizardDraft;
  setupResult: WizardSetupResponse | null;
  isSettingUp: boolean;
  /** wizard-ent-sso-mode v1.3:SSO 模式只显示统一认证摘要 */
  isSsoMode: boolean;
  /** 验证步自动识别到的租户 ID(未识别或非 SSO 模式为 null) */
  detectedTenantId: string | null;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const ssoTypeLabel = t('wizard.types.enterpriseSso', {
    defaultValue: '企业版（SSO模式）',
  });
  const typeLabel = t('wizard.confirm.type', { defaultValue: 'Type' });
  const tenantIdLabel = t('wizard.confirm.tenantId', {
    defaultValue: 'Tenant ID',
  });
  const channelsText =
    draft.sso.providers.length > 0
      ? draft.sso.providers.join(',')
      : t('wizard.confirm.ssoAllChannels', {
          defaultValue: '全部渠道',
        });
  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>
          {t('wizard.confirm.title', { defaultValue: 'Confirm Setup' })}
        </CardTitle>
        <CardDescription>
          {isSsoMode
            ? t('wizard.confirm.ssoDescription', {
                defaultValue:
                  'Review the unified sign-in settings. On confirm, unified sign-in is turned on and the enterprise gateway is registered automatically.',
              })
            : t('wizard.confirm.description', {
                defaultValue:
                  'Review the configuration. On confirm, a backend config will be created.',
              })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isSsoMode ? (
          <>
            <Row label={typeLabel} value={ssoTypeLabel} />
            <Row
              label={t('wizard.confirm.gateway', {
                defaultValue: 'Authentication gateway',
              })}
              value={draft.endpoint}
            />
            <Row
              label={tenantIdLabel}
              value={detectedTenantId ?? draft.intellectTenantId.trim()}
            />
            <Row
              label={t('wizard.confirm.sso', { defaultValue: 'SSO(统一认证)' })}
              value={`${channelsText} · ${draft.sso.publicOrigin}`}
            />
            <Row
              label={t('wizard.sso.silentRelogin', {
                defaultValue: '会话过期后静默重登',
              })}
              value={
                draft.sso.silentRelogin
                  ? t('wizard.confirm.ssoOn', { defaultValue: 'On' })
                  : t('wizard.confirm.ssoOff', { defaultValue: 'Off' })
              }
            />
            {/* §8 R8:向导完成 ≠ 统一认证已生效,须写入环境变量并重启 BFF */}
            <p className="text-xs text-state-warning break-words">
              {t('wizard.confirm.ssoPendingHint', {
                defaultValue:
                  'Unified sign-in is not active yet. The completion page lists the environment variables to add to your deployment configuration; sign-in channels appear on the login page only after they are written and the BFF is restarted.',
              })}
            </p>
          </>
        ) : (
          <>
            <Row
              label={t('wizard.confirm.name', { defaultValue: 'Name' })}
              value={draft.name}
            />
            <Row
              label={typeLabel}
              value={
                draft.setupProfile === 'enterprise-password'
                  ? t('wizard.types.enterprisePassword', {
                      defaultValue: '企业版（非SSO模式）',
                    })
                  : (draft.selectedType ?? '-')
              }
            />
            <Row
              label={t('wizard.confirm.endpoint', { defaultValue: 'Endpoint' })}
              value={draft.endpoint}
            />
            {draft.intellectTenantId && (
              <Row label={tenantIdLabel} value={draft.intellectTenantId} />
            )}
          </>
        )}
        {setupResult?.envSnippet && (
          <div className="space-y-1 pt-2">
            <p className="text-xs text-text-secondary">
              {t('wizard.confirm.envSnippet', {
                defaultValue: '.env snippet (copy to your .env file)',
              })}
            </p>
            <pre className="text-xs bg-bg-muted p-3 rounded-md overflow-x-auto">
              {setupResult.envSnippet}
            </pre>
          </div>
        )}
        {setupResult && !setupResult.success && (
          <p className="text-sm text-destructive">
            {t('wizard.confirm.error', { defaultValue: 'Error' })}:{' '}
            {setupResult.error}
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-between">
        <Button variant="ghost" onClick={onBack} disabled={isSettingUp}>
          <LucideChevronLeft className="size-4 mr-1" />
          {t('common.back', { defaultValue: 'Back' })}
        </Button>
        <Button onClick={onConfirm} disabled={isSettingUp}>
          {isSettingUp
            ? t('common.submitting', { defaultValue: 'Submitting...' })
            : isSsoMode
              ? t('wizard.confirm.submitSso', { defaultValue: 'Finish setup' })
              : t('wizard.confirm.submit', { defaultValue: 'Create Backend' })}
        </Button>
      </CardFooter>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-text-secondary">{label}</span>
      <code className="text-text-primary text-right break-all">{value}</code>
    </div>
  );
}

function StepDone({
  setupResult,
  isSsoMode,
  onDone,
}: {
  setupResult: WizardSetupResponse | null;
  /** wizard-ent-sso-mode v1.3:SSO 模式的完成页以统一认证为主线 */
  isSsoMode: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const warnings = setupResult?.warnings ?? [];
  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>
          {t('wizard.done.title', { defaultValue: 'Setup Complete' })}
        </CardTitle>
        <CardDescription>
          {isSsoMode
            ? t('wizard.done.ssoDescription', {
                defaultValue:
                  'Unified sign-in is configured and the enterprise gateway has been registered. Add the environment variables below to your deployment configuration and restart the service.',
              })
            : t('wizard.done.description', {
                defaultValue:
                  'Backend has been configured successfully. You can now start using the platform.',
              })}
        </CardDescription>
      </CardHeader>
      {/* D-FUP-01(wizard-sso-followup/A2):envSnippet 原只渲染在第 5 步确认卡,
          而 setup 成功即 goToStep(6) 自动跳完成页——用户永远看不到步骤 1 承诺的
          ".env 片段"。补渲染到完成页(与确认卡同键复用)。 */}
      {setupResult?.envSnippet && (
        <CardContent className="space-y-1">
          {/* §8 R8:SSO snippet 时强制提示尚未写入 env */}
          {setupResult.envSnippet.includes('BFF_SSO_ENABLED') && (
            <p className="text-xs text-state-warning break-words">
              {t('wizard.done.ssoEnvPending', {
                defaultValue:
                  '统一认证尚未生效:请将下列 BFF_SSO_* 写入部署 .env 并重启 BFF 后,登录页才会出现统一认证渠道。',
              })}
            </p>
          )}
          <p className="text-xs text-text-secondary">
            {t('wizard.confirm.envSnippet', {
              defaultValue: '.env snippet (copy to your .env file)',
            })}
          </p>
          <pre className="text-xs bg-bg-muted p-3 rounded-md overflow-x-auto">
            {setupResult.envSnippet}
          </pre>
        </CardContent>
      )}
      {/* wizard-sso(P3/X-04/R13):非阻断告警展示(如 RAG 未配置的能力降级说明) */}
      {warnings.length > 0 && (
        <CardContent className="space-y-2">
          <p className="text-sm font-medium">
            {t('wizard.done.warnings', { defaultValue: '提示' })}
          </p>
          <ul className="space-y-1.5">
            {warnings.map((w, i) => (
              <li key={i} className="text-xs text-state-warning break-words">
                • {w}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
      <CardFooter>
        <Button onClick={onDone}>
          {t('wizard.done.goHome', { defaultValue: 'Go to Home' })}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Wizard page (main container + state machine)
// ---------------------------------------------------------------------------

function WizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get('mode');

  // Step state:1-6
  const initialStep = (() => {
    const s = Number(searchParams.get('step'));
    if (s >= 1 && s <= WIZARD_STEPS) return s;
    return 1;
  })();
  const [step, setStep] = useState<number>(initialStep);

  // Draft state(Step 3-4 持久化到 localStorage)
  const [draft, setDraft] = useState<WizardDraft>(() => {
    // Step 3-4 时从 localStorage 加载,否则重置
    if (initialStep >= 3 && initialStep <= 4) {
      return loadDraft();
    }
    return INITIAL_DRAFT;
  });

  const [probeResult, setProbeResult] = useState<WizardProbeResponse | null>(
    null,
  );
  const [setupResult, setSetupResult] = useState<WizardSetupResponse | null>(
    null,
  );
  // wizard-sso(P2/R3):引导密钥仅内存态,不进 localStorage 草稿;刷新丢失需重新生成
  const [ssoSecret, setSsoSecret] = useState('');

  // ----- Queries -----
  // 列表:可用后端类型
  const { data: typesData } = useQuery({
    queryKey: ['wizard/backend-types'],
    queryFn: async () => (await fetchWizardBackendTypes()).data,
    retry: false,
  });
  // intellect-rag 不作为独立向导类型(RAG 是 enterprise 插件)。BFF 已不返回该项;此处再过滤一次防止旧缓存。
  // 滚动升级:旧 BFF 无 optionId 时回落 type(双卡场景须新 BFF)
  // useMemo 保持引用稳定:selectedOption 与 StepConnectionForm 的 [option] 副作用都依赖它,
  // 每次渲染新建数组会让该副作用反复触发(修复:第 3 步曾因此陷入重渲染循环)
  const options = useMemo(
    () =>
      (typesData?.options ?? [])
        .filter((o) => o.type !== 'intellect-rag')
        .map((o) => ({
          ...o,
          optionId: o.optionId || o.type,
        })),
    [typesData],
  );

  // 当前选中 option 元数据(按 optionId,§8 R2)
  const selectedOption = useMemo(
    () => options.find((o) => o.optionId === draft.selectedOptionId),
    [options, draft.selectedOptionId],
  );
  // wizard-ent-sso-mode v1.3:SSO 模式走独立的第 3–6 步(统一认证设置 / 验证 / 确认 / 完成)
  const isSsoMode = draft.setupProfile === 'enterprise-sso';

  useEffect(() => {
    if (!draft.selectedOptionId || options.length === 0) return;
    if (!options.some((o) => o.optionId === draft.selectedOptionId)) {
      setDraft((prev) => ({
        ...prev,
        selectedOptionId: null,
        selectedType: null,
        setupProfile: undefined,
      }));
    }
  }, [options, draft.selectedOptionId]);

  // Step 5-6 刷新时检查后端是否已配置,有则跳 /
  const { data: statusData } = useQuery({
    queryKey: ['wizard/status'],
    queryFn: async () => (await fetchWizardStatus()).data,
    // Step 5-6 才启用;"新增后端"场景从第 2 步起就需要(判断是否隐藏 SSO 模式卡)
    enabled: step >= 5 || mode === 'add',
    retry: false,
  });

  // v1.3 D5:"新增后端"场景下已有企业后端时不再提供 SSO 模式卡——
  // 它会再登记一条企业后端并改写默认租户绑定;统一认证的调整走系统管理的「统一认证设置」
  const hideSsoCard = mode === 'add' && statusData?.hasEnterpriseBackend === true;
  const visibleOptions = hideSsoCard
    ? options.filter((o) => o.setupProfile !== 'enterprise-sso')
    : options;

  // SSO 模式卡被隐藏时,清掉旧草稿里可能残留的 SSO 选型
  useEffect(() => {
    if (hideSsoCard && draft.setupProfile === 'enterprise-sso') {
      setDraft((prev) => ({
        ...prev,
        selectedOptionId: null,
        selectedType: null,
        setupProfile: undefined,
      }));
    }
  }, [hideSsoCard, draft.setupProfile]);

  // 仅当页面以 step>=5 加载(刷新场景)时才执行重定向检测。
  // 用户从 Step 4 点击"继续"进入 Step 5 时,后端尚未创建(needsSetup=true 是预期行为),
  // 不应触发回退逻辑。此处通过 initialStep 判断是否为刷新场景。
  const isRefreshToConfirmOrDone = useRef(initialStep >= 5);

  useEffect(() => {
    if (!isRefreshToConfirmOrDone.current) return;
    if (step >= 5 && statusData) {
      if (!statusData.needsSetup) {
        // 后端已配置:mode=add 场景允许继续完成向导,其他场景跳走
        if (mode !== 'add') {
          navigate(Routes.Root);
        }
      } else {
        // m2 修复(P3):后端未配置(needsSetup=true),说明用户在 Step 5-6 时
        // 后端被删除或配置丢失,回退到 Step 3 让用户重新填写连接信息
        // mode=add 场景下也需要回退,因为新增向导依赖前几步的表单数据
        if (step > 5) {
          // Step 6(Done)回退到 Step 5(Confirm),由用户决定是否重试
          goToStep(5);
        } else {
          // Step 5(Confirm)回退到 Step 3(Connection),保留草稿
          goToStep(3);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusData, step, mode, navigate]);

  // ----- Step transitions -----
  const goToStep = (n: number) => {
    setStep(n);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('step', String(n));
      return next;
    }, { replace: true });
  };

  const updateDraft = (patch: Partial<WizardDraft>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      // Step 3-4 持久化
      if (step >= 3 && step <= 4) {
        saveDraft(next);
      }
      return next;
    });
  };

  // ----- Probe mutation -----
  const probeMutation = useMutation({
    mutationFn: async () => {
      if (!draft.selectedType || !draft.endpoint) {
        throw new Error('missing type or endpoint');
      }
      const req: WizardProbeRequest =
        draft.credentialKind === 'email-password'
          ? {
              type: draft.selectedType,
              endpoint: draft.endpoint,
              email: draft.email,
              password: draft.password,
            }
          : {
              type: draft.selectedType,
              endpoint: draft.endpoint,
              token: draft.token,
            };
      // P3(wizard-sso):RAG 插件探测随向导 RAG 区块移除
      // wizard-ent-sso-mode v1.3:SSO 模式走验证分支(BFF 校验网关与密钥、识别租户)
      if (draft.setupProfile) {
        req.setupProfile = draft.setupProfile;
      }
      return (await probeWizardBackend(req)).data;
    },
    onSuccess: (resp) => {
      setProbeResult(resp);
    },
    onError: (err: unknown) => {
      setProbeResult({
        healthy: false,
        error: (err as Error).message,
      });
    },
    retry: false,
  });

  // 进入 Step 4 时自动触发 probe
  useEffect(() => {
    if (step === 4 && !probeResult && !probeMutation.isPending) {
      probeMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ----- Setup mutation -----
  const queryClient = useQueryClient();
  const setupMutation = useMutation({
    mutationFn: async () => {
      if (!draft.selectedType) {
        throw new Error('missing type');
      }
      const req = {
        name: draft.name,
        type: draft.selectedType,
        endpoint: draft.endpoint,
        credentialKind: draft.credentialKind,
        // adminTokenEnvVar 由 BFF 自动生成 HARNESS_<ID>_TOKEN,前端不再发送该字段
        ...(draft.credentialKind === 'bearer-token'
          ? { token: draft.token }
          : { email: draft.email, password: draft.password }),
        ...(draft.intellectTenantId
          ? { intellectTenantId: draft.intellectTenantId }
          : {}),
        // wizard-ent-sso-mode:显式 setupProfile;仅 enterprise-sso 携带 sso。
        // v1.3:启用状态由模式推定(不传 sso.enabled);SSO 模式下名称由 BFF 取默认值、
        // 租户 ID 由 BFF 自动识别,intellectTenantId 仅在验证步手填过时携带
        ...(draft.setupProfile ? { setupProfile: draft.setupProfile } : {}),
        ...(draft.setupProfile === 'enterprise-sso'
          ? {
              sso: {
                publicOrigin: draft.sso.publicOrigin.trim(),
                stateSecret: ssoSecret,
                providers:
                  draft.sso.providers.length > 0 ? draft.sso.providers : null,
                silentRelogin: draft.sso.silentRelogin,
              },
            }
          : {}),
        defaultForTenant: draft.defaultForTenant,
      };
      return (await setupWizardBackend(req)).data;
    },
    onSuccess: (resp) => {
      setSetupResult(resp);
      if (resp.success) {
        toast.success(
          isSsoMode
            ? t('wizard.toast.successSso', {
                defaultValue: 'Unified sign-in setup is complete',
              })
            : t('wizard.toast.success', {
                defaultValue: 'Backend created successfully',
              }),
        );
        // 失效 wizard/status 缓存,避免 WizardGuard 读到旧 needsSetup=true
        // 导致跳转 / 时被重定向回 /wizard 形成死循环
        queryClient.invalidateQueries({ queryKey: ['wizard/status'] });
        clearDraft();
        goToStep(6);
      } else {
        toast.error(
          resp.error ??
            t('wizard.toast.failed', {
              defaultValue: 'Setup failed',
            }),
        );
      }
    },
    onError: (err: unknown) => {
      setSetupResult({
        success: false,
        error: (err as Error).message,
      });
      toast.error(
        t('wizard.toast.failed', { defaultValue: 'Setup failed' }),
      );
    },
    retry: false,
  });

  // ----- Handlers -----
  const handleSelectType = (option: WizardBackendTypeOption) => {
    const isSso = option.setupProfile === 'enterprise-sso';
    updateDraft({
      selectedOptionId: option.optionId,
      selectedType: option.type,
      setupProfile: option.setupProfile,
      endpoint: option.defaultEndpoint,
      credentialKind: option.credentialKind,
      // 重置凭据字段(切换类型时旧凭据无效)
      token: '',
      email: '',
      password: '',
      intellectTenantId: '',
      // 切卡重置 SSO;SSO 模式卡预填公开来源地址(启用状态由模式推定,草稿里没有 enabled)
      sso: isSso
        ? {
            ...INITIAL_WIZARD_DRAFT_SSO,
            publicOrigin: window.location.origin,
          }
        : { ...INITIAL_WIZARD_DRAFT_SSO },
    });
    setSsoSecret('');
  };

  const handleProbeRetry = () => {
    setProbeResult(null);
    probeMutation.mutate();
  };

  const handleConfirm = () => {
    setupMutation.mutate();
  };

  const handleDone = () => {
    clearDraft();
    navigate(Routes.Root);
  };

  // ----- Render -----
  return (
    <ScrollArea className="w-screen h-screen">
      <div className="min-h-screen flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-5xl">
          <h1 className="text-2xl font-bold text-center mb-2">
            {t('wizard.title', { defaultValue: 'Setup Wizard' })}
          </h1>
          <p className="text-center text-sm text-text-secondary mb-8">
            {isSsoMode
              ? t('wizard.subtitleSso', {
                  defaultValue: 'Set up unified sign-in',
                })
              : t('wizard.subtitle', {
                  defaultValue: 'Connect your first harness backend',
                })}
          </p>

          <Stepper current={step} isSsoMode={isSsoMode} />

          {step === 1 && <StepWelcome onNext={() => goToStep(2)} />}

          {step === 2 && (
            <StepSelectType
              options={visibleOptions}
              selectedOptionId={draft.selectedOptionId}
              onSelect={handleSelectType}
              onNext={() => goToStep(3)}
              onBack={() => goToStep(1)}
              ssoCardHidden={hideSsoCard}
            />
          )}

          {step === 3 && (
            <StepConnectionForm
              draft={draft}
              option={selectedOption}
              ssoSecret={ssoSecret}
              onSsoChange={(patch) => updateDraft({ sso: { ...draft.sso, ...patch } })}
              onSsoSecretChange={setSsoSecret}
              update={updateDraft}
              onNext={() => {
                setProbeResult(null);
                goToStep(4);
              }}
              onBack={() => goToStep(2)}
            />
          )}

          {step === 4 && (
            <StepProbeResult
              probeResult={probeResult}
              isProbing={probeMutation.isPending}
              isSsoMode={isSsoMode}
              manualTenantId={draft.intellectTenantId}
              onManualTenantChange={(value) =>
                updateDraft({ intellectTenantId: value })
              }
              onRetry={handleProbeRetry}
              onNext={() => goToStep(5)}
              onBack={() => goToStep(3)}
            />
          )}

          {step === 5 && (
            <StepConfirm
              draft={draft}
              setupResult={setupResult}
              isSettingUp={setupMutation.isPending}
              isSsoMode={isSsoMode}
              detectedTenantId={probeResult?.sso?.tenantId ?? null}
              onConfirm={handleConfirm}
              onBack={() => goToStep(4)}
            />
          )}

          {step === 6 && (
            <StepDone
              setupResult={setupResult}
              isSsoMode={isSsoMode}
              onDone={handleDone}
            />
          )}
        </div>
      </div>
      <Toaster />
    </ScrollArea>
  );
}

export default WizardPage;
