import { AgentCategory, AgentQuery } from '@agentui/canvas-plugin/constant';
import { useSearchParams } from 'react-router';

export function useIsPipeline() {
  const [queryParameters] = useSearchParams();

  return (
    queryParameters.get(AgentQuery.Category) === AgentCategory.DataflowCanvas
  );
}
