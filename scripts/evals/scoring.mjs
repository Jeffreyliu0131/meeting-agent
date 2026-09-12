/** Missing evidence is never a pass. All rates carry their denominator. */
export const ratio = (numerator, denominator) => ({
  numerator,
  denominator,
  value: denominator ? numerator / denominator : null,
});
export function quantile(values, q = 0.95) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  return clean.length ? clean[Math.max(0, Math.ceil(q * clean.length) - 1)] : null;
}
export function classification(rows, project = (x) => x) {
  const labels = [
    ...new Set(rows.flatMap((r) => [...r.expected, ...(r.actual ?? [])]).map(project)),
  ].sort();
  const byClass = labels.map((label) => {
    let tp = 0,
      fp = 0,
      fn = 0,
      support = 0;
    for (const row of rows) {
      const expected = new Set(row.expected.map(project));
      const actual = new Set((row.actual ?? []).map(project));
      if (expected.has(label)) support++;
      if (expected.has(label) && actual.has(label)) tp++;
      else if (expected.has(label)) fn++;
      else if (actual.has(label)) fp++;
    }
    return {
      label,
      support,
      tp,
      fp,
      fn,
      precision: ratio(tp, tp + fp),
      recall: ratio(tp, tp + fn),
      f1: ratio(2 * tp, 2 * tp + fp + fn).value,
    };
  });
  const scored = byClass.filter((x) => x.f1 !== null);
  return {
    samples: rows.length,
    completed: rows.filter((x) => x.actual !== null).length,
    byClass,
    macroF1: scored.length ? scored.reduce((s, r) => s + r.f1, 0) / scored.length : null,
  };
}
export function intentLabels(intents = []) {
  const labels = intents
    .filter(
      (x) =>
        !['negated', 'hypothetical', 'quoted'].includes(x.expression) &&
        x.resolution !== 'no_action',
    )
    .map((x) => `${x.family}/${x.operation}`);
  return [...new Set(labels.length ? labels : ['none'])].sort();
}
export function validateCorpus(corpus) {
  const errors = [],
    ids = new Set(),
    events = new Set(corpus.events.map((e) => e.id));
  for (const c of corpus.cases) {
    if (ids.has(c.id)) errors.push(`duplicate case ${c.id}`);
    ids.add(c.id);
    const labels = c.expected.finalIntentLabels;
    const families = ['poll', 'assignment', 'conflict', 'decision_confirmation'];
    const operations = ['prepare', 'update', 'preview', 'publish', 'close', 'cancel'];
    if (
      labels.some(
        (label) =>
          label !== 'none' &&
          (!families.includes(label.split('/')[0]) || !operations.includes(label.split('/')[1])),
      )
    )
      errors.push(`unknown intent label ${c.id}`);
    if (!events.has(c.eventId)) errors.push(`unknown event ${c.eventId}`);
    if (c.synthetic !== true || c.turns.length < 2)
      errors.push(`invalid multi-turn synthetic case ${c.id}`);
    if (!c.expected.finalIntentLabels.length || !c.expected.checks.length)
      errors.push(`missing expectations ${c.id}`);
    if (new Set(c.turns.map((t) => t.id)).size !== c.turns.length)
      errors.push(`duplicate sources ${c.id}`);
  }
  for (const event of corpus.events)
    for (const id of event.caseIds) if (!ids.has(id)) errors.push(`missing case ${id}`);
  if (
    corpus.cases.length < 60 ||
    corpus.cases.filter((x) => x.language === 'zh-CN').length < 40 ||
    corpus.cases.filter((x) => x.language !== 'zh-CN').length < 20
  )
    errors.push('minimum corpus language/sample requirement');
  return errors;
}
export function reviewStatus(review, expectedRunHash, caseIds) {
  if (!review) return { status: 'review_required', reason: 'No independent human review' };
  if (review.runHash !== expectedRunHash || !review.reviewer?.trim())
    return { status: 'failed', reason: 'Review must identify reviewer and exact run hash' };
  const entries = review.entries ?? [],
    ids = entries.map((x) => x.id);
  if (
    new Set(ids).size !== ids.length ||
    ids.length !== caseIds.length ||
    caseIds.some((id) => !ids.includes(id))
  )
    return { status: 'failed', reason: 'Review must cover every case exactly once' };
  if (entries.some((e) => !e.evidence?.length || !['pass', 'fail'].includes(e.verdict)))
    return { status: 'review_required', reason: 'Unassessed cases or missing evidence' };
  return {
    status: entries.some((e) => e.verdict === 'fail') ? 'failed' : 'passed',
    reviewed: entries.length,
  };
}
export function releaseGate(checks) {
  const failed = checks.filter((x) => x.status === 'failed');
  const incomplete = checks.filter((x) => x.status !== 'passed' && x.status !== 'failed');
  return {
    status: failed.length ? 'failed' : incomplete.length || !checks.length ? 'blocked' : 'passed',
    ready: checks.length > 0 && failed.length === 0 && incomplete.length === 0,
    failed: failed.map((x) => x.id),
    missing: incomplete.map((x) => x.id),
  };
}
