import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Ref, type Meeting } from '../contracts/model';
import { latestSegments, scopedContext } from './context';
import { dependencies } from '../domain/meaning';
import { calculate } from '../domain/calculator';

import { EvidenceRequest } from '../contracts/workflow';
export { EvidenceRequest } from '../contracts/workflow';
export type ToolObservation = {
  resultId: string;
  inputHash: string;
  kind: string;
  values: unknown[];
  refs: { kind: string; id: string; rev: number }[];
  coverage: { total: number; loaded: number; hasMore: boolean; cursor: number | null };
  status: 'known' | 'conditional' | 'unknown' | 'error';
  error?: string;
};
/** All tools are local, scoped and read-only. Pagination never clips a source. */
export function executeEvidence(
  raw: EvidenceRequest,
  meeting: Meeting,
  scope: 'meeting' | 'personal',
  requestId?: string,
  maxBytes = 12000,
): ToolObservation {
  const r = EvidenceRequest.parse(raw),
    m = scopedContext(meeting, scope);
  if (scope === 'personal') {
    m.segments = m.segments.filter((s) => s.kind !== 'request' || s.id === requestId);
    m.artifacts = m.artifacts.filter(
      (a) => (a.scope ?? 'meeting') === 'meeting' || a.branchId === requestId,
    );
    m.objectHistory = m.objectHistory?.filter((o) =>
      o.sources.every((r) => m.segments.some((s) => s.id === r.id)),
    );
    m.clarifications = m.clarifications?.filter((c) => !c.branchId || c.branchId === requestId);
    m.decisions = m.decisions.filter((d) => d.scope === 'meeting');
    m.scenarios = [];
  }
  let pool: { value: unknown; ref: { kind: string; id: string; rev: number } }[] = [];
  const add = (kind: string, items: { id: string; rev: number }[]) =>
    items.map((value) => ({ value, ref: { kind, id: value.id, rev: value.rev } }));
  if (r.kind === 'search_meeting') {
    const q = r.query.trim().toLocaleLowerCase();
    if (!q) throw new Error('EMPTY_QUERY');
    const tokens = q.match(/[\p{L}\p{N}]+/gu) ?? [];
    pool = add(
      'source',
      latestSegments(m).filter(
        (s) =>
          s.text.toLocaleLowerCase().includes(q) ||
          tokens.some((t) => s.text.toLocaleLowerCase().includes(t)),
      ),
    );
  } else if (r.kind === 'read_sources')
    pool = add(
      'source',
      m.segments.filter((s) => r.refs.some((ref) => ref.id === s.id && ref.rev === s.rev)),
    );
  else if (r.kind === 'neighbors') {
    const all = latestSegments(m),
      indices = all.flatMap((s, i) =>
        r.refs.some((ref) => ref.id === s.id && ref.rev === s.rev) ? [i] : [],
      );
    pool = add(
      'source',
      all.filter((_, i) => indices.some((n) => Math.abs(n - i) <= 2)),
    );
  } else if (r.kind === 'read_objects')
    pool = add(
      'object',
      r.refs.length
        ? [...(m.objectHistory ?? []), ...m.objects].filter((o) =>
            r.refs.some((ref) => ref.id === o.id && ref.rev === o.rev),
          )
        : m.objects,
    );
  else if (r.kind === 'read_artifacts')
    pool = add(
      'artifact',
      r.refs.length
        ? m.artifacts.filter((a) => r.refs.some((ref) => ref.id === a.id && ref.rev === a.rev))
        : [...new Map(m.artifacts.map((a) => [a.id, a])).values()],
    );
  else if (r.kind === 'dependency_impact') {
    const ids = new Set(r.refs.map((x) => x.id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const o of m.objects)
        if (!ids.has(o.id) && dependencies(m, o.id).some((id) => ids.has(id))) {
          ids.add(o.id);
          changed = true;
        }
    }
    pool = add(
      'object',
      m.objects.filter((o) => ids.has(o.id)),
    );
  } else {
    if (scope !== 'personal') throw new Error('TOOL_SCOPE');
    const a = m.artifacts.find((a) => r.refs.some((ref) => ref.id === a.id && ref.rev === a.rev));
    const f = a?.formulas.find((f) => f.id === r.formulaId);
    if (!a || !f) throw new Error('FORMULA_NOT_FOUND');
    const result = calculate(f, r.overrides);
    pool = [
      {
        value: { formulaId: f.id, result, unit: f.unit, basis: f.basis, overrides: r.overrides },
        ref: { kind: 'artifact', id: a.id, rev: a.rev },
      },
    ];
  }
  const selected: typeof pool = [];
  for (const item of pool.slice(r.cursor, r.cursor + r.limit)) {
    if (Buffer.byteLength(JSON.stringify([...selected, item])) > maxBytes) {
      if (!selected.length) throw new Error('EVIDENCE_ITEM_TOO_LARGE');
      break;
    }
    selected.push(item);
  }
  const end = r.cursor + selected.length,
    hasMore = end < pool.length;
  return {
    resultId: randomUUID(),
    inputHash: createHash('sha256').update(JSON.stringify(r)).digest('hex'),
    kind: r.kind,
    values: selected.map((x) => x.value),
    refs: selected.map((x) => x.ref),
    coverage: {
      total: pool.length,
      loaded: selected.length,
      hasMore,
      cursor: hasMore ? end : null,
    },
    status:
      !selected.length ||
      (r.kind === 'calculate' && (selected[0].value as { result: string | null }).result === null)
        ? 'unknown'
        : r.kind === 'calculate' && Object.keys(r.overrides).length
          ? 'conditional'
          : 'known',
  };
}
