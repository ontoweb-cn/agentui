/**
 * Gateway session PATCH body for chat settings save.
 * `dataset_ids !== undefined`（含空数组）才会写入 kb_ids——空数组表示清空绑定。
 */
export function buildUpdateChatPatch(params: {
  name?: string;
  dataset_ids?: string[];
  prompt_config?: unknown;
}): Record<string, unknown> {
  const patchData: Record<string, unknown> = {
    name: params.name,
    title: params.name,
  };
  if (params.dataset_ids !== undefined) {
    patchData.kb_ids = params.dataset_ids;
  }
  if (params.prompt_config) {
    patchData.prompt_config = params.prompt_config;
  }
  return patchData;
}
