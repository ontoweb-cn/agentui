// Multi-Harness P2 (US3):Harness Backend Admin 服务层封装。
// Constitution Principle I (BFF-Mediated Frontend) + V (非租户隔离) + Token Security。
// 前端 Admin 页面通过此 service 调 BFF `/api/bff/admin/harness-backends` CRUD 接口。
// 不带 X-Backend-Id(运维全局操作),响应不含 adminToken 明文。

import api from '@/utils/api';
import request from '@/utils/next-request';

// ---------------------------------------------------------------------------
// Types — 与 BFF src/types/harness-admin.ts 同步
// ---------------------------------------------------------------------------

export type BackendType =
  | 'intellect-rag'
  | 'intellect-enterprise'
  | 'intellect-llm'
  | 'intellect-community'
  | 'hermes'
  | 'kag'
  | 'agent-scope';

// spec-010 v8 D-1: 协议族(供 Admin 列表页展示列使用)
export type ProtocolFamily =
  | 'canvas-workflow'
  | 'intellect-enterprise'
  | 'openai-compatible';

export interface HarnessCapabilities {
  canvas: boolean;
  knowledgeBase: boolean;
  memory: boolean;
  mcp: boolean;
  multiTenant: boolean;
  modelManagement: boolean;
}

/**
 * spec-010 v8 D-1: BackendType → ProtocolFamily 映射。
 * 用于 Admin 列表页新增的"协议族"展示列。
 */
const PROTOCOL_FAMILY_BY_TYPE: Record<BackendType, ProtocolFamily> = {
  'intellect-rag': 'canvas-workflow',
  'intellect-enterprise': 'intellect-enterprise',
  // OpenAI 兼容协议族(A3-3 OpenAICompatibleBaseAdapter 的子类)
  'intellect-llm': 'openai-compatible',
  'intellect-community': 'openai-compatible',
  hermes: 'openai-compatible',
  kag: 'openai-compatible',
  'agent-scope': 'openai-compatible',
};

export const getProtocolFamily = (type: BackendType): ProtocolFamily =>
  PROTOCOL_FAMILY_BY_TYPE[type] ?? 'openai-compatible';

export interface HarnessBackendForm {
  id: string;
  name: string;
  type: BackendType;
  endpoint: string;
  /**
   * 可选;BFF 始终自动生成 `HARNESS_<ID>_TOKEN` 并忽略前端传入的值。
   * 保留字段用于响应类型 HarnessBackendWithStatus 的展示(列表/详情中读取)。
   */
  adminTokenEnvVar?: string;
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
 * spec-010 v8 B-8 (D2 软阻断): 切换 backend 为租户的主/画布后端。
 * POST /api/bff/admin/harness-backends/:id/switch
 *
 * 后端校验活跃 run,有活跃 run 时返回 409 + "请等待 N 个活跃 run 完成"。
 * @param id backend id
 * @param tenantId 租户 id(BffTenant.id)
 * @param role 'primary' (intellectBackendId) | 'canvas' (canvasBackendId)
 */
export const switchHarnessBackend = (
  id: string,
  tenantId: string,
  role: 'primary' | 'canvas',
) =>
  request.post<ApiResponse<null>>(api.switchHarnessBackend(id), {
    tenantId,
    role,
  });

/**
 * 查询当前 tenant 绑定后端的能力(US2)。
 * GET /api/bff/capabilities
 * 需 X-Backend-Id / X-User-Id header(由调用方传入)。
 */
export const fetchHarnessCapabilities = (headers: {
  'X-Backend-Id': string;
  'X-User-Id': string;
}) =>
  request.get<ApiResponse<CapabilitiesResponse>>(api.harnessCapabilities, {
    headers,
  });
