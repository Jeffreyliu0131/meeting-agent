import { z } from 'zod';
import type { Meeting, Ref } from '../contracts/model';
import { ComponentContent, emptyContent, type EvidenceRef } from '../contracts/collaboration';
import { createCollaboration, applyCollaborationCommand, saveDraft } from './collaboration';

/** Explicit host action: private preparation becomes a preview, never a published round. */
export function promoteIntent(
  m: Meeting,
  payload: Record<string, unknown>,
  commandId: string,
): string {
  const p = z
    .object({ draftId: z.string(), expectedRevision: z.number().int().positive() })
    .strict()
    .parse(payload);
  if (m.status !== 'active') throw Error('MEETING_ENDED');
  const state = m.intentPreparation;
  if (!state?.enabled) throw Error('COLLABORATION_DISABLED');
  const d = state.drafts.find((d) => d.id === p.draftId);
  if (!d || d.rev !== p.expectedRevision) throw Error('INTENT_TARGET_STALE');
  if (
    !['draft', 'suggestion'].includes(d.status) ||
    !d.content ||
    !['prepare', 'update', 'propose_resolution'].includes(d.candidate.operation)
  )
    throw Error('INTENT_NOT_READY');
  if (
    d.needsReview ||
    d.sources.some(
      (r) =>
        !m.segments.some(
          (s) =>
            s.id === r.id && s.rev === r.rev && s.kind !== 'request' && s.finality !== 'partial',
        ) || m.segments.some((s) => s.id === r.id && s.rev > r.rev),
    )
  )
    throw Error('DEPENDENCY_STALE');
  if (
    d.candidate.referencedObjects.some(
      (r) => !m.objects.some((o) => o.id === r.id && o.rev === r.rev),
    )
  )
    throw Error('DEPENDENCY_STALE');
  m.collaboration ??= createCollaboration(
    m.id,
    m.outputLocale === 'zh-CN'
      ? ['参与者A', '参与者B', '参与者C']
      : ['Participant A', 'Participant B', 'Participant C'],
  );
  const s = m.collaboration,
    host = s.participants.find((p) => p.role === 'host')!;
  const existing = d.promotedComponentId
    ? s.components.find((c) => c.id === d.promotedComponentId)
    : undefined;
  if (existing && d.promotedIntentRevision === d.rev) return existing.id;
  if (existing && existing.draftRevision !== d.promotedDraftRevision)
    throw Error('COMPONENT_EDITED');
  const evidence = (refs: Ref[]): EvidenceRef[] => refs.map((ref) => ({ kind: 'segment', ref }));
  const input = d.content;
  let content = emptyContent(input.kind);
  if (input.kind === 'poll' && content.kind === 'poll') {
    content.payload.question = input.question;
    content.payload.options = input.options.map((o) => ({
      id: o.key,
      label: o.label,
      description: '',
      objectRefs: [],
    }));
    content.payload.selection = {
      mode: input.selection === 'single' ? 'single' : 'multiple',
      min: 1,
      max: input.selection === 'single' ? 1 : Math.max(1, input.options.length),
    };
  } else if (input.kind === 'assignment' && content.kind === 'assignment') {
    content.payload.items = input.items.map((t) => ({
      id: t.key,
      itemRevision: 1,
      taskRef: null,
      title: t.task,
      deliverable: t.deliverable,
      assigneeId: null,
      unresolvedAssigneeText: t.owner,
      collaboratorIds: [],
      schedule: {
        rawText: t.time ?? '',
        timezone: null,
        start: null,
        end: null,
        dueDate: null,
        dueAt: null,
        exclusive: null,
        precision: 'unknown',
      },
      dependencyRefs: t.dependencies,
      discussionPoints: [],
      conflictIds: [],
    }));
  } else if (input.kind === 'conflict' && content.kind === 'conflict') {
    const id = 'intent-' + d.id;
    let conflict = s.conflicts.find((f) => f.id === id);
    if (!conflict) {
      conflict = {
        id,
        revision: 1,
        fingerprint: id,
        type: 'constraint_violation',
        basis: 'agent_inferred',
        verification: 'needs_confirmation',
        resolution: 'unresolved',
        summary: input.summary,
        impact: '',
        objectRefs: d.candidate.referencedObjects,
        evidence: evidence(d.sources),
        affectedParticipantIds: [],
        componentIds: [],
        coverage: 'partial',
      };
      s.conflicts.push(conflict);
    } else {
      conflict.revision++;
      conflict.summary = input.summary;
      conflict.evidence = evidence(d.sources);
      conflict.objectRefs = d.candidate.referencedObjects;
      conflict.resolution = 'unresolved';
    }
    content.payload = {
      conflictRefs: [{ id, rev: conflict.revision }],
      sides: input.sides.map((t) => ({
        id: t.key,
        title: t.description,
        description: t.description,
        objectRefs: [],
        evidence: evidence(t.sources),
      })),
      questions: input.questions.map((text, i) => ({
        id: 'question-' + i,
        text,
        participantIds: [],
      })),
      resolutions: input.resolutions.map((title, i) => ({
        id: 'resolution-' + i,
        title,
        tradeoffs: '',
        actions: [],
      })),
    };
  } else if (input.kind === 'decision_confirmation' && content.kind === 'decision_confirmation') {
    content.payload.statement = input.statement;
    content.payload.scopeText = input.scopeText;
    content.payload.conditions = input.conditions.map((text, i) => ({
      id: 'condition-' + i,
      text,
      objectRefs: [],
      evidence: evidence(d.sources),
    }));
    content.payload.targetObjectRefs = d.candidate.referencedObjects;
  }
  content = ComponentContent.parse(content);
  const sourceRefs: EvidenceRef[] = [...evidence(d.sources), { kind: 'command', commandId }];
  let id: string;
  if (existing) {
    saveDraft(s, existing, content, host.id, sourceRefs, true);
    id = existing.id;
  } else
    id = applyCollaborationCommand(s, host.id, {
      id: commandId,
      meetingId: m.id,
      type: 'component.prepare',
      payload: { content, sourceRefs },
    }) as string;
  const component = s.components.find((c) => c.id === id)!;
  component.revisions.at(-1)!.objectRefs = d.candidate.referencedObjects;
  d.promotedComponentId = id;
  d.promotedDraftRevision = component.draftRevision;
  d.promotedIntentRevision = d.rev;
  state.revision++;
  return id;
}
