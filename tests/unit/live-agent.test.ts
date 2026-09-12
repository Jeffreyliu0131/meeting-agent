import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionService } from '../../src/service/session';
import { createMeeting, uid } from '../../src/domain/commands';
import { defaults } from '../../src/service/store';
import { buildContextBatch, latestSegments } from '../../src/agent/context';
import { applyArtifactPatch, artifactIsStale } from '../../src/domain/artifacts';
import { TranscriptionQueue } from '../../src/integrations/transcription-queue';
import { acceptAudio } from '../../src/integrations/audio-leases';
import { layoutGraph } from '../../src/renderers/graph-layout';
import type { Meeting, Proposal, Artifact, ExpressionPlan } from '../../src/contracts/model';
import type { ModelPort, ProviderConfig } from '../../src/agent/provider';
const config: ProviderConfig = {
  key: '',
  base: 'https://example.invalid',
  model: 'test',
  sttKey: '',
  sttBase: 'https://example.invalid',
  sttModel: 'test',
  format: 'json_schema',
  minBatchMs: 5,
};
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 10));
test('live drafts remain outside meeting facts and streaming calls account for final audio duration', async () => {
  const { service, id } = setup({
    interpret: async () => {
      throw new Error('UNEXPECTED_MODEL_CALL');
    },
  });
  const audio = {
    meetingId: id,
    epoch: 1,
    channel: 'microphone' as const,
    segmentId: 'draft',
    receivedAt: new Date().toISOString(),
  };
  service.partialAudio(audio, 'still speaking');
  assert.equal(service.snapshot().liveTranscripts?.[0].text, 'still speaking');
  assert.equal(service.meetings[0].segments.length, 0);
  assert.equal(service.meetings[0].inputVersion, 0);
  const done = deferred<string>();
  let seconds = 0;
  const call = service.runCall(
    id,
    'transcribe',
    () => done.promise,
    () => seconds,
  );
  seconds = 1.25;
  done.resolve('finished');
  await call;
  assert.equal(service.meetings[0].calls?.at(-1)?.audioSeconds, 1.25);
  assert.equal(service.meetings[0].usageTotals?.audioSeconds, 1.25);
  service.partialAudio(audio, '');
  assert.deepEqual(service.snapshot().liveTranscripts, []);
  service.close();
});
function setup(
  model: ModelPort,
  preview?: (a: Artifact) => Promise<void>,
  overrides: Partial<ProviderConfig> = {},
) {
  const service = new SessionService(
    {
      load: () => ({ meetings: [], collections: [], preferences: { ...defaults } }),
      save: () => {},
      command: () => null,
      close: () => {},
    },
    model,
    { ...config, ...overrides },
    () => {},
    preview,
  );
  const id = service.command({
    id: uid(),
    meetingId: null,
    type: 'create',
    payload: { title: 'Synthetic live test', mode: 'manual', outputLocale: 'en', timezone: 'UTC' },
  }) as string;
  const ingest = (text: string) =>
    service.command({
      id: uid(),
      meetingId: id,
      type: 'ingest',
      payload: { text, kind: 'manual' },
    });
  return { service, id, ingest };
}
function proposal(m: Meeting, content = true): Proposal {
  const s = m.segments.at(-1)!,
    sources = [{ id: s.id, rev: s.rev }];
  return {
    focus: 'Synthetic test',
    changes: [],
    objects: [],
    relations: [],
    action: content ? 'create_artifact' : 'no_change',
    rationale: 'Test double',
    artifact: content
      ? {
          id: 'work',
          purposeKey: 'test',
          question: 'Test',
          summary: s.text,
          layout: 'stack',
          objectIds: [],
          sources,
          formulas: [],
          blocks: [
            {
              id: 'body',
              type: 'text',
              title: 'Body',
              items: [s.text],
              objectIds: [],
              sources,
              origin: 'stated',
              status: 'unverified',
            },
          ],
        }
      : null,
  };
}
const fake: ModelPort = {
  interpret: async (m) => ({ proposal: proposal(m), inputTokens: 10, outputTokens: 10 }),
};
test('streamed model drafts are ephemeral and clear on failure without changing facts', async () => {
  const x = setup(fake);
  try {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let ready!: () => void;
    const entered = new Promise<void>((r) => {
      ready = r;
    });
    const call = x.service.runCall(x.id, 'understand', async (options) => {
      options.onDraft?.('A tentative draft');
      ready();
      await gate;
      throw new Error('MODEL_STREAM_INTERRUPTED');
    });
    const checked = assert.rejects(call, /MODEL_STREAM_INTERRUPTED/);
    await entered;
    assert.equal(x.service.snapshot().liveDrafts?.[0].text, 'A tentative draft');
    assert.equal(x.service.meetings[0].objects.length, 0);
    assert.equal(x.service.meetings[0].artifacts.length, 0);
    release();
    await checked;
    assert.equal(x.service.snapshot().liveDrafts?.length, 0);
  } finally {
    x.service.close();
  }
});

test('understanding commits while preview is held, and new speech is processed independently', async () => {
  const held = deferred(),
    entered = deferred();
  let previews = 0;
  const x = setup(fake, async () => {
    if (previews++ === 0) {
      entered.resolve();
      await held.promise;
    }
  });
  try {
    x.ingest('first');
    const first = x.service.process(x.id);
    await entered.promise;
    assert.equal(x.service.meetings[0].understoodVersion, 1);
    x.ingest('second');
    const second = x.service.process(x.id);
    await tick();
    assert.equal(x.service.meetings[0].understoodVersion, 2);
    held.resolve();
    await Promise.all([first, second]);
    assert.equal(x.service.meetings[0].artifacts.at(-1)?.summary, 'second');
  } finally {
    held.resolve();
    x.service.close();
  }
});
test('complex generation runs after understanding and does not block subsequent batches', async () => {
  const held = deferred(),
    entered = deferred();
  let n = 0;
  const x = setup({
    interpret: async (m) => {
      const p = proposal(m, false);
      if (n++ === 0) {
        p.action = 'create_artifact';
        p.plan = {
          purposeKey: 'test',
          question: 'Q',
          instruction: 'Synthetic plan',
          objectIds: [],
          sources: [{ id: m.segments[0].id, rev: 1 }],
        };
      }
      return { proposal: p, inputTokens: 5, outputTokens: 5 };
    },
    generate: async (m) => {
      entered.resolve();
      await held.promise;
      return { artifact: proposal(m).artifact!, inputTokens: 5, outputTokens: 5 };
    },
  });
  try {
    x.ingest('first');
    const first = x.service.process(x.id);
    await entered.promise;
    assert.equal(x.service.meetings[0].understoodVersion, 1);
    x.ingest('second');
    const second = x.service.process(x.id);
    await tick();
    assert.equal(x.service.meetings[0].understoodVersion, 2);
    held.resolve();
    await Promise.all([first, second]);
  } finally {
    held.resolve();
    x.service.close();
  }
});
test('a source correction invalidates a preview result without losing the correction', async () => {
  const held = deferred(),
    entered = deferred();
  const x = setup(fake, async () => {
    entered.resolve();
    await held.promise;
  });
  try {
    x.ingest('40 people');
    const first = x.service.process(x.id);
    await entered.promise;
    const s = x.service.meetings[0].segments[0];
    x.service.command({
      id: uid(),
      meetingId: x.id,
      type: 'correct',
      payload: { segmentId: s.id, baseRevision: 1, text: '14 people', speaker: null },
    });
    held.resolve();
    await first;
    await x.service.flush();
    assert.equal(
      x.service.meetings[0].artifacts.some((a) => a.summary === '40 people'),
      false,
    );
    assert.equal(x.service.meetings[0].artifacts.at(-1)?.summary, '14 people');
  } finally {
    held.resolve();
    x.service.close();
  }
});
test('out-of-order dual-channel responses retain capture chronology and receipt versions', () => {
  const x = setup(fake);
  try {
    const base = { meetingId: x.id, epoch: 0, receivedAt: new Date().toISOString() };
    x.service.completeAudio(
      {
        ...base,
        channel: 'microphone',
        segmentId: 'late',
        captureStartMs: 200,
        captureEndMs: 300,
        channelSequence: 1,
      },
      'Change to 14',
    );
    x.service.completeAudio(
      {
        ...base,
        channel: 'system_audio',
        segmentId: 'early',
        captureStartMs: 100,
        captureEndMs: 200,
        channelSequence: 0,
      },
      'Originally 40',
    );
    const s = latestSegments(x.service.meetings[0]);
    assert.deepEqual(
      s.map((s) => s.text),
      ['Originally 40', 'Change to 14'],
    );
    assert.deepEqual(
      s.map((s) => s.version),
      [2, 1],
    );
  } finally {
    x.service.close();
  }
});
test('transcription queue survives a slow call, preserves per-channel order and reports overflow', async () => {
  const held = deferred(),
    seen: number[] = [],
    gaps: number[] = [];
  const q = new TranscriptionQueue<{ id: number; bytes: number; durationMs: number }>(
    async (item) => {
      if (item.id === 1) await held.promise;
      seen.push(item.id);
    },
    (item) => gaps.push(item.id),
    () => {},
    15000,
    1000,
  );
  q.enqueue('mic', { id: 1, bytes: 10, durationMs: 5000 });
  await tick();
  q.enqueue('mic', { id: 2, bytes: 10, durationMs: 5000 });
  q.enqueue('mic', { id: 3, bytes: 10, durationMs: 5000 });
  assert.equal(q.enqueue('mic', { id: 4, bytes: 10, durationMs: 5000 }), false);
  assert.equal(q.pending, 3);
  held.resolve();
  await q.idle();
  assert.deepEqual(seen, [1, 2, 3]);
  assert.deepEqual(gaps, [4]);
  assert.equal(q.enqueue('mic', { id: 5, bytes: 10, durationMs: 5000 }), true);
  await q.idle();
  assert.deepEqual(seen, [1, 2, 3, 5]);
  q.close();
});
test('queue failure is an explicit gap and does not discard subsequent audio', async () => {
  const seen: number[] = [],
    gaps: number[] = [];
  const q = new TranscriptionQueue<{ id: number; bytes: number; durationMs: number }>(
    async (i) => {
      if (i.id === 1) throw Error('network');
      seen.push(i.id);
    },
    (i) => gaps.push(i.id),
  );
  q.enqueue('mic', { id: 1, bytes: 1, durationMs: 100 });
  q.enqueue('mic', { id: 2, bytes: 1, durationMs: 100 });
  await q.idle();
  assert.deepEqual(seen, [2]);
  assert.deepEqual(gaps, [1]);
  q.close();
});
test('long-meeting retrieval recalls old conditions within a bounded prompt', () => {
  const m = createMeeting(
    { title: 'Synthetic long meeting', mode: 'manual', outputLocale: 'en', timezone: 'UTC' },
    defaults,
  );
  m.processedSources = {};
  for (let i = 0; i < 500; i++) {
    const id = 's' + i;
    m.segments.push({
      id,
      rev: 1,
      version: i + 1,
      text:
        i === 0
          ? '外包供应商 Alpha，期限周五，不含设计支持。'
          : 'Unrelated discussion ' + i + ' repeated background '.repeat(35),
      kind: 'manual',
      epoch: 0,
      channel: 'manual',
      order: i + 1,
      receivedAt: new Date(i * 1000).toISOString(),
      speaker: null,
      identity: 'unknown',
      identityBasis: null,
      synthetic: true,
    });
    m.processedSources[id] = 1;
  }
  m.objects = [
    {
      id: 'alpha',
      rev: 1,
      kind: 'option',
      title: 'Alpha 外包方案',
      detail: '期限周五，不含设计支持',
      origin: 'stated',
      status: 'unverified',
      sources: [{ id: 's0', rev: 1 }],
      lifecycle: 'active',
    },
  ];
  m.understoodVersion = 500;
  m.inputVersion = 501;
  m.segments.push({
    ...m.segments[0],
    id: 'new',
    version: 501,
    order: 501,
    text: '回到 Alpha 外包方案，之前的期限和支持范围是什么？',
    receivedAt: new Date(501000).toISOString(),
  });
  const batch = buildContextBatch(m, 12000);
  assert.ok(batch.bytes <= 12000);
  assert.ok(batch.meeting.segments.some((s) => s.id === 's0'));
  assert.ok(batch.meeting.objects.some((o) => o.id === 'alpha'));
  assert.deepEqual(batch.accepted, [{ id: 'new', rev: 1 }]);
  assert.ok(batch.meeting.segments.length < 20);
});
test('pending inputs are batched without silent truncation or skipped watermarks', async () => {
  const x = setup(
    { interpret: async (m) => ({ proposal: proposal(m, false), inputTokens: 1, outputTokens: 1 }) },
    undefined,
    { contextBytes: 8000 },
  );
  try {
    for (let i = 0; i < 40; i++) x.ingest('Synthetic ' + i + ' words '.repeat(40));
    await x.service.process(x.id);
    await x.service.flush();
    assert.equal(Object.keys(x.service.meetings[0].processedSources ?? {}).length, 40);
    assert.equal(x.service.meetings[0].understoodVersion, 40);
  } finally {
    x.service.close();
  }
});
test('usage is recorded even when the provider returns invalid output or the result is superseded', async () => {
  const x = setup({
    interpret: async (_m, _repair, o) => {
      o?.onUsage?.(100, 20);
      throw Error('MODEL_OUTPUT_LIMIT');
    },
  });
  try {
    x.ingest('source');
    await x.service.process(x.id);
    const m = x.service.meetings[0];
    assert.equal(m.calls?.length, 1);
    assert.equal(m.calls?.[0].status, 'failed');
    assert.equal(m.metrics.inputTokens, 100);
    assert.equal(m.metrics.outputTokens, 20);
  } finally {
    x.service.close();
  }
});
test('budget denial stops provider calls while keeping new input available', async () => {
  let count = 0;
  const x = setup(
    {
      interpret: async (m) => {
        count++;
        return { proposal: proposal(m, false), inputTokens: 10, outputTokens: 10 };
      },
    },
    undefined,
    { maxCallsPerHour: 1 },
  );
  try {
    x.ingest('one');
    await x.service.process(x.id);
    x.ingest('two');
    await x.service.process(x.id);
    assert.equal(count, 1);
    assert.equal(x.service.meetings[0].segments.length, 2);
    assert.equal(x.service.meetings[0].error, 'AGENT_BUDGET_LIMIT');
  } finally {
    x.service.close();
  }
});
test('patch preserves unchanged blocks and rejects stale bases', async () => {
  const x = setup(fake);
  try {
    x.ingest('one');
    await x.service.process(x.id);
    const base = x.service.meetings[0].artifacts[0];
    const patch = {
      artifactId: base.id,
      baseRev: base.rev,
      question: null,
      summary: 'Updated',
      upsertBlocks: [],
      removeBlockIds: [],
      formulas: null,
    };
    const result = applyArtifactPatch(base, patch);
    assert.deepEqual(result.blocks, base.blocks);
    assert.equal(result.summary, 'Updated');
    assert.throws(() => applyArtifactPatch(base, { ...patch, baseRev: 3 }), /CONFLICT/);
    x.ingest('unrelated');
    assert.equal(artifactIsStale(base, x.service.meetings[0]), false);
  } finally {
    x.service.close();
  }
});
test('graph branching shares a node and preserves positions on append', () => {
  const a = {
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
    ],
  };
  const first = layoutGraph(a);
  assert.equal(first.positions.size, 3);
  assert.ok(first.positions.get('b')!.x > first.positions.get('a')!.x);
  const next = layoutGraph(
    { nodes: [...a.nodes, { id: 'd' }], edges: [...a.edges, { from: 'b', to: 'd' }] },
    first.positions,
  );
  for (const [id, p] of first.positions) assert.deepEqual(next.positions.get(id), p);
  assert.equal(new Set([...next.positions.values()].map((p) => p.x + ',' + p.y)).size, 4);
});
test('audio timing is validated before work is accepted', () => {
  const m = createMeeting(
    { title: 'Test', mode: 'microphone', outputLocale: 'en', timezone: 'UTC' },
    defaults,
  );
  m.capture = 'capturing';
  assert.throws(
    () =>
      acceptAudio(m, 0, 'microphone', 's', {
        captureStartMs: 200,
        captureEndMs: 100,
        channelSequence: 0,
      }),
    /INVALID_AUDIO_TIME/,
  );
});

test('agent patch is applied through the service and preserves untouched content', async () => {
  let n = 0;
  const x = setup({
    interpret: async (m) => {
      let p = proposal(m);
      if (n++) {
        const base = m.artifacts.at(-1)!;
        p = {
          ...p,
          artifact: null,
          action: 'patch_artifact',
          patch: {
            artifactId: base.id,
            baseRev: base.rev,
            question: null,
            summary: 'Patched summary',
            upsertBlocks: [],
            removeBlockIds: [],
            formulas: null,
          },
        };
      }
      return { proposal: p, inputTokens: 1, outputTokens: 1 };
    },
  });
  try {
    x.ingest('initial body');
    await x.service.process(x.id);
    x.ingest('summary change');
    await x.service.process(x.id);
    const versions = x.service.meetings[0].artifacts;
    assert.equal(versions.length, 2);
    assert.equal(versions[1].summary, 'Patched summary');
    assert.deepEqual(versions[1].blocks, versions[0].blocks);
    assert.equal(versions[1].id, versions[0].id);
  } finally {
    x.service.close();
  }
});
test('personal exploration cannot replace meeting objects or reuse the meeting artifact identity', async () => {
  const x = setup({
    interpret: async (m) => {
      const p = proposal(m),
        s = m.segments.at(-1)!;
      if (s.kind === 'request') {
        p.objects = [
          {
            id: 'private-option',
            kind: 'option',
            title: 'Personal assumption',
            detail: s.text,
            sources: [{ id: s.id, rev: s.rev }],
            origin: 'agent_inferred',
            status: 'assumed',
            lifecycle: 'active',
          },
        ];
        p.artifact!.objectIds = ['private-option'];
        p.artifact!.blocks[0].objectIds = ['private-option'];
        p.artifact!.blocks[0].origin = 'agent_inferred';
      }
      return { proposal: p, inputTokens: 1, outputTokens: 1 };
    },
  });
  try {
    x.ingest('meeting facts');
    await x.service.process(x.id);
    const meetingView = x.service.meetings[0].artifacts[0];
    x.service.command({
      id: uid(),
      meetingId: x.id,
      type: 'ask',
      payload: { text: 'What if we change the plan?' },
    });
    await x.service.process(x.id);
    const m = x.service.meetings[0];
    assert.equal(
      m.objects.some((o) => o.id === 'private-option'),
      false,
    );
    assert.equal(m.artifacts.at(-1)?.scope, 'personal');
    assert.notEqual(m.artifacts.at(-1)?.id, meetingView.id);
    assert.equal(m.artifacts[0].scope, 'meeting');
  } finally {
    x.service.close();
  }
});
test('a failed preview does not poison the next valid visual update', async () => {
  let calls = 0;
  const x = setup(fake, async () => {
    if (calls++ === 0) throw Error('RENDER_FAILED');
  });
  try {
    x.ingest('first');
    await x.service.process(x.id);
    assert.equal(x.service.meetings[0].understoodVersion, 1);
    assert.equal(x.service.meetings[0].expressionStatus, 'error');
    x.ingest('second');
    await x.service.process(x.id);
    assert.equal(x.service.meetings[0].artifacts.at(-1)?.summary, 'second');
    assert.equal(x.service.meetings[0].expressionError, null);
  } finally {
    x.service.close();
  }
});

test('system language and legacy preferences migrate without changing an active meeting language', async () => {
  const { resolvePreferences, systemLocale } = await import('../../src/domain/preferences');
  assert.equal(systemLocale('zh-TW'), 'zh-CN');
  assert.equal(systemLocale('zh-Hans-US'), 'zh-CN');
  assert.equal(systemLocale('zh-Hant-HK'), 'zh-CN');
  assert.equal(systemLocale('en-CN'), 'en');
  assert.equal(systemLocale('ja-JP'), 'en');
  const fresh = resolvePreferences({ ...defaults }, 'zh-CN');
  assert.equal(fresh.uiLocale, 'zh-CN');
  assert.equal(fresh.defaultOutputLocale, 'zh-CN');
  const old = resolvePreferences(
    {
      uiLocale: 'en',
      defaultOutputLocale: 'en',
      reduceMotion: false,
      reduceTransparency: false,
      shortcut: '',
    },
    'zh-CN',
  );
  assert.equal(old.uiLocale, 'en');
  assert.equal(old.uiLanguage, 'en');
  const x = setup(fake);
  try {
    const before = x.service.meetings[0].outputLocale;
    x.service.command({
      id: uid(),
      meetingId: null,
      type: 'preferences',
      payload: { ...defaults, uiLanguage: 'zh-CN', defaultOutputLanguage: 'zh-CN' },
    });
    assert.equal(x.service.meetings[0].outputLocale, before);
  } finally {
    x.service.close();
  }
});
test('user rename wins over an in-flight automatic title proposal', async () => {
  const ready = deferred(),
    held = deferred();
  const x = setup({
    interpret: async (m) => {
      ready.resolve();
      await held.promise;
      const p = proposal(m);
      p.titleProposal = {
        text: 'Agent proposed title',
        baseRevision: m.titleMeta?.revision ?? 0,
        sources: [{ id: m.segments[0].id, rev: 1 }],
      };
      return { proposal: p, inputTokens: 1, outputTokens: 1 };
    },
  });
  try {
    x.service.meetings[0].titleMeta = { origin: 'placeholder', revision: 0, sources: [] };
    x.ingest('Discuss launch plan');
    const work = x.service.process(x.id);
    await ready.promise;
    x.service.command({
      id: uid(),
      meetingId: x.id,
      type: 'rename',
      payload: { title: 'My chosen title', baseRevision: 0 },
    });
    held.resolve();
    await work;
    assert.equal(x.service.meetings[0].title, 'My chosen title');
    assert.equal(x.service.meetings[0].titleMeta?.origin, 'user');
  } finally {
    held.resolve();
    x.service.close();
  }
});
test('start intent snapshots configured audio and never silently selects manual input', () => {
  const state = {
    meetings: [] as Meeting[],
    collections: [],
    preferences: {
      ...defaults,
      audio: {
        deviceId: 'specific',
        deviceLabel: 'USB',
        includeComputerAudio: true,
        setupCompleted: true,
      },
    },
  };
  const service = new SessionService(
    { load: () => structuredClone(state), save: () => {}, command: () => null, close: () => {} },
    fake,
    config,
  );
  try {
    service.command({
      id: uid(),
      meetingId: null,
      type: 'startMeeting',
      payload: { timezone: 'UTC' },
    });
    const m = service.meetings[0];
    assert.equal(m.mode, 'online');
    assert.equal(m.audioSettings?.deviceId, 'specific');
    assert.equal(m.titleMeta?.origin, 'placeholder');
    assert.equal(m.capture, 'idle');
  } finally {
    service.close();
  }
});
