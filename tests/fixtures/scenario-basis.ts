/** Synthetic data only: no audio, model calls, or real meeting content. */
import { createMeeting, reduceMeeting, uid } from '../../src/domain/commands';
import { defaults } from '../../src/service/store';
import { commitMeaning } from '../../src/domain/meaning';
import type { ArtifactRevision, Formula, Meeting } from '../../src/contracts/model';

export function scenarioFixture(): Meeting {
  const m = createMeeting(
    {
      title: 'Synthetic scenario basis',
      mode: 'manual',
      outputLocale: 'en',
      timezone: 'UTC',
    },
    defaults,
  );
  const ingest = (id: string, text: string) =>
    reduceMeeting(m, {
      id: uid(),
      meetingId: m.id,
      type: 'ingest',
      payload: { segmentId: id, text, kind: 'manual' },
    });
  ingest(
    'cost-source',
    'Synthetic: total = venue + people * food. Venue 150 SGD, food 12 SGD/person.',
  );
  ingest('condition-source', 'Synthetic: venue reservation is required.');
  const costSource = [{ id: 'cost-source', rev: 1 }];
  const conditionSource = [{ id: 'condition-source', rev: 1 }];
  commitMeaning(m, {
    focus: 'Synthetic cost',
    changes: [],
    action: 'no_change',
    artifact: null,
    rationale: 'Fixture only',
    objects: [
      {
        id: 'cost-object',
        kind: 'option',
        title: 'Cost option',
        detail: 'Synthetic option',
        sources: costSource,
        lifecycle: 'active',
        origin: 'stated',
        status: 'unverified',
      },
      {
        id: 'condition-object',
        kind: 'constraint',
        title: 'Reservation',
        detail: 'Reservation required',
        sources: conditionSource,
        lifecycle: 'active',
        origin: 'stated',
        status: 'unverified',
      },
    ],
    relations: [
      {
        id: 'dependency',
        from: 'cost-object',
        to: 'condition-object',
        kind: 'depends_on',
        sources: conditionSource,
        origin: 'stated',
      },
    ],
  });
  const formula: Formula = {
    id: 'cost',
    label: 'Synthetic cost',
    unit: 'SGD',
    parameters: [
      { id: 'venue', label: 'Venue', unit: 'SGD', value: 150, min: 0, max: 10000 },
      { id: 'people', label: 'People', unit: 'people', value: 30, min: 0, max: 1000 },
      { id: 'food', label: 'Food', unit: 'SGD/person', value: 12, min: 0, max: 1000 },
    ],
    steps: [
      { id: 'catering', op: 'multiply', left: 'people', right: 'food' },
      { id: 'total', op: 'add', left: 'venue', right: 'catering' },
    ],
    result: 'total',
    basis: m.segments[0].text,
    sources: costSource,
  };
  const a: ArtifactRevision = {
    id: 'cost-artifact',
    rev: 1,
    generation: 1,
    inputVersion: m.inputVersion,
    languageRevision: 1,
    locale: 'en',
    purposeKey: 'cost',
    question: 'Synthetic cost basis',
    summary: 'Synthetic only',
    layout: 'stack',
    objectIds: ['cost-object'],
    objectRefs: [{ id: 'cost-object', rev: 1 }],
    relationRefs: [{ id: 'dependency', rev: 1 }],
    sources: costSource,
    createdAt: new Date().toISOString(),
    formulas: [formula],
    blocks: [
      {
        id: 'body',
        type: 'text',
        title: 'Synthetic basis',
        items: ['Fixture only'],
        objectIds: ['cost-object'],
        sources: costSource,
        origin: 'stated',
        status: 'unverified',
      },
    ],
  };
  m.artifacts.push(a);
  reduceMeeting(m, {
    id: uid(),
    meetingId: m.id,
    type: 'scenario',
    payload: {
      artifactId: a.id,
      artifactRev: a.rev,
      formulaId: formula.id,
      values: { people: 40 },
    },
  });
  m.processedSources = Object.fromEntries(m.segments.map((s) => [s.id, s.rev]));
  m.understoodVersion = m.inputVersion;
  return m;
}
