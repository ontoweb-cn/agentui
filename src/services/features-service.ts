/**
 * AgentUI 系统级能力（features）服务封装。
 *
 * 与 harness 后端能力（/api/bff/capabilities）解耦：
 * 统一认证等宿主集成能力由 `/api/bff/features` 返回，缺省 false。
 */

import request from '@/utils/next-request';

export interface Features {
  /**
   * 统一认证能力。按产品约定 JSON 键名使用连字符 `intellect-auth`。
   */
  'intellect-auth': boolean;
  /** AIHub 能力：控制顶部「资源」入口与 `/api/bff/aihub/*`。 */
  aihub: boolean;
}

export interface FeaturesResponse {
  features: Features;
}

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

/**
 * GET /api/bff/features
 * 仅要求宿主会话，不携带 X-Backend-Id / X-User-Id。
 */
export const fetchFeatures = () =>
  request.get<ApiEnvelope<FeaturesResponse>>('/api/bff/features');
