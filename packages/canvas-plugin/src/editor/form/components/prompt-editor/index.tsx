import {
  PromptEditor as GenericPromptEditor,
  PromptEditorProps,
} from '@/components/prompt-editor';
import type { VariablePickerMenuOptionType } from '@/components/prompt-editor/variable-picker-plugin';
import {
  useFindAgentStructuredOutputLabel,
  useGetStructuredOutputByValue,
  useShowSecondaryMenu,
} from '@agentui/canvas-plugin/editor/hooks/use-build-structured-output';
import { useFilterQueryVariableOptionsByTypes } from '@agentui/canvas-plugin/editor/hooks/use-get-begin-query';
import { forwardRef } from 'react';
import { StructuredOutputSecondaryMenu } from '../structured-output-secondary-menu';

// 画布专用 PromptEditor 包装器:注入画布 hook 和组件,保持画布内调用方无需改动
export const PromptEditor = forwardRef(function CanvasPromptEditor(
  props: PromptEditorProps,
  ref: React.Ref<HTMLDivElement>,
) {
  const queryVariableOptions = useFilterQueryVariableOptionsByTypes({
    types: props.types,
  });
  const findAgentStructuredOutputLabel = useFindAgentStructuredOutputLabel();
  const getStructuredOutputByValue = useGetStructuredOutputByValue();
  const showSecondaryMenu = useShowSecondaryMenu();

  // 评审 Q2:useFilterQueryVariableOptionsByTypes 返回类型因 filterDocGeneratorDownloadOutputOptions
  // 的 options 内对象类型宽泛({value?: string} & Record<string, any>),无法自动推断出
  // label/icon 字段。此断言比 as any 更安全:仅断言到 VariablePickerMenuOptionType[],
  // 保留对外层 group 结构(label/title)的类型检查。彻底修复需重构 filterDocGeneratorDownloadOutputOptions
  // 泛型以保留 options 内对象类型,留待后续。
  return (
    <GenericPromptEditor
      {...props}
      ref={ref}
      queryVariableOptions={
        queryVariableOptions as VariablePickerMenuOptionType[]
      }
      findAgentStructuredOutputLabel={findAgentStructuredOutputLabel}
      getStructuredOutputByValue={getStructuredOutputByValue}
      showSecondaryMenu={showSecondaryMenu}
      StructuredOutputSecondaryMenuComponent={StructuredOutputSecondaryMenu}
    />
  );
});
