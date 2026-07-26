// 改进 1 (P0):BFF 启动时校验 intellectTenantId 配置一致性。
// 防止 HarnessBackend.intellectTenantId 静态配置与 intellect-team gateway 的
// INTELLECT_TENANT_ID env var 漂移,导致 TEAM 与 RAG 租户不一致。
//
// 校验逻辑:
//   遍历 type='intellect-enterprise' 的 backend,调用 GET {endpoint}/api/tenant/info
//   (intellect-team 改进 6 新增的公开端点),比对返回的 tenant_id 与 backend.intellectTenantId:
//   - 一致 → OK
//   - 不一致 → FATAL,process.exit(1)(继续运行会导致数据分裂)
//   - backend.intellectTenantId 未配置 → WARN,自动从 endpoint 拉取并写入运行时对象(不修改 JSON)
//   - endpoint 不可达 → WARN,不阻塞启动(intellect-team 可能稍后启动)

import type { HarnessStore } from '../types';
import type { HarnessBackend } from '../types/harness';

export interface TenantInfoResponse {
  tenant_id: string;
  display_name?: string;
  enabled?: boolean;
  source?: 'env' | 'default' | 'db' | 'db_miss';
}

/**
 * 调用 intellect-team GET /api/tenant/info 公开端点,返回 tenant 信息。
 * 失败时返回 null(降级放行)。
 *
 * 改进 1 (启动校验) 和方案 2 (per-request 校验) 共用此函数。
 */
export async function fetchTenantInfo(endpoint: string): Promise<TenantInfoResponse | null> {
  const url = `${endpoint.replace(/\/$/, '')}/api/tenant/info`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      // 公开端点,无需 Authorization
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.warn(
      `[tenant-validator] failed to reach ${url} (${(err as Error).message})`,
    );
    return null;
  }

  if (!response.ok) {
    console.warn(`[tenant-validator] GET ${url} returned ${response.status}`);
    return null;
  }

  try {
    return (await response.json()) as TenantInfoResponse;
  } catch (err) {
    console.warn(
      `[tenant-validator] invalid JSON from ${url} (${(err as Error).message})`,
    );
    return null;
  }
}

/**
 * 校验单个 intellect-enterprise backend 的 intellectTenantId 配置。
 * 返回 true 表示通过(或已自动修复),false 表示不一致(应 fail-fast)。
 * endpoint 不可达时返回 true(降级放行,由 log 暴露问题)。
 */
async function validateBackend(backend: HarnessBackend): Promise<boolean> {
  const body = await fetchTenantInfo(backend.endpoint);

  if (!body) {
    console.warn(
      `[tenant-validator] Backend "${backend.id}": /api/tenant/info unreachable; ` +
        `skipping tenant_id validation. intellect-team may not be running yet.`,
    );
    return true;
  }

  const actualTenantId = body.tenant_id;
  if (!actualTenantId) {
    console.warn(
      `[tenant-validator] Backend "${backend.id}": /api/tenant/info returned empty tenant_id; ` +
        `skipping validation.`,
    );
    return true;
  }

  // 情况 1:backend.intellectTenantId 已配置 → 严格比对
  if (backend.intellectTenantId) {
    if (backend.intellectTenantId === actualTenantId) {
      console.log(
        `[tenant-validator] Backend "${backend.id}": tenant_id OK ` +
          `(configured="${backend.intellectTenantId}" == actual="${actualTenantId}", source="${body.source ?? 'unknown'}")`,
      );
      return true;
    }
    console.error(
      `[tenant-validator] FATAL: Backend "${backend.id}" tenant_id MISMATCH! ` +
        `configured intellectTenantId="${backend.intellectTenantId}" ` +
        `!= actual tenant_id from intellect-team="${actualTenantId}". ` +
        `This will cause TEAM/RAG tenant data split. ` +
        `Fix: update bff/data/harness-backends.json or intellect-team INTELLECT_TENANT_ID env var.`,
    );
    return false;
  }

  // 情况 2:backend.intellectTenantId 未配置 → 自动填充运行时对象
  // 不修改 JSON 文件(避免运行时副作用),仅写入内存对象。
  // 后续 backend-context.ts / proxy.ts / intellect-rag-adapter.ts 读取此字段时即可用。
  console.warn(
    `[tenant-validator] Backend "${backend.id}": intellectTenantId not configured; ` +
      `auto-filling from intellect-team: "${actualTenantId}" (source="${body.source ?? 'unknown'}"). ` +
      `Recommend: set intellectTenantId="${actualTenantId}" in bff/data/harness-backends.json ` +
      `to make config explicit.`,
  );
  backend.intellectTenantId = actualTenantId;
  return true;
}

/**
 * 启动时校验所有 intellect-enterprise backend 的 intellectTenantId 配置。
 * 任一 backend 配置不一致 → 返回 false(BFF 应 fail-fast)。
 * endpoint 不可达或 backend 无 intellectTenantId → 不影响结果(降级放行)。
 */
export async function validateTenantConfigs(
  harnessStore: HarnessStore,
): Promise<boolean> {
  const backends = harnessStore.list().filter((b) => b.type === 'intellect-enterprise');

  if (backends.length === 0) {
    console.log('[tenant-validator] No intellect-enterprise backends; skipping validation.');
    return true;
  }

  console.log(
    `[tenant-validator] Validating intellectTenantId for ${backends.length} enterprise backend(s)...`,
  );

  let allOk = true;
  for (const backend of backends) {
    const ok = await validateBackend(backend);
    if (!ok) {
      allOk = false;
    }
  }

  if (allOk) {
    console.log('[tenant-validator] All enterprise backends passed tenant_id validation.');
  } else {
    console.error(
      '[tenant-validator] FATAL: One or more enterprise backends have tenant_id mismatch. ' +
        'Aborting BFF startup to prevent data split. ' +
        'See logs above for details.',
    );
  }
  return allOk;
}
