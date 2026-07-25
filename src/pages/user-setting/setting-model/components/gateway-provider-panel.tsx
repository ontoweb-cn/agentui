/**
 * Phase 3: Gateway Provider Panel.
 *
 * Provider/key management UI backed by the Intellect Gateway Admin API.
 * Shown alongside the existing local-provider list (UsedModel) when the
 * intellect-llm backend is configured in harness-backends.json.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IntellectTooltip } from '@/components/ui/tooltip';
import {
  gatewayAdmin,
  type Provider,
} from '@/services/gateway-admin';
import { cn } from '@/lib/utils';
import { CheckCircle, Key, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function GatewayProviderPanel() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState({ id: '', base_url: '', default_model: '' });
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [verifyStatus, setVerifyStatus] = useState<Record<string, string>>({});

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await gatewayAdmin.listProviders();
      setProviders(data.providers);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const handleAddProvider = async () => {
    if (!newProvider.id) return;
    try {
      await gatewayAdmin.createProvider({
        id: newProvider.id,
        base_url: newProvider.base_url || undefined,
        default_model: newProvider.default_model || undefined,
      });
      setNewProvider({ id: '', base_url: '', default_model: '' });
      setShowAddForm(false);
      await loadProviders();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDeleteProvider = async (id: string) => {
    try {
      await gatewayAdmin.deleteProvider(id);
      await loadProviders();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSetKey = async (providerId: string) => {
    const key = keyInputs[providerId];
    if (!key) return;
    try {
      await gatewayAdmin.setKey(providerId, key);
      setKeyInputs(prev => ({ ...prev, [providerId]: '' }));
      await loadProviders(); // refresh to show updated key status
    } catch (e) {
      setError(String(e));
    }
  };

  const handleVerify = async (providerId: string) => {
    try {
      const result = await gatewayAdmin.verifyConnection(providerId);
      setVerifyStatus(prev => ({ ...prev, [providerId]: result.status }));
    } catch {
      setVerifyStatus(prev => ({ ...prev, [providerId]: 'unknown' }));
    }
  };

  const getKeyHealth = async () => {
    try {
      const health = await gatewayAdmin.keyHealthSummary();
      alert(
        `Keys: ${health.total_keys} total, ${health.healthy} healthy, ${health.exhausted} exhausted, ${health.dead} dead`,
      );
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section className="rounded-lg border border-border p-4">
      <header className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium">
          {t('setting.gatewayProviders', 'Gateway Managed Providers')}
        </h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={getKeyHealth}>
            {t('setting.keyHealth', 'Key Health')}
          </Button>
          <Button variant="outline" size="sm" onClick={loadProviders} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {error && (
        <p className="text-sm text-state-error mb-2">{error}</p>
      )}

      {/* Add Provider Form */}
      {showAddForm && (
        <div className="flex gap-2 mb-4 p-2 border rounded">
          <Input
            placeholder="Provider ID (e.g. openai)"
            value={newProvider.id}
            onChange={e => setNewProvider(p => ({ ...p, id: e.target.value }))}
            className="flex-1"
          />
          <Input
            placeholder="Base URL (optional)"
            value={newProvider.base_url}
            onChange={e => setNewProvider(p => ({ ...p, base_url: e.target.value }))}
            className="flex-1"
          />
          <Button size="sm" onClick={handleAddProvider}>Add</Button>
        </div>
      )}

      {/* Provider List */}
      {loading ? (
        <p className="text-sm text-text-secondary">{t('common.loading')}</p>
      ) : providers.length === 0 ? (
        <p className="text-sm text-text-secondary">
          No providers configured. Click + to add one.
        </p>
      ) : (
        <div className="space-y-3">
          {providers.map(p => (
            <div key={p.id} className="border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-medium">{p.display_name || p.id}</span>
                  <span className="text-xs text-text-secondary ml-2">{p.base_url}</span>
                  <span className="text-xs ml-2">
                    {p.enabled ? (
                      <span className="text-green-600">enabled</span>
                    ) : (
                      <span className="text-text-secondary">disabled</span>
                    )}
                  </span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleDeleteProvider(p.id)}>
                  <Trash2 className="h-4 w-4 text-state-error" />
                </Button>
              </div>

              {/* Key Management */}
              <div className="flex gap-2 items-center">
                <Input
                  type="password"
                  placeholder="API Key"
                  value={keyInputs[p.id] || ''}
                  onChange={e => setKeyInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                  className="flex-1"
                />
                <IntellectTooltip tooltip="Save API Key">
                  <Button size="sm" variant="outline" onClick={() => handleSetKey(p.id)}>
                    <Key className="h-4 w-4" />
                  </Button>
                </IntellectTooltip>
                <IntellectTooltip tooltip="Verify Connection">
                  <Button size="sm" variant="outline" onClick={() => handleVerify(p.id)}>
                    {verifyStatus[p.id] === 'ok' ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : verifyStatus[p.id] === 'auth_error' ? (
                      <XCircle className="h-4 w-4 text-state-error" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </IntellectTooltip>
              </div>
              {verifyStatus[p.id] && (
                <p className="text-xs text-text-secondary mt-1">
                  Status: {verifyStatus[p.id]}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
