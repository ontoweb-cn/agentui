/**
 * 把服务端保存后的 DSL 回填到画布 store(保存→回填链路,见
 * docs 中 canvas Go 事件契约)。
 *
 * 入参 dsl 来自 HTTP 响应(未受信),此处只做最小结构校验;类型上用泛型
 * 保留具体节点/边类型,避免调用方 store(IntellectNodeType[]/Edge[])与
 * unknown[] 不兼容——store 只关心"数组",类型由调用方保证。
 */
export function applySavedCanvasDsl<TNode = unknown, TEdge = unknown>(
  dsl: { graph?: { nodes?: unknown; edges?: unknown } } | null | undefined,
  store: {
    setNodes: (nodes: TNode[]) => void;
    setEdges: (edges: TEdge[]) => void;
  },
): boolean {
  const nodes = dsl?.graph?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return false;
  }
  store.setNodes(nodes as TNode[]);
  const edges = dsl?.graph?.edges;
  if (Array.isArray(edges)) {
    store.setEdges(edges as TEdge[]);
  }
  return true;
}
