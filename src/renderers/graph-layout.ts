export type Position = { x: number; y: number };
type Graph = { nodes: { id: string }[]; edges: { from: string; to: string }[] };
/** Stable layered layout: an existing node never moves on an incremental update. */
export function layoutGraph(graph: Graph, previous: Map<string, Position> = new Map()) {
  const positions = new Map([...previous].filter(([id]) => graph.nodes.some((n) => n.id === id)));
  const rank = new Map<string, number>(),
    remaining = new Set(graph.nodes.map((n) => n.id));
  for (let round = 0; round < graph.nodes.length && remaining.size; round++) {
    let progress = false;
    for (const id of [...remaining]) {
      const parents = graph.edges.filter((e) => e.to === id && e.from !== id).map((e) => e.from);
      if (parents.every((p) => rank.has(p) || !remaining.has(p))) {
        rank.set(id, Math.max(0, ...parents.map((p) => (rank.get(p) ?? -1) + 1)));
        remaining.delete(id);
        progress = true;
      }
    }
    if (!progress) {
      const id = [...remaining].sort()[0];
      rank.set(id, 0);
      remaining.delete(id);
    }
  }
  for (const node of graph.nodes) {
    if (positions.has(node.id)) continue;
    const x = 24 + (rank.get(node.id) ?? 0) * 320;
    let y = 40;
    while ([...positions.values()].some((p) => Math.abs(p.x - x) < 200 && Math.abs(p.y - y) < 112))
      y += 128;
    positions.set(node.id, { x, y });
  }
  return {
    positions,
    width: Math.max(320, ...[...positions.values()].map((p) => p.x + 220)),
    height: Math.max(180, ...[...positions.values()].map((p) => p.y + 120)),
  };
}
