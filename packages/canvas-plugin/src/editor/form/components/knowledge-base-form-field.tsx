// 画布扩展版本:在通用 KnowledgeBaseSelect 基础上合并 Begin/上游节点变量选项
import { IntellectAvatar } from '@/components/intellect-avatar';
import {
  KnowledgeBaseSelect,
  useDisableDifferenceEmbeddingDataset,
} from '@/components/knowledge-base-item';
import { useBuildQueryVariableOptions } from '@agentui/canvas-plugin/editor/hooks/use-get-begin-query';
import { toLower } from 'lodash';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export function AgentKnowledgeBaseFormField({
  name = 'dataset_ids',
  required = false,
}: {
  name?: string;
  required?: boolean;
}) {
  const { t } = useTranslation();

  const { datasetOptions, handleSearchChange, loading, searchString } =
    useDisableDifferenceEmbeddingDataset(name);

  const nextOptions = useBuildQueryVariableOptions();

  // 合并知识库选项与变量选项(仅保留 string 类型变量)
  const options = useMemo(() => {
    return [
      {
        label: t('knowledgeDetails.dataset'),
        options: datasetOptions,
      },
      ...nextOptions.map((group) => {
        // group 类型已包含必填 label(见 VariablePickerMenuOptionType / useBuild*VariableOptions 返回类型)
        // 评审 Q5:重命名内层变量消除遮蔽;Q2:不再需要 'label' in group 运行时检查
        const groupLabel = (group.label ?? '') as ReactNode;

        return {
          ...group,
          label: groupLabel,
          options: group.options
            .filter((option) => toLower(option.type).includes('string'))
            .map((option) => ({
              ...option,
              label: option.label ?? option.value ?? '',
              value: option.value ?? '',
              icon: () => (
                <IntellectAvatar
                  className="size-4 mr-2"
                  avatar={String(option.label ?? '')}
                  name={String(option.label ?? '')}
                />
              ),
            })),
        };
      }),
    ];
  }, [datasetOptions, nextOptions, t]);

  return (
    <KnowledgeBaseSelect
      name={name}
      required={required}
      options={options}
      searchString={searchString}
      handleSearchChange={handleSearchChange}
      loading={loading}
    />
  );
}
