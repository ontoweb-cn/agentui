// 方案 3 (P2):tenant 状态后台校验运行器。
//
// 与启动校验 (tenant-validator.ts) 的区别:
//   - 启动校验:fail-fast(process.exit),阻止 BFF 启动
//   - 后台校验:仅更新 tenant-status 状态,由 /health/readiness 探针反映
//
// 行为:
//   - 遍历 intellect-enterprise backends
//   - 调用 /api/tenant/info
//   - 一致 + enabled=true → setTenantStatus(backendId, 'ok')
//   - 不一致 或 enabled=false → setTenantStatus(backendId, 'disabled', reason)
//   - endpoint 不可达 → setTenantStatus(backendId, 'unknown', reason)
//   - 不抛错(由 setInterval .catch 静默吞掉)

import type { HarnessStore } from '../types';
import { fetchTenantInfo } from './tenant-validator';
import { setTenantStatus } from './tenant-status';

/**
 * 后台校验所有 enterprise backend 的 tenant 配置,更新 tenant-status。
 * 不抛错(所有异常被 catch),由 setInterval 调用。
 */
export async function validateTenantConfigsForStatus(
  harnessStore: HarnessStore,
): Promise<void> {
  const backends = harnessStore.list().filter((b) => b.type === 'intellect-enterprise');

  if (backends.length === 0) {
    return;
  }

  for (const backend of backends) {
    try {
      const info = await fetchTenantInfo(backend.endpoint);

      if (!info) {
        // endpoint 不可达 → unknown(不摘流量,与启动校验降级一致)
        setTenantStatus(backend.id, 'unknown', 'endpoint unreachable');
        continue;
      }

      if (!info.tenant_id) {
        setTenantStatus(backend.id, 'unknown', 'empty tenant_id from endpoint');
        continue;
      }

      // tenant_id 不一致 → disabled
      if (backend.intellectTenantId && backend.intellectTenantId !== info.tenant_id) {
        setTenantStatus(
          backend.id,
          'disabled',
          `configured="${backend.intellectTenantId}" != actual="${info.tenant_id}"`,
        );
        continue;
      }

      // tenant 被禁用 → disabled
      if (info.enabled === false) {
        setTenantStatus(backend.id, 'disabled', 'tenant is disabled (enabled=false)');
        continue;
      }

      // 校验通过
      setTenantStatus(backend.id, 'ok');
    } catch (err) {
      // 异常 → unknown(保守降级,不摘流量)
      setTenantStatus(backend.id, 'unknown', (err as Error).message);
    }
  }
}
