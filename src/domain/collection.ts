import { z } from 'zod';
import {
  MAX_COLLECTION_MEMBERS,
  Locale,
  type CollectionAlias,
  type CollectionReportRevision,
  type Meeting,
  type MeetingCollection,
  type Ref,
} from '../contracts/model';

/**
 * Browser-safe on purpose. This module is reachable from the renderer through
 * main.tsx, so it must not import node:crypto or domain/commands.ts - the
 * architecture test only greps the UI file's own text and would not catch it,
 * but Vite cannot bundle a node: builtin into the renderer.
 */
const uid = () => crypto.randomUUID();

const MemberIds = z
  .array(z.string().regex(/^[\w-]{1,100}$/))
  .min(1)
  .max(MAX_COLLECTION_MEMBERS);

export function createCollection(
  payload: Record<string, unknown>,
  preferences: { defaultOutputLocale: Locale },
): MeetingCollection {
  const p = z
    .object({
      title: z.string().trim().min(1).max(100),
      brief: z.string().max(600).default(''),
      meetingIds: MemberIds,
      outputLocale: Locale.optional(),
    })
    .parse(payload);
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: p.title,
    brief: p.brief,
    meetingIds: p.meetingIds,
    outputLocale: p.outputLocale ?? preferences.defaultOutputLocale,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    reports: [],
    calls: [],
    reportStatus: 'idle',
    reportError: null,
  };
}

/** Mutates the clone the service handed in, mirroring reduceMeeting. */
export function reduceCollection(
  collection: MeetingCollection,
  command: { type: string; payload: Record<string, unknown> },
  knownMeetingIds: Set<string>,
): void {
  const p = command.payload;
  switch (command.type) {
    case 'collectionUpdate': {
      if (p.baseRevision !== collection.revision) throw new Error('REV_CONFLICT');
      if (p.title !== undefined) collection.title = z.string().trim().min(1).max(100).parse(p.title);
      if (p.brief !== undefined) collection.brief = z.string().max(600).parse(p.brief);
      if (p.outputLocale !== undefined) collection.outputLocale = Locale.parse(p.outputLocale);
      break;
    }
    case 'collectionMembers': {
      const ids = MemberIds.parse(p.meetingIds);
      if (ids.some((id) => !knownMeetingIds.has(id)))
        throw new Error('COLLECTION_MEMBER_NOT_FOUND');
      collection.meetingIds = ids;
      break;
    }
    default:
      throw new Error('INVALID_COMMAND');
  }
  collection.revision++;
  collection.updatedAt = new Date().toISOString();
}

export type StaleReason =
  | { kind: 'member_set_changed' }
  | { kind: 'member_missing'; meetingId: string }
  | { kind: 'meeting_changed'; meetingId: string }
  | { kind: 'citation_superseded'; meetingId: string; alias: string; was: number; now: number };

/**
 * Pure and never persisted. A stored flag would be a second source of truth that
 * can drift, which is why artifact staleness is computed the same way.
 */
export function collectionReportStaleness(
  report: CollectionReportRevision,
  collection: MeetingCollection,
  meetings: Meeting[],
): StaleReason[] {
  const reasons: StaleReason[] = [];
  const members = new Set(collection.meetingIds);
  const reported = new Set(report.meetingIds);
  if (members.size !== reported.size || [...reported].some((id) => !members.has(id)))
    reasons.push({ kind: 'member_set_changed' });

  const byId = new Map(meetings.map((m) => [m.id, m]));
  for (const id of reported) {
    const m = byId.get(id);
    if (!m) {
      reasons.push({ kind: 'member_missing', meetingId: id });
      continue;
    }
    const watermark = report.watermarks.find((w) => w.meetingId === id);
    if (!watermark) continue;
    if (m.revision !== watermark.revision || m.languageRevision !== watermark.languageRevision)
      reasons.push({ kind: 'meeting_changed', meetingId: id });
  }

  // Per-citation precision, routed through the persisted aliasMap so aliases are
  // never compared across two different naming schemes.
  for (const ref of report.aliasRefs) {
    const m = byId.get(ref.meetingId);
    if (!m) continue;
    const now =
      ref.kind === 'source'
        ? m.segments.filter((s) => s.id === ref.id).at(-1)?.rev
        : ref.kind === 'object'
          ? m.objects.find((o) => o.id === ref.id)?.rev
          : m.relations.find((r) => r.id === ref.id)?.rev;
    if (now !== undefined && now !== ref.rev)
      reasons.push({
        kind: 'citation_superseded',
        meetingId: ref.meetingId,
        alias: ref.alias,
        was: ref.rev,
        now,
      });
  }
  return reasons;
}

export type CitationGroup = { meetingId: string; meetingTitle: string; refs: Ref[] };

/**
 * Turns the alias refs a rendered block carries back into per-meeting real refs.
 * Unknown aliases are dropped rather than thrown: this runs while rendering, and
 * a report written by an older build may cite an alias no longer in the map.
 */
export function groupCitations(
  refs: Ref[],
  report: { aliasMap: Record<string, CollectionAlias> },
  meetings: Meeting[],
): CitationGroup[] {
  const byId = new Map(meetings.map((m) => [m.id, m]));
  const groups = new Map<string, CitationGroup>();
  for (const ref of refs) {
    const alias = report.aliasMap[ref.id];
    if (!alias) continue;
    const meeting = byId.get(alias.meetingId);
    if (!meeting) continue;
    const group = groups.get(alias.meetingId) ?? {
      meetingId: alias.meetingId,
      meetingTitle: meeting.title,
      refs: [],
    };
    group.refs.push({ id: alias.id, rev: ref.rev });
    groups.set(alias.meetingId, group);
  }
  return [...groups.values()];
}
