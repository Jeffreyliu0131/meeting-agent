import type {
  CollectionAlias,
  CollectionOmitted,
  Locale,
  Meeting,
  MeetingCollection,
  ObjectState,
} from '../contracts/model';
import { classifyOpenItems } from './closeout';

/**
 * Deterministic projection of several meetings, for a consolidated report.
 *
 * Nothing here is inferred and no model is involved. Every quote comes from
 * ObjectState.meaning.evidence, which the host already verified is a literal
 * substring of a cited segment - so "traceable to the original words" is a
 * structural property, not a prompt hope. Object `detail` is never included.
 *
 * Browser-safe: this is also reachable from the renderer. No node: imports.
 */

export type DigestQuote = { alias: string; meetingAlias: string; text: string };
export type OpenReason = 'unresolved' | 'conditional' | 'incomplete_task' | 'review' | 'provisional';
export type DigestOpenItem = {
  alias: string;
  meetingAlias: string;
  meetingTitle: string;
  kind: ObjectState['kind'];
  title: string;
  status: ObjectState['status'];
  stance: string | null;
  owner: string | null;
  deadline: string | null;
  conditions: string[];
  reason: OpenReason[];
  quotes: DigestQuote[];
};
export type DigestDispute = {
  basis: 'disputed_status' | 'challenges_relation' | 'title_stance_divergence';
  label: string;
  positions: Array<{
    alias: string;
    meetingAlias: string;
    stance: string | null;
    status: ObjectState['status'];
    quote: string | null;
  }>;
};
export type DigestDecision = {
  alias: string;
  meetingAlias: string;
  meetingTitle: string;
  question: string;
  summary: string;
  basis: string;
  participants: string;
  sources: string[];
};
export type DigestMeeting = {
  alias: string;
  meetingId: string;
  label: string;
  date: string;
  state: string;
  gaps: number;
};
export type CollectionDigest = {
  collection: { title: string; brief: string; outputLocale: Locale };
  meetings: DigestMeeting[];
  decisions: DigestDecision[];
  open: DigestOpenItem[];
  disputes: DigestDispute[];
  omitted: CollectionOmitted;
  aliasMap: Record<string, CollectionAlias>;
  aliasRefs: CollectionAlias[];
  bytes: number;
};

type Aliaser = ReturnType<typeof createAliaser>;
/** Aliases are short because `id` is capped at 100 chars, and must not clash with `new_`. */
function createAliaser(collection: MeetingCollection, meetings: Meeting[]) {
  const meetingAlias = new Map<string, string>();
  collection.meetingIds.forEach((id, i) => meetingAlias.set(id, `M${i + 1}`));
  const aliasMap: Record<string, CollectionAlias> = {};
  const reverse = new Map<string, string>();
  const counters = { source: 0, object: 0, relation: 0, decision: 0 };
  const prefix = { source: 's', object: 'o', relation: 'r', decision: 'd' } as const;
  const known = new Set(meetings.map((m) => m.id));
  /** Assigns on first use, so the same input always yields the same aliases. */
  const alias = (
    meetingId: string,
    kind: CollectionAlias['kind'],
    id: string,
    rev: number,
  ): string | null => {
    if (!meetingAlias.has(meetingId) || !known.has(meetingId)) return null;
    const key = `${meetingId}|${kind}|${id}|${rev}`;
    const existing = reverse.get(key);
    if (existing) return existing;
    const next = `${prefix[kind]}${++counters[kind]}`;
    aliasMap[next] = {
      alias: next,
      meetingAlias: meetingAlias.get(meetingId)!,
      meetingId,
      kind,
      id,
      rev,
    };
    reverse.set(key, next);
    return next;
  };
  return { meetingAlias, aliasMap, alias };
}

/** Latest revision of a source id, matching the append-log folding used elsewhere. */
function headRev(m: Meeting, id: string): number {
  return m.segments.reduce((max, s) => (s.id === id && s.rev > max ? s.rev : max), 0);
}

const normalizeTitle = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

/**
 * Three deterministic rules. Each carries the basis so the UI can say WHY two
 * positions are shown side by side - "never adjudicate" needs a reason, not just
 * a pair of claims.
 */
function findDisputes(
  members: Meeting[],
  aliaser: Aliaser,
  quote: (m: Meeting, o: ObjectState) => string | null,
): DigestDispute[] {
  const disputes: DigestDispute[] = [];
  const position = (m: Meeting, o: ObjectState) => {
    const a = aliaser.alias(m.id, 'object', o.id, o.rev);
    return a
      ? {
          alias: a,
          meetingAlias: aliaser.meetingAlias.get(m.id)!,
          stance: o.meaning?.stance ?? null,
          status: o.status,
          quote: quote(m, o),
        }
      : null;
  };

  // Rule 1: explicitly disputed.
  for (const m of members)
    for (const o of m.objects) {
      if (o.lifecycle !== 'active' || o.status !== 'disputed') continue;
      const p = position(m, o);
      if (p) disputes.push({ basis: 'disputed_status', label: o.title, positions: [p] });
    }

  // Rule 2: connected components of `challenges` relations with two or more members.
  for (const m of members) {
    const edges = m.relations.filter((r) => r.kind === 'challenges');
    if (!edges.length) continue;
    const adjacency = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!adjacency.has(e.from)) adjacency.set(e.from, new Set());
      if (!adjacency.has(e.to)) adjacency.set(e.to, new Set());
      adjacency.get(e.from)!.add(e.to);
      adjacency.get(e.to)!.add(e.from);
    }
    const seen = new Set<string>();
    for (const start of adjacency.keys()) {
      if (seen.has(start)) continue;
      const component: string[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const id = stack.pop()!;
        component.push(id);
        for (const next of adjacency.get(id) ?? []) if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
      if (component.length < 2) continue;
      const positions = component
        .map((id) => m.objects.find((o) => o.id === id))
        .filter((o): o is ObjectState => !!o)
        .map((o) => position(m, o))
        .filter((p): p is NonNullable<typeof p> => !!p);
      if (positions.length >= 2)
        disputes.push({
          basis: 'challenges_relation',
          label: m.objects.find((o) => o.id === component[0])?.title ?? '',
          positions,
        });
    }
  }

  // Rule 3: the same topic across meetings whose stance has not converged. This is
  // what actually delivers cross-meeting tracking: proposed in M1, still proposed in M4.
  const byTitle = new Map<string, Array<{ m: Meeting; o: ObjectState }>>();
  for (const m of members)
    for (const o of m.objects) {
      if (o.lifecycle !== 'active' || o.kind === 'topic') continue;
      const key = normalizeTitle(o.title);
      if (!key) continue;
      const list = byTitle.get(key) ?? [];
      list.push({ m, o });
      byTitle.set(key, list);
    }
  for (const [, list] of byTitle) {
    const meetingIds = new Set(list.map((x) => x.m.id));
    if (meetingIds.size < 2) continue;
    const stances = new Set(list.map((x) => x.o.meaning?.stance ?? null));
    if (stances.size < 2) continue;
    if (![...stances].some((s) => s === 'proposed' || s === 'conditional' || s === null)) continue;
    const positions = list
      .map((x) => position(x.m, x.o))
      .filter((p): p is NonNullable<typeof p> => !!p);
    if (positions.length >= 2)
      disputes.push({ basis: 'title_stance_divergence', label: list[0].o.title, positions });
  }
  return disputes;
}

export function buildCollectionDigest(
  collection: MeetingCollection,
  meetings: Meeting[],
  maxBytes: number,
): CollectionDigest {
  const aliaser = createAliaser(collection, meetings);
  const members = collection.meetingIds
    .map((id) => meetings.find((m) => m.id === id))
    .filter((m): m is Meeting => !!m);

  const quoteOf = (m: Meeting, o: ObjectState): string | null => {
    const first = o.meaning?.evidence?.[0];
    return first ? first.quote : null;
  };

  const digest: CollectionDigest = {
    collection: {
      title: collection.title,
      brief: collection.brief,
      outputLocale: collection.outputLocale,
    },
    meetings: members.map((m) => ({
      alias: aliaser.meetingAlias.get(m.id)!,
      meetingId: m.id,
      label: m.title,
      date: m.createdAt,
      state: m.status === 'active' ? 'active' : (m.closeout?.state ?? 'ready'),
      gaps: m.inputGaps.length,
    })),
    decisions: [],
    open: [],
    disputes: [],
    omitted: { openItems: 0, meetings: 0, quotes: 0 },
    aliasMap: aliaser.aliasMap,
    aliasRefs: [],
    bytes: 0,
  };

  // Decisions are already recorded and evidence-checked; they are never synthesised.
  for (const m of members)
    for (const d of m.decisions) {
      if (d.scope !== 'meeting') continue;
      const a = aliaser.alias(m.id, 'decision', d.id, 1);
      if (!a) continue;
      digest.decisions.push({
        alias: a,
        meetingAlias: aliaser.meetingAlias.get(m.id)!,
        meetingTitle: m.title,
        question: d.artifact?.question ?? '',
        summary: d.artifact?.summary ?? '',
        basis: d.basis,
        participants: d.participants,
        sources: d.sources
          .map((r) => aliaser.alias(m.id, 'source', r.id, headRev(m, r.id) || r.rev))
          .filter((x): x is string => !!x),
      });
    }

  for (const m of members) {
    const classified = classifyOpenItems(m);
    const reasonFor = new Map<string, OpenReason[]>();
    const add = (id: string, reason: OpenReason) => {
      const list = reasonFor.get(id) ?? [];
      list.push(reason);
      reasonFor.set(id, list);
    };
    for (const id of classified.unresolvedObjectIds) add(id, 'unresolved');
    for (const id of classified.conditionalObjectIds) add(id, 'conditional');
    for (const id of classified.incompleteTaskIds) add(id, 'incomplete_task');
    for (const id of classified.reviewObjectIds) add(id, 'review');
    for (const id of classified.provisionalObjectIds) add(id, 'provisional');
    for (const [id, reason] of reasonFor) {
      const o = m.objects.find((x) => x.id === id);
      if (!o) continue;
      const a = aliaser.alias(m.id, 'object', o.id, o.rev);
      if (!a) continue;
      const quote = quoteOf(m, o);
      const quoteAlias = o.meaning?.evidence?.[0]?.sources?.[0];
      const q = quoteAlias
        ? aliaser.alias(m.id, 'source', quoteAlias.id, headRev(m, quoteAlias.id) || quoteAlias.rev)
        : null;
      digest.open.push({
        alias: a,
        meetingAlias: aliaser.meetingAlias.get(m.id)!,
        meetingTitle: m.title,
        kind: o.kind,
        title: o.title,
        status: o.status,
        stance: o.meaning?.stance ?? null,
        owner: o.meaning?.owner?.value ?? null,
        deadline: o.meaning?.deadline?.value ?? null,
        conditions: o.meaning?.conditionIds ?? [],
        reason,
        quotes: quote && q ? [{ alias: q, meetingAlias: aliaser.meetingAlias.get(m.id)!, text: quote }] : [],
      });
    }
  }

  digest.disputes = findDisputes(members, aliaser, quoteOf);

  // TextEncoder, not Buffer: this module is also bundled into the renderer.
  const size = () =>
    new TextEncoder().encode(
      JSON.stringify({ ...digest, bytes: 0, aliasMap: {}, aliasRefs: [] }),
    ).length;
  const trimQuotes = (limit: number | null) => {
    for (const item of digest.open) {
      if (limit === null) {
        digest.omitted.quotes += item.quotes.length;
        item.quotes = [];
        continue;
      }
      for (const q of item.quotes) {
        if (q.text.length > limit) {
          q.text = q.text.slice(0, limit);
          digest.omitted.quotes++;
        }
      }
      if (item.quotes.length > 1) {
        digest.omitted.quotes += item.quotes.length - 1;
        item.quotes = item.quotes.slice(0, 1);
      }
    }
  };
  const dropOpen = (predicate: (i: DigestOpenItem) => boolean) => {
    const kept = digest.open.filter((i) => !predicate(i));
    digest.omitted.openItems += digest.open.length - kept.length;
    digest.open = kept;
  };
  const dropLastMeeting = () => {
    const last = digest.meetings.at(-1);
    if (!last) return;
    digest.meetings = digest.meetings.slice(0, -1);
    const gone = new Set(
      Object.values(aliaser.aliasMap)
        .filter((a) => a.meetingId === last.meetingId)
        .map((a) => a.alias),
    );
    dropOpen((i) => gone.has(i.alias));
    digest.decisions = digest.decisions.filter((d) => !gone.has(d.alias));
    // A dispute with a whole side missing would misrepresent the disagreement, so
    // a partially visible dispute is dropped entirely rather than shown one-sided.
    const dropped = digest.disputes.filter((d) => d.positions.some((p) => gone.has(p.alias)));
    digest.disputes = digest.disputes.filter((d) => !d.positions.some((p) => gone.has(p.alias)));
    if (dropped.length) digest.omitted.openItems += dropped.length;
    digest.omitted.meetings++;
  };

  // Ordered least-destructive first. Disputes keep their positions throughout:
  // dropping one side of a disagreement would be worse than a shorter report.
  const cascade: Array<() => void> = [
    () => trimQuotes(160),
    () => trimQuotes(100),
    () => {
      for (const d of digest.decisions) d.participants = '';
    },
    () => {
      for (const d of digest.decisions) d.basis = '';
    },
    () => trimQuotes(null),
    () => dropOpen((i) => i.reason.length === 1 && i.reason[0] === 'provisional'),
    () => dropOpen((i) => i.reason.length === 1 && i.reason[0] === 'unresolved'),
    () => dropOpen((i) => i.reason.length === 1 && i.reason[0] === 'review'),
    dropLastMeeting,
  ];
  for (const step of cascade) {
    if (size() <= maxBytes) break;
    step();
  }
  if (size() > maxBytes) throw new Error('COLLECTION_CONTEXT_TOO_LARGE');

  // Keep only aliases the digest actually cites; otherwise a 5-meeting collection
  // would persist an alias row for every object it ever looked at.
  const used = new Set<string>();
  for (const d of digest.decisions) {
    used.add(d.alias);
    for (const s of d.sources) used.add(s);
  }
  for (const i of digest.open) {
    used.add(i.alias);
    for (const q of i.quotes) used.add(q.alias);
  }
  for (const d of digest.disputes) for (const p of d.positions) used.add(p.alias);
  digest.aliasRefs = Object.values(aliaser.aliasMap).filter((a) => used.has(a.alias));
  digest.aliasMap = Object.fromEntries(digest.aliasRefs.map((a) => [a.alias, a]));
  digest.bytes = size();
  return digest;
}
