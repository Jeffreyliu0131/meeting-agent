import React, { useEffect, useRef, useId, useState } from 'react';
import {
  Lightbulb,
  Target,
  ListChecks,
  GitBranch,
  ShieldAlert,
  CircleHelp,
  UserRound,
  Clock3,
  Database,
  LockKeyhole,
} from 'lucide-react';
import { layoutGraph, graphNodeHeight, NODE_WIDTH, type Position } from './graph-layout';
import type { Block, ArtifactRevision, Ref, Locale } from '../contracts/model';
const icons = {
  idea: Lightbulb,
  goal: Target,
  task: ListChecks,
  option: GitBranch,
  risk: ShieldAlert,
  question: CircleHelp,
  person: UserRound,
  time: Clock3,
  data: Database,
  constraint: LockKeyhole,
};
export function RelationshipGraph({
  block,
  artifact,
  onSources,
  locale = 'en',
}: {
  block: Extract<Block, { type: 'diagram' }>;
  artifact: ArtifactRevision;
  onSources: (refs: Ref[]) => void;
  locale?: Locale;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const stable = useRef(new Map<string, Position>());
  const signature = [block.layout, narrow, graphNodeHeight(block)].join(':');
  const priorLayout = useRef(signature);
  if (priorLayout.current !== signature) {
    stable.current.clear();
    priorLayout.current = signature;
  }
  const layout = layoutGraph(block, stable.current, narrow && block.layout !== 'mindmap');
  stable.current = layout.positions;
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 540));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const previous = useRef(new Map<string, string>());
  const blockContent = JSON.stringify(block);
  const [changed, setChanged] = useState<string[]>([]);
  useEffect(() => {
    const next = new Map([
      ...block.nodes.map((n) => [n.id, JSON.stringify(n)] as const),
      ...block.edges.map((e) => [e.relationId, JSON.stringify(e)] as const),
    ]);
    setChanged(
      [...next].filter(([id, value]) => previous.current.get(id) !== value).map(([id]) => id),
    );
    previous.current = next;
    const timer = setTimeout(() => setChanged([]), 1800);
    return () => clearTimeout(timer);
  }, [blockContent]);
  const marker = useId().replace(/:/g, '');
  const cite = (id: string) => onSources(artifact.elementSources?.[id] ?? block.sources);
  const caption =
    locale === 'zh-CN'
      ? { mindmap: '思路图', flow: '依赖与流程', argument: '观点与条件' }
      : { mindmap: 'Mind map', flow: 'Dependencies & flow', argument: 'Arguments & conditions' };
  return (
    <div className="semantic-graph" ref={host}>
      <div className="graph-caption">
        <GitBranch size={15} />
        <span>{caption[block.layout ?? 'flow']}</span>
        <span>
          {block.nodes.length} {locale === 'zh-CN' ? '个要点' : 'points'} · {block.edges.length}{' '}
          {locale === 'zh-CN' ? '条关联' : 'connections'}
        </span>
      </div>
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
                <path d="M0 0 L8 4 L0 8" fill="context-stroke" />
              </marker>
            </defs>
            {block.edges.map((e) => {
              const a = layout.positions.get(e.from)!,
                b = layout.positions.get(e.to)!;
              const h = layout.nodeHeight;
              const forward = b.x > a.x;
              const x1 = a.x + (forward ? NODE_WIDTH : 0),
                x2 = b.x + (forward ? 0 : NODE_WIDTH);
              const y1 = a.y + h / 2,
                y2 = b.y + h / 2;
              const d = layout.vertical
                ? `M${a.x + NODE_WIDTH / 2},${a.y + h} C${a.x + NODE_WIDTH / 2},${(a.y + h + b.y) / 2} ${b.x + NODE_WIDTH / 2},${(a.y + h + b.y) / 2} ${b.x + NODE_WIDTH / 2},${b.y}`
                : a.x === b.x
                  ? `M${a.x + NODE_WIDTH},${y1} C${a.x + NODE_WIDTH + 28},${y1} ${b.x + NODE_WIDTH + 28},${y2} ${b.x + NODE_WIDTH},${y2}`
                  : `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
              return (
                <path
                  key={e.relationId}
                  className={changed.includes(e.relationId) ? 'graph-edge-new' : ''}
                  data-relation-kind={e.kind ?? undefined}
                  d={d}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  markerEnd={`url(#${marker})`}
                  pathLength={1}
                />
              );
            })}
          </svg>
          {block.nodes.map((n) => {
            const p = layout.positions.get(n.id)!,
              Icon = icons[n.icon ?? 'idea'];
            return (
              <button
                key={n.id}
                data-node-id={n.id}
                data-icon={n.icon ?? 'idea'}
                className={`relationship-node ${changed.includes(n.id) ? 'graph-node-edited' : ''}`}
                style={{ left: p.x, top: p.y, height: layout.nodeHeight }}
                onClick={() => cite(n.objectId)}
              >
                <span className="node-symbol">
                  <Icon size={19} />
                </span>
                <span>{n.label}</span>
              </button>
            );
          })}
          {block.edges.map((e) => {
            const a = layout.positions.get(e.from)!,
              b = layout.positions.get(e.to)!;
            return (
              <button
                key={e.relationId}
                className="relationship-label"
                data-relation-kind={e.kind ?? undefined}
                style={{
                  left: layout.vertical
                    ? (a.x + b.x) / 2 + NODE_WIDTH / 2 + 8
                    : a.x === b.x
                      ? a.x + NODE_WIDTH - 20
                      : (a.x + b.x + NODE_WIDTH) / 2,
                  top: layout.vertical
                    ? (a.y + layout.nodeHeight + b.y) / 2 - 14
                    : (a.y + b.y + layout.nodeHeight) / 2 + 8,
                  transform: layout.vertical ? 'none' : undefined,
                }}
                onClick={() => cite(e.relationId)}
              >
                {e.label}
              </button>
            );
          })}
        </div>
      </div>
      <details className="graph-text-alternative">
        <summary>{locale === 'zh-CN' ? '查看文字关系' : 'Read connections'}</summary>
        {block.edges.map((e) => (
          <p key={e.relationId}>
            <button className="text-button" onClick={() => cite(e.relationId)}>
              {block.nodes.find((n) => n.id === e.from)?.label} · {e.label} →{' '}
              {block.nodes.find((n) => n.id === e.to)?.label}
            </button>
          </p>
        ))}
      </details>
    </div>
  );
}
