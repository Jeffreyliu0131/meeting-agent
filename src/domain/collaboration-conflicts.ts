import type {
  CollaborationState,
  ConflictRecord,
  ResponseRecord,
} from '../contracts/collaboration';
import { currentResponses, findRound } from './collaboration';

/** An explicit report stays open until its author resolves it; accepting a revised task is separate. */
export function responseIssueResolved(s: CollaborationState, response: ResponseRecord): boolean {
  if (response.resolved) return true;
  if (!['object', 'reserve', 'disagree', 'suggest_change'].includes(response.response.kind))
    return false;
  const component = s.components.find((c) => c.id === response.componentId);
  const round = component && findRound(component);
  return !!(
    component &&
    round &&
    currentResponses(s, component, round).some(
      (current) =>
        current.actorId === response.actorId &&
        current.subject === response.subject &&
        ['accept', 'agree'].includes(current.response.kind),
    )
  );
}

/** Uses explicit exclusive intervals only; a due date never implies occupied time. */
export function detectCollaborationConflicts(s: CollaborationState): ConflictRecord[] {
  const draft = detect(s, 'draft');
  const published = detect(s, 'published');
  return [
    ...draft,
    ...published.filter((f) => !draft.some((d) => d.fingerprint === f.fingerprint)),
  ];
}
function detect(s: CollaborationState, scope: 'draft' | 'published'): ConflictRecord[] {
  const tasks = s.components.flatMap((c) => {
    const content = scope === 'draft' ? c.revisions.at(-1)?.content : findRound(c)?.content;
    return content?.kind === 'assignment' && c.draftState !== 'cancelled'
      ? content.payload.items.map((item) => ({ componentId: c.id, item }))
      : [];
  });
  const results: ConflictRecord[] = [];
  function add(type: ConflictRecord['type'], items: typeof tasks, summary: string) {
    const objectRefs = items.map(
      (t) => t.item.taskRef ?? { id: t.item.id, rev: t.item.itemRevision },
    );
    const fingerprint =
      scope +
      ':' +
      type +
      ':' +
      objectRefs
        .map((r) => r.id)
        .sort()
        .join(':');
    const old = s.conflicts.find((f) => f.fingerprint === fingerprint);
    const id = old?.id ?? crypto.randomUUID();
    results.push({
      id,
      scope,
      revision: old?.revision ?? 1,
      fingerprint,
      type,
      basis: 'rule',
      verification: 'supported',
      resolution: 'unresolved',
      summary,
      impact: '相关分工需要核对',
      objectRefs,
      evidence: [{ kind: 'rule_result', resultId: id }],
      affectedParticipantIds: [
        ...new Set(items.map((t) => t.item.assigneeId).filter((id): id is string => !!id)),
      ],
      componentIds: [...new Set(items.map((t) => t.componentId))],
      coverage: 'complete',
    });
  }
  for (let a = 0; a < tasks.length; a++)
    for (let b = a + 1; b < tasks.length; b++) {
      const x = tasks[a].item,
        y = tasks[b].item;
      if (
        !x.assigneeId ||
        x.assigneeId !== y.assigneeId ||
        (x.taskRef && x.taskRef.id === y.taskRef?.id)
      )
        continue;
      const t = x.schedule,
        u = y.schedule;
      if (
        t.precision !== 'interval' ||
        u.precision !== 'interval' ||
        !t.exclusive ||
        !u.exclusive ||
        !t.timezone ||
        !u.timezone ||
        !t.start ||
        !t.end ||
        !u.start ||
        !u.end
      )
        continue;
      if (Date.parse(t.start) < Date.parse(u.end) && Date.parse(u.start) < Date.parse(t.end))
        add('time_overlap', [tasks[a], tasks[b]], `${x.title} 与 ${y.title} 的独占时间重叠`);
    }
  const byId = new Map(tasks.map((t) => [t.item.taskRef?.id ?? t.item.id, t]));
  const emitted = new Set<string>();
  for (const t of tasks) {
    const path: string[] = [],
      visiting = new Set<string>();
    const visit = (key: string) => {
      if (visiting.has(key)) {
        const cycle = path.slice(path.indexOf(key)).sort();
        const signature = cycle.join(':');
        if (!emitted.has(signature)) {
          emitted.add(signature);
          add(
            'dependency_conflict',
            cycle.map((id) => byId.get(id)!),
            '任务之间存在循环依赖',
          );
        }
        return;
      }
      const current = byId.get(key);
      if (!current || path.length > 30) return;
      visiting.add(key);
      path.push(key);
      current.item.dependencyRefs.forEach((d) => visit(d.id));
      path.pop();
      visiting.delete(key);
    };
    visit(t.item.taskRef?.id ?? t.item.id);
  }
  for (const c of s.components) {
    const round = findRound(c);
    if (!round) continue;
    for (const r of c.rounds.flatMap((previous) => currentResponses(s, c, previous))) {
      if (
        r.resolved ||
        !['object', 'report_issue', 'reserve', 'disagree', 'suggest_change'].includes(
          r.response.kind,
        )
      )
        continue;
      if (responseIssueResolved(s, r)) continue;
      const fingerprint = `participant_objection:${c.id}:${r.actorId}:${r.subject}`;
      const old = s.conflicts.find((f) => f.fingerprint === fingerprint);
      results.push({
        id: old?.id ?? crypto.randomUUID(),
        revision: old?.revision ?? 1,
        fingerprint,
        type: 'participant_objection',
        basis: 'participant_reported',
        verification: 'supported',
        resolution: 'unresolved',
        summary: '参与者对当前安排提出异议',
        impact: '确认前需要回应这一异议',
        objectRefs: [],
        evidence: [{ kind: 'response', responseId: r.id, responseVersion: r.version }],
        affectedParticipantIds: [r.actorId],
        componentIds: [c.id],
        coverage: 'complete',
      });
    }
  }
  return results;
}
