// 方案 A: intellect-enterprise 的伴生 intellect-rag 插件。
// RAG 不作为独立向导/Admin 新增类型;URL 与 API Key 存在伴生 backend 上,
// enterprise 只存 ragBackendId 引用。

import type { HarnessBackend, HarnessBackendConfig, HarnessCapabilities } from '../types/harness';
import type { BffTenant } from '../types/tenant';
import type { HarnessStore } from '../types/stores';

export const RAG_PLUGIN_CAPABILITIES: HarnessCapabilities = {
  canvas: true,
  knowledgeBase: true,
  memory: true,
  mcp: false,
  multiTenant: false,
  modelManagement: false,
};

export const DEFAULT_RAG_PLUGIN_ENDPOINT = 'http://localhost:9380';

export function companionRagBackendId(enterpriseBackendId: string): string {
  return `${enterpriseBackendId}-rag`;
}

export function buildCompanionRagConfig(opts: {
  enterpriseId: string;
  enterpriseName: string;
  ragEndpoint: string;
}): HarnessBackendConfig {
  const id = companionRagBackendId(opts.enterpriseId);
  return {
    id,
    name: `${opts.enterpriseName} RAG`,
    type: 'intellect-rag',
    endpoint: opts.ragEndpoint.replace(/\/$/, ''),
    adminTokenEnvVar: `HARNESS_${id.toUpperCase().replace(/-/g, '_')}_TOKEN`,
    capabilities: RAG_PLUGIN_CAPABILITIES,
    credentialKind: 'bearer-token',
    comment: `RAG plugin of ${opts.enterpriseId}`,
  };
}

/**
 * 解析当前租户应使用的 intellect-rag backend id。
 * 1. tenant.canvasBackendId
 * 2. 主后端本身是 intellect-rag
 * 3. 主后端是 enterprise 且 ragBackendId 已绑定
 * 4. 缺省租户 '0'/'default' 回退首个 intellect-rag
 */
export function resolveRagBackendId(
  tenant: BffTenant | undefined,
  tenantId: string,
  harnessStore: HarnessStore,
): string | undefined {
  if (tenant?.canvasBackendId) {
    return tenant.canvasBackendId;
  }
  if (tenant) {
    const main = harnessStore.get(tenant.intellectBackendId);
    if (main?.type === 'intellect-rag') {
      return main.id;
    }
    if (main?.type === 'intellect-enterprise' && main.ragBackendId) {
      return main.ragBackendId;
    }
  }
  if (tenantId === '0' || tenantId === 'default') {
    return harnessStore.list().find((b: HarnessBackend) => b.type === 'intellect-rag')?.id;
  }
  return undefined;
}
