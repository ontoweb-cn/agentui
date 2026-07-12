/**
 * IntellectLlmAdapter — Intellect Gateway LLM API 的 Adapter 实现。
 *
 * Phase 3: 对接 intellect-gateway 的 /v1/chat/completions、/v1/embeddings、
 * /v1/rerank、/v1/models 和 /v1/admin/* 端点。
 */

export interface LlmServiceConfig {
  url: string;
  adminToken: string;
}

// ── Request / Response types ──────────────────────────────────────────────

export interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface Model {
  id: string;
  object: string;
  created?: number;
  owned_by: string;
  type?: string; // "chat" | "embedding" | "rerank"
  context_length?: number;
}

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

export interface UpsertModelRequest {
  display_name?: string;
  context_length?: number;
  max_output_tokens?: number;
  supports_vision?: boolean;
  pricing_input?: number;
  pricing_output?: number;
  enabled?: boolean;
}

export interface RuntimeProfile {
  primary_provider_id?: string;
  primary_model_id?: string;
  api_mode?: string;
  base_url_override?: string;
}

export interface FallbackEntry {
  position: number;
  provider_id: string;
  model_id?: string;
  enabled: boolean;
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

// ── Adapter ───────────────────────────────────────────────────────────────

export class IntellectLlmAdapter {
  private url: string;
  private authHeaders: Record<string, string>;

  constructor(config: LlmServiceConfig) {
    this.url = config.url.replace(/\/$/, "");
    if (!config.adminToken) {
      console.warn(
        "IntellectLlmAdapter: adminToken is empty. Admin API requests will fail with 401. " +
        "Set INTELLECT_LLM_API_KEY environment variable."
      );
    }
    this.authHeaders = config.adminToken
      ? { Authorization: `Bearer ${config.adminToken}` }
      : {};
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.url}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM API error ${res.status}: ${text}`);
    }
    return res.json();
  }

  // ── Chat ──

  chatCompletion(request: ChatRequest): Promise<Response> {
    return fetch(`${this.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders },
      body: JSON.stringify(request),
    });
  }

  // ── Models ──

  async listModels(): Promise<Model[]> {
    const data = await this.request<{ data: Model[] }>("GET", "/v1/models");
    return data.data;
  }

  // ── Embedding ──

  async embed(input: string | string[], model: string): Promise<{ data: Array<{ embedding: number[] }>; usage: { total_tokens: number } }> {
    return this.request("POST", "/v1/embeddings", { input, model });
  }

  // ── Rerank ──

  async rerank(query: string, documents: string[], model: string, topN?: number): Promise<{ results: Array<{ index: number; relevance_score: number }> }> {
    const body: Record<string, unknown> = { query, documents, model };
    if (topN !== undefined) body.top_n = topN;
    return this.request("POST", "/v1/rerank", body);
  }

  // ── Providers ──

  listProviders(): Promise<{ providers: Provider[] }> {
    return this.request("GET", "/v1/admin/providers");
  }

  createProvider(provider: CreateProviderRequest): Promise<{ status: string }> {
    return this.request("POST", "/v1/admin/providers", provider);
  }

  deleteProvider(id: string): Promise<{ status: string }> {
    return this.request("DELETE", `/v1/admin/providers/${id}?confirm=true`);
  }

  // ── Keys ──

  setKey(providerId: string, apiKey: string, label = "default"): Promise<KeyInfo> {
    return this.request("PUT", `/v1/admin/providers/${providerId}/key`, { api_key: apiKey, label });
  }

  deleteKey(providerId: string, keyId: string): Promise<{ status: string }> {
    return this.request("DELETE", `/v1/admin/providers/${providerId}/key?key_id=${keyId}`);
  }

  verifyConnection(providerId: string): Promise<VerifyResult> {
    return this.request("POST", `/v1/admin/providers/${providerId}/verify`, {});
  }

  // ── Provider Keys Detail ──

  getProviderKeys(providerId: string): Promise<{ provider_id: string; keys: KeyInfo[] }> {
    return this.request("GET", `/v1/admin/providers/${providerId}/keys`);
  }

  // ── Key Health ──

  keyHealthSummary(): Promise<KeyHealthSummary> {
    return this.request("GET", "/v1/admin/health/keys");
  }

  // ── Models CRUD ──

  listProviderModels(providerId: string): Promise<{ models: Model[] }> {
    return this.request("GET", `/v1/admin/providers/${providerId}/models`);
  }

  upsertModel(providerId: string, modelId: string, model: UpsertModelRequest): Promise<{ status: string }> {
    return this.request("PUT", `/v1/admin/providers/${providerId}/models/${modelId}`, model);
  }

  deleteModel(providerId: string, modelId: string): Promise<{ status: string }> {
    return this.request("DELETE", `/v1/admin/providers/${providerId}/models/${modelId}`);
  }

  // ── Runtime Profile ──

  getRuntimeProfile(): Promise<RuntimeProfile> {
    return this.request("GET", "/v1/admin/runtime-profile");
  }

  setRuntimeProfile(profile: Partial<RuntimeProfile>): Promise<{ status: string }> {
    return this.request("PUT", "/v1/admin/runtime-profile", profile);
  }

  // ── Fallback Chain ──

  getFallbackChain(): Promise<{ fallback_chain: FallbackEntry[] }> {
    return this.request("GET", "/v1/admin/fallback-chain");
  }

  setFallbackChain(entries: FallbackEntry[]): Promise<{ status: string }> {
    return this.request("PUT", "/v1/admin/fallback-chain", entries);
  }

  // ── Aliases ──

  listAliases(): Promise<{ aliases: Array<{ alias: string; provider_id: string }> }> {
    return this.request("GET", "/v1/admin/provider-aliases");
  }

  setAlias(alias: string, providerId: string): Promise<{ status: string }> {
    return this.request("PUT", `/v1/admin/provider-aliases/${encodeURIComponent(alias)}`, { provider_id: providerId });
  }
}
