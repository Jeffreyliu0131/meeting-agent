/** Synthetic transport answers; tests state boundaries and UI, not model semantics. */
import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { cleanupElectron } from './cleanup';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('conditional meeting record survives personal exploration, end, sources and restart', async () => {
  const contexts: any[] = [];
  const server = createServer(async (req, res) => {
    let data = '';
    for await (const chunk of req) data += chunk;
    const body = JSON.parse(data),
      context = JSON.parse(body.messages.at(-1).content);
    contexts.push(context);
    const s = context.segments.at(-1),
      sources = [{ id: s.id, rev: s.rev }];
    const personal = context.scope === 'personal';
    const first = !context.objects.some((o: any) => o.title === 'Friday launch');
    const p: any = {
      focus: 'Synthetic launch discussion',
      changes: [],
      objects: [],
      relations: [],
      action: 'no_change',
      artifact: null,
      rationale: 'Test double',
    };
    if (first || personal) {
      p.objects = personal
        ? []
        : [
            {
              id: 'budget',
              kind: 'constraint',
              title: 'Budget approval',
              detail: 'Budget must be approved',
              origin: 'stated',
              status: 'unverified',
              sources,
              lifecycle: 'active',
              meaning: null,
              changeSources: [],
            },
            {
              id: 'launch',
              kind: 'task',
              title: 'Friday launch',
              detail: 'Launch Friday only if budget is approved',
              origin: 'stated',
              status: 'unverified',
              sources,
              lifecycle: 'active',
              changeSources: [],
              meaning: {
                stance: 'conditional',
                conditionIds: ['budget'],
                owner: null,
                deadline: { value: 'Friday', evidence: { quote: s.text, sources } },
                evidence: [{ quote: s.text, sources }],
              },
            },
          ];
      p.action = 'create_artifact';
      p.artifact = {
        id: personal ? 'private-work' : 'launch-view',
        purposeKey: personal ? 'private' : 'launch',
        question: personal ? 'Private exploration' : 'Launch plan',
        summary: personal ? 'PRIVATE_TEST_ONLY' : 'Friday depends on budget approval',
        layout: 'stack',
        objectIds: personal ? [] : ['launch'],
        sources,
        formulas: [],
        blocks: [
          {
            id: 'body',
            type: 'text',
            title: 'Working proposal',
            items: [personal ? 'PRIVATE_TEST_ONLY' : 'Friday depends on budget approval'],
            sources,
            objectIds: personal ? [] : ['launch'],
            origin: personal ? 'agent_inferred' : 'stated',
            status: 'assumed',
          },
        ],
      };
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(p) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'meeting-reliability-ui-'));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const env = {
    ...process.env,
    MEETING_DEV_INPUTS: '1',
    MEETING_SYSTEM_LOCALE: 'en',
    MEETING_DATA_DIR: dir,
    OPENAI_API_KEY: 'synthetic-only',
    MEETING_API_BASE: base,
    MEETING_STT_API_KEY: 'synthetic-only',
    MEETING_STT_API_BASE: base,
  };
  let app = await electron.launch({ args: [resolve('.')], env });
  async function workspace() {
    let page: any;
    await expect
      .poll(async () => {
        page = (await app.windows()).find((p) => p.url().includes('role=workspace'));
        return !!page;
      })
      .toBe(true);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('role=workspace'),
      );
      w?.show();
      w?.focus();
    });
    return page;
  }
  try {
    let page = await workspace();
    await page.getByText('Development tools', { exact: true }).click();
    await page.getByRole('button', { name: 'Development input', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start meeting' }).click();
    await page.getByRole('button', { name: 'Add a transcript excerpt' }).click();
    await page
      .getByRole('textbox', { name: 'Original words…' })
      .fill('Synthetic: If budget is approved, launch Friday.');
    await page.getByRole('button', { name: 'Add source', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Launch plan', exact: true })).toBeVisible();
    await page.getByTestId('meaning-notes').locator('summary').click();
    await expect(page.getByTestId('meaning-notes')).toContainText('Budget must be approved');
    await page.getByRole('button', { name: 'Explore this', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Ask about this meeting…' })
      .fill('PRIVATE_TEST_ONLY: assume unlimited budget');
    await page.getByRole('textbox', { name: 'Ask about this meeting…' }).press('Enter');
    await expect.poll(() => contexts.some((c) => c.scope === 'personal')).toBe(true);
    await page
      .getByRole('textbox', { name: 'Original words…' })
      .fill('Synthetic: move to a different topic.');
    await page.getByRole('button', { name: 'Add source', exact: true }).click();
    await expect.poll(() => contexts.filter((c) => c.scope === 'meeting').length).toBe(2);
    const lastMeeting = contexts.filter((c) => c.scope === 'meeting').at(-1);
    expect(JSON.stringify(lastMeeting)).not.toContain('PRIVATE_TEST_ONLY');
    expect(lastMeeting.objects.some((o: any) => o.title === 'Budget approval')).toBe(true);
    await page.getByRole('button', { name: 'End meeting', exact: true }).click();
    const review = page.getByTestId('meeting-closeout');
    await review.locator('summary').first().click();
    await expect(review).toContainText('Saved with items to review');
    await expect(review).toContainText('Conditions still to check (1)');
    await review.getByText('Consolidated meeting record', { exact: true }).click();
    await expect(review).toContainText('Launch Friday only if budget is approved');
    await expect(review).not.toContainText('PRIVATE_TEST_ONLY');
    await review.getByRole('button', { name: 'View sources', exact: true }).last().click();
    await expect(
      page.getByText('Synthetic: If budget is approved, launch Friday.', { exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('closeout-with-sources.png') });
    await app.evaluate(({ app }) => app.exit(0));
    app = await electron.launch({ args: [resolve('.')], env });
    page = await workspace();
    await page.locator('.meeting-row').first().click();
    await expect(page.getByTestId('meeting-closeout')).toContainText(
      'Conditions still to check (1)',
    );
    await page.screenshot({ path: test.info().outputPath('closeout-restored.png') });
  } finally {
    await cleanupElectron(app, dir);
    await new Promise<void>((r) => server.close(() => r()));
  }
});
