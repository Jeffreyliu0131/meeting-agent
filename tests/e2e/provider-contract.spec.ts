/** All provider answers in this file are explicit transport TEST DOUBLES.
 * These tests do not assess real model semantics or real microphone quality. */
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
let server: Server,
  base: string,
  app: ElectronApplication,
  dir: string,
  calls = 0,
  sttDelay = 0;
function reply(context: any) {
  const s = context.segments.at(-1),
    sources = [{ id: s.id, rev: s.rev }];
  const common = {
    sources,
    objectIds: ['option-a', 'capacity'],
    origin: 'stated',
    status: 'unverified',
  };
  const answer: any = {
    focus: 'Protocol fixture — not real model output',
    changes: ['A transport test update'],
    objects: [
      {
        id: 'option-a',
        kind: 'option',
        title: 'Invited participants',
        detail: 'Synthetic renderer fixture',
        origin: 'stated',
        status: 'unverified',
        sources,
        lifecycle: 'active',
      },
      {
        id: 'capacity',
        kind: 'constraint',
        title: 'Support capacity',
        detail: 'Unconfirmed',
        origin: 'stated',
        status: 'unknown',
        sources,
        lifecycle: 'active',
      },
    ],
    relations: [
      {
        id: 'condition',
        from: 'option-a',
        to: 'capacity',
        kind: 'conditions',
        origin: 'stated',
        sources,
      },
    ],
    action: 'patch_artifact',
    artifact: {
      id: 'work',
      purposeKey: 'pilot',
      question:
        context.outputLocale === 'zh-CN'
          ? '谁应参加试点？（协议测试）'
          : 'Who should join the pilot? · Protocol test',
      summary: 'Synthetic provider output. Batch ' + context.inputVersion + ' — transport only.',
      layout: 'stack',
      objectIds: common.objectIds,
      sources,
      blocks: [
        {
          ...common,
          id: 'comparison',
          type: 'table',
          title: 'Two routes, one unresolved condition',
          columns: ['', 'Internal team', 'Invited customers'],
          rows: [
            { id: 'learn', cells: ['Learning', 'Internal feedback', 'Customer feedback'], sources },
            { id: 'support', cells: ['Support', 'Lower load', 'Capacity to confirm'], sources },
            { id: 'access', cells: ['Access', 'Team only', 'Invite only'], sources },
          ],
        },
        {
          ...common,
          id: 'dependency',
          type: 'diagram',
          title: 'Key condition',
          nodes: [
            { id: 'invite', label: 'Invited customers', objectId: 'option-a' },
            { id: 'support', label: 'Support capacity', objectId: 'capacity' },
          ],
          edges: [
            { from: 'invite', to: 'support', relationId: 'condition', label: 'only if confirmed' },
          ],
        },
      ],
      formulas: [
        {
          id: 'cost',
          label: 'Personal cost scenario',
          unit: 'SGD',
          parameters: [
            { id: 'venue', label: 'Venue estimate', unit: 'SGD', value: 150, min: 0, max: 10000 },
            { id: 'people', label: 'People', unit: 'people', value: 30, min: 0, max: 1000 },
            {
              id: 'food',
              label: 'Catering per person',
              unit: 'SGD/person',
              value: 12,
              min: 0,
              max: 1000,
            },
          ],
          steps: [
            { id: 'catering', op: 'multiply', left: 'people', right: 'food' },
            { id: 'total', op: 'add', left: 'venue', right: 'catering' },
          ],
          result: 'total',
          basis: 'Synthetic test formula: venue + people × catering per person',
          sources,
        },
      ],
    },
    titleProposal:
      context.title?.origin === 'placeholder'
        ? {
            text: 'Pilot planning · Synthetic title',
            baseRevision: context.title.revision,
            sources,
          }
        : null,
    rationale: 'Deterministic provider contract fixture',
  };
  if (s.text === 'PASSIVE_CARRIER_PROTOCOL_TEST')
    answer.artifact.blocks = [
      {
        ...common,
        id: 'text',
        type: 'text',
        title: 'A concise observation',
        items: ['Synthetic carrier validation only.'],
      },
      {
        ...common,
        id: 'timeline',
        type: 'timeline',
        title: 'Timing',
        items: [
          {
            id: 'step',
            label: 'Confirm capacity',
            when: 'Unknown date',
            detail: 'No duration supplied',
            sources,
          },
        ],
      },
      {
        ...common,
        id: 'chart',
        type: 'chart',
        title: 'Known quantities',
        unit: 'people',
        values: [{ label: 'Synthetic count', value: 30, sources }],
      },
      {
        ...common,
        id: 'svg',
        type: 'svg',
        title: 'Simple SVG',
        markup:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 100"><rect x="10" y="10" width="570" height="70" rx="8" fill="#EDF2FA" stroke="#315DA8"/><text x="30" y="52" font-size="18" fill="#1D2430">Synthetic SVG protocol fixture</text></svg>',
      },
      {
        ...common,
        id: 'html',
        type: 'html',
        title: 'Composed explanation',
        markup:
          '<section><h2>Open condition</h2><p>Confirm support before inviting customers.</p><ul><li>Timing remains unknown.</li></ul></section>',
      },
    ];
  return answer;
}
test.beforeEach(async () => {
  ((calls = 0), (sttDelay = 0));
  server = createServer(async (req, res) => {
    let data = '';
    for await (const chunk of req) data += chunk;
    if (req.url === '/chat/completions') {
      calls++;
      const body = JSON.parse(data),
        context = JSON.parse(body.messages.at(-1).content);
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(reply(context)) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
      );
    } else {
      res.setHeader('Content-Type', 'application/json');
      await new Promise((r) => setTimeout(r, sttDelay));
      res.end(
        JSON.stringify({
          text: 'Synthetic generated audio transport fixture; not a real meeting.',
        }),
      );
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  dir = mkdtempSync(join(tmpdir(), 'meeting-provider-test-'));
  app = await electron.launch({
    args: [resolve('.'), '--use-fake-device-for-media-stream'],
    env: {
      ...process.env,
      MEETING_DEV_INPUTS: test.info().title.startsWith('normal') ? '' : '1',
      MEETING_SYSTEM_LOCALE: 'en',
      MEETING_DATA_DIR: dir,
      OPENAI_API_KEY: 'test-transport-only',
      MEETING_API_BASE: base,
      MEETING_STT_API_KEY: 'test-transport-only',
      MEETING_STT_API_BASE: base,
    },
  });
});
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await new Promise<void>((r) => server.close(() => r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});
test('provider transport, isolated preflight, generated structure, source binding, updates and personal calculator', async () => {
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
  await page.getByText('Development tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Development input', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start meeting' }).click();
  await page.getByRole('button', { name: 'Add a transcript excerpt' }).click();
  await page
    .getByRole('textbox', { name: 'Original words…' })
    .fill('Synthetic transport fixture, not a live meeting.');
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Who should join the pilot? · Protocol test' }),
  ).toBeVisible();
  expect(calls).toBe(1);
  await page.getByRole('button', { name: 'Calculate with these assumptions' }).click();
  await expect(page.getByText('Result: 510 SGD')).toBeVisible();
  await page.getByLabel('People (people)', { exact: true }).fill('40');
  await page.getByRole('button', { name: 'Calculate with these assumptions' }).click();
  await expect(page.getByText('Result: 630 SGD')).toBeVisible();
  await page.getByRole('button', { name: 'Save this scenario', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore this', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Ask about this meeting…' })
    .fill('Draft kept while a new version arrives');
  await page
    .getByRole('textbox', { name: 'Original words…' })
    .fill('Synthetic fixture correction: support capacity is still unknown.');
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await expect
    .poll(async () => {
      const state = await page.evaluate(() => window.meeting.call('snapshot'));
      return state.value.meetings[0].artifacts.length;
    })
    .toBe(2);
  await expect(page.getByRole('button', { name: 'Show latest version' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Ask about this meeting…' })).toHaveValue(
    'Draft kept while a new version arrives',
  );
  await expect(page.getByLabel('People (people)', { exact: true })).toHaveValue('40');
  await page.getByRole('button', { name: 'Remove context', exact: true }).click();
  await expect(page.locator('.context-chip')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Ask about this meeting…' })).toHaveValue(
    'Draft kept while a new version arrives',
  );
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Contents' })
    .getByRole('button', { name: 'Key condition' })
    .click();
  await expect(page.locator('[data-block-id="dependency"]')).toBeFocused();

  await expect(
    page.getByText('Synthetic provider output. Batch 2 — transport only.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Current focus', { exact: false }).first()).toBeVisible();
  await page
    .getByRole('button', {
      name: 'View sources: Two routes, one unresolved condition',
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole('dialog', { name: 'View sources' })
      .getByText('Two routes, one unresolved condition', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'tests/results/e2e-artifacts/refresh-sources.png' });
  await page
    .getByRole('dialog', { name: 'View sources' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();

  for (const size of [
    { width: 1440, height: 1024 },
    { width: 1024, height: 768 },
    { width: 800, height: 600 },
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('role=workspace'))
          ?.setSize(size.width, size.height),
      size,
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `tests/results/e2e-artifacts/contract-workspace-${size.width}.png`,
      fullPage: true,
    });
  }
  const state = await page.evaluate(() => window.meeting.call('snapshot'));
  expect(state.value.meetings[0].artifacts).toHaveLength(2);
  expect(state.value.meetings[0].artifacts[0].id).toBe(state.value.meetings[0].artifacts[1].id);
  expect(state.value.meetings[0].scenarios[0].result).toBe('630');
  expect(state.value.meetings[0].decisions).toHaveLength(0);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('role=workspace'))
      ?.webContents.setZoomFactor(2),
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await expect(page.locator('.relationship-list')).toBeVisible();
  // Electron zoom affects CDP screenshot cropping; use the native surface at 200%.
  const zoomCapture = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('role=workspace'))!
        .webContents.capturePage()
    )
      .toPNG()
      .toString('base64'),
  );
  writeFileSync(
    'tests/results/e2e-artifacts/refresh-workspace-200.png',
    Buffer.from(zoomCapture, 'base64'),
  );
});
test('synthetic oscillator keeps capturing through a slow STT response and stops cleanly', async () => {
  sttDelay = 6500;
  let page: any, capture: any;
  await expect
    .poll(async () => {
      const windows = await app.windows();
      page = windows.find((p) => p.url().includes('role=workspace'));
      capture = windows.find((p) => p.url().includes('capture.html'));
      return !!page && !!capture;
    })
    .toBe(true);
  await capture.evaluate(() => {
    // Only this test replaces physical devices. Production never installs this override.
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      oscillator.frequency.value = 220;
      const output = ctx.createMediaStreamDestination();
      oscillator.connect(output);
      oscillator.start();
      await ctx.resume();
      (window as any).testTrack = output.stream.getAudioTracks()[0];
      (window as any).testAudioContext = ctx;
      return output.stream;
    };
  });
  const created = await page.evaluate(() =>
    window.meeting.call('command', {
      id: crypto.randomUUID(),
      meetingId: null,
      type: 'create',
      payload: {
        title: 'Synthetic oscillator input test',
        mode: 'microphone',
        outputLocale: 'en',
        timezone: 'UTC',
      },
    }),
  );
  expect(created.ok).toBe(true);
  const started = await page.evaluate(
    (id: string) => window.meeting.call('capture', { action: 'start', meetingId: id }),
    created.value,
  );
  expect(started.ok).toBe(true);
  await expect
    .poll(async () => {
      const r = await page.evaluate(() => window.meeting.call('snapshot'));
      return r.value.meetings[0].capture;
    })
    .toBe('capturing');
  await expect
    .poll(
      async () => {
        const r = await page.evaluate(() => window.meeting.call('snapshot'));
        return r.value.meetings[0].segments.length;
      },
      { timeout: 25000 },
    )
    .toBeGreaterThan(1);
  const live = await page.evaluate(() => window.meeting.call('snapshot'));
  expect(live.value.meetings[0].capture).toBe('capturing');
  await page.evaluate(
    (id: string) =>
      window.meeting.call('command', {
        id: crypto.randomUUID(),
        meetingId: id,
        type: 'end',
        payload: {},
      }),
    created.value,
  );
  await expect
    .poll(() => capture.evaluate(() => (window as any).testTrack.readyState))
    .toBe('ended');
  const stopped = await page.evaluate(() => window.meeting.call('snapshot'));
  expect(stopped.value.meetings[0].capture).toBe('stopped');
  expect(stopped.value.meetings[0].segments[0].kind).toBe('microphone');
  expect(stopped.value.meetings[0].segments[0].identity).toBe('unknown');
  await capture.evaluate(() => (window as any).testAudioContext.close());
});
test('text, timeline, chart, SVG and passive HTML render without a privileged bridge', async () => {
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
  await page.getByText('Development tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Development input', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start meeting' }).click();
  await page.getByRole('button', { name: 'Add a transcript excerpt' }).click();
  await page
    .getByRole('textbox', { name: 'Original words…' })
    .fill('PASSIVE_CARRIER_PROTOCOL_TEST');
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Simple SVG', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Timing', exact: true })).toBeVisible();
  await expect(page.getByText('30 people', { exact: true })).toBeVisible();
  const frame = page.frameLocator('iframe[title="Composed explanation"]');
  await expect(frame.getByText('Confirm support before inviting customers.')).toBeVisible();
  expect(await frame.locator('body').evaluate(() => typeof (window as any).meeting)).toBe(
    'undefined',
  );
  expect(await frame.locator('body').evaluate(() => typeof (window as any).require)).toBe(
    'undefined',
  );
  await page.screenshot({
    path: 'tests/results/e2e-artifacts/passive-carriers.png',
    fullPage: true,
  });
});

test('normal meeting entry saves setup once, starts audio in one intent and reveals exploration only after content', async () => {
  let page: any, capture: any;
  await expect
    .poll(async () => {
      const windows = await app.windows();
      page = windows.find((p) => p.url().includes('role=workspace'));
      capture = windows.find((p) => p.url().includes('capture.html'));
      return !!page && !!capture;
    })
    .toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('role=workspace'),
    );
    w?.show();
    w?.focus();
  });
  await capture.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async (constraints: any) => {
      if (constraints?.audio?.deviceId?.exact === 'missing-device')
        throw new DOMException('Unavailable', 'OverconstrainedError');
      const ctx = new AudioContext(),
        oscillator = ctx.createOscillator(),
        output = ctx.createMediaStreamDestination();
      oscillator.connect(output);
      oscillator.start();
      await ctx.resume();
      (window as any).testContexts ??= [];
      (window as any).testContexts.push(ctx);
      return output.stream;
    };
  });
  await expect(page.getByText('Development tools', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Ask about this meeting…' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start meeting' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Meeting audio' })).toBeVisible();
  await expect(page.getByLabel('Interface language', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'tests/results/e2e-artifacts/audio-settings.png', fullPage: true });
  await expect(page.getByLabel('Meeting title', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  let state = await page.evaluate(() => window.meeting.call('snapshot'));
  expect(state.value.meetings.length).toBe(0);
  expect(state.value.preferences.audio.setupCompleted).toBe(true);
  await page.getByRole('button', { name: 'Start meeting' }).first().click();
  await expect
    .poll(async () => {
      const s = await page.evaluate(() => window.meeting.call('snapshot'));
      return s.value.meetings[0]?.capture;
    })
    .toBe('capturing');
  await expect(page.getByRole('textbox', { name: 'Ask about this meeting…' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add a transcript excerpt' })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Who should join the pilot? · Protocol test' }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByRole('button', { name: 'Pilot planning · Synthetic title', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask about this meeting…' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Explore this', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Ask about this meeting…' })).toBeVisible();
  state = await page.evaluate(() => window.meeting.call('snapshot'));
  const first = state.value.meetings[0].id;
  const repeated = await page.evaluate(() =>
    Promise.all([
      window.meeting.call('startMeeting', { requestId: 'duplicate-a' }),
      window.meeting.call('startMeeting', { requestId: 'duplicate-b' }),
    ]),
  );
  expect(repeated.every((r: any) => r.value.meetingId === first)).toBe(true);
  await page.getByRole('button', { name: 'End meeting', exact: true }).click();
  await page.getByRole('button', { name: 'Meetings', exact: true }).click();
  await page.getByRole('button', { name: 'Start meeting' }).first().click();
  await expect
    .poll(async () => {
      const s = await page.evaluate(() => window.meeting.call('snapshot'));
      return s.value.meetings[0]?.capture;
    })
    .toBe('capturing');
  state = await page.evaluate(() => window.meeting.call('snapshot'));
  expect(state.value.meetings.length).toBe(2);
  expect(state.value.meetings[0].id).not.toBe(first);
  await page.getByRole('button', { name: 'End meeting', exact: true }).click();
  const failedStart = await page.evaluate(async () => {
    const s = await window.meeting.call('snapshot');
    await window.meeting.call('command', {
      id: crypto.randomUUID(),
      meetingId: null,
      type: 'preferences',
      payload: {
        ...s.value.preferences,
        audio: { ...s.value.preferences.audio, deviceId: 'missing-device' },
      },
    });
    return window.meeting.call('startMeeting', { requestId: 'missing-device-start' });
  });
  await expect
    .poll(async () => {
      const s = await page.evaluate(() => window.meeting.call('snapshot'));
      return s.value.meetings[0].captureError;
    })
    .toBe('MICROPHONE_UNAVAILABLE');
  const restored = await page.evaluate(async () => {
    const s = await window.meeting.call('snapshot');
    await window.meeting.call('command', {
      id: crypto.randomUUID(),
      meetingId: null,
      type: 'preferences',
      payload: {
        ...s.value.preferences,
        audio: { ...s.value.preferences.audio, deviceId: 'default' },
      },
    });
    await window.meeting.call('applyAudioSettings');
    return s.value.meetings[0].id;
  });
  expect(restored).toBe(failedStart.value.meetingId);
  await expect
    .poll(async () => {
      const s = await page.evaluate(() => window.meeting.call('snapshot'));
      return s.value.meetings[0].capture;
    })
    .toBe('capturing');
  await page.getByRole('button', { name: 'End meeting', exact: true }).click();
  await page.screenshot({ path: 'tests/results/e2e-artifacts/normal-entry.png', fullPage: true });
  await capture.evaluate(async () => {
    for (const ctx of (window as any).testContexts ?? []) await ctx.close();
  });
});
