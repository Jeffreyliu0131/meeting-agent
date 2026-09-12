/** Deterministic synthetic sources + provider, rendered by the actual Electron app. No audio. */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
  type CDPSession,
} from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
let app: ElectronApplication, page: Page, server: Server, meetingId: string, cdp: CDPSession;
const quotes = [
  '能不能先用白名单邀请少数客户？这个只是一个备选。',
  '如果邀请规模可控而且支持团队同意，我可以考虑白名单。还不能说已经确定。',
  '回到刚才白名单方案，还需要给参与客户说明这是试用版。',
];
const output = resolve('tests/results/meeting-editorial');
async function viewport(width: number, height: number) {
  cdp ??= await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}
async function ingest(text: string) {
  const response = await page.evaluate(
    ({ meetingId, text }) =>
      window.meeting.call('command', {
        id: crypto.randomUUID(),
        meetingId,
        type: 'ingest',
        payload: { text, kind: 'manual' },
      }),
    { meetingId, text },
  );
  expect(response.ok).toBe(true);
}
const snapshot = () => page.evaluate(async () => (await window.meeting.call('snapshot')).value);
test.beforeEach(async () => {
  cdp = undefined as unknown as CDPSession;
  mkdirSync(output, { recursive: true });
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const c = JSON.parse(JSON.parse(raw).messages.at(-1).content);
    const sources = c.segments.map((s: any) => ({ id: s.id, rev: s.rev }));
    // Match the named evidence, never the second item of a trimmed context.
    // If that original source is outside this batch, retain the existing artifact.
    const supportSegment = c.segments.find(
      (s: any) => s.text === quotes[1] || s.text === quotes[1] + '（合成纠错）',
    );
    if (!supportSegment && c.currentArtifact) {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  focus: '首批试点应该邀请谁？',
                  changes: [],
                  objects: [],
                  relations: [],
                  action: 'no_change',
                  artifact: null,
                  rationale:
                    'Keep the established synthetic citation when its source is outside the context.',
                }),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
      );
      return;
    }
    const support = supportSegment
      ? { id: supportSegment.id, rev: supportSegment.rev }
      : sources[0];
    const common = { sources, objectIds: [], origin: 'stated', status: 'unverified' };
    const reply = {
      focus: '首批试点应该邀请谁？',
      changes: ['邀请时需说明试用性质'],
      objects: [],
      relations: [],
      action: 'create_artifact',
      rationale: 'Synthetic UI fixture only',
      artifact: {
        id: 'work',
        purposeKey: 'pilot',
        question: '首批试点应该邀请谁？',
        summary:
          c.segments.length > 3
            ? '有新的原话，支持容量仍待确认。'
            : '两种路径仍在比较，支持容量是关键条件。',
        layout: 'stack',
        objectIds: [],
        sources,
        formulas: [],
        blocks: [
          {
            ...common,
            id: 'comparison',
            type: 'table',
            title: '方案比较',
            columns: ['比较维度', '内部试用', '白名单客户试用'],
            rows: [
              {
                id: 'feedback',
                cells: ['反馈价值', '快速发现基础问题', '验证真实客户场景'],
                sources: sources.slice(0, 1),
              },
              {
                id: 'support',
                cells: ['支持条件', '支持负担较低', '需确认支持容量'],
                sources: [support],
              },
              {
                id: 'scope',
                cells: ['开放方式', '内部团队', '邀请范围待定'],
                sources: sources.slice(0, 1),
              },
            ],
          },
          {
            ...common,
            id: 'pending',
            type: 'text',
            title: '待核实',
            items: [
              '支持容量：支持团队是否能承接客户试用？',
              '邀请范围：具体客户与邀请规模尚未确定。',
              '帮助中心文案：负责人尚未确定。',
            ],
          },
        ],
      },
    };
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(reply) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'editorial-synthetic-'));
  app = await electron.launch({
    args: [resolve('.')],
    env: {
      ...process.env,
      MEETING_DEV_INPUTS: '1',
      MEETING_SYSTEM_LOCALE: 'zh-CN',
      MEETING_DATA_DIR: dir,
      OPENAI_API_KEY: 'synthetic-only',
      MEETING_API_BASE: `http://127.0.0.1:${(server.address() as any).port}`,
      MEETING_STT_API_KEY: '',
      MEETING_MIN_BATCH_MS: '100',
    },
  });
  await expect
    .poll(async () => {
      page = (await app.windows()).find((p) => p.url().includes('role=workspace'))!;
      return !!page;
    })
    .toBe(true);
  await page.waitForFunction(() => !!window.meeting);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('role=workspace'),
    );
    w?.show();
  });
  await viewport(1488, 1056);
  await page.getByText('开发测试工具', { exact: true }).click();
  await page.getByRole('button', { name: '开发测试输入', exact: true }).click();
  await page.getByRole('dialog').locator('input').first().fill('试点开放范围讨论 · 合成演示');
  await page.getByRole('dialog').locator('select').last().selectOption('zh-CN');
  await page.getByRole('dialog').getByRole('button', { name: '开始会议', exact: true }).click();
  meetingId = (await snapshot()).meetings[0].id;
  for (const quote of quotes) await ingest(quote);
  await expect
    .poll(async () => (await snapshot()).meetings[0].artifacts.at(-1)?.sources.length)
    .toBe(3);
  await expect(page.getByText('方案比较', { exact: true })).toBeVisible();
});
test.afterEach(async () => {
  // These disposable UI fixtures do not exercise the native quit-confirmation flow.
  // Terminate only PIDs reported by this launched Electron instance, including its
  // utility process, so modal confirmation and inherited stdio cannot hold the runner.
  if (app) {
    const owned = await app
      .evaluate(({ app }) => app.getAppMetrics().map((metric) => metric.pid))
      .catch(() => [] as number[]);
    const child = app.process();
    const pids = [...new Set([child.pid!, ...owned])].filter(
      (pid) => pid > 0 && pid !== process.pid,
    );
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true);
  }
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});
test('editorial: stable split, exact numbered sources, preserved reading and contextual feedback draft', async () => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const workspace = page.locator('.workspace'),
    before = await workspace.boundingBox();
  const source = page
    .getByRole('row')
    .filter({ hasText: '支持条件' })
    .getByRole('button', { name: '查看来源', exact: true });
  await expect(source).toHaveText('[2]');
  await source.click();
  const drawer = page.getByRole('dialog', { name: '查看来源' });
  await expect(drawer.locator('blockquote')).toHaveText(quotes[1]);
  const panelBox = (await drawer.boundingBox())!;
  expect(panelBox.width).toBe(372);
  expect(panelBox.x).toBe(1116);
  expect((await workspace.boundingBox())!.x).toBe(before!.x);
  expect((await workspace.boundingBox())!.width).toBe(before!.width);
  expect(await drawer.getAttribute('aria-modal')).toBeNull();
  await drawer.getByRole('button', { name: '查看全部转写' }).click();
  await expect(drawer.locator('blockquote')).toHaveCount(3);
  await expect(drawer.locator('[data-cited="true"] blockquote')).toHaveText(quotes[1]);
  await expect.poll(() => page.locator('.expression-changed').count()).toBe(0);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ scale: 'css', path: join(output, 'desktop-sources.png') });
  await ingest('新的补充：支持容量仍未确认。');
  await expect(page.locator('.reading-update')).toBeVisible();
  // Only the inspected comparison is held; the question summary follows live updates.
  await expect(page.locator('.focus-summary')).toHaveText('有新的原话，支持容量仍待确认。');
  await page.getByRole('button', { name: '查看新内容', exact: true }).click();
  await expect(page.locator('.focus-summary')).toHaveText('有新的原话，支持容量仍待确认。');
  await page.getByRole('button', { name: '进一步讨论', exact: true }).click();
  await page.locator('.ask-bar textarea').fill('保留已有的个人草稿。');
  await drawer.locator('[data-cited="true"]').getByRole('button', { name: '反馈理解' }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator('.ask-bar textarea')).toBeFocused();
  expect(await page.locator('.ask-bar textarea').inputValue()).toContain(quotes[1]);
  expect(await page.locator('.ask-bar textarea').inputValue()).toContain('保留已有的个人草稿。');
  // Feedback is only a draft; no request was sent to the model.
  expect(
    (await snapshot()).meetings[0].segments.filter((s: any) => s.kind === 'request'),
  ).toHaveLength(0);
  expect(errors).toEqual([]);
  writeFileSync(
    join(output, 'geometry.json'),
    JSON.stringify(
      {
        viewport: { width: 1488, height: 1056 },
        sourcePanel: panelBox,
        before,
        after: await workspace.boundingBox(),
        errors,
        synthetic: true,
        audio: false,
      },
      null,
      2,
    ),
  );
});
test('editorial: narrow overlay, focus, correction draft, readable zoom and English shell', async () => {
  await viewport(800, 600);
  await page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '查看来源' });
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  expect(await page.locator('.workspace').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  await drawer.getByRole('button', { name: '纠正来源', exact: true }).first().click();
  await drawer
    .getByRole('textbox', { name: '原始发言', exact: true })
    .fill('纠错草稿：保留这句话。');
  await drawer.getByRole('textbox', { name: '原始发言', exact: true }).press('Escape');
  await expect(drawer).toBeHidden();
  expect(await page.locator('.workspace').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  await expect(
    page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }),
  ).toBeFocused();
  await page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }).click();
  await expect(drawer.getByRole('textbox', { name: '原始发言', exact: true })).toHaveValue(
    '纠错草稿：保留这句话。',
  );
  await page.screenshot({ scale: 'css', path: join(output, 'narrow-correction.png') });
  await drawer.getByRole('textbox', { name: '原始发言', exact: true }).press('Escape');
  const prefs = (await snapshot()).preferences;
  await page.evaluate(
    ({ prefs }) =>
      window.meeting.call('command', {
        id: crypto.randomUUID(),
        meetingId: null,
        type: 'preferencesPatch',
        payload: { uiLanguage: 'en' },
      }),
    { prefs },
  );
  await expect(
    page.getByRole('navigation').getByRole('button', { name: 'View sources', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'View sources', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'View sources' })).toBeVisible();
  await page.screenshot({ scale: 'css', path: join(output, 'english-narrow.png') });
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('role=workspace'),
    )!;
    w.setSize(800, 600);
    w.webContents.setZoomFactor(2);
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  const box = (await page.locator('.source-panel').boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(400);
  expect(box.y).toBe(0);
  expect(box.height).toBeGreaterThan(250);
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }),
  ).toBeVisible();
  const capture = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('role=workspace'),
    )!;
    return {
      image: (await w.webContents.capturePage()).toPNG().toString('base64'),
      zoom: w.webContents.getZoomFactor(),
      bounds: w.getContentBounds(),
    };
  });
  writeFileSync(join(output, 'zoom-200.png'), Buffer.from(capture.image, 'base64'));
  writeFileSync(
    join(output, 'zoom-200.json'),
    JSON.stringify(
      {
        zoom: capture.zoom,
        bounds: capture.bounds,
        viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
        sourcePanel: box,
      },
      null,
      2,
    ),
  );
});

test('editorial: long transcript preserves scroll and corrected source keeps its number and old revision', async () => {
  for (let i = 0; i < 8; i++) await ingest(`合成补充 ${i + 1}：${quotes[1]} ${quotes[2]}`);
  await page.getByRole('navigation').getByRole('button', { name: '查看来源', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '查看来源' }),
    scroller = panel.locator('.source-panel-scroll');
  await expect(panel.locator('.source-excerpt')).toHaveCount(11);
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(panel.getByRole('button', { name: /回到最新/ })).toBeVisible();
  await ingest('合成新增：只增加这一段，不能打断正在回看的位置。');
  await expect(panel.locator('.source-excerpt')).toHaveCount(12);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(panel.getByRole('button', { name: '回到最新 · 1', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '回到最新 · 1', exact: true }).click();
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThan(2);
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  await page
    .getByRole('row')
    .filter({ hasText: '支持条件' })
    .getByRole('button', { name: '查看来源', exact: true })
    .click();
  const selected = (await snapshot()).meetings[0].segments[1];
  await expect(panel.locator('blockquote')).toHaveText(quotes[1]);
  await panel.getByRole('button', { name: '纠正来源', exact: true }).click();
  await panel
    .getByRole('textbox', { name: '原始发言', exact: true })
    .fill(quotes[1] + '（合成纠错）');
  await panel.getByRole('button', { name: '保存纠正', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot()).meetings[0].segments.filter((s: any) => s.id === selected.id).length,
    )
    .toBe(2);
  // A historical citation must not silently show corrected text.
  await expect(panel.locator('blockquote')).toHaveText(quotes[1]);
  await expect(panel.locator('.source-number')).toHaveText('[2]');
  await expect(panel.locator('.stale')).toBeVisible();
  await panel.getByRole('button', { name: '查看全部转写', exact: true }).click();
  await expect(panel.locator('.source-excerpt').nth(1).locator('.source-number')).toHaveText('[2]');
  await expect(panel.locator('.source-excerpt').nth(1).locator('blockquote')).toHaveText(
    quotes[1] + '（合成纠错）',
  );
  await page.screenshot({ scale: 'css', path: join(output, 'corrected-source.png') });
});

test('editorial: explicit history navigation releases reading hold and failed corrections stay actionable', async () => {
  await ingest('新增合成来源：条件尚未确认。');
  await expect
    .poll(async () => (await snapshot()).meetings[0].artifacts.at(-1)?.sources.length)
    .toBe(4);
  await page
    .getByRole('row')
    .filter({ hasText: '支持条件' })
    .getByRole('button', { name: '查看来源', exact: true })
    .click();
  await page.getByRole('button', { name: '版本', exact: true }).click();
  const historyIndex = (await snapshot()).meetings[0].artifacts
    .slice()
    .reverse()
    .findIndex((artifact: any) => artifact.sources.length === 3);
  expect(historyIndex).toBeGreaterThanOrEqual(0);
  await page.locator('.version-list button').nth(historyIndex).click();
  await expect(page.getByRole('dialog', { name: '查看来源' })).toBeHidden();
  await expect(page.locator('.focus-summary')).toHaveText('两种路径仍在比较，支持容量是关键条件。');
  await page
    .getByRole('row')
    .filter({ hasText: '支持条件' })
    .getByRole('button', { name: '查看来源', exact: true })
    .click();
  const panel = page.getByRole('dialog', { name: '查看来源' });
  await panel.getByRole('button', { name: '纠正来源', exact: true }).click();
  const field = panel.getByRole('textbox', { name: '原始发言', exact: true });
  await field.fill('仍在编辑的草稿');
  const source = (await snapshot()).meetings[0].segments[1];
  const correction = await page.evaluate(
    ({ meetingId, source }) =>
      window.meeting.call('command', {
        id: crypto.randomUUID(),
        meetingId,
        type: 'correct',
        payload: {
          segmentId: source.id,
          baseRevision: source.rev,
          text: source.text + '（其他已保存修订）',
          speaker: null,
          basis: '',
        },
      }),
    { meetingId, source },
  );
  expect(correction.ok).toBe(true);
  await panel.getByRole('button', { name: '保存纠正', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(field).toHaveValue('仍在编辑的草稿');
  await expect(panel.getByRole('button', { name: '保存纠正', exact: true })).toBeEnabled();
});
