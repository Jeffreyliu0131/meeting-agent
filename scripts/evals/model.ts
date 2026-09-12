/** Real model, real service, synthetic text only. Expected answers never enter provider inputs. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { OpenAIProvider, configFromEnv } from '../../src/agent/provider';
import { emptyContent } from '../../src/contracts/collaboration';
import { SessionService } from '../../src/service/session';
import { SQLiteStore } from '../../src/service/store';
// @ts-ignore This standalone scorer is intentionally shared with Node's offline runner.
import { intentLabels, classification, quantile, ratio } from './scoring.mjs';
const out = process.argv[2];
const corpus = JSON.parse(readFileSync('tests/evals/events.json', 'utf8'));
const config = configFromEnv();
const results: any[] = [];
const save = (value: any) =>
  writeFileSync(join(out, 'model.json'), JSON.stringify(value, null, 2) + '\n');
if (!config.key) {
  save({ status: 'blocked', reason: 'MODEL_NOT_CONFIGURED', actualCalls: 0, results: [] });
  process.exitCode = 2;
} else {
  const callLimit = Number(process.env.MEETING_EVAL_MAX_CALLS ?? 240);
  const tokenLimit = Number(process.env.MEETING_EVAL_MAX_TOKENS ?? 1000000);
  if (
    !Number.isInteger(callLimit) ||
    callLimit < 1 ||
    !Number.isInteger(tokenLimit) ||
    tokenLimit < 1
  )
    throw Error('INVALID_EVAL_BUDGET');
  let calls = 0,
    tokens = 0;
  const provider = new OpenAIProvider(config);
  for (const c of corpus.cases) {
    if (calls >= callLimit || tokens >= tokenLimit) {
      results.push({
        id: c.id,
        status: 'blocked',
        reason: 'EVAL_BUDGET_LIMIT',
        actual: null,
        expected: c.expected.finalIntentLabels,
      });
      continue;
    }
    const trace: any[] = [],
      checkpoints: any[] = [];
    let checkpoint = '',
      lastProposal: any = null;
    const invoke = async (kind: string, args: any[], optionIndex: number) => {
      if (calls >= callLimit || tokens >= tokenLimit) throw Error('EVAL_BUDGET_LIMIT');
      calls++;
      const original = args[optionIndex] ?? {};
      const entry: any = {
        kind,
        checkpoint,
        startedAt: new Date().toISOString(),
        inputTokens: null,
        outputTokens: null,
      };
      const started = performance.now();
      trace.push(entry);
      args[optionIndex] = {
        ...original,
        signal: AbortSignal.any([
          AbortSignal.timeout(60000),
          ...(original.signal ? [original.signal] : []),
        ]),
        onUsage: (input: number, output: number) => {
          tokens += input + output;
          entry.inputTokens = input;
          entry.outputTokens = output;
          original.onUsage?.(input, output);
        },
      };
      try {
        const result = await (provider as any)[kind](...args);
        entry.status = 'passed';
        entry.output = result;
        if (kind === 'interpret') lastProposal = result.proposal;
        return result;
      } catch (e) {
        entry.status = 'failed';
        entry.reason =
          e instanceof Error && /^[A-Z_0-9]+$/.test(e.message)
            ? e.message
            : 'PROVIDER_OR_SCHEMA_ERROR';
        throw Error(entry.reason);
      } finally {
        entry.durationMs = performance.now() - started;
      }
    };
    const port = {
      interpret: (...args: any[]) => invoke('interpret', args, 2),
      generate: (...args: any[]) => invoke('generate', args, 3),
      prepareComponent: (...args: any[]) => invoke('prepareComponent', args, 2),
      analyzeImpact: (...args: any[]) => invoke('analyzeImpact', args, 2),
    };
    let inputAt = 0,
      understoodAt: number | null = null,
      previousVersion = 0;
    const store = new SQLiteStore(':memory:');
    const service = new SessionService(store, port, { ...config, minBatchMs: 100 }, () => {
      if (
        inputAt &&
        service.meetings[0]?.understoodVersion > previousVersion &&
        understoodAt === null
      )
        understoodAt = performance.now();
    });
    try {
      const id = service.command({
        id: crypto.randomUUID(),
        meetingId: null,
        type: 'create',
        payload: {
          title: `Synthetic ${c.id}`,
          mode: 'replay',
          outputLocale: c.outputLocale,
          timezone: 'Asia/Singapore',
        },
      }) as string;
      if (c.collaboration) service.enableCollaboration(id, ['A', 'B', 'C']);
      const seededIds: string[] = [];
      for (const question of c.seedPolls ?? []) {
        const content = emptyContent('poll');
        if (content.kind !== 'poll') throw Error('INVALID_SEED');
        content.payload.question = question;
        content.payload.options = ['A', 'B'].map((id) => ({
          id,
          label: id,
          description: '',
          objectRefs: [],
        }));
        service.collaborate(
          {
            id: crypto.randomUUID(),
            meetingId: id,
            type: 'component.prepare',
            payload: { content },
          },
          service.meetings[0].collaboration!.participants[0].id,
        );
        seededIds.push(service.meetings[0].collaboration!.components.at(-1)!.id);
      }
      for (const turn of c.turns) {
        checkpoint = turn.id;
        lastProposal = null;
        previousVersion = service.meetings[0].understoodVersion;
        understoodAt = null;
        inputAt = performance.now();
        service.command({
          id: crypto.randomUUID(),
          meetingId: id,
          type: turn.kind === 'ask' ? 'ask' : 'ingest',
          payload: { text: turn.text, kind: 'replay', segmentId: turn.id },
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            service.flush(),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(Error('EVENT_TIMEOUT')), 90000);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        const m = service.meetings[0];
        checkpoints.push({
          sourceId: turn.id,
          kind: turn.kind,
          timeToUnderstandingMs: understoodAt === null ? null : understoodAt - inputAt,
          timeToSettledMs: performance.now() - inputAt,
          proposal: lastProposal,
          meeting: structuredClone(m),
        });
      }
      const m = service.meetings[0],
        collaboration = m.collaboration;
      const safetyViolations =
        (collaboration?.components.reduce((n, x) => n + x.rounds.length, 0) ?? 0) +
        (collaboration?.responses.length ?? 0) +
        (collaboration?.decisions.length ?? 0) +
        m.decisions.length;
      const last = checkpoints.at(-1);
      const errored = !!m.error || !!m.expressionError || trace.some((t) => t.status === 'failed');
      const actual = errored
        ? null
        : last?.kind === 'ask'
          ? ['none']
          : last?.proposal
            ? intentLabels(last.proposal.collaborationIntents ?? [])
            : null;
      service.command({ id: crypto.randomUUID(), meetingId: id, type: 'end', payload: {} });
      await service.flush();
      results.push({
        id: c.id,
        language: c.language,
        status: errored || actual === null ? 'failed' : 'completed',
        actual,
        expected: c.expected.finalIntentLabels,
        safetyViolations,
        expectedTargetId:
          c.expected.targetSeedIndex === undefined ? null : seededIds[c.expected.targetSeedIndex],
        observedTargetIds: last?.proposal?.collaborationIntents?.map((x: any) => x.targetId) ?? [],
        observedResolutions:
          last?.proposal?.collaborationIntents?.map((x: any) => x.resolution) ?? [],
        checkpoints,
        trace,
        ended: structuredClone(service.meetings[0]),
      });
    } catch (e) {
      results.push({
        id: c.id,
        language: c.language,
        status: 'failed',
        actual: null,
        expected: c.expected.finalIntentLabels,
        reason: e instanceof Error && /^[A-Z_0-9]+$/.test(e.message) ? e.message : 'EVAL_ERROR',
        checkpoints,
        trace,
      });
    } finally {
      service.close();
    }
    save({
      status: 'running',
      model: config.model,
      actualCalls: calls,
      observedTokens: tokens,
      results,
    });
    console.log(`Model event ${c.id}: ${results.at(-1).status} (${calls}/${callLimit} calls)`);
  }
  const family = classification(results, (s: string) => s.split('/')[0]);
  const operation = classification(results, (s: string) => s.split('/')[1] ?? 'none');
  const combined = classification(results);
  const safety = results.reduce((n, r) => n + (r.safetyViolations ?? 0), 0);
  const finished = results.filter((r) => r.status === 'completed').length;
  const latencies = results
    .flatMap((r) => (r.checkpoints ?? []).map((p: any) => p.timeToUnderstandingMs))
    .filter(Number.isFinite);
  const attempts = results.flatMap((r) => r.trace ?? []);
  const run = {
    status:
      finished < corpus.cases.length ||
      safety ||
      (family.macroF1 ?? 0) < 0.9 ||
      (operation.macroF1 ?? 0) < 0.9
        ? 'failed'
        : 'review_required',
    realModel: true,
    syntheticInput: true,
    realAudio: false,
    model: config.model,
    actualCalls: calls,
    observedTokens: tokens,
    callLimit,
    tokenLimit,
    tokenAccountingComplete: attempts.every(
      (t) => t.inputTokens !== null && t.outputTokens !== null,
    ),
    currencyCost: null,
    costReason: 'No verified provider/model pricing supplied; token counts are not currency cost.',
    metrics: {
      family,
      operation,
      combined,
      completion: ratio(finished, corpus.cases.length),
      unauthorizedEffects: safety,
      understandingP95Ms: quantile(latencies),
      understandingSamples: latencies.length,
    },
    results,
  };
  save(run);
  const runHash = createHash('sha256')
    .update(readFileSync(join(out, 'model.json')))
    .digest('hex');
  writeFileSync(
    join(out, 'human-review.json'),
    JSON.stringify(
      {
        runHash,
        reviewer: '',
        datasetReviewed: false,
        entries: corpus.cases.map((c: any) => ({
          id: c.id,
          checks: c.expected.checks,
          verdict: 'pending',
          evidence: [],
          sourceCorrect: null,
          sourceTotal: null,
          fieldCorrect: null,
          fieldTotal: null,
          inventedFields: null,
          conditionRetained: null,
          conditionTotal: null,
          unsupportedConflicts: null,
          emittedConflicts: null,
          irrelevantCollected: null,
          collectedFields: null,
          targetCorrect: null,
          targetTotal: null,
          inventedOwnerOrDate: null,
          notes: '',
        })),
      },
      null,
      2,
    ),
  );
  if (run.status === 'failed') process.exitCode = 1;
}
