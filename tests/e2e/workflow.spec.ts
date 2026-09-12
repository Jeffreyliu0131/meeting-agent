/** Production HTTP provider + actual Electron; all input/output is synthetic. */
import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('workflow: object-bound exploration, live progress, cancellation and persistent clarification', async () => {
  const contexts: any[] = [];
  let release: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    let input = '';
    for await (const chunk of req) input += chunk;
    const body = JSON.parse(input),
      c = JSON.parse(body.messages.at(-1).content);
    contexts.push(c);
    const source = c.segments.at(-1),
      sources = [{ id: source.id, rev: source.rev }];
    let p: any = {
      focus: 'Synthetic workflow',
      changes: [],
      objects: [],
      relations: [],
      action: 'no_change',
      artifact: null,
      rationale: 'Synthetic protocol',
    };
    if (c.scope === 'personal') {
      await new Promise<void>((r) => {
        release = r;
      });
    } else if (source.text.includes('AMBIGUOUS')) {
      if (!c.toolObservations.length)
        p.evidenceRequest = {
          kind: 'search_meeting',
          query: 'INITIAL',
          refs: [],
          cursor: 0,
          limit: 10,
          formulaId: '',
          overrides: {},
        };
      else {
        p.action = 'request_clarification';
        p.clarification = {
          question: 'Which rollout option do you mean?',
          candidates: c.objects.map((o: any) => ({ id: o.id, rev: o.rev })),
          affectedObjectIds: c.objects.map((o: any) => o.id),
          sources,
        };
      }
    } else {
      const objectId = c.objects[0]?.id ?? 'new_option';
      p.objects = [
        {
          id: objectId,
          kind: 'option',
          title: 'Rollout option',
          detail: source.text,
          origin: 'stated',
          status: 'unverified',
          sources,
          lifecycle: 'active',
        },
      ];
      p.action = 'create_artifact';
      p.artifact = {
        id: 'work',
        purposeKey: 'rollout',
        question: 'Rollout working view',
        summary: source.text,
        layout: 'stack',
        objectIds: [objectId],
        sources,
        formulas: [],
        blocks: [
          {
            id: 'body',
            type: 'text',
            title: 'Discussion',
            items: [source.text],
            objectIds: [objectId],
            sources,
            origin: 'stated',
            status: 'unverified',
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
  const dir = mkdtempSync(join(tmpdir(), 'workflow-electron-synthetic-'));
  const env = {
    ...process.env,
    MEETING_DEV_INPUTS: '1',
    MEETING_SYSTEM_LOCALE: 'en',
    MEETING_DATA_DIR: dir,
    OPENAI_API_KEY: 'synthetic-only',
    MEETING_API_BASE: `http://127.0.0.1:${(server.address() as any).port}`,
    MEETING_STT_API_KEY: '',
    MEETING_MIN_BATCH_MS: '100',
  };
  let app = await electron.launch({ args: [resolve('.')], env });
  const workspace = async () => {
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
  };
  try {
    let page = await workspace();
    await page.getByText('Development tools', { exact: true }).click();
    await page.getByRole('button', { name: 'Development input', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start meeting' }).click();
    await page.getByRole('button', { name: 'Add a transcript excerpt' }).click();
    const ingest = async (text: string) => {
      await page.getByRole('textbox', { name: 'Original words…' }).fill(text);
      await page.getByRole('button', { name: 'Add source', exact: true }).click();
    };
    await ingest('INITIAL synthetic option');
    await expect(
      page.getByRole('heading', { name: 'Rollout working view', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Explore this', exact: true }).click();
    await page.getByRole('button', { name: 'Rollout option +', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Ask about this meeting…' })
      .fill('PERSONAL synthetic comparison');
    await page.getByRole('textbox', { name: 'Ask about this meeting…' }).press('Enter');
    await expect.poll(() => !!release).toBe(true);
    const personal = contexts.find((c) => c.scope === 'personal');
    expect(
      personal.segments.find((s: any) => s.kind === 'request').requestContext.objectRefs,
    ).toHaveLength(1);
    await ingest('CONTINUING independent speech');
    await expect(page.locator('.focus-summary')).toHaveText('CONTINUING independent speech');
    await page
      .getByTestId('workflow-panel')
      .getByText(/^Personal exploration/)
      .click();
    await expect(page.getByTestId('personal-job')).toContainText('Baseline changed');
    await page.getByRole('button', { name: 'Cancel exploration', exact: true }).click();
    await expect(page.getByTestId('personal-job')).toContainText('Cancelled');
    release?.();
    await ingest('AMBIGUOUS that option');
    await expect(page.getByTestId('clarification')).toContainText('Which rollout option');
    await page.getByRole('textbox', { name: 'Clarification answer' }).fill('中文草稿');
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('role=workspace'),
      );
      w?.setSize(800, 600);
      w?.webContents.setZoomFactor(2);
    });
    await expect(page.getByRole('textbox', { name: 'Clarification answer' })).toHaveValue(
      '中文草稿',
    );
    await page.getByRole('textbox', { name: 'Clarification answer' }).focus();
    await expect(page.getByRole('textbox', { name: 'Clarification answer' })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.getByRole('textbox', { name: 'Clarification answer' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('textbox', { name: 'Clarification answer' })).toBeInViewport({
      ratio: 1,
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    // CDP screenshots may be blank at Electron zoom; verify the actual native rendered surface.
    const capture = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('role=workspace'),
      )!;
      const image = await w.webContents.capturePage();
      const bitmap = image.toBitmap();
      const colors = new Set<number>();
      for (let i = 0; i + 3 < bitmap.length; i += 4) colors.add(bitmap.readUInt32LE(i));
      return { png: image.toPNG().toString('base64'), colors: colors.size };
    });
    expect(capture.colors).toBeGreaterThan(16);
    writeFileSync(
      test.info().outputPath('workflow-personal-clarification.png'),
      Buffer.from(capture.png, 'base64'),
    );
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('role=workspace'),
      );
      w?.webContents.setZoomFactor(1);
      w?.setSize(1180, 808);
    });
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(page.getByTestId('clarification')).toContainText('Cancelled');
    await page.getByRole('button', { name: 'End meeting', exact: true }).click();
    await app.evaluate(({ app }) => app.exit(0));
    app = await electron.launch({ args: [resolve('.')], env });
    page = await workspace();
    await page.locator('.meeting-row').first().click();
    await expect(page.getByTestId('clarification')).toContainText('Cancelled');
    await page.screenshot({ path: test.info().outputPath('workflow-restored.png') });
    expect(
      contexts
        .filter((c) => c.scope === 'meeting')
        .every((c) => !JSON.stringify(c).includes('PERSONAL synthetic')),
    ).toBe(true);
  } finally {
    release?.();
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
