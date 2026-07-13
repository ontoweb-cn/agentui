import { DocumentParserType } from '@/constants/knowledge';
import { useFetchKnowledgeList } from '@/hooks/use-knowledge-request';
import { IDataset } from '@/interfaces/database/dataset';
import { useDebounce } from 'ahooks';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { IntellectAvatar } from './intellect-avatar';
import { IntellectFormItem } from './intellect-form';
import {
  type MultiSelectGroupOptionType,
  type MultiSelectOptionType,
  MultiSelect,
} from './ui/multi-select';

function DatasetLabel({ text }: { text: string }) {
  return (
    <div className="text-xs px-3 p-1 bg-bg-card text-text-secondary rounded-lg border border-bg-card">
      {text}
    </div>
  );
}

export function useDisableDifferenceEmbeddingDataset(name: string) {
  const form = useFormContext();
  const datasetId = useWatch({ name, control: form.control });
  const [searchString, setSearchString] = useState('');
  const debouncedSearchString = useDebounce(searchString, { wait: 500 });
  const { list: datasetListOrigin, loading } = useFetchKnowledgeList(
    true,
    debouncedSearchString,
  );
  const datasetCacheRef = useRef(new Map<string, IDataset>());

  const datasetList = useMemo(() => {
    datasetListOrigin.forEach((dataset) => {
      datasetCacheRef.current.set(dataset.id, dataset);
    });

    const selectedDatasetIds = Array.isArray(datasetId) ? datasetId : [];
    const selectedDatasets = selectedDatasetIds
      .map((id) => datasetCacheRef.current.get(id))
      .filter(Boolean) as IDataset[];

    return Array.from(
      new Map(
        [...datasetListOrigin, ...selectedDatasets].map((dataset) => [
          dataset.id,
          dataset,
        ]),
      ).values(),
    );
  }, [datasetId, datasetListOrigin]);

  const selectedEmbedId = useMemo(() => {
    const data = datasetList?.find((item) => item.id === datasetId?.[0]);
    return data?.embedding_model ?? '';
  }, [datasetId, datasetList]);

  const nextOptions = useMemo(() => {
    const datasetListMap = datasetList
      .filter((x) => x.chunk_method !== DocumentParserType.Tag)
      .map((item: IDataset) => {
        return {
          label: item.name,
          icon: () => (
            <IntellectAvatar
              className="size-4"
              avatar={item.avatar}
              name={item.name}
            />
          ),
          suffix: (
            <section className="flex gap-2">
              <DatasetLabel text={item.nickname} />
              <DatasetLabel text={item.embedding_model} />
            </section>
          ),
          value: item.id,
          disabled:
            item.embedding_model !== selectedEmbedId && selectedEmbedId !== '',
        };
      });

    return datasetListMap;
  }, [datasetList, selectedEmbedId]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchString(value);
  }, []);

  return {
    datasetOptions: nextOptions,
    handleSearchChange,
    loading,
    searchString,
  };
}

// 通用 UI 子组件:仅负责渲染 FormItem + MultiSelect,不依赖任何画布 hook
export function KnowledgeBaseSelect({
  name = 'dataset_ids',
  required = false,
  options,
  searchString,
  handleSearchChange,
  loading,
}: {
  name?: string;
  required?: boolean;
  options: (MultiSelectGroupOptionType | MultiSelectOptionType)[];
  searchString: string;
  handleSearchChange: (value: string) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <IntellectFormItem
      name={name}
      tooltip={t('chat.knowledgeBasesTip')}
      required={required}
      label={t('chat.knowledgeBases')}
    >
      {(field) => (
        <MultiSelect
          data-testid="chat-datasets-combobox"
          options={options}
          onValueChange={field.onChange}
          placeholder={t('chat.knowledgeBasesPlaceholder')}
          variant="inverted"
          maxCount={100}
          defaultValue={field.value}
          showSelectAll={false}
          popoverTestId="datasets-options"
          optionTestIdPrefix="datasets"
          searchValue={searchString}
          onSearchChange={handleSearchChange}
          isSearching={loading}
          shouldFilter={false}
          {...field}
        />
      )}
    </IntellectFormItem>
  );
}

// 通用版本:仅使用 datasetOptions,不合并变量选项
export function KnowledgeBaseFormField({
  name = 'dataset_ids',
  required = false,
}: {
  name?: string;
  required?: boolean;
}) {
  const { datasetOptions, handleSearchChange, loading, searchString } =
    useDisableDifferenceEmbeddingDataset(name);

  return (
    <KnowledgeBaseSelect
      name={name}
      required={required}
      options={datasetOptions}
      searchString={searchString}
      handleSearchChange={handleSearchChange}
      loading={loading}
    />
  );
}
