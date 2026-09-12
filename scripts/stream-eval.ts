/** Accelerated synthetic load. Zero external calls, no devices, no claims about model quality. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { SessionService } from '../src/service/session';
import { uid } from '../src/domain/commands';
import { defaults } from '../src/service/store';
import type { Proposal } from '../src/contracts/model';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let maxPending = 0,
  modelCalls = 0,
  understandingBeforeFirstPreview = false,
  firstPreview = true;
const service = new SessionService(
  {
    load: () => ({ meetings: [], collections: [], preferences: { ...defaults } }),
    save: () => {},
    command: () => null,
    close: () => {},
  },
  {
    interpret: async (m, _repair, options) => {
      modelCalls++;
      await sleep(12);
      const s = m.segments.at(-1)!,
        refs = [{ id: s.id, rev: s.rev }];
      const proposal: Proposal = {
        focus: 'Synthetic continuous stream',
        changes: [],
        objects: [],
        relations: [],
        action: 'patch_artifact',
        rationale: 'Explicit test double',
        artifact: {
          id: 'stream',
          purposeKey: 'stream',
          question: 'Synthetic load only',
          summary: String(m.inputVersion),
          layout: 'stack',
          objectIds: [],
          sources: refs,
          formulas: [],
          blocks: [
            {
              id: 'body',
              type: 'text',
              title: 'Watermark',
              items: [String(m.inputVersion)],
              sources: refs,
              objectIds: [],
              origin: 'stated',
              status: 'unverified',
            },
          ],
        },
      };
      options?.onUsage?.(100, 50);
      return { proposal, inputTokens: 100, outputTokens: 50 };
    },
  },
  {
    key: '',
    base: 'https://example.invalid',
    model: 'synthetic-test-double',
    sttKey: '',
    sttBase: 'https://example.invalid',
    sttModel: 'none',
    format: 'json_schema',
    minBatchMs: 5,
    contextBytes: 8000,
  },
  () => {},
  async () => {
    if (firstPreview) {
      firstPreview = false;
      understandingBeforeFirstPreview = service.meetings[0].understoodVersion > 0;
      await sleep(80);
    } else await sleep(20);
  },
);
const id = service.command({
  id: uid(),
  meetingId: null,
  type: 'create',
  payload: {
    title: 'Synthetic accelerated 30-minute stream',
    mode: 'replay',
    outputLocale: 'en',
    timezone: 'UTC',
  },
}) as string;
const started = Date.now();
try {
  for (let i = 0; i < 360; i++) {
    service.command({
      id: uid(),
      meetingId: id,
      type: 'ingest',
      payload: {
        kind: 'replay',
        text: `Synthetic event ${i + 1}: ${i % 5 === 0 ? 'Return to Alpha outsourcing conditions.' : 'Continue discussion.'}`,
        segmentId: 'stream-' + i,
      },
    });
    const m = service.meetings[0];
    maxPending = Math.max(maxPending, m.inputVersion - m.understoodVersion);
    await sleep(2);
  }
  await service.flush();
  const m = service.meetings[0];
  const result = {
    synthetic: true,
    realModel: false,
    realAudio: false,
    simulatedMeetingSeconds: 1800,
    events: 360,
    playbackIntervalMs: 2,
    elapsedMs: Date.now() - started,
    modelCalls,
    maxPending,
    usageTotals: m.usageTotals,
    unknownUsageCalls: (m.calls ?? []).filter(
      (c) => c.inputTokens === null || c.outputTokens === null,
    ).length,
    inputRetained: m.segments.length,
    processed: Object.keys(m.processedSources ?? {}).length,
    understoodVersion: m.understoodVersion,
    latestArtifactVersion: m.artifacts.at(-1)?.inputVersion,
    understandingBeforeFirstPreview,
    lastContextBytes: m.lastContextBytes,
    error: m.error,
    expressionError: m.expressionError ?? null,
    pass:
      m.understoodVersion === 360 &&
      m.artifacts.at(-1)?.inputVersion === 360 &&
      understandingBeforeFirstPreview &&
      !m.error &&
      (m.calls ?? []).every((c) => c.inputTokens !== null && c.outputTokens !== null) &&
      m.segments.length === 360 &&
      modelCalls > 0,
  };
  mkdirSync('tests/results', { recursive: true });
  writeFileSync('tests/results/stream-evaluation.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
} finally {
  service.close();
}
