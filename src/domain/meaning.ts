import type { Meeting, ObjectState, Proposal, Ref } from '../contracts/model';
import { validateRefs } from './evidence';

export function objectSources(o: ObjectState | Proposal['objects'][number]): Ref[] {
  return [
    ...o.sources,
    ...(o.meaning?.evidence.flatMap((e) => e.sources) ?? []),
    ...(o.meaning?.owner?.evidence.sources ?? []),
    ...(o.meaning?.deadline?.evidence.sources ?? []),
  ];
}

/** Literal evidence is checkable; whether it entails a claim still needs semantic evaluation. */
export function validateMeaning(p: Proposal, m: Meeting) {
  const all = new Map([...m.objects, ...p.objects].map((o) => [o.id, o]));
  for (const o of p.objects) {
    const meaning = o.meaning;
    if (meaning) {
      if (meaning.stance !== 'unknown' && !meaning.evidence.length)
        throw new Error('MEANING_EVIDENCE_REQUIRED');
      if (meaning.stance === 'conditional' && !meaning.conditionIds.length)
        throw new Error('CONDITION_REQUIRED');
      for (const condition of meaning.conditionIds) {
        const target = all.get(condition);
        if (condition === o.id || !target || target.kind !== 'constraint')
          throw new Error('INVALID_CONDITION');
      }
      const evidence = [
        ...meaning.evidence,
        ...[meaning.owner, meaning.deadline].flatMap((v) => (v ? [v.evidence] : [])),
      ];
      for (const e of evidence) {
        validateRefs(e.sources, m, true);
        if (
          !e.sources.some((r) =>
            m.segments.some((s) => s.id === r.id && s.rev === r.rev && s.text.includes(e.quote)),
          )
        )
          throw new Error('QUOTE_NOT_IN_SOURCE');
        if (
          m.contextScope !== 'personal' &&
          e.sources.some((r) => m.segments.some((s) => s.id === r.id && s.kind === 'request'))
        )
          throw new Error('PERSONAL_SOURCE_IN_MEETING');
      }
      for (const value of [meaning.owner, meaning.deadline])
        if (value && !value.evidence.quote.includes(value.value))
          throw new Error('VALUE_NOT_IN_QUOTE');
    }
    const previous = m.objects.find((x) => x.id === o.id);
    if (
      previous?.reviewRequired ||
      (previous?.meaning && JSON.stringify(previous.meaning) !== JSON.stringify(meaning))
    ) {
      // Legacy objects have no meaning/changeSources protocol; a newly cited source
      // is sufficient to recheck them, but repeating old evidence is not.
      const changes = o.changeSources ?? (previous?.meaning ? [] : o.sources);
      validateRefs(changes, m, true);
      if (
        !changes.some(
          (r) =>
            m.processedSources?.[r.id] !== r.rev &&
            m.segments.some(
              (s) =>
                s.id === r.id &&
                s.rev === r.rev &&
                (m.contextScope === 'personal' || s.kind !== 'request'),
            ),
        )
      )
        throw new Error('MEANING_CHANGE_REQUIRES_NEW_EVIDENCE');
    }
  }
}

export function dependencies(m: Meeting, id: string): string[] {
  const result = new Set(m.objects.find((o) => o.id === id)?.meaning?.conditionIds ?? []);
  for (const r of m.relations) {
    if (r.kind === 'conditions' && r.to === id) result.add(r.from);
    if (r.kind === 'depends_on' && r.from === id) result.add(r.to);
  }
  result.delete(id);
  return [...result];
}

export function refsCurrent(refs: Ref[], m: Meeting) {
  return refs.every(
    (r) =>
      m.segments.some((s) => s.id === r.id && s.rev === r.rev) &&
      !m.segments.some((s) => s.id === r.id && s.rev > r.rev),
  );
}

/** Host marks the transitive impact; it does not invent a replacement conclusion. */
export function refreshIntegrity(m: Meeting) {
  m.objectHistory ??= [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of m.objects) {
      const invalid =
        !refsCurrent(objectSources(o), m) ||
        (o.dependencyRefs ?? []).some((r) => {
          const dependency = m.objects.find((x) => x.id === r.id);
          return (
            !dependency ||
            dependency.rev !== r.rev ||
            dependency.reviewRequired ||
            dependency.lifecycle !== 'active'
          );
        });
      if (invalid && !o.reviewRequired) {
        m.objectHistory.push(structuredClone(o));
        o.reviewRequired = true;
        o.rev++;
        changed = true;
      }
    }
  }
}

export function commitMeaning(m: Meeting, p: Proposal) {
  m.objectHistory ??= [];
  const changedIds = new Set<string>();
  for (const o of p.objects) {
    const i = m.objects.findIndex((x) => x.id === o.id),
      previous = m.objects[i];
    const data = {
      ...o,
      sources: [...new Map(objectSources(o).map((r) => [r.id + ':' + r.rev, r])).values()],
      changeSources: o.changeSources ?? [],
    };
    const oldData = previous
      ? {
          ...previous,
          rev: undefined,
          dependencyRefs: undefined,
          reviewRequired: undefined,
          changeSources: previous.changeSources ?? [],
        }
      : null;
    const same = previous && JSON.stringify(oldData) === JSON.stringify(data);
    if (previous && (!same || previous.reviewRequired))
      m.objectHistory.push(structuredClone(previous));
    const value: ObjectState = {
      ...data,
      rev: (previous?.rev ?? 0) + (same && !previous.reviewRequired ? 0 : 1),
      reviewRequired: false,
    };
    if (i < 0) m.objects.push(value);
    else m.objects[i] = value;
    changedIds.add(o.id);
  }
  for (const r of p.relations) {
    const i = m.relations.findIndex((x) => x.id === r.id),
      previous = m.relations[i];
    const same = previous && JSON.stringify({ ...previous, rev: undefined }) === JSON.stringify(r);
    const value = { ...r, rev: (previous?.rev ?? 0) + (same ? 0 : 1) };
    if (i < 0) m.relations.push(value);
    else m.relations[i] = value;
  }
  for (const o of m.objects) {
    if (changedIds.has(o.id))
      o.dependencyRefs = dependencies(m, o.id).map((id) => ({
        id,
        rev: m.objects.find((x) => x.id === id)!.rev,
      }));
    else {
      // A newly attached condition must invalidate a previously unconditional projection.
      for (const id of dependencies(m, o.id))
        if (!o.dependencyRefs?.some((r) => r.id === id)) {
          o.dependencyRefs ??= [];
          o.dependencyRefs.push({ id, rev: 0 });
        }
    }
  }
  refreshIntegrity(m);
}
