import { filterChildNodeIds } from '@agentui/canvas-plugin/utils/canvas-util';
import useGraphStore from '../store';

export function useFilterChildNodeIds(nodeId?: string) {
  const nodes = useGraphStore((state) => state.nodes);

  const childNodeIds = filterChildNodeIds(nodes, nodeId);

  return childNodeIds ?? [];
}
