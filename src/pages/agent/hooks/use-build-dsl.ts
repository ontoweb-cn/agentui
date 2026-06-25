import { useFetchAgent } from '@/hooks/use-agent-request';
import {
  GlobalVariableType,
  IntellectNodeType,
} from '@/interfaces/database/agent';
import { useCallback } from 'react';
import useGraphStore from '../store';
import { graphToDsl } from '../utils/dsl-bridge';

export const useBuildDslData = () => {
  const { data } = useFetchAgent();
  const { nodes, edges } = useGraphStore((state) => state);

  const buildDslData = useCallback(
    (
      currentNodes?: IntellectNodeType[],
      otherParam?: { globalVariables: Record<string, GlobalVariableType> },
    ) => {
      return graphToDsl(
        currentNodes ?? nodes,
        edges,
        data?.dsl ?? {},
        otherParam?.globalVariables,
      );
    },
    [data?.dsl, edges, nodes],
  );

  return { buildDslData };
};
