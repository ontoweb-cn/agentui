// wizard-sso(P2) + wizard-ent-sso-mode:
// 向导统一认证(SSO)配置区块 —— 仅「企业版（SSO模式）」卡渲染。
//
// 设计(docs/wizard-enterprise-sso-mode-design.md §3.3 / §8 R4):
// - SSO 模式卡强制启用(无「可跳过」主开关);
// - 渠道列表来自 BFF /admin/wizard/sso/providers(字段裁剪视图,只读展示);
// - stateSecret 仅存在于组件内存态(不进 localStorage 草稿,刷新后重新生成);
// - publicOrigin 为 http:// 时警告但不阻断(生产强制由 BFF 启动 fail-fast 裁决)。
//
// 约束:文本遵循 Text Overflow 规则(渠道名可能很长,truncate + min-w-0)。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';

import { LucideCopy, LucideKeyRound } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

import {
  fetchWizardSsoProviders,
  type WizardSsoProviderView,
} from '@/services/wizard-service';

export interface WizardDraftSso {
  enabled: boolean;
  publicOrigin: string;
  /** 渠道白名单;空数组 = 不过滤(全部展示) */
  providers: string[];
  silentRelogin: boolean;
}

/** 向导 SSO 初始态(page 与切型重置共用同一引用源) */
export const INITIAL_WIZARD_DRAFT_SSO: WizardDraftSso = {
  enabled: false,
  publicOrigin: '',
  providers: [],
  silentRelogin: true,
};

interface SsoSectionProps {
  value: WizardDraftSso;
  /** 引导密钥:父组件内存态,不随草稿持久化 */
  secret: string;
  /** 当前已填端点(渠道拉取目标) */
  endpoint: string;
  onChange: (patch: Partial<WizardDraftSso>) => void;
  onSecretChange: (secret: string) => void;
  /** SSO 模式卡:锁定启用,隐藏可跳过开关(§8 R4) */
  lockedEnabled?: boolean;
}

const SECRET_LENGTH = 48;
const SECRET_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 生成 ≥32 字符随机密钥(满足 BFF_SSO_STATE_SECRET 启动校验) */
function generateSecret(): string {
  const bytes = new Uint8Array(SECRET_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => SECRET_CHARS[b % SECRET_CHARS.length]).join('');
}

interface ChannelState {
  providers: WizardSsoProviderView[];
  misconfigured: string[];
  error?: string;
}

export function SsoSection({
  value,
  secret,
  endpoint,
  onChange,
  onSecretChange,
  lockedEnabled = false,
}: SsoSectionProps) {
  const { t } = useTranslation();
  const [channels, setChannels] = useState<ChannelState | null>(null);
  const showFields = lockedEnabled || value.enabled;

  const providersMutation = useMutation({
    mutationFn: () => fetchWizardSsoProviders(endpoint.trim().replace(/\/+$/, '')),
    onSuccess: (resp) => {
      setChannels({
        providers: resp.data.providers,
        misconfigured: resp.data.misconfigured,
      });
    },
    onError: (err: unknown) => {
      setChannels({
        providers: [],
        misconfigured: [],
        error: (err as Error).message,
      });
    },
    retry: false,
  });

  const toggleProvider = (id: string) => {
    const next = value.providers.includes(id)
      ? value.providers.filter((p) => p !== id)
      : [...value.providers, id];
    onChange({ providers: next });
  };

  const handleGenerate = () => {
    onSecretChange(generateSecret());
  };

  const handleCopy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast.success(t('wizard.sso.secretCopied', {
        defaultValue: '密钥已复制,请粘贴到 .env 的 BFF_SSO_STATE_SECRET',
      }));
    } catch {
      toast.error(t('wizard.sso.copyFailed', { defaultValue: '复制失败,请手动选择复制' }));
    }
  };

  const isHttp = value.publicOrigin.trim().toLowerCase().startsWith('http://');

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="min-w-0 space-y-0.5">
        <Label>
          {t('wizard.sso.title', { defaultValue: '统一认证登录(SSO)' })}
        </Label>
        <p className="text-xs text-text-secondary">
          {lockedEnabled
            ? t('wizard.sso.requiredHint', {
                defaultValue:
                  '本模式必须配置统一认证;完成后请将环境变量写入部署配置并重启 BFF,登录页才会出现渠道按钮。',
              })
            : t('wizard.sso.skipHint', {
                defaultValue:
                  '可跳过,稍后在系统管理中配置;开启后终端用户可经统一认证免密登录。',
              })}
        </p>
      </div>

      {showFields && (
        <div className="space-y-4 pt-1">
          {/* 登录渠道 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>
                {t('wizard.sso.channels', { defaultValue: '登录渠道' })}
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!endpoint.trim() || providersMutation.isPending}
                onClick={() => providersMutation.mutate()}
              >
                <LucideKeyRound className="size-4 mr-1" />
                {providersMutation.isPending
                  ? t('wizard.sso.fetching', { defaultValue: '获取中...' })
                  : channels
                    ? t('wizard.sso.refetch', { defaultValue: '重新获取' })
                    : t('wizard.sso.fetchChannels', { defaultValue: '获取登录渠道' })}
              </Button>
            </div>
            {!endpoint.trim() && (
              <p className="text-xs text-text-secondary">
                {t('wizard.sso.needEndpoint', {
                  defaultValue: '先填写企业版网关端点,再获取登录渠道。',
                })}
              </p>
            )}
            {channels?.error && (
              <p className="text-xs text-destructive">
                {t('wizard.sso.fetchFailed', {
                  defaultValue: '获取登录渠道失败,请稍后再试',
                })}
                {channels.error ? ` (${channels.error})` : ''}
              </p>
            )}
            {channels && !channels.error && (
              <div className="space-y-1.5">
                {channels.providers.length === 0 && (
                  <p className="text-xs text-text-secondary">
                    {t('wizard.sso.noChannels', {
                      defaultValue: '统一认证服务暂无可用登录渠道;可稍后配置或跳过 SSO。',
                    })}
                  </p>
                )}
                {channels.providers.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 min-w-0">
                    <Checkbox
                      id={`wizard-sso-channel-${p.id}`}
                      checked={value.providers.includes(p.id)}
                      onCheckedChange={() => toggleProvider(p.id)}
                    />
                    <Label
                      htmlFor={`wizard-sso-channel-${p.id}`}
                      className="min-w-0 flex-1 cursor-pointer truncate font-normal"
                    >
                      {p.displayName}
                    </Label>
                    <code className="shrink-0 text-xs text-text-secondary truncate max-w-40">
                      {p.id}
                    </code>
                  </div>
                ))}
                {channels.misconfigured.map((id) => (
                  <div key={id} className="flex items-center gap-2 min-w-0">
                    <Checkbox disabled checked={false} id={`wizard-sso-channel-${id}`} />
                    <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
                      {id}
                    </span>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {t('wizard.sso.misconfigured', { defaultValue: '配置缺失,不可选' })}
                    </Badge>
                  </div>
                ))}
                <p className="text-xs text-text-secondary">
                  {t('wizard.sso.whitelistHint', {
                    defaultValue:
                      '勾选要在登录页展示的渠道;全部不勾 = 展示全部可用渠道。',
                  })}
                </p>
              </div>
            )}
          </div>

          {/* 公开来源 */}
          <div className="space-y-2">
            <Label htmlFor="wizard-sso-origin">
              {t('wizard.sso.publicOrigin', { defaultValue: '公开来源地址' })}
            </Label>
            <Input
              id="wizard-sso-origin"
              value={value.publicOrigin}
              onChange={(e) => onChange({ publicOrigin: e.target.value })}
              placeholder="https://your-domain.example.com"
            />
            {isHttp && (
              <p className="text-xs text-state-warning">
                {t('wizard.sso.httpWarning', {
                  defaultValue:
                    '当前为 http://:生产环境必须使用 https,否则 BFF 启动校验将失败(内网调试可设置 BFF_ALLOW_INSECURE_SSO=true 例外)。',
                })}
              </p>
            )}
          </div>

          {/* 引导密钥 */}
          <div className="space-y-2">
            <Label htmlFor="wizard-sso-secret">
              {t('wizard.sso.secret', { defaultValue: '引导密钥(State Secret)' })}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="wizard-sso-secret"
                readOnly
                value={secret}
                placeholder={t('wizard.sso.secretPlaceholder', {
                  defaultValue: '点击"生成"创建随机密钥',
                })}
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" size="sm" onClick={handleGenerate} className="shrink-0">
                {secret
                  ? t('wizard.sso.regenerate', { defaultValue: '重新生成' })
                  : t('wizard.sso.generate', { defaultValue: '生成' })}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopy}
                disabled={!secret}
                className="shrink-0"
              >
                <LucideCopy className="size-4" />
              </Button>
            </div>
            <p className="text-xs text-text-secondary">
              {t('wizard.sso.secretHint', {
                defaultValue:
                  '复制到部署配置 BFF_SSO_STATE_SECRET;仅此一次展示,页面刷新后需重新生成。',
              })}
            </p>
          </div>

          {/* 静默重登(标签文案已含语义:会话过期后静默重登) */}
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="wizard-sso-relogin" className="min-w-0">
              {t('wizard.sso.silentRelogin', { defaultValue: '会话过期后静默重登' })}
            </Label>
            <Switch
              id="wizard-sso-relogin"
              checked={value.silentRelogin}
              onCheckedChange={(v) => onChange({ silentRelogin: v })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
