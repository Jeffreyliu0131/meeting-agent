/** Offline evidence rubric. This command never loads credentials or invokes a model. */
import { readFileSync, writeFileSync } from 'node:fs';
const fixtures = [
  'discussion-options',
  'execution-plan',
  'scenario-calculation',
  'bilingual-meeting',
];
const entries = fixtures.flatMap((name) => {
  const fixture = JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));
  return (fixture.turns ? [fixture] : (fixture.variants ?? fixture.cases ?? [])).map(
    (group: any) => ({
      fixture: name,
      variant: group.id ?? name,
      synthetic: true,
      sources: (group.turns ?? []).map((turn: any) => ({
        id: turn.id,
        rev: 1,
        text: turn.text,
        kind: turn.kind,
      })),
      expectedActions: group.expected ?? fixture.expected ?? [],
      humanAssessment: {
        evidenceRecall: null,
        correctVersion: null,
        objectIdentity: null,
        conditionPreservation: null,
        scopeSafety: null,
        clarificationUsefulness: null,
        expressionFaithfulness: null,
        notes: '',
        reviewer: null,
      },
      actualRun: null,
      status: 'not_run',
    }),
  );
});
writeFileSync(
  'tests/results/workflow-semantic-rubric.json',
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      realModelCalls: 0,
      semanticPasses: 0,
      policy:
        'Schema and synthetic transport success never imply semantic success. Record actual job IDs, source versions, proposals and human judgements before marking a case assessed.',
      entries,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Prepared ${entries.length} fixture groups; zero model calls, zero semantic passes.`);
