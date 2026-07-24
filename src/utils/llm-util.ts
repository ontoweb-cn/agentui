// The names of the large models returned by the interface are similar to "deepseek-r1___OpenAI-API"
export function getRealModelName(llmName: string) {
  return llmName.split('__').at(0) ?? '';
}

/** Build "modelName@instanceName@providerName" */
export function buildModelValue(model: {
  model_name: string;
  model_instance: string;
  model_provider: string;
}) {
  return `${model.model_name}@${model.model_instance}@${model.model_provider}`;
}

/** Parse "modelName@instanceName@providerName" */
export function parseModelValue(val: string) {
  if (!val) return null;
  const firstAt = val.indexOf('@');
  const lastAt = val.lastIndexOf('@');
  if (firstAt === -1 || firstAt === lastAt) return null;
  return {
    model_name: val.substring(0, firstAt),
    model_instance: val.substring(firstAt + 1, lastAt),
    model_provider: val.substring(lastAt + 1),
  };
}

/**
 * Phase 3 (RAG Migration 006): tenant FK columns (`tenant_llm_id`,
 * `tenant_embd_id`, ...) have been dropped from the RAG `tenant` table.
 * Model selection is now sourced from the TEAM API.
 *
 * Additionally, `API_WHITELIST` was already stale (paths `/api/v1/...` vs
 * the current `/api/bff/proxy/v1/...` proxy paths), so this function was a
 * silent no-op even before Phase 3.
 *
 * Retained as a no-op for backward compatibility with existing callers in
 * `request.ts` and `next-request.ts`.
 *
 * TODO: remove all callers and this function after Phase 3 deployment is verified.
 */
export function addTenantParams(data: any, _url?: string): any {
  return data;
}
