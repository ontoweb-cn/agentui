/**
 * Gateway Admin API 客户端 — 经 BFF 代理访问 intellect-gateway Admin API。
 *
 * 所有请求发送到 /api/bff/proxy/v1/*，BFF 转发到 intellect-gateway /v1/admin/*
 * 并注入 admin token。前端不接触 admin token（Constitution Principle V）。
 */

import { getAuthorization } from '@/utils/authorization-util';

// ── Response types（与原 IntellectLlmAdapter 保持兼容）──────────────────

export interface Provider {
  id: string;
  display_name: string;
  api_mode: string;
  auth_type: string;
  base_url: string;
  enabled: boolean;
  default_model: string;
  priority: number;
}

export interface CreateProviderRequest {
  id: string;
  display_name?: string;
  api_mode?: string;
  auth_type?: string;
  base_url?: string;
  default_model?: string;
  enabled?: boolean;
  priority?: number;
}

export interface KeyInfo {
  id: string;
  label: string;
  status: string; // "ok" | "exhausted" | "dead" | "unknown"
}

export interface VerifyResult {
  provider_id: string;
  status: string; // "ok" | "auth_error" | "unknown"
  message: string;
  verified_at: number;
}

export interface KeyHealthSummary {
  total_providers: number;
  total_keys: number;
  healthy: number;
  exhausted: number;
  dead: number;
  providers: Array<{
    id: string;
    display_name: string;
    key_count: number;
    healthy: number;
  }>;
}

// ── BFF response envelope ────────────────────────────────────────────────

interface BffEnvelope<T> {
  code: number;
  data: T;
  message: string;
}

const BASE = '/api/bff/proxy/v1';

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const auth = getAuthorization();
  if (auth) {
    headers['Authorization'] = auth;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let envelope: BffEnvelope<T> | null = null;
  try {
    envelope = (await res.json()) as BffEnvelope<T>;
  } catch {
    throw new Error(`Gateway admin API error: HTTP ${res.status} (non-JSON response)`);
  }

  if (envelope.code !== 0) {
    throw new Error(envelope.message || `HTTP ${res.status}`);
  }
  return envelope.data;
}

// ── Public API（与原 IntellectLlmAdapter 方法签名对齐）──────────────────

export const gatewayAdmin = {
  /**
   * 列出所有 gateway 管理的 providers。
   * BFF 对 GET /providers 列表端点会提取 providers 数组为 data，
   * 因此这里 data 已是 Provider[]。
   */
  async listProviders(): Promise<{ providers: Provider[] }> {
    const data = await request<Provider[]>('GET', '/providers');
    return { providers: data ?? [] };
  },

  async createProvider(
    provider: CreateProviderRequest,
  ): Promise<{ status: string }> {
    return request('POST', '/providers', provider);
  },

  async deleteProvider(id: string): Promise<{ status: string }> {
    return request('DELETE', `/providers/${id}?confirm=true`);
  },

  async setKey(
    providerId: string,
    apiKey: string,
    label = 'default',
  ): Promise<KeyInfo> {
    return request('PUT', `/providers/${providerId}/key`, {
      api_key: apiKey,
      label,
    });
  },

  async verifyConnection(providerId: string): Promise<VerifyResult> {
    return request('POST', `/providers/${providerId}/verify`, {});
  },

  async keyHealthSummary(): Promise<KeyHealthSummary> {
    return request('GET', '/health/keys');
  },
};
