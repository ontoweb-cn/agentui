/**
 * Provenance: verbatim port from upstream RAGFlow web/ (base 91c702e),零漂移。
 * 同步策略见 docs/ragflow-ui-improvement-recommendations.md;T2.9 决策记录见
 * docs/ragflow-ui-alignment-followup-tasks.md(移植依据:zh/en 默认模板与
 * variableTip 均内嵌 {knowledge},运行时语义活跃;生产无存量对话,见 L-10)。
 */
export type ChatPromptKbIssue = {
  path: string[];
  message: string;
};

export type ChatPromptKbValue = {
  dataset_ids?: string[];
  prompt_config?: {
    system?: string;
    empty_response?: string;
  };
};

export function chatPromptKbIssues(
  value: ChatPromptKbValue,
  t: (key: string) => string,
): ChatPromptKbIssue[] {
  const system = value?.prompt_config?.system ?? '';
  const emptyResponse = value?.prompt_config?.empty_response ?? '';
  const datasetIds = value?.dataset_ids ?? [];
  const issues: ChatPromptKbIssue[] = [];

  if (
    datasetIds.length > 0 &&
    system.trim() !== '' &&
    !system.includes('{knowledge}')
  ) {
    issues.push({
      path: ['prompt_config', 'system'],
      message: t('knowledgePlaceholderMessage'),
    });
  }

  if (datasetIds.length === 0 && emptyResponse.trim() !== '') {
    issues.push({
      path: ['prompt_config', 'empty_response'],
      message: t('emptyResponseMessage'),
    });
  }

  return issues;
}
