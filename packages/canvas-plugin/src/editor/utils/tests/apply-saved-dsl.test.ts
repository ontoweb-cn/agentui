import { applySavedCanvasDsl } from '../apply-saved-dsl';

describe('applySavedCanvasDsl', () => {
  it('replaces the editor draft with the saved graph', () => {
    const nodes: unknown[] = [];
    const edges: unknown[] = [];
    const applied = applySavedCanvasDsl(
      {
        graph: {
          nodes: [{ id: 'begin' }],
          edges: [{ id: 'e1', source: 'begin', target: 'end' }],
        },
      },
      {
        setNodes: (next) => nodes.splice(0, nodes.length, ...next),
        setEdges: (next) => edges.splice(0, edges.length, ...next),
      },
    );
    expect(applied).toBe(true);
    expect(nodes).toEqual([{ id: 'begin' }]);
    expect(edges).toEqual([{ id: 'e1', source: 'begin', target: 'end' }]);
  });

  it('leaves the editor unchanged when the response has no nodes', () => {
    const setNodes = jest.fn();
    const setEdges = jest.fn();
    expect(applySavedCanvasDsl({ graph: { nodes: [] } }, { setNodes, setEdges })).toBe(
      false,
    );
    expect(setNodes).not.toHaveBeenCalled();
  });
});
