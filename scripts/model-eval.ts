/** Real provider evaluation. Never falls back to fixed output. */
import dotenv from 'dotenv';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteStore } from '../src/service/store';
import { SessionService } from '../src/service/session';
import { OpenAIProvider, configFromEnv } from '../src/agent/provider';
import { uid } from '../src/domain/commands';
dotenv.config({ quiet: true });
const config = configFromEnv();
if (!config.key) {
  console.log(
    'BLOCKED: MODEL_NOT_CONFIGURED. No model calls were made; synthetic fixtures are not model results.',
  );
  process.exitCode = 2;
} else {
  const dir = mkdtempSync(join(tmpdir(), 'meeting-real-model-'));
  const service = new SessionService(
    new SQLiteStore(join(dir, 'evaluation.sqlite')),
    new OpenAIProvider(config),
    config,
  );
  const results = [];
  for (const name of [
    'discussion-options',
    'execution-plan',
    'scenario-calculation',
    'bilingual-meeting',
  ]) {
    const f = JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));
    const groups = f.turns ? [{ id: name, turns: f.turns }] : f.variants || f.cases || [];
    for (const group of groups) {
      const id = service.command({
        id: uid(),
        meetingId: null,
        type: 'create',
        payload: {
          title: `Synthetic evaluation: ${group.id || name}`,
          mode: 'replay',
          outputLocale: group.outputLocale || 'en',
          timezone: f.timezone || 'Asia/Singapore',
        },
      }) as string;
      // Fixture clock applies only to this explicitly synthetic evaluation event.
      if (f.meetingDate)
        service.meetings.find((m) => m.id === id)!.createdAt = f.meetingDate + 'T00:00:00+08:00';
      const turns = [];
      const interval = Number(process.env.MEETING_EVAL_INTERVAL_MS ?? 2000);
      if (!Number.isFinite(interval) || interval < 100 || interval > 30000)
        throw new Error('INVALID_EVAL_INTERVAL');
      for (const turn of group.turns || []) {
        service.command({
          id: uid(),
          meetingId: id,
          type: turn.kind === 'user_request' ? 'ask' : 'ingest',
          payload: { text: turn.text, kind: 'replay', segmentId: turn.id || uid() },
        });
        // Continue delivering input while earlier model work is in flight.
        await new Promise((r) => setTimeout(r, interval));
        const m = service.meetings.find((m) => m.id === id)!;
        turns.push({
          sourceId: turn.id,
          inputVersion: m.inputVersion,
          understoodVersion: m.understoodVersion,
          error: m.error,
          artifact: m.artifacts.at(-1),
          metrics: m.metrics,
        });
      }
      service.command({ id: uid(), meetingId: id, type: 'end', payload: {} });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          service.flush(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('EVALUATION_TIMEOUT')), 120000);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      const final = service.meetings.find((m) => m.id === id)!;
      results.push({
        fixture: name,
        variant: group.id,
        turns,
        inputCadenceMs: interval,
        final: {
          inputVersion: final.inputVersion,
          understoodVersion: final.understoodVersion,
          error: final.error,
          expressionError: final.expressionError,
          artifacts: final.artifacts,
          calls: final.calls,
          usage: final.usageTotals,
        },
        expectedChecks: group.expected ?? f.expected ?? [],
        semanticAssessment:
          'Requires human assessment against fixture expected checks; schema success is not semantic success.',
      });
    }
  }
  mkdirSync('tests/results', { recursive: true });
  writeFileSync(
    'tests/results/model-evaluation.json',
    JSON.stringify(
      {
        syntheticInput: true,
        realModel: true,
        model: config.model,
        runAt: new Date().toISOString(),
        results,
      },
      null,
      2,
    ),
  );
  service.close();
  console.log(
    'Real model outputs saved to tests/results/model-evaluation.json. Review semantic checks before claiming pass.',
  );
}
