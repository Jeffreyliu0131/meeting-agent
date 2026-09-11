import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../../src/service/store';
import { SessionService } from '../../src/service/session';
import { uid } from '../../src/domain/commands';
import { calculate } from '../../src/domain/calculator';
import { safeMarkup, validateArtifact } from '../../src/renderers/validate';
import { Proposal, type Meeting, type Formula, type Artifact } from '../../src/contracts/model';
import type { ModelPort, ProviderConfig } from '../../src/agent/provider';
import { extra } from '../../src/ui/i18n';
const config: ProviderConfig = {
  key: '',
  base: 'https://api.openai.com/v1',
  model: 'test-double',
  sttKey: '',
  sttBase: 'https://api.openai.com/v1',
  sttModel: 'test-double',
  format: 'json_schema',
};
function proposal(m: Meeting): Proposal {
  const s = m.segments.at(-1)!,
    sources = [{ id: s.id, rev: s.rev }];
  return {
    focus: 'Synthetic protocol test',
    changes: ['Test update'],
    objects: [
      {
        id: 'topic',
        kind: 'topic',
        title: 'Protocol test',
        detail: s.text,
        origin: 'stated',
        status: 'unverified',
        sources,
        lifecycle: 'active',
      },
    ],
    relations: [],
    action: 'patch_artifact',
    artifact: {
      id: 'work',
      purposeKey: 'protocol',
      question: 'Protocol test only',
      summary: 'Not a model result',
      layout: 'stack',
      objectIds: ['topic'],
      sources,
      blocks: [
        {
          id: 'body',
          type: 'text',
          title: 'Test content',
          items: [s.text],
          sources,
          objectIds: ['topic'],
          origin: 'stated',
          status: 'unverified',
        },
      ],
      formulas: [],
    },
    rationale: 'Deterministic test double, not semantic evaluation',
  };
}
const fake: ModelPort = {
  interpret: async (m) => ({ proposal: proposal(m), inputTokens: 0, outputTokens: 0 }),
};
function setup(model: ModelPort = fake) {
  const path = mkdtempSync(join(tmpdir(), 'meeting-unit-'));
  const store = new SQLiteStore(join(path, 'test.sqlite'));
  const service = new SessionService(store, model, config);
  const create = () =>
    service.command({
      id: uid(),
      meetingId: null,
      type: 'create',
      payload: {
        title: 'Synthetic test',
        mode: 'manual',
        outputLocale: 'en',
        timezone: 'Asia/Singapore',
      },
    }) as string;
  const command = (id: string, type: string, payload: any = {}, commandId = uid()) =>
    service.command({ id: commandId, meetingId: id, type, payload });
  return {
    service,
    store,
    path,
    create,
    command,
    close: () => {
      service.close();
      rmSync(path, { recursive: true, force: true });
    },
  };
}
test('isolates events, saves immutable source revisions, never restores capture', async () => {
  const x = setup();
  try {
    const id = x.create();
    x.command(id, 'ingest', { text: 'First statement', kind: 'manual', segmentId: 's1' });
    await x.service.process(id);
    x.command(id, 'correct', {
      segmentId: 's1',
      baseRevision: 1,
      text: 'Corrected statement',
      speaker: null,
    });
    await x.service.process(id);
    const m = x.service.snapshot().meetings[0];
    assert.equal(m.segments.length, 2);
    assert.equal(m.artifacts.length, 2);
    assert.equal(m.artifacts[0].id, m.artifacts[1].id);
    assert.equal(m.artifacts[0].blocks[0].type, 'text');
    assert.equal(m.segments[0].text, 'First statement');
    x.command(id, 'end');
    assert.throws(
      () => x.command(id, 'ingest', { text: 'too late', kind: 'manual' }),
      /MEETING_ENDED/,
    );
    const b = x.create();
    assert.equal(x.service.snapshot().meetings.find((m) => m.id === b)!.segments.length, 0);
    x.service.close();
    const resumed = new SessionService(new SQLiteStore(join(x.path, 'test.sqlite')), fake, config);
    assert.equal(resumed.snapshot().meetings[0].capture, 'paused');
    assert.equal(resumed.snapshot().meetings[1].status, 'ended');
    resumed.close();
  } finally {
    rmSync(x.path, { recursive: true, force: true });
  }
});
test('idempotency binds IDs to payloads and source events', () => {
  const x = setup();
  try {
    const id = x.create(),
      cmd = uid(),
      payload = { text: 'a', kind: 'manual', segmentId: 's' };
    x.command(id, 'ingest', payload, cmd);
    x.command(id, 'ingest', payload, cmd);
    x.command(id, 'ingest', payload);
    assert.equal(x.service.meetings[0].segments.length, 1);
    assert.throws(
      () => x.command(id, 'ingest', { ...payload, text: 'b' }, cmd),
      /IDEMPOTENCY_CONFLICT/,
    );
    assert.throws(() => x.command(id, 'ingest', { ...payload, text: 'b' }), /IDEMPOTENCY_CONFLICT/);
  } finally {
    x.close();
  }
});
test('late model result cannot overwrite a correction or new output locale', async () => {
  let resolve!: (v: any) => void;
  const x = setup({
    interpret: (m) =>
      new Promise((r) => {
        resolve = () => r({ proposal: proposal(m), inputTokens: 0, outputTokens: 0 });
      }),
  });
  try {
    const id = x.create();
    x.command(id, 'ingest', { text: 'old', kind: 'manual', segmentId: 's' });
    const work = x.service.process(id);
    x.command(id, 'correct', { segmentId: 's', baseRevision: 1, text: 'new', speaker: null });
    x.command(id, 'language', { locale: 'zh-CN' });
    resolve({});
    await work;
    assert.equal(x.service.meetings[0].artifacts.length, 0);
    assert.equal(x.service.meetings[0].outputLocale, 'zh-CN');
  } finally {
    x.close();
  }
});
test('no_change advances received understanding without a new artifact', async () => {
  let count = 0;
  const x = setup({
    interpret: async (m) => {
      const p = proposal(m);
      if (count++) {
        p.action = 'no_change';
        p.artifact = null;
        p.changes = [];
      }
      return { proposal: p, inputTokens: 0, outputTokens: 0 };
    },
  });
  try {
    const id = x.create();
    x.command(id, 'ingest', { text: 'one', kind: 'manual' });
    await x.service.process(id);
    x.command(id, 'ingest', { text: 'paraphrase', kind: 'manual' });
    await x.service.process(id);
    assert.equal(x.service.meetings[0].artifacts.length, 1);
    assert.equal(x.service.meetings[0].understoodVersion, 2);
  } finally {
    x.close();
  }
});
test('model failure preserves original source and existing artifacts', async () => {
  let fail = false;
  const x = setup({
    interpret: async (m) => {
      if (fail) throw new Error('MODEL_UNAVAILABLE');
      return { proposal: proposal(m), inputTokens: 0, outputTokens: 0 };
    },
  });
  try {
    const id = x.create();
    x.command(id, 'ingest', { text: 'good', kind: 'manual' });
    await x.service.process(id);
    fail = true;
    x.command(id, 'ingest', { text: 'pending', kind: 'manual' });
    await x.service.process(id);
    assert.equal(x.service.meetings[0].processing, 'error');
    assert.equal(x.service.meetings[0].artifacts.length, 1);
    assert.equal(x.service.meetings[0].segments.length, 2);
  } finally {
    x.close();
  }
});
test('render failure still commits understanding, keeps previous artifact', async () => {
  let bad = false;
  const x = setup({
    interpret: async (m) => {
      const p = proposal(m);
      if (bad)
        p.artifact!.blocks = [
          {
            id: 'unsafe',
            title: 'Invalid test content',
            sources: p.artifact!.sources,
            objectIds: ['topic'],
            origin: 'agent_inferred',
            status: 'unverified',
            type: 'html',
            markup: '<script>while(true){}</script>',
          },
        ];
      return { proposal: p, inputTokens: 0, outputTokens: 0 };
    },
  });
  try {
    const id = x.create();
    x.command(id, 'ingest', { text: 'good', kind: 'manual' });
    await x.service.process(id);
    bad = true;
    x.command(id, 'ingest', { text: 'new', kind: 'manual' });
    await x.service.process(id);
    assert.equal(x.service.meetings[0].artifacts.length, 1);
    assert.equal(x.service.meetings[0].understoodVersion, 2);
    assert.equal(x.service.meetings[0].error, 'INVALID_ARTIFACT');
  } finally {
    x.close();
  }
});
const formula: Formula = {
  id: 'cost',
  label: 'Total',
  unit: 'SGD',
  parameters: [
    { id: 'venue', label: 'Venue', unit: 'SGD', value: 150, min: 0, max: 10000 },
    { id: 'people', label: 'People', unit: 'people', value: 30, min: 0, max: 1000 },
    { id: 'food', label: 'Per person', unit: 'SGD/person', value: 12, min: 0, max: 1000 },
  ],
  steps: [
    { id: 'catering', op: 'multiply', left: 'people', right: 'food' },
    { id: 'total', op: 'add', left: 'venue', right: 'catering' },
  ],
  result: 'total',
  basis: 'Explicit total = venue + people × food',
  sources: [],
};
test('decimal arithmetic, unknown inputs, bounds and formula validation', () => {
  assert.equal(calculate(formula), '510');
  assert.equal(calculate(formula, { people: 40 }), '630');
  assert.equal(calculate(formula, { people: 35 }), '570');
  assert.equal(calculate(formula, { venue: 180 }), '540');
  assert.equal(calculate(formula, { food: null }), null);
  assert.throws(() => calculate(formula, { people: -1 }), /INVALID_PARAMETER/);
  assert.throws(() => calculate(formula, { unexpected: 1 }), /UNKNOWN_PARAMETER/);
  assert.equal(
    calculate({
      ...formula,
      parameters: formula.parameters.map((p) => ({
        ...p,
        value: p.id === 'venue' ? 0.1 : p.id === 'food' ? 0.2 : 1,
      })),
    }),
    '0.3',
  );
  assert.throws(
    () =>
      calculate(
        {
          ...formula,
          steps: [{ id: 'r', op: 'divide', left: 'venue', right: 'people' }],
          result: 'r',
        },
        { people: 0 },
      ),
    /DIVISION_BY_ZERO/,
  );
});
test('personal scenarios and decisions cannot become meeting consensus', async () => {
  const x = setup({
    interpret: async (m) => {
      const p = proposal(m);
      p.artifact!.formulas = [{ ...formula, sources: p.artifact!.sources }];
      return { proposal: p, inputTokens: 0, outputTokens: 0 };
    },
  });
  try {
    const id = x.create();
    x.command(id, 'ingest', { text: 'Explicit relation', kind: 'manual', segmentId: 'source' });
    await x.service.process(id);
    x.command(id, 'scenario', {
      artifactId: 'work',
      artifactRev: 1,
      formulaId: 'cost',
      values: { people: 40 },
    });
    const m = x.service.meetings[0];
    assert.equal(m.scenarios[0].result, '630');
    assert.equal(m.artifacts[0].formulas[0].parameters[1].value, 30);
    x.command(id, 'decision', {
      scope: 'personal',
      artifactId: 'work',
      artifactRev: 1,
      basis: 'My working preference',
      sourceIds: [],
    });
    assert.equal(x.service.meetings[0].decisions[0].scope, 'personal');
    assert.throws(
      () =>
        x.command(id, 'decision', {
          scope: 'meeting',
          artifactId: 'work',
          artifactRev: 1,
          basis: 'agreed',
          participants: '',
          sourceIds: [],
        }),
      /DECISION_SCOPE_REQUIRED/,
    );
    x.command(id, 'ingest', { text: 'New basis', kind: 'manual' });
    assert.equal(x.service.meetings[0].scenarios[0].baseInputVersion, 1);
  } finally {
    x.close();
  }
});
test('capture epochs and identity remain explicit', () => {
  const x = setup();
  try {
    const id = x.service.command({
      id: uid(),
      meetingId: null,
      type: 'create',
      payload: { title: 'audio', mode: 'online', outputLocale: 'en', timezone: 'UTC' },
    }) as string;
    x.command(id, 'captureStart');
    const epoch = x.service.meetings[0].epoch;
    x.command(id, 'captureReady', { epoch });
    x.command(id, 'ingest', {
      text: 'actual transcript input contract test',
      kind: 'system_audio',
      epoch,
    });
    assert.equal(x.service.meetings[0].segments[0].identity, 'unknown');
    x.command(id, 'pause');
    assert.throws(
      () => x.command(id, 'ingest', { text: 'late', kind: 'system_audio', epoch }),
      /CAPTURE_EXPIRED/,
    );
  } finally {
    x.close();
  }
});
test('unsafe generated content is rejected; passive content survives', () => {
  for (const bad of [
    '<script>while(true){}</script>',
    '<img src="https://evil.example/">',
    '<svg><foreignObject>bad</foreignObject></svg>',
    '<p onclick="steal()">x</p>',
    '<p style="background:url(https://evil.example)">x</p>',
    '<iframe src="file:///etc/passwd"></iframe>',
    '<!DOCTYPE svg><svg/>',
    '<svg><use href="#x"/></svg>',
  ])
    assert.throws(() => safeMarkup(bad, 'html'));
  assert.equal(
    safeMarkup('<section><h2>Safe</h2><p>Clear</p></section>', 'html'),
    '<section><h2>Safe</h2><p>Clear</p></section>',
  );
  assert.throws(() => safeMarkup('<p>' + 'x'.repeat(50001) + '</p>', 'html'), /TOO_LARGE/);
});
test('schema rejects invented consensus and missing graph bindings', async () => {
  const x = setup();
  try {
    const id = x.create();
    x.command(id, 'ingest', { text: 'input', kind: 'manual' });
    const m = x.service.meetings[0],
      p = proposal(m);
    assert.throws(() =>
      Proposal.parse({ ...p, objects: [{ ...p.objects[0], status: 'confirmed' }] }),
    );
    const a = p.artifact!;
    a.blocks = [
      {
        id: 'g',
        type: 'diagram',
        title: 'Graph',
        origin: 'stated',
        status: 'unverified',
        sources: a.sources,
        objectIds: ['topic'],
        nodes: [{ id: 'n', label: 'node', objectId: 'missing' }],
        edges: [],
      },
    ];
    assert.throws(() => validateArtifact(a, m, [{ ...p.objects[0], rev: 1 }], []), /INVALID_NODE/);
  } finally {
    x.close();
  }
});
test('storage failure does not report a command as saved', () => {
  const x = setup();
  try {
    const id = x.create();
    const save = x.store.save.bind(x.store);
    x.store.save = () => {
      throw new Error('disk full');
    };
    assert.throws(
      () => x.command(id, 'ingest', { text: 'unsaved', kind: 'manual' }),
      /STORAGE_FAILED/,
    );
    assert.equal(x.service.meetings[0].segments.length, 0);
    assert.equal(x.service.storageError, 'STORAGE_FAILED');
    x.store.save = save;
  } finally {
    x.close();
  }
});
test('English and Chinese additional UI keys match', () => {
  assert.deepEqual(Object.keys(extra.en).sort(), Object.keys(extra['zh-CN']).sort());
});
test('continuous appended input does not starve an in-flight understanding batch', async () => {
  let resolve!: (v: any) => void;
  const x = setup({
    interpret: (m) =>
      new Promise((r) => {
        resolve = () => r({ proposal: proposal(m), inputTokens: 0, outputTokens: 0 });
      }),
  });
  try {
    const id = x.create();
    x.command(id, 'ingest', { text: 'batch one', kind: 'manual' });
    const work = x.service.process(id);
    x.command(id, 'ingest', { text: 'batch two while processing', kind: 'manual' });
    resolve({});
    await work;
    assert.equal(x.service.meetings[0].understoodVersion, 1);
    assert.equal(x.service.meetings[0].artifacts[0].inputVersion, 1);
    assert.equal(x.service.meetings[0].inputVersion, 2);
  } finally {
    x.close();
  }
});
test('already-received audio may finish after end; new audio cannot enter', async () => {
  const { acceptAudio } = await import('../../src/integrations/audio-leases');
  const x = setup();
  try {
    const id = x.service.command({
      id: uid(),
      meetingId: null,
      type: 'create',
      payload: {
        title: 'Audio lease test',
        mode: 'microphone',
        outputLocale: 'en',
        timezone: 'UTC',
      },
    }) as string;
    x.command(id, 'captureStart');
    const epoch = x.service.meetings[0].epoch;
    x.command(id, 'captureReady', { epoch });
    const lease = acceptAudio(x.service.meetings[0], epoch, 'microphone', 'accepted-before-stop');
    x.command(id, 'end');
    assert.throws(
      () => acceptAudio(x.service.meetings[0], epoch, 'microphone', 'new-after-stop'),
      /CAPTURE_EXPIRED/,
    );
    x.service.completeAudio(lease, 'Completion of accepted audio, protocol test only');
    assert.equal(x.service.meetings[0].segments.length, 1);
    assert.equal(x.service.meetings[0].status, 'ended');
  } finally {
    x.close();
  }
});

test('diagram direction must match its cited semantic relation', () => {
  const x = setup();
  try {
    const id = x.create();
    x.command(id, 'ingest', { text: 'Synthetic relation source', kind: 'manual' });
    const m = x.service.meetings[0],
      p = proposal(m),
      a = p.artifact!;
    const objects = [
      { ...p.objects[0], rev: 1 },
      { ...p.objects[0], id: 'other', rev: 1 },
    ];
    const relations = [
      {
        id: 'dependency',
        from: 'topic',
        to: 'other',
        rev: 1,
        kind: 'depends_on' as const,
        origin: 'stated' as const,
        sources: a.sources,
      },
    ];
    a.blocks = [
      {
        id: 'graph',
        type: 'diagram',
        title: 'Dependency',
        sources: a.sources,
        objectIds: ['topic', 'other'],
        origin: 'stated',
        status: 'unverified',
        nodes: [
          { id: 'a', label: 'A', objectId: 'topic' },
          { id: 'b', label: 'B', objectId: 'other' },
        ],
        edges: [{ from: 'b', to: 'a', relationId: 'dependency', label: 'depends on' }],
      },
    ];
    assert.throws(() => validateArtifact(a, m, objects, relations), /INVALID_EDGE/);
    assert.equal(a.blocks[0].type, 'diagram');
    if (a.blocks[0].type !== 'diagram') throw new Error('Expected diagram');
    a.blocks[0].edges[0] = { from: 'a', to: 'b', relationId: 'dependency', label: 'depends on' };
    assert.doesNotThrow(() => validateArtifact(a, m, objects, relations));
  } finally {
    x.close();
  }
});

test('model relations cannot claim trusted tool provenance', async () => {
  const { validateDelta } = await import('../../src/renderers/validate');
  const x = setup();
  try {
    const id = x.create();
    x.command(id, 'ingest', { text: 'Synthetic provenance test', kind: 'manual' });
    const m = x.service.meetings[0],
      p = proposal(m);
    p.relations = [
      {
        id: 'forged',
        from: 'topic',
        to: 'topic',
        kind: 'supports',
        sources: p.objects[0].sources,
        origin: 'tool_computed',
      },
    ];
    assert.throws(() => validateDelta(p, m), /UNTRUSTED_TOOL_RESULT/);
  } finally {
    x.close();
  }
});
