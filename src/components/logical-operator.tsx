import { useBuildSwitchLogicOperatorOptions } from '@/hooks/logic-hooks/use-build-options';
import { IntellectFormItem } from './intellect-form';
import { IntellectSelect } from './ui/select';

type LogicalOperatorProps = { name: string };

export function LogicalOperator({ name }: LogicalOperatorProps) {
  const switchLogicOperatorOptions = useBuildSwitchLogicOperatorOptions();

  return (
    <div className="relative min-w-14">
      <IntellectFormItem
        name={name}
        className="absolute top-1/2 -translate-y-1/2 right-1 left-0 z-10 bg-bg-base"
      >
        <IntellectSelect
          options={switchLogicOperatorOptions}
          triggerClassName="w-full text-xs px-1 py-0 h-6"
        ></IntellectSelect>
      </IntellectFormItem>
      <div className="absolute border-l border-y w-5 right-0 top-4 bottom-4 rounded-l-lg"></div>
    </div>
  );
}
