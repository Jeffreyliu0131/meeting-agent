import type { Formula, Meeting, Ref, Scenario } from '../contracts/model';
import { objectSources } from './meaning';

export type ScenarioBasisStatus = 'unchanged' | 'changed' | 'unknown';

// Labels/layout may change without changing a saved calculation.
function calculationBasis(formula: Formula) {
  return JSON.stringify({
    unit: formula.unit,
    basis: formula.basis,
    parameters: formula.parameters
      .map(({ id, unit, value, min, max }) => ({ id, unit, value, min, max }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    steps: formula.steps,
    result: formula.result,
  });
}

/** Read-only check against the saved artifact's dependencies; new input alone is irrelevant.
 * "unchanged" means no recorded dependency changed, not that the meeting was fully understood.
 */
export function scenarioBasisStatus(scenario: Scenario, meeting: Meeting): ScenarioBasisStatus {
  let status: ScenarioBasisStatus = 'unchanged';
  const missing = () => {
    if (status !== 'changed') status = 'unknown';
  };
  const changed = () => {
    status = 'changed';
  };
  const sources = (refs: Ref[]) => {
    for (const ref of refs) {
      const versions = meeting.segments.filter((s) => s.id === ref.id);
      if (versions.some((s) => s.rev > ref.rev)) changed();
      else if (!versions.some((s) => s.rev === ref.rev)) missing();
    }
  };
  if (!scenario.formula.sources.length) missing();
  sources(scenario.formula.sources);
  const base = meeting.artifacts.find(
    (a) => a.id === scenario.artifactId && a.rev === scenario.artifactRev,
  );
  if (!base) {
    missing();
    return status;
  }
  if (!base.formulas.some((f) => f.id === scenario.formula.id)) missing();
  const revisions = meeting.artifacts.filter(
    (a) =>
      a.id === base.id &&
      (a.scope ?? 'meeting') === (base.scope ?? 'meeting') &&
      a.branchId === base.branchId,
  );
  const latest = revisions.reduce((a, b) => (a.rev > b.rev ? a : b));
  const formula = latest.formulas.find((f) => f.id === scenario.formula.id);
  if (!formula || calculationBasis(formula) !== calculationBasis(scenario.formula)) changed();
  if (formula) sources(formula.sources);

  const visited = new Set<string>();
  const objects = (refs: Ref[]) => {
    for (const ref of refs) {
      const key = ref.id + ':' + ref.rev;
      if (visited.has(key)) continue;
      visited.add(key);
      const current = meeting.objects.find((o) => o.id === ref.id);
      if (!current) {
        missing();
        continue;
      }
      if (current.rev !== ref.rev || current.reviewRequired || current.lifecycle !== 'active') {
        changed();
        continue;
      }
      sources(objectSources(current));
      objects(current.dependencyRefs ?? []);
    }
  };
  objects(base.objectRefs);
  for (const ref of base.relationRefs ?? []) {
    const relation = meeting.relations.find((r) => r.id === ref.id);
    if (!relation) missing();
    else if (relation.rev !== ref.rev) changed();
    else sources(relation.sources);
  }
  return status;
}
