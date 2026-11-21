// wizard-sso-followup(A7): 统一认证运行时配置设置页(系统管理)。
//
// 手册口径(docs/wizard-manual.md §9):
// - 展示生效配置与来源(runtime=本页保存的运行时文件 / env=部署环境变量兜底);
// - 保存即时生效,无需重启;
// - 引导密钥(BFF_SSO_STATE_SECRET)属部署级敏感配置,本页不展示不修改,仅自检提示。
//
// 网络分层:仅经 sso-admin-service(下一层 next-request)。

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { LucideRotateCcw, LucideSave } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

import {
  getSsoAdminConfig,
  resetSsoAdminConfig,
  saveSsoAdminConfig,
  type SsoAdminConfig,
} from '@/services/sso-admin-service';

function SourceBadge({ source }: { source: 'runtime' | 'env' }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      className={
        source === 'runtime'
          ? 'shrink-0 text-xs text-state-success'
          : 'shrink-0 text-xs text-text-secondary'
      }
    >
      {source === 'runtime'
        ? t('admin.ssoSettings.sourceRuntime', { defaultValue: '运行时配置' })
        : t('admin.ssoSettings.sourceEnv', { defaultValue: '环境变量' })}
    </Badge>
  );
}

function AdminSsoSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ['admin/sso-config'],
    queryFn: async () => (await getSsoAdminConfig()).data,
    retry: false,
  });

  const [form, setForm] = useState<SsoAdminConfig>({
    enabled: false,
    publicOrigin: '',
    providers: null,
    silentRelogin: true,
  });
  const [providersText, setProvidersText] = useState('');

  useEffect(() => {
    if (!data) return;
    setForm({
      enabled: data.config.enabled,
      publicOrigin: data.config.publicOrigin,
      providers: data.config.providers,
      silentRelogin: data.config.silentRelogin,
    });
    setProvidersText((data.config.providers ?? []).join(','));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const providers = providersText
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      return (
        await saveSsoAdminConfig({
          enabled: form.enabled,
          publicOrigin: form.publicOrigin,
          providers: providers.length > 0 ? providers : null,
          silentRelogin: form.silentRelogin,
        })
      ).data;
    },
    onSuccess: (resp) => {
      toast.success(
        t('admin.ssoSettings.saved', { defaultValue: '统一认证配置已保存并即时生效' }),
      );
      (resp?.warnings ?? []).forEach((w) => toast.warning(w));
      queryClient.invalidateQueries({ queryKey: ['admin/sso-config'] });
    },
    onError: (err: unknown) => {
      toast.error(
        (err as Error).message ??
          t('admin.ssoSettings.saveFailed', { defaultValue: '保存失败' }),
      );
    },
    retry: false,
  });

  const resetMutation = useMutation({
    mutationFn: async () => (await resetSsoAdminConfig()).data,
    onSuccess: () => {
      toast.success(
        t('admin.ssoSettings.resetDone', {
          defaultValue: '已清除运行时配置,回落到部署环境变量',
        }),
      );
      queryClient.invalidateQueries({ queryKey: ['admin/sso-config'] });
    },
    onError: (err: unknown) => {
      toast.error((err as Error).message);
    },
    retry: false,
  });

  const isHttp =
    form.publicOrigin.trim().toLowerCase().startsWith('http://');
  const secretMissing = Boolean(data && form.enabled && !data.stateSecretConfigured);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">
        {t('admin.ssoSettings.title', { defaultValue: '统一认证设置' })}
      </h1>
      <p className="text-sm text-text-secondary mb-6">
        {t('admin.ssoSettings.subtitle', {
          defaultValue: '统一认证(SSO)登录的运行时配置;保存后即时生效,无需重启。',
        })}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('admin.ssoSettings.cardTitle', { defaultValue: '生效配置' })}
          </CardTitle>
          <CardDescription>
            {data?.runtime?.updatedAt
              ? t('admin.ssoSettings.updatedAt', {
                  defaultValue: '运行时配置更新于 {{time}}',
                  time: data.runtime.updatedAt,
                })
              : t('admin.ssoSettings.noRuntime', {
                  defaultValue: '当前无运行时配置,以下生效值来自部署环境变量。',
                })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {secretMissing && (
            <p className="text-xs text-state-warning break-words">
              {t('admin.ssoSettings.secretMissing', {
                defaultValue:
                  '已启用统一认证,但部署配置缺少 BFF_SSO_STATE_SECRET:重启后 BFF 将启动失败,请先在 .env 设置(≥32 字符)。',
              })}
            </p>
          )}

          {/* 启用开关 */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor="sso-admin-enable">
                {t('admin.ssoSettings.enable', { defaultValue: '启用统一认证登录' })}
              </Label>
              <p className="text-xs text-text-secondary">
                {t('admin.ssoSettings.enableHint', {
                  defaultValue: '登录页展示 SSO 渠道按钮;仅企业版租户生效。',
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {data && <SourceBadge source={data.sources.enabled} />}
              <Switch
                id="sso-admin-enable"
                checked={form.enabled}
                onCheckedChange={(v) => setForm((p) => ({ ...p, enabled: v }))}
              />
            </div>
          </div>

          {/* 公开来源 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="sso-admin-origin">
                {t('admin.ssoSettings.publicOrigin', { defaultValue: '公开来源地址' })}
              </Label>
              {data && <SourceBadge source={data.sources.publicOrigin} />}
            </div>
            <Input
              id="sso-admin-origin"
              value={form.publicOrigin}
              onChange={(e) => setForm((p) => ({ ...p, publicOrigin: e.target.value }))}
              placeholder="https://your-domain.example.com"
            />
            {isHttp && (
              <p className="text-xs text-state-warning">
                {t('admin.ssoSettings.httpWarning', {
                  defaultValue:
                    '当前为 http://:生产环境必须 https,否则 BFF 启动校验将失败(内网调试可设 BFF_ALLOW_INSECURE_SSO=true)。',
                })}
              </p>
            )}
          </div>

          {/* 渠道白名单 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="sso-admin-providers">
                {t('admin.ssoSettings.providers', { defaultValue: '渠道白名单' })}
              </Label>
              {data && <SourceBadge source={data.sources.providers} />}
            </div>
            <Input
              id="sso-admin-providers"
              value={providersText}
              onChange={(e) => setProvidersText(e.target.value)}
              placeholder="intellect-auth, another-channel"
            />
            <p className="text-xs text-text-secondary">
              {t('admin.ssoSettings.providersHint', {
                defaultValue:
                  '逗号分隔的渠道 ID;留空 = 不过滤(以网关 enabled/用途为准)。',
              })}
            </p>
          </div>

          {/* 静默重登 */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor="sso-admin-relogin">
                {t('admin.ssoSettings.silentRelogin', { defaultValue: '静默重登' })}
              </Label>
              <p className="text-xs text-text-secondary">
                {t('admin.ssoSettings.silentReloginHint', {
                  defaultValue: '会话过期后自动尝试免密恢复;主动登出后不自动重登。',
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {data && <SourceBadge source={data.sources.silentRelogin} />}
              <Switch
                id="sso-admin-relogin"
                checked={form.silentRelogin}
                onCheckedChange={(v) => setForm((p) => ({ ...p, silentRelogin: v }))}
              />
            </div>
          </div>

          {/* 密钥说明 */}
          <p className="text-xs text-text-secondary break-words">
            {t('admin.ssoSettings.secretNote', {
              defaultValue:
                '引导密钥(BFF_SSO_STATE_SECRET)属部署级敏感配置,不在本页展示或修改,由部署配置文件管理。',
            })}
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2 mt-4">
        <Button
          variant="outline"
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending || !data?.runtime}
        >
          <LucideRotateCcw className="size-4 mr-1" />
          {t('admin.ssoSettings.reset', { defaultValue: '回落环境变量' })}
        </Button>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || isPending}
        >
          <LucideSave className="size-4 mr-1" />
          {saveMutation.isPending
            ? t('common.submitting', { defaultValue: 'Submitting...' })
            : t('admin.ssoSettings.save', { defaultValue: '保存' })}
        </Button>
      </div>
      <Toaster />
    </div>
  );
}

export default AdminSsoSettings;
