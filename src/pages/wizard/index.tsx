// spec-010 v8 B-6: Wizard 首次安装向导(6 步状态机)。
// Constitution Principle I (BFF-Mediated Frontend): 前端经 BFF Wizard 路由完成首次配置。
//
// 状态机(m7):
// - Step 1-2: 刷新重置到 Step 1
// - Step 3-4: 表单暂存到 localStorage `wizard-draft`,刷新后回到 Step 3
// - Step 5-6: 刷新检测后端是否已配置(GET /wizard/status),有则跳 /,无则回 Step 3
// - Probe 失败:停留在 Step 4 显示错误,允许修改后重试
// - Setup 成功:清空 wizard-draft,跳转 /
//
// 路由:/wizard (不经过 AuthWrapper,首次安装无 admin token)
// URL query:?step=N 控制步骤,?mode=add 从 Admin 页跳转过来(已有后端时新增)

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  LucideCheck,
  LucideChevronLeft,
  LucideChevronRight,
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

import { Routes } from '@/routes';
import {
  fetchWizardBackendTypes,
  fetchWizardStatus,
  probeWizardBackend,
  setupWizardBackend,
  type BackendType,
  type CredentialKind,
  type HarnessCapabilities,
  type WizardBackendTypeOption,
  type WizardProbeResponse,
  type WizardSetupResponse,
} from '@/services/wizard-service';

// ---------------------------------------------------------------------------
// Local types & constants
// ---------------------------------------------------------------------------

const DRAFT_STORAGE_KEY = 'wizard-draft';
const WIZARD_STEPS = 6;

interface WizardDraft {
  selectedType: BackendType | null;
  name: string;
  endpoint: string;
  adminTokenEnvVar: string;
  credentialKind: CredentialKind;
  token: string;
  email: string;
  password: string;
  intellectTenantId: string;
  defaultForTenant: boolean;
}

const INITIAL_DRAFT: WizardDraft = {
  selectedType: null,
  name: '',
  endpoint: '',
  adminTokenEnvVar: '',
  credentialKind: 'bearer-token',
  token: '',
  email: '',
  password: '',
  intellectTenantId: '',
  defaultForTenant: true,
};

// ---------------------------------------------------------------------------
// Draft persistence helpers
// ---------------------------------------------------------------------------

function loadDraft(): WizardDraft {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return INITIAL_DRAFT;
    return { ...INITIAL_DRAFT, ...JSON.parse(raw) };
  } catch {
    return INITIAL_DRAFT;
  }
}

function saveDraft(draft: WizardDraft): void {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // localStorage 不可用时静默忽略(隐私模式等)
  }
}

function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

function Stepper({ current }: { current: number }) {
  const { t } = useTranslation();
  const labels = useMemo(
    () => [
      t('wizard.step.welcome', { defaultValue: 'Welcome' }),
      t('wizard.step.selectType', { defaultValue: 'Select Type' }),
      t('wizard.step.connection', { defaultValue: 'Connection' }),
      t('wizard.step.probe', { defaultValue: 'Probe' }),
      t('wizard.step.confirm', { defaultValue: 'Confirm' }),
      t('wizard.step.done', { defaultValue: 'Done' }),
    ],
    [t],
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
              'This wizard guides you through connecting your first harness backend. You can configure Intellect Community, Intellect Enterprise, or other OpenAI-compatible backends.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-text-secondary">
        <p>
          {t('wizard.welcome.steps', {
            defaultValue:
              'You will: select a backend type → enter connection info → probe → confirm → done.',
          })}
        </p>
        <p>
          {t('wizard.welcome.note', {
            defaultValue:
              'Token is sent over HTTPS only. Response will not include the plaintext token; instead an .env snippet is provided for persistence.',
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
  selectedType,
  onSelect,
  onNext,
  onBack,
}: {
  options: WizardBackendTypeOption[];
  selectedType: BackendType | null;
  onSelect: (type: BackendType, option: WizardBackendTypeOption) => void;
  onNext: () => void;
  onBack: () => void;
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
          value={selectedType ?? ''}
          onValueChange={(v) => {
            const opt = options.find((o) => o.type === v);
            if (opt) onSelect(opt.type, opt);
          }}
          className="grid grid-cols-1 md:grid-cols-2 gap-3"
        >
          {options.map((opt) => (
            <label
              key={opt.type}
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                selectedType === opt.type
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-border-hover'
              }`}
            >
              <RadioGroupItem
                value={opt.type}
                id={`backend-type-${opt.type}`}
                className="mt-1"
              />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{opt.label}</span>
                  <code className="text-xs text-text-secondary">{opt.type}</code>
                </div>
                <p className="text-xs text-text-secondary">{opt.description}</p>
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
              </div>
            </label>
          ))}
        </RadioGroup>
      </CardContent>
      <CardFooter className="justify-between">
        <Button variant="ghost" onClick={onBack}>
          <LucideChevronLeft className="size-4 mr-1" />
          {t('common.back', { defaultValue: 'Back' })}
        </Button>
        <Button disabled={!selectedType} onClick={onNext}>
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
  update,
  onNext,
  onBack,
}: {
  draft: WizardDraft;
  option: WizardBackendTypeOption | undefined;
  update: (patch: Partial<WizardDraft>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const isEnterprise = draft.selectedType === 'intellect-enterprise';

  // 自动填充默认 endpoint/adminTokenEnvVar(首次进入时)
  useEffect(() => {
    if (option && !draft.endpoint) {
      update({ endpoint: option.defaultEndpoint });
    }
    // m1 修复:adminTokenEnvVar 优先用 name,若 name 为空则用 option.type 兜底
    // 原 bug:`${draft.name...}_TOKEN` 在 name 为空时产出 '_TOKEN'(truthy),`||` 右侧永不执行
    if (option && !draft.adminTokenEnvVar) {
      const trimmedName = draft.name.trim();
      const envVar = trimmedName
        ? `${trimmedName.toUpperCase().replace(/\s+/g, '_')}_TOKEN`
        : `${option.type.toUpperCase().replace(/-/g, '_')}_TOKEN`;
      update({ adminTokenEnvVar: envVar });
    }
    if (option) {
      update({ credentialKind: option.credentialKind });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option]);

  const valid = useMemo(() => {
    if (!draft.name.trim() || !draft.endpoint.trim()) return false;
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
      if (!/^[0-9a-fA-F]{32}$/.test(tenantId)) return false;
    }
    return true;
  }, [draft, isEnterprise]);

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
            placeholder="Intellect RAG Default"
          />
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
        <div className="space-y-2">
          <Label htmlFor="wizard-envvar">
            {t('wizard.connection.adminTokenEnvVar', {
              defaultValue: 'Admin Token Env Var',
            })}
          </Label>
          <Input
            id="wizard-envvar"
            value={draft.adminTokenEnvVar}
            onChange={(e) => update({ adminTokenEnvVar: e.target.value })}
            placeholder="HARNESS_INTELLECT_RAG_ADMIN_TOKEN"
          />
          <p className="text-xs text-text-secondary">
            {t('wizard.connection.adminTokenEnvVarHint', {
              defaultValue:
                'Env var name to read the token from at runtime (fallback when no vault).',
            })}
          </p>
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

function StepProbeResult({
  probeResult,
  isProbing,
  onRetry,
  onNext,
  onBack,
}: {
  probeResult: WizardProbeResponse | null;
  isProbing: boolean;
  onRetry: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>
          {t('wizard.probe.title', { defaultValue: 'Connection Probe' })}
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
              <LucideCheck className="size-4 text-green-500" />
              <span>
                {t('wizard.probe.healthy', {
                  defaultValue: 'Backend is reachable',
                })}
              </span>
            </div>
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
  onConfirm,
  onBack,
}: {
  draft: WizardDraft;
  setupResult: WizardSetupResponse | null;
  isSettingUp: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>
          {t('wizard.confirm.title', { defaultValue: 'Confirm Setup' })}
        </CardTitle>
        <CardDescription>
          {t('wizard.confirm.description', {
            defaultValue:
              'Review the configuration. On confirm, a backend config will be created.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row
          label={t('wizard.confirm.name', { defaultValue: 'Name' })}
          value={draft.name}
        />
        <Row
          label={t('wizard.confirm.type', { defaultValue: 'Type' })}
          value={draft.selectedType ?? '-'}
        />
        <Row
          label={t('wizard.confirm.endpoint', { defaultValue: 'Endpoint' })}
          value={draft.endpoint}
        />
        <Row
          label={t('wizard.confirm.envVar', { defaultValue: 'Env Var' })}
          value={draft.adminTokenEnvVar}
        />
        {draft.intellectTenantId && (
          <Row
            label={t('wizard.confirm.tenantId', { defaultValue: 'Tenant ID' })}
            value={draft.intellectTenantId}
          />
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

function StepDone({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>
          {t('wizard.done.title', { defaultValue: 'Setup Complete' })}
        </CardTitle>
        <CardDescription>
          {t('wizard.done.description', {
            defaultValue:
              'Backend has been configured successfully. You can now start using the platform.',
          })}
        </CardDescription>
      </CardHeader>
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

  // ----- Queries -----
  // 列表:可用后端类型
  const { data: typesData } = useQuery({
    queryKey: ['wizard/backend-types'],
    queryFn: async () => (await fetchWizardBackendTypes()).data,
    retry: false,
  });
  const options = typesData?.options ?? [];

  // 当前选中类型的 option 元数据
  const selectedOption = useMemo(
    () => options.find((o) => o.type === draft.selectedType),
    [options, draft.selectedType],
  );

  // Step 5-6 刷新时检查后端是否已配置,有则跳 /
  const { data: statusData } = useQuery({
    queryKey: ['wizard/status'],
    queryFn: async () => (await fetchWizardStatus()).data,
    // Step 5-6 才启用
    enabled: step >= 5,
    retry: false,
  });

  useEffect(() => {
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
      const req =
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
        adminTokenEnvVar: draft.adminTokenEnvVar,
        ...(draft.credentialKind === 'bearer-token'
          ? { token: draft.token }
          : { email: draft.email, password: draft.password }),
        ...(draft.intellectTenantId
          ? { intellectTenantId: draft.intellectTenantId }
          : {}),
        defaultForTenant: draft.defaultForTenant,
      };
      return (await setupWizardBackend(req)).data;
    },
    onSuccess: (resp) => {
      setSetupResult(resp);
      if (resp.success) {
        toast.success(
          t('wizard.toast.success', {
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
  const handleSelectType = (
    type: BackendType,
    option: WizardBackendTypeOption,
  ) => {
    updateDraft({
      selectedType: type,
      endpoint: option.defaultEndpoint,
      credentialKind: option.credentialKind,
      // 重置凭据字段(切换类型时旧凭据无效)
      token: '',
      email: '',
      password: '',
      intellectTenantId: '',
    });
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
            {t('wizard.subtitle', {
              defaultValue: 'Connect your first harness backend',
            })}
          </p>

          <Stepper current={step} />

          {step === 1 && <StepWelcome onNext={() => goToStep(2)} />}

          {step === 2 && (
            <StepSelectType
              options={options}
              selectedType={draft.selectedType}
              onSelect={handleSelectType}
              onNext={() => goToStep(3)}
              onBack={() => goToStep(1)}
            />
          )}

          {step === 3 && (
            <StepConnectionForm
              draft={draft}
              option={selectedOption}
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
              onConfirm={handleConfirm}
              onBack={() => goToStep(4)}
            />
          )}

          {step === 6 && <StepDone onDone={handleDone} />}
        </div>
      </div>
      <Toaster />
    </ScrollArea>
  );
}

export default WizardPage;
