import React, { useRef, useId } from 'react';
import type { Block, ArtifactRevision, Ref } from '../contracts/model';
import { layoutGraph, type Position } from './graph-layout';
export function RelationshipGraph({
  block,
  artifact,
  onSources,
}: {
  block: Extract<Block, { type: 'diagram' }>;
  artifact: ArtifactRevision;
  onSources: (refs: Ref[]) => void;
}) {
  const stable = useRef(new Map<string, Position>()),
    marker = useId().replace(/:/g, '');
  const layout = layoutGraph(block, stable.current);
  stable.current = layout.positions;
  const cite = (id: string) => onSources(artifact.elementSources?.[id] ?? block.sources);
  return (
    <div className="relationship-scroll" tabIndex={0} aria-label={block.title}>
      <div className="relationship-canvas" style={{ width: layout.width, height: layout.height }}>
        <svg
          className="relationship-edges"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          <defs>
            <marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0 0 L8 4 L0 8" fill="currentColor" />
            </marker>
          </defs>
          {block.edges.map((e) => {
            const a = layout.positions.get(e.from),
              b = layout.positions.get(e.to);
            if (!a || !b) return null;
            const forward = b.x > a.x,
              x1 = a.x + 192,
              y1 = a.y + 38,
              x2 = b.x,
              y2 = b.y + 38;
            const d = forward
              ? `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`
              : `M${a.x + 96},${a.y + 76} C${a.x + 96},${Math.max(a.y, b.y) + 110} ${b.x + 96},${Math.max(a.y, b.y) + 110} ${b.x + 96},${b.y + 76}`;
            return (
              <path
                key={e.relationId}
                d={d}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                markerEnd={`url(#${marker})`}
              />
            );
          })}
        </svg>
        {block.nodes.map((n) => {
          const p = layout.positions.get(n.id)!;
          return (
            <button
              className="relationship-node"
              key={n.id}
              style={{ left: p.x, top: p.y }}
              onClick={() => cite(n.objectId)}
            >
              {n.label}
            </button>
          );
        })}
        {block.edges.map((e) => {
          const a = layout.positions.get(e.from),
            b = layout.positions.get(e.to);
          if (!a || !b) return null;
          const forward = b.x > a.x;
          return (
            <button
              className="relationship-label"
              key={e.relationId}
              style={{
                left: forward ? (a.x + 192 + b.x) / 2 - 48 : (a.x + b.x) / 2 + 48,
                top: forward ? (a.y + b.y) / 2 - 6 : Math.max(a.y, b.y) + 88,
              }}
              onClick={() => cite(e.relationId)}
            >
              {e.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
