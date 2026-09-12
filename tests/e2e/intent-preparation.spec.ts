/** Local HTTP test double and synthetic text only; no real model or audio. */
import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('four intent drafts: real IPC, protected edits, sources and restart', async () => {
  const server = createServer(async (req, res) => {
    let input = '';
    for await (const chunk of req) input += chunk;
    const request = JSON.parse(input),
      context = JSON.parse(request.messages.at(-1).content);
    const s = context.segments.at(-1),
      evidence = [{ id: s.id, rev: s.rev }];
    const contents = [
      {
        kind: 'poll',
        question: 'Choose rollout',
        selection: 'single',
        options: [
          { key: 'a', label: 'Internal', sources: evidence },
          { key: 'b', label: 'Invited', sources: evidence },
        ],
      },
      {
        kind: 'assignment',
        items: [
          {
            key: 'task',
            task: 'Build API',
            deliverable: 'API',
            owner: 'Alice',
            time: 'Friday',
            dependencies: [],
            sources: evidence,
          },
        ],
      },
      {
        kind: 'conflict',
        summary: 'Schedule needs review',
        sides: [{ key: 'side', description: 'Existing work', sources: evidence }],
        questions: ['Exclusive work?'],
        resolutions: ['Check availability'],
      },
      {
        kind: 'decision_confirmation',
        statement: 'Use invited rollout',
        scopeText: 'Pilot',
        conditions: ['Approval required'],
      },
    ];
    const intents = context.intentPreparation
      ? contents.map((content) => {
          const d = context.intentPreparation.drafts.find(
            (d: any) => d.candidate.family === content.kind && d.status !== 'dismissed',
          );
          return {
            localId: content.kind,
            family: content.kind,
            operation: d ? 'update' : 'prepare',
            expression: 'explicit',
            resolution: 'actionable_draft',
            target: d ? { id: d.id, rev: d.rev } : null,
            targetLocalId: null,
            topicRef: null,
            referencedObjects: [],
            evidence,
            collectionMode: content.kind === 'poll' ? 'prospective' : 'none',
            scopeText: content.kind,
            missingSlots: [],
            dependsOnLocalIds: [],
            content,
          };
        })
      : [];
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                focus: 'Synthetic intentPreparation',
                changes: [],
                objects: [],
                relations: [],
                action: 'no_change',
                artifact: null,
                rationale: 'Test double',
                intentPreparation: { intents, coverage: 'complete', unprocessedRefs: [] },
              }),
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'intentPreparation-electron-'));
  const env = {
    ...process.env,
    MEETING_DATA_DIR: dir,
    MEETING_DEV_INPUTS: '1',
    MEETING_SYSTEM_LOCALE: 'en',
    OPENAI_API_KEY: 'synthetic-only',
    MEETING_API_BASE: `http://127.0.0.1:${(server.address() as any).port}`,
    MEETING_MIN_BATCH_MS: '100',
  };
  let app = await electron.launch({ args: [resolve('.')], env });
  const workspace = async () => {
    await expect
      .poll(async () => (await app.windows()).some((p) => p.url().includes('role=workspace')))
      .toBe(true);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('role=workspace'),
      );
      w?.show();
      w?.focus();
    });
    return (await app.windows()).find((p) => p.url().includes('role=workspace'))!;
  };
  try {
    let page = await workspace();
    await page.getByText('Development tools', { exact: true }).click();
    await page.getByRole('button', { name: 'Development input', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start meeting' }).click();
    await page.getByRole('button', { name: 'Enable preparation', exact: true }).click();
    await page.getByRole('button', { name: 'Add a transcript excerpt' }).click();
    const ingest = async (text: string) => {
      await page.getByRole('textbox', { name: 'Original words…' }).fill(text);
      await page.getByRole('button', { name: 'Add source', exact: true }).click();
    };
    await ingest(
      'Synthetic: Alice builds API by Friday. Choose Internal or Invited. Schedule conflict, approval required.',
    );
    for (const kind of ['poll', 'assignment', 'conflict', 'decision_confirmation'])
      await expect(page.getByTestId(`intent-${kind}`)).toBeVisible();
    const poll = page.getByTestId('intent-poll');
    await poll
      .getByRole('textbox', { name: 'Option 1', exact: true })
      .fill('Five invited customers');
    await poll.getByRole('button', { name: 'Save field' }).click();
    await expect(poll.getByText('Manual edit · protected from automatic updates')).toBeVisible();
    await ingest(
      'Synthetic update: Alice builds API by Friday; Internal or Invited are still discussed.',
    );
    await expect(
      poll.getByText('Automatic suggestion differs from your protected edits'),
    ).toBeVisible();
    await expect(poll.getByRole('textbox', { name: 'Option 1', exact: true })).toHaveValue(
      'Five invited customers',
    );
    await poll.getByRole('button', { name: 'Stop collecting and preview' }).click();
    await expect(poll.getByRole('heading')).toContainText('Private draft');
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('role=workspace'),
      );
      w?.setSize(800, 600);
      w?.webContents.setZoomFactor(2);
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('role=workspace'),
      );
      w?.webContents.setZoomFactor(1);
      w?.setSize(1100, 850);
    });
    for (const kind of ['poll', 'assignment', 'conflict', 'decision_confirmation']) {
      await page.getByTestId(`intent-${kind}`).getByRole('heading').scrollIntoViewIfNeeded();
      await page.waitForTimeout(250); // Wait for the native compositor after scrolling.
      const png = await app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes('role=workspace'),
        )!;
        return (await w.capturePage()).toPNG().toString('base64');
      });
      writeFileSync(join(dir, `intent-${kind}.png`), Buffer.from(png, 'base64'));
    }
    await app.close();
    app = await electron.launch({ args: [resolve('.')], env });
    page = await workspace();
    const savedMeeting = page.getByRole('button', { name: /^Meeting ·/ });
    await expect
      .poll(
        async () => (await page.getByTestId('intent-panel').count()) + (await savedMeeting.count()),
      )
      .toBeGreaterThan(0);
    if (await savedMeeting.count()) await savedMeeting.first().click();
    await expect(
      page.getByTestId('intent-poll').getByRole('textbox', { name: 'Option 1', exact: true }),
    ).toHaveValue('Five invited customers');
    await expect(page.getByTestId('intent-decision_confirmation')).toContainText(
      'not a recorded decision',
    );
  } finally {
    await app.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
