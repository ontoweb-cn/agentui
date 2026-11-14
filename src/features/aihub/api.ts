/**
 * aihub BFF 客户端（M0 仅 meta 冒烟）。
 *
 * 浏览器只访问 `/api/bff/aihub/*`，不直连 aihub。
 */

import request from '@/utils/next-request';

export interface AihubMeta {
  service: string;
  version: string;
  model_source: string;
  storage: string;
  subject: string;
  kid: string;
  assertion_exp: number;
  now: number;
}

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export const fetchAihubMeta = () =>
  request.get<ApiEnvelope<AihubMeta>>('/api/bff/aihub/meta');
