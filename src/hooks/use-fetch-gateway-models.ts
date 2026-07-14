/**
 * Phase 3: Gateway model fetching hook.
 *
 * Merges gateway /v1/models response with legacy data source.
 * Gateway models take priority; duplicates are filtered by owned_by:id compound key.
 */

import { useCallback } from 'react';
import { IntellectLlmAdapter } from '@/../bff/src/services/adapters/intellect-llm/intellect-llm-adapter';

interface LegacyModel {
  model_type: string[];
  name: string;
  provider_id: string;
  provider_name: string;
  instance_id: string;
  instance_name: string;
}

export interface MergedModel {
  id: string;
  provider: string;
  type: 'chat' | 'embedding' | 'rerank';
  contextLength?: number;
  source: 'gateway' | 'legacy';
}

export function useFetchGatewayModels(
  adapter: IntellectLlmAdapter | null,
  legacyModels: LegacyModel[],
): {
  fetchModels: () => Promise<MergedModel[]>;
} {
  const fetchModels = useCallback(async (): Promise<MergedModel[]> => {
    const gatewayModels: MergedModel[] = [];
    if (adapter) {
      try {
        const models = await adapter.listModels();
        for (const m of models) {
          gatewayModels.push({
            id: m.id,
            provider: m.owned_by,
            type: (m.type as MergedModel['type']) || 'chat',
            contextLength: m.context_length,
            source: 'gateway',
          });
        }
      } catch {
        // Gateway unavailable — fall through to legacy only
        console.warn('Gateway /v1/models unavailable, using legacy source only');
      }
    }

    // Dedup: gateway priority, filter by provider:id compound key.
    // Fall back to id-only when provider is empty/undefined.
    const seen = new Set(gatewayModels.map(m => `${m.provider || 'unknown'}:${m.id}`));
    const legacyMerged: MergedModel[] = legacyModels
      .filter(m => !seen.has(`${m.provider_name || 'unknown'}:${m.name}`))
      .map(m => ({
        id: m.name,
        provider: m.provider_name,
        type: 'chat' as const,
        source: 'legacy' as const,
      }));

    return [...gatewayModels, ...legacyMerged];
  }, [adapter, legacyModels]);

  return { fetchModels };
}
