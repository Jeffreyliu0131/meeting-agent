export type Position = { x: number; y: number };
type Graph = {
  layout?: 'mindmap' | 'flow' | 'argument' | null;
  nodes: { id: string; label?: string }[];
  edges: { from: string; to: string }[];
};
export const NODE_WIDTH = 192;
export function graphNodeHeight(graph: Graph) {
  const lines = Math.max(
    1,
    ...graph.nodes.map((n) =>
      Math.ceil(
        [...(n.label ?? '')].reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 1 : 0.55), 0) / 8,
      ),
    ),
  );
  return Math.max(86, 38 + lines * 22);
}
/** Layout only source-bound nodes; never invent edges or semantic groups. */
export function layoutGraph(
  graph: Graph,
  previous: Map<string, Position> = new Map(),
  vertical = false,
) {
  const height = graphNodeHeight(graph);
  const positions = new Map([...previous].filter(([id]) => graph.nodes.some((n) => n.id === id)));
  const ranks = new Map<string, number>(),
    remaining = new Set(graph.nodes.map((n) => n.id));
  if (graph.layout === 'mindmap' && graph.nodes.length) {
    const degree = (id: string) => graph.edges.filter((e) => e.from === id || e.to === id).length;
    const root = [...graph.nodes].sort((a, b) => degree(b.id) - degree(a.id))[0].id;
    ranks.set(root, 0);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift()!;
      for (const edge of graph.edges) {
        const other = edge.from === id ? edge.to : edge.to === id ? edge.from : null;
        if (other && !ranks.has(other)) {
          ranks.set(other, ranks.get(id)! + 1);
          queue.push(other);
        }
      }
    }
    for (const n of graph.nodes) if (!ranks.has(n.id)) ranks.set(n.id, 0);
  } else {
    for (let round = 0; round < graph.nodes.length && remaining.size; round++) {
      let progress = false;
      for (const id of [...remaining]) {
        const parents = graph.edges.filter((e) => e.to === id && e.from !== id).map((e) => e.from);
        if (parents.every((p) => ranks.has(p) || !remaining.has(p))) {
          ranks.set(id, Math.max(0, ...parents.map((p) => (ranks.get(p) ?? -1) + 1)));
          remaining.delete(id);
          progress = true;
        }
      }
      if (!progress) {
        const id = [...remaining].sort()[0];
        ranks.set(id, 0);
        remaining.delete(id);
      }
    }
  }
  for (const node of graph.nodes) {
    if (positions.has(node.id)) continue;
    const rank = ranks.get(node.id) ?? 0;
    let x = vertical ? 24 : 24 + rank * 332;
    let y = vertical ? 32 + rank * (height + 112) : 32;
    while (
      [...positions.values()].some(
        (p) => Math.abs(p.x - x) < NODE_WIDTH + 24 && Math.abs(p.y - y) < height + 40,
      )
    ) {
      if (vertical) x += NODE_WIDTH + 48;
      else y += height + 58;
    }
    positions.set(node.id, { x, y });
  }
  // On first composition center a mindmap's origin against its branches.
  if (graph.layout === 'mindmap' && !previous.size && !vertical) {
    const root = graph.nodes.find((n) => ranks.get(n.id) === 0);
    const children = graph.nodes.filter((n) => ranks.get(n.id) === 1);
    if (root && children.length && graph.nodes.filter((n) => ranks.get(n.id) === 0).length === 1) {
      const ys = children.map((n) => positions.get(n.id)!.y);
      positions.get(root.id)!.y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
  }
  return {
    positions,
    nodeHeight: height,
    vertical,
    width: Math.max(260, ...[...positions.values()].map((p) => p.x + NODE_WIDTH + 24)),
    height: Math.max(180, ...[...positions.values()].map((p) => p.y + height + 48)),
  };
}
