import useGraphStore from '@agentui/canvas-plugin/editor/store';
import { getAgentNodeMCP } from '@agentui/canvas-plugin/editor/utils';
import { isEmpty } from 'lodash';
import { useMemo } from 'react';

export function useValues() {
  const { clickedToolId, clickedNodeId, findUpstreamNodeById } = useGraphStore(
    (state) => state,
  );

  const values = useMemo(() => {
    const agentNode = findUpstreamNodeById(clickedNodeId);
    const mcpList = getAgentNodeMCP(agentNode);

    const formData =
      mcpList.find((x) => x.mcp_id === clickedToolId)?.tools || {};

    if (isEmpty(formData)) {
      return { items: [] };
    }

    return { items: Object.keys(formData) };
  }, [clickedNodeId, clickedToolId, findUpstreamNodeById]);

  return values;
}
