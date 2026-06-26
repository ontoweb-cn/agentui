// Multi-Harness P2 (US3):Harness Backend Admin 服务层封装。
// Constitution Principle I (BFF-Mediated Frontend) + V (非租户隔离) + Token Security。
// 前端 Admin 页面通过此 service 调 BFF `/api/bff/admin/harness-backends` CRUD 接口。
// 不带 X-Tenant-Id(运维全局操作),响应不含 adminToken 明文。

import api from '@/utils/api';
import request from '@/utils/next-request';

// ---------------------------------------------------------------------------
// Types — 与 BFF src/types/harness-admin.ts 同步
// ---------------------------------------------------------------------------

export type BackendType = 'intellect-rag' | 'intellect-enterprise';

export interface HarnessCapabilities {
  canvas: boolean;
  knowledgeBase: boolean;
  memory: boolean;
  mcp: boolean;
  multiTenant: boolean;
  modelManagement: boolean;
}

export interface HarnessBackendForm {
  id: string;
  name: string;
  type: BackendType;
  endpoint: string;
  adminTokenEnvVar: string;
  capabilities: HarnessCapabilities;
  defaultForTenant?: boolean;
}

export interface HarnessBackendWithStatus extends Omit<HarnessBackendForm, 'id'> {
  id: string;
  ready: boolean;
}

export interface CapabilitiesResponse {
  backendId: string;
  backendName: string;
  backendType: BackendType;
  capabilities: HarnessCapabilities;
}

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

/**
 * 列出所有后端配置(含未就绪的,带 ready 状态)。
 * GET /api/bff/admin/harness-backends
 */
export const listHarnessBackends = () =>
  request.get<ApiResponse<HarnessBackendWithStatus[]>>(
    api.listHarnessBackends,
  );

/**
 * 新增后端配置。
 * POST /api/bff/admin/harness-backends
 * @param form 表单数据(id 必填,kebab-case)
 */
export const createHarnessBackend = (form: HarnessBackendForm) =>
  request.post<ApiResponse<HarnessBackendWithStatus>>(
    api.createHarnessBackend,
    form,
  );

/**
 * 编辑后端配置(id 只读,用路径参数)。
 * PUT /api/bff/admin/harness-backends/:id
 */
export const updateHarnessBackend = (id: string, form: Omit<HarnessBackendForm, 'id'>) =>
  request.put<ApiResponse<HarnessBackendWithStatus>>(
    api.updateHarnessBackend(id),
    form,
  );

/**
 * 删除后端配置(被 tenant 绑定时返回 409)。
 * DELETE /api/bff/admin/harness-backends/:id
 */
export const deleteHarnessBackend = (id: string) =>
  request.delete<ApiResponse<null>>(api.deleteHarnessBackend(id));

/**
 * 查询当前 tenant 绑定后端的能力(US2)。
 * GET /api/bff/capabilities
 * 需 X-Tenant-Id / X-User-Id header(由调用方传入)。
 */
export const fetchHarnessCapabilities = (headers: {
  'X-Tenant-Id': string;
  'X-User-Id': string;
}) =>
  request.get<ApiResponse<CapabilitiesResponse>>(api.harnessCapabilities, {
    headers,
  });
