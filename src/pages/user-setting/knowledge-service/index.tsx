import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getKbConnection,
  saveKbConnection,
  testKbConnection,
  type KbConnection,
  type KbConnectionTestResult,
  type TestKbConnectionPayload,
} from '@/services/kb-connection-service';
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ProfileSettingWrapperCard } from '../components/user-setting-header';

interface RequestError {
  message?: string;
  response?: {
    status?: number;
    data?: {
      message?: string;
    };
  };
}

interface LoadError {
  message: string;
  forbidden: boolean;
}

function getErrorStatus(error: unknown) {
  return ((error || {}) as RequestError).response?.status;
}

function getErrorMessage(error: unknown, fallback: string) {
  const requestError = (error || {}) as RequestError;
  return (
    requestError.response?.data?.message || requestError.message || fallback
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 text-sm">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-text-primary">{children}</dd>
    </div>
  );
}

export default function KnowledgeServicePage() {
  const { t } = useTranslation();
  const [connection, setConnection] = useState<KbConnection | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [serviceToken, setServiceToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<KbConnectionTestResult | null>(
    null,
  );
  const [savedUnverified, setSavedUnverified] = useState(false);
  const [versionInfo, setVersionInfo] = useState<{
    version: string | null;
    versionError: string | null;
  }>({ version: null, versionError: null });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setValidationError(null);
    setActionError(null);
    setConflict(false);
    setTestResult(null);
    setSavedUnverified(false);
    try {
      const response = await getKbConnection();
      const data = response.data.data;
      setConnection(data);
      setEndpoint(data.endpoint);
      setServiceToken('');
      setVersionInfo({
        version: data.version,
        versionError: data.versionError,
      });
    } catch (error) {
      setConnection(null);
      setVersionInfo({ version: null, versionError: null });
      setLoadError({
        message: getErrorMessage(error, t('setting.kbConnection.loadFailed')),
        forbidden: getErrorStatus(error) === 403,
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const invalidateTestResult = (clearVersion = false) => {
    setTestResult(null);
    setSavedUnverified(false);
    setValidationError(null);
    setActionError(null);
    // URL 变更后,已显示的版本属于旧端点,必须清空避免误导;仅改 Token 时 URL 未变,
    // 可回显上次加载的版本。
    if (clearVersion) {
      setVersionInfo({ version: null, versionError: null });
    } else {
      setVersionInfo({
        version: connection?.version ?? null,
        versionError: connection?.versionError ?? null,
      });
    }
  };

  const validatePayload = (): TestKbConnectionPayload | null => {
    if (!connection) return null;

    const normalizedEndpoint = endpoint.trim();
    if (!normalizedEndpoint) {
      setValidationError(t('setting.kbConnection.endpointRequired'));
      return null;
    }

    const endpointChanged = normalizedEndpoint !== connection.endpoint.trim();
    if (!serviceToken.trim() && (!connection.configured || endpointChanged)) {
      setValidationError(
        t(
          connection.configured
            ? 'setting.kbConnection.tokenRequiredForUrlChange'
            : 'setting.kbConnection.tokenRequiredInitial',
        ),
      );
      return null;
    }

    setValidationError(null);
    return {
      endpoint: normalizedEndpoint,
      ...(serviceToken.trim() ? { serviceToken } : {}),
    };
  };

  const handleTest = async () => {
    if (testing || saving) return;
    const payload = validatePayload();
    if (!payload) return;

    setTesting(true);
    setActionError(null);
    setConflict(false);
    setSavedUnverified(false);
    setTestResult(null);
    setVersionInfo({
      version: connection?.version ?? null,
      versionError: connection?.versionError ?? null,
    });
    try {
      const response = await testKbConnection(payload);
      const result = response.data.data;
      setTestResult(result);
      setVersionInfo({ version: result.version, versionError: null });
    } catch (error) {
      setActionError(
        getErrorMessage(error, t('setting.kbConnection.testRequestFailed')),
      );
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (testing || saving || !connection) return;
    const payload = validatePayload();
    if (!payload) return;

    setSaving(true);
    setActionError(null);
    setConflict(false);
    setSavedUnverified(false);
    setTestResult(null);
    try {
      const response = await saveKbConnection({
        ...payload,
        revision: connection.revision,
      });
      const saved = response.data.data;
      // A successful PUT enables the configuration but does not verify it.
      // Only GET and the explicit connection test may supply version details.
      const savedWithoutVersion = {
        ...saved,
        version: null,
        versionError: null,
      };
      setConnection(savedWithoutVersion);
      setEndpoint(savedWithoutVersion.endpoint);
      setServiceToken('');
      setVersionInfo({ version: null, versionError: null });
      setSavedUnverified(true);
    } catch (error) {
      if (getErrorStatus(error) === 409) {
        setConflict(true);
      } else {
        setActionError(
          getErrorMessage(error, t('setting.kbConnection.saveFailed')),
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProfileSettingWrapperCard
      header={
        <header>
          <h2 className="text-2xl font-medium text-text-primary">
            {t('setting.kbConnection.title')}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            {t('setting.kbConnection.description')}
          </p>
        </header>
      }
    >
      <div className="h-full overflow-y-auto p-7">
        {loading && (
          <div
            className="max-w-3xl space-y-6"
            role="status"
            aria-label={t('setting.kbConnection.loading')}
            data-testid="kb-connection-loading"
          >
            <span className="sr-only">{t('setting.kbConnection.loading')}</span>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-20 w-full" />
            <div className="flex gap-3">
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-32" />
            </div>
          </div>
        )}

        {!loading && loadError?.forbidden && (
          <div
            role="alert"
            className="flex min-h-40 max-w-3xl flex-col items-center justify-center gap-2 rounded-lg border border-state-error/30 bg-state-error/5 p-8 text-center"
            data-testid="kb-connection-forbidden"
          >
            <p className="font-medium text-state-error">
              {t('setting.kbConnection.forbidden')}
            </p>
            <p className="text-sm text-text-secondary">
              {t('setting.kbConnection.forbiddenDetail')}
            </p>
          </div>
        )}

        {!loading && loadError && !loadError.forbidden && (
          <div
            role="alert"
            className="flex min-h-40 max-w-3xl flex-col items-center justify-center gap-3 rounded-lg border border-state-error/30 bg-state-error/5 p-8 text-center"
          >
            <p className="text-sm text-state-error">{loadError.message}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void load()}
              data-testid="kb-connection-retry-button"
            >
              {t('setting.kbConnection.retry')}
            </Button>
          </div>
        )}

        {!loading && !loadError && connection && (
          <div className="max-w-3xl space-y-6">
            <div
              role="status"
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border-button bg-bg-card p-4"
              data-testid="kb-connection-status"
            >
              <span
                className={
                  connection.configured
                    ? 'text-sm font-medium text-state-success'
                    : 'text-sm font-medium text-text-secondary'
                }
              >
                {connection.configured
                  ? t('setting.kbConnection.enabled')
                  : t('setting.kbConnection.notConfigured')}
              </span>
              {versionInfo.version && (
                <span className="text-sm text-text-secondary">
                  {t('setting.kbConnection.version')}: {versionInfo.version}
                </span>
              )}
            </div>

            {versionInfo.versionError && (
              <p role="alert" className="text-sm text-state-warning">
                {versionInfo.versionError}
              </p>
            )}

            {!connection.configured && (
              <p className="text-sm text-text-secondary">
                {t('setting.kbConnection.notConfiguredHint')}
              </p>
            )}

            {savedUnverified && (
              <div
                role="status"
                className="rounded-md border border-state-warning/30 bg-state-warning/5 p-4 text-sm text-state-warning"
                data-testid="kb-connection-saved-unverified"
              >
                {t('setting.kbConnection.savedUnverified')}
              </div>
            )}

            {conflict && (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-state-warning/30 bg-state-warning/5 p-4"
                data-testid="kb-connection-conflict"
              >
                <p className="text-sm text-state-warning">
                  {t('setting.kbConnection.conflict')}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void load()}
                  data-testid="kb-connection-reload-button"
                >
                  {t('setting.kbConnection.reload')}
                </Button>
              </div>
            )}

            {(validationError || actionError) && (
              <div
                role="alert"
                className="rounded-md border border-state-error/30 bg-state-error/5 p-4 text-sm text-state-error"
                data-testid="kb-connection-action-error"
              >
                {validationError || actionError}
              </div>
            )}

            <form
              className="space-y-6"
              noValidate
              aria-busy={testing || saving}
              onSubmit={(event) => void handleSave(event)}
            >
              <div className="space-y-2">
                <Label htmlFor="kb-service-endpoint">
                  {t('setting.kbConnection.endpoint')}
                </Label>
                <Input
                  id="kb-service-endpoint"
                  type="url"
                  value={endpoint}
                  placeholder={t('setting.kbConnection.endpointPlaceholder')}
                  aria-describedby="kb-service-endpoint-hint"
                  disabled={testing || saving}
                  onChange={(event) => {
                    setEndpoint(event.target.value);
                    invalidateTestResult(true);
                  }}
                  data-testid="kb-service-endpoint-input"
                />
                <p
                  id="kb-service-endpoint-hint"
                  className="text-xs text-text-secondary"
                >
                  {t('setting.kbConnection.endpointHint')}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="kb-service-token">
                  {t('setting.kbConnection.serviceToken')}
                </Label>
                <Input
                  id="kb-service-token"
                  type="password"
                  value={serviceToken}
                  placeholder={t(
                    connection.tokenConfigured
                      ? 'setting.kbConnection.tokenSavedPlaceholder'
                      : 'setting.kbConnection.tokenPlaceholder',
                  )}
                  autoComplete="new-password"
                  aria-describedby="kb-service-token-hint"
                  disabled={testing || saving}
                  onChange={(event) => {
                    setServiceToken(event.target.value);
                    invalidateTestResult();
                  }}
                  data-testid="kb-service-token-input"
                />
                <p
                  id="kb-service-token-hint"
                  className="text-xs leading-5 text-text-secondary"
                >
                  {t('setting.kbConnection.tokenHint')}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="outline"
                  loading={testing}
                  disabled={saving}
                  onClick={() => void handleTest()}
                  data-testid="kb-connection-test-button"
                >
                  {testing
                    ? t('setting.kbConnection.testing')
                    : t('setting.kbConnection.test')}
                </Button>
                <Button
                  type="submit"
                  loading={saving}
                  disabled={testing}
                  data-testid="kb-connection-save-button"
                >
                  {saving
                    ? t('setting.kbConnection.saving')
                    : t('setting.kbConnection.saveAndEnable')}
                </Button>
              </div>
            </form>

            {testResult && (
              <div
                role={testResult.success ? 'status' : 'alert'}
                className={`space-y-3 rounded-md border p-4 ${
                  testResult.success
                    ? 'border-state-success/30 bg-state-success/5'
                    : 'border-state-error/30 bg-state-error/5'
                }`}
                data-testid="kb-connection-test-result"
              >
                <p
                  className={`text-sm font-medium ${
                    testResult.success
                      ? 'text-state-success'
                      : 'text-state-error'
                  }`}
                >
                  {testResult.success
                    ? t('setting.kbConnection.testSucceeded')
                    : t('setting.kbConnection.testFailed')}
                </p>
                <dl className="space-y-2">
                  <DetailRow label={t('setting.kbConnection.stage')}>
                    {testResult.stage === 'version'
                      ? t('setting.kbConnection.stageVersion')
                      : testResult.stage === 'authentication'
                        ? t('setting.kbConnection.stageAuthentication')
                        : '—'}
                  </DetailRow>
                  <DetailRow label={t('setting.kbConnection.message')}>
                    {testResult.message || '—'}
                  </DetailRow>
                  <DetailRow label={t('setting.kbConnection.version')}>
                    {testResult.version || '—'}
                  </DetailRow>
                  <DetailRow label={t('setting.kbConnection.upstreamStatus')}>
                    {testResult.upstreamStatus ?? '—'}
                  </DetailRow>
                </dl>
              </div>
            )}
          </div>
        )}
      </div>
    </ProfileSettingWrapperCard>
  );
}
