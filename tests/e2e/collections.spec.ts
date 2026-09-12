import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SQLiteStore } from '../../src/service/store';
import { SessionService } from '../../src/service/session';
import { cleanupElectron } from './cleanup';

test('collections combine explicit collaboration decisions, preserve source meetings, and become stale after editing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meeting-desktop-collections-synthetic-'));
  const service = new SessionService(
    new SQLiteStore(join(dir, 'meetings.sqlite')),
    {
      interpret: async () => {
        throw Error('UNEXPECTED_MODEL');
      },
    },
    {
      key: '',
      base: 'https://example.invalid',
      model: 'synthetic',
      sttKey: '',
      sttBase: 'https://example.invalid',
      sttModel: 'gpt-live-transcribe',
      format: 'json_schema',
    },
  );
  for (const title of ['Synthetic kickoff', 'Synthetic review']) {
    const mid = service.command({
      id: crypto.randomUUID(),
      meetingId: null,
      type: 'create',
      payload: { title, mode: 'manual', outputLocale: 'en', timezone: 'UTC' },
    }) as string;
    service.enableCollaboration(mid, ['A']);
    const state = service.meetings.find((m) => m.id === mid)!.collaboration!;
    const action = (type: string, payload: any, actor = state.participants[0].id) =>
      service.collaborate({ id: crypto.randomUUID(), meetingId: mid, type, payload }, actor);
    const cid = action('component.prepare', {
      content: {
        kind: 'decision_confirmation',
        payload: {
          statement: 'Proceed with pilot',
          scopeText: title,
          conditions: [],
          targetObjectRefs: [],
          supportingResults: [],
          requiredParticipantIds: [],
          rule: 'all_required_explicit_agree',
        },
      },
    });
    await service.flush();
    const comp = () =>
      service.meetings
        .find((m) => m.id === mid)!
        .collaboration!.components.find((c) => c.id === cid)!;
    action('component.publish', {
      componentId: cid,
      draftRevision: comp().draftRevision,
      expectedAggregateVersion: comp().aggregateVersion,
      audienceIds: [state.participants[1].id],
      sourceDisclosure: [],
    });
    await service.flush();
    action(
      'component.respond',
      {
        componentId: cid,
        publishedRevision: comp().publishedRevision,
        expectedResponseVersion: 0,
        response: { kind: 'agree' },
      },
      state.participants[1].id,
    );
    await service.flush();
    action('component.record_decision', {
      componentId: cid,
      publishedRevision: comp().publishedRevision,
      expectedAggregateVersion: comp().aggregateVersion,
    });
    service.command({ id: crypto.randomUUID(), meetingId: mid, type: 'end', payload: {} });
  }
  service.close();
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(JSON.parse(body).messages.at(-1).content);
    const refs = input.decisions.flatMap((d: any) =>
      d.sources.map((id: string) => ({ id, rev: 1 })),
    );
    const report = {
      id: 'new_report',
      purposeKey: 'report',
      question: 'Consolidated pilot',
      summary: 'Both selected meetings recorded scoped pilot decisions.',
      layout: 'stack',
      objectIds: [],
      blocks: [
        {
          id: 'b1',
          type: 'text',
          title: 'Recorded scope',
          items: ['Proceed with pilot'],
          sources: refs,
          objectIds: [],
          origin: 'stated',
          status: 'unverified',
        },
      ],
      formulas: [],
      sources: refs,
    };
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(report) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const app = await electron.launch({
    args: [resolve('.')],
    env: {
      ...process.env,
      MEETING_DATA_DIR: dir,
      MEETING_SYSTEM_LOCALE: 'en',
      OPENAI_API_KEY: 'synthetic-only',
      MEETING_API_BASE: `http://127.0.0.1:${(server.address() as any).port}`,
      MEETING_STT_API_KEY: '',
      MEETING_AUTOSTART_PROXY: '0',
    },
  });
  try {
    let page: any;
    await expect
      .poll(async () => {
        page = (await app.windows()).find((p) => p.url().includes('role=workspace'));
        return !!page;
      })
      .toBe(true);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('role=workspace'))
        ?.show(),
    );
    await page.getByRole('button', { name: 'New collection', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').first().fill('Pilot collection');
    await dialog.getByLabel('Synthetic kickoff', { exact: true }).check();
    await dialog.getByLabel('Synthetic review', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Generate consolidated report', exact: true }).click();
    await expect(
      page
        .getByText('Both selected meetings recorded scoped pilot decisions.', { exact: true })
        .first(),
    ).toBeVisible();
    const state = await page.evaluate(() => window.meeting.call('snapshot'));
    expect(state.value.collections[0].reports).toHaveLength(1);
    expect(state.value.meetings.every((m: any) => m.segments.length === 0)).toBe(true);
    await page.evaluate(
      (collection: any) =>
        window.meeting.call('command', {
          id: crypto.randomUUID(),
          meetingId: null,
          type: 'collectionUpdate',
          payload: {
            collectionId: collection.id,
            baseRevision: collection.revision,
            brief: 'Compare a changed scope',
          },
        }),
      state.value.collections[0],
    );
    await expect(
      page.getByText('The evidence behind this report has changed since it was generated.', {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await cleanupElectron(app, dir);
    await new Promise<void>((r) => server.close(() => r()));
  }
});
