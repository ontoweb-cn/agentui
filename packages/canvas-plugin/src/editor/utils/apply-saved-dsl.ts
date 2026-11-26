export function applySavedCanvasDsl(
  dsl: { graph?: { nodes?: unknown; edges?: unknown } } | null | undefined,
  store: {
    setNodes: (nodes: unknown[]) => void;
    setEdges: (edges: unknown[]) => void;
  },
): boolean {
  const nodes = dsl?.graph?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return false;
  }
  store.setNodes(nodes);
  const edges = dsl?.graph?.edges;
  if (Array.isArray(edges)) {
    store.setEdges(edges);
  }
  return true;
}
