// wizard-sso-followup(A7): 统一认证运行时配置设置页(系统管理)。
//
// wizard-ent-sso-mode v1.4(设计 docs/wizard-enterprise-sso-mode-design.md §11.2):
// SSO 配置从首装向导迁移至本页——向导只装企业后端(网关地址/服务密钥/租户 ID),
// 统一认证在本页启用。扩展:
// - ① 前置状态卡:绑定后端/网关可达/租户 ID/服务密钥/渠道数/BFF_SSO_STATE_SECRET 三态,
//   [重新检测] 走 GET /admin/sso/config?check=1(服务端实时四项检测,admin 门控);
// - ② 生效配置:沿用运行时配置(保存即时生效),渠道白名单升级为渠道预览勾选;
// - ③ 启用守卫:后端未绑定/密钥未设或长度不足 → 开关禁用/黄字警示(双保险的服务端 warnings 在 BFF)。
//
// 手册口径(docs/wizard-manual.md §9 / docs/wizard-ent-sso-mode-manual.md):
// - 引导密钥(BFF_SSO_STATE_SECRET)属部署级敏感配置,本页不展示不修改,仅三态自检提示;
// - 保存即时生效,无需重启。
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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

import {
  getSsoAdminConfig,
  getSsoAdminProviders,
  resetSsoAdminConfig,
  saveSsoAdminConfig,
  type SsoAdminConfig,
  type SsoBackendCheckStatus,
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

/** 四项检测行的三态图标/文案(§12 R-6:keyValid=null 为"无法判定",不阻断) */
function CheckRow({
  state,
  label,
  detail,
}: {
  state: 'ok' | 'failed' | 'unknown';
  label: string;
  detail?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 shrink-0 w-4 text-center">
        {state === 'ok' && '✓'}
        {state === 'failed' && '✗'}
        {state === 'unknown' && '?'}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={
            state === 'failed'
              ? 'text-destructive'
              : state === 'unknown'
                ? 'text-text-secondary'
                : 'text-text-primary'
          }
        >
          {label}
        </span>
        {detail && (
          <span className="block text-xs text-text-secondary break-all">
            {detail}
          </span>
        )}
        {state === 'unknown' && !detail && (
          <span className="block text-xs text-text-secondary">
            {t('admin.ssoSettings.checkUnknown', {
              defaultValue: '无法判定,将在使用时验证',
            })}
          </span>
        )}
      </span>
    </div>
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

  // v1.4:前置状态实时检测(?check=1,手动触发——最坏 ~15s,需 loading 态)
  const {
    data: checkData,
    isFetching: checkFetching,
    refetch: refetchCheck,
  } = useQuery({
    queryKey: ['admin/sso-config', 'check'],
    queryFn: async () => (await getSsoAdminConfig(true)).data,
    enabled: false,
    retry: false,
  });

  // 渠道预览(绑定后端的裁剪视图;后端未绑定时 400 → 提示)
  const providersQuery = useQuery({
    queryKey: ['admin/sso-providers'],
    queryFn: async () => (await getSsoAdminProviders()).data,
    retry: false,
  });

  const [form, setForm] = useState<SsoAdminConfig>({
    enabled: false,
    publicOrigin: '',
    providers: null,
    silentRelogin: true,
  });
  // §12 v1.4 评审 Q-1:手动输入用独立 text state——直接绑定归一化
  // join/split 会把用户敲的逗号立即剥掉,无法连续输入多个渠道 id
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
    mutationFn: async () =>
      (
        await saveSsoAdminConfig({
          enabled: form.enabled,
          publicOrigin: form.publicOrigin,
          providers: form.providers,
          silentRelogin: form.silentRelogin,
        })
      ).data,
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
  // §12 R-5 三态:unset/invalid 都要黄字(set 才算就绪)
  const secretStatus = data?.stateSecretStatus ?? 'unset';
  const secretNotReady = secretStatus !== 'set';
  // §12 R-3:后端未绑定 → 启用开关禁用(stores 缺失/undefined 时不禁用,兼容)
  const boundBackendMissing = data?.boundBackend === null;
  const checkStatus: SsoBackendCheckStatus | null | undefined =
    checkData?.check?.status ?? undefined;

  const toggleProvider = (id: string) => {
    const current = form.providers ?? [];
    const next = current.includes(id)
      ? current.filter((p) => p !== id)
      : [...current, id];
    const normalized = next.length > 0 ? next : null;
    setForm((p) => ({ ...p, providers: normalized }));
    setProvidersText((normalized ?? []).join(','));
  };

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

      {/* ① 前置状态(v1.4 §11.2) */}
      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>
              {t('admin.ssoSettings.preconditionTitle', {
                defaultValue: '前置状态',
              })}
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refetchCheck()}
              disabled={checkFetching}
            >
              {checkFetching
                ? t('admin.ssoSettings.checking', { defaultValue: '检测中...' })
                : t('admin.ssoSettings.recheck', { defaultValue: '重新检测' })}
            </Button>
          </div>
          <CardDescription>
            {t('admin.ssoSettings.preconditionDesc', {
              defaultValue:
                '对默认租户绑定的企业后端做实时检测(网关/租户/服务密钥/认证服务);启用前建议先通过检测。',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data?.boundBackend === null && (
            <p className="text-xs text-state-warning break-words">
              {t('admin.ssoSettings.noBackend', {
                defaultValue:
                  '默认租户未绑定企业后端:SSO 兑换无法路由。请先完成企业版首装,或到「系统管理 → Harness 后端」绑定。',
              })}
            </p>
          )}
          {data?.boundBackend && (
            <p className="text-xs text-text-secondary break-all">
              {t('admin.ssoSettings.boundBackend', {
                defaultValue: '企业后端:{{id}}({{endpoint}})',
                id: data.boundBackend.id,
                endpoint: data.boundBackend.endpoint,
              })}
            </p>
          )}
          {!checkData && !checkFetching && (
            <p className="text-xs text-text-secondary">
              {t('admin.ssoSettings.checkNotRun', {
                defaultValue: '尚未检测;点击「重新检测」获取实时状态。',
              })}
            </p>
          )}
          {checkFetching && (
            <p className="text-xs text-text-secondary">
              {t('admin.ssoSettings.checking', { defaultValue: '检测中...' })}
            </p>
          )}
          {checkData?.check?.boundBackendMissing && (
            <p className="text-xs text-state-warning">
              {t('admin.ssoSettings.noBackend', {
                defaultValue:
                  '默认租户未绑定企业后端:SSO 兑换无法路由。请先完成企业版首装,或到「系统管理 → Harness 后端」绑定。',
              })}
            </p>
          )}
          {checkStatus && (
            <div className="space-y-2 pt-1">
              <CheckRow
                state={checkStatus.gatewayOk ? 'ok' : 'failed'}
                label={t('admin.ssoSettings.checkGateway', {
                  defaultValue: '认证网关可达',
                })}
              />
              <CheckRow
                state={checkStatus.tenantId ? 'ok' : 'unknown'}
                label={t('admin.ssoSettings.checkTenant', {
                  defaultValue: '企业租户 ID',
                })}
                detail={checkStatus.tenantId ?? undefined}
              />
              <CheckRow
                state={
                  checkStatus.keyValid === false
                    ? 'failed'
                    : checkStatus.keyValid
                      ? 'ok'
                      : 'unknown'
                }
                label={t('admin.ssoSettings.checkKey', {
                  defaultValue: '网关服务密钥',
                })}
              />
              <CheckRow
                state={checkStatus.providersOk ? 'ok' : 'failed'}
                label={t('admin.ssoSettings.checkProviders', {
                  defaultValue: '统一认证服务',
                })}
                detail={
                  checkStatus.providersOk
                    ? t('admin.ssoSettings.checkProvidersCount', {
                        defaultValue: '{{count}} 个可用渠道',
                        count: checkStatus.providerCount ?? 0,
                      })
                    : undefined
                }
              />
            </div>
          )}
          {/* §12 R-5 三态展示(不回显值) */}
          <div className="flex items-center gap-2 pt-1 text-xs">
            <span className="text-text-secondary">
              {t('admin.ssoSettings.stateSecretLabel', {
                defaultValue: 'BFF_SSO_STATE_SECRET(部署配置)',
              })}
            </span>
            <Badge
              variant="outline"
              className={
                secretStatus === 'set'
                  ? 'text-xs text-state-success'
                  : 'text-xs text-state-warning'
              }
            >
              {secretStatus === 'set'
                ? t('admin.ssoSettings.stateSecretSet', { defaultValue: '已设置' })
                : secretStatus === 'invalid'
                  ? t('admin.ssoSettings.stateSecretInvalid', {
                      defaultValue: '已设置但长度不足 32 字符',
                    })
                  : t('admin.ssoSettings.stateSecretUnset', {
                      defaultValue: '未设置',
                    })}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* ② 生效配置 */}
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
          {secretNotReady && form.enabled && (
            <p className="text-xs text-state-warning break-words">
              {secretStatus === 'invalid'
                ? t('admin.ssoSettings.secretInvalid', {
                    defaultValue:
                      '已启用统一认证,但 BFF_SSO_STATE_SECRET 长度不足 32 字符:重启后 BFF 将启动失败,请先在部署配置中更正。',
                  })
                : t('admin.ssoSettings.secretMissing', {
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
                {boundBackendMissing
                  ? t('admin.ssoSettings.enableDisabledHint', {
                      defaultValue: '默认租户未绑定企业后端,无法启用;请先完成企业版首装。',
                    })
                  : t('admin.ssoSettings.enableHint', {
                      defaultValue: '登录页展示 SSO 渠道按钮;仅企业版租户生效。',
                    })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {data && <SourceBadge source={data.sources.enabled} />}
              <Switch
                id="sso-admin-enable"
                checked={form.enabled}
                disabled={boundBackendMissing}
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

          {/* 渠道白名单(v1.4:渠道预览勾选) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="sso-admin-providers">
                {t('admin.ssoSettings.providers', { defaultValue: '渠道白名单' })}
              </Label>
              {data && <SourceBadge source={data.sources.providers} />}
            </div>
            {providersQuery.isLoading && (
              <p className="text-xs text-text-secondary">
                {t('admin.ssoSettings.providersLoading', {
                  defaultValue: '渠道加载中...',
                })}
              </p>
            )}
            {providersQuery.isError && (
              <p className="text-xs text-text-secondary">
                {t('admin.ssoSettings.providersError', {
                  defaultValue:
                    '渠道预览不可用(后端未绑定或统一认证服务不可达);仍可通过下方手动输入兜底。',
                })}
              </p>
            )}
            {providersQuery.data && (
              <div className="space-y-1.5 rounded-md border border-border p-3">
                {providersQuery.data.providers.length === 0 && (
                  <p className="text-xs text-text-secondary">
                    {t('admin.ssoSettings.providersEmpty', {
                      defaultValue:
                        '网关暂无可用登录渠道;可稍后在网关侧配置后重新获取。',
                    })}
                  </p>
                )}
                {providersQuery.data.providers.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 min-w-0">
                    <Checkbox
                      id={`sso-admin-channel-${p.id}`}
                      checked={(form.providers ?? []).includes(p.id)}
                      onCheckedChange={() => toggleProvider(p.id)}
                    />
                    <Label
                      htmlFor={`sso-admin-channel-${p.id}`}
                      className="min-w-0 flex-1 cursor-pointer truncate font-normal"
                    >
                      {p.displayName}
                    </Label>
                    <code className="shrink-0 text-xs text-text-secondary truncate max-w-40">
                      {p.id}
                    </code>
                  </div>
                ))}
                {providersQuery.data.misconfigured.map((id) => (
                  <div key={id} className="flex items-center gap-2 min-w-0">
                    <Checkbox disabled checked={false} id={`sso-admin-channel-${id}`} />
                    <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
                      {id}
                    </span>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {t('admin.ssoSettings.providerMisconfigured', {
                        defaultValue: '配置缺失,不可选',
                      })}
                    </Badge>
                  </div>
                ))}
                <p className="text-xs text-text-secondary">
                  {t('admin.ssoSettings.providersHint', {
                    defaultValue:
                      '勾选要在登录页展示的渠道;全部不勾 = 展示全部可用渠道。',
                  })}
                </p>
              </div>
            )}
            <Input
              id="sso-admin-providers"
              value={providersText}
              onChange={(e) => {
                setProvidersText(e.target.value);
                const list = e.target.value
                  .split(',')
                  .map((p) => p.trim())
                  .filter(Boolean);
                setForm((p) => ({ ...p, providers: list.length > 0 ? list : null }));
              }}
              placeholder="intellect-auth, another-channel"
            />
            <p className="text-xs text-text-secondary">
              {t('admin.ssoSettings.providersManualHint', {
                defaultValue:
                  '手动兜底:逗号分隔的渠道 ID(与上方勾选联动);留空 = 不过滤。',
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
          {/* v1.4:启用后验证指引(§12 R-8) */}
          {form.enabled && (
            <p className="text-xs text-text-secondary break-words">
              {t('admin.ssoSettings.verifyHint', {
                defaultValue:
                  '保存后打开登录页(/login-next)应出现 SSO 渠道按钮;同时确认 IdP/网关侧 redirect_uris 白名单包含「公开来源地址 + /api/bff/auth/oauth/callback」。',
              })}
            </p>
          )}
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
