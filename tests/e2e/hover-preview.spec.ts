/** Synthetic meeting and loopback provider; real service, renderer and native windows. No audio. */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cleanupElectron } from './cleanup';
let app: ElectronApplication,
  workspace: Page,
  launcher: Page,
  preview: Page,
  server: Server,
  dataDir: string;
let meetingId: string;
let includeMarkup = false;
const call = async (page: Page, method: string, args?: unknown) => {
  const r = await page.evaluate(({ method, args }) => window.meeting.call(method, args), {
    method,
    args,
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.value;
};
const command = (type: string, payload: unknown = {}, id: string | null = meetingId) =>
  call(workspace, 'command', {
    id: crypto.randomUUID(),
    meetingId: id,
    type,
    payload,
  });
const native = (role: string) =>
  app.evaluate(({ BrowserWindow }, role) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('role=' + role),
    )!;
    return { visible: w.isVisible(), focused: w.isFocused(), bounds: w.getBounds() };
  }, role);
const leave = async (page: Page) => page.mouse.move(-20, -20);
const enter = async () => {
  await leave(launcher);
  await launcher.locator('.launcher').hover();
};
async function create() {
  meetingId = await command(
    'create',
    {
      title: '悬停画板 · 合成测试',
      mode: 'manual',
      outputLocale: 'zh-CN',
      timezone: 'Asia/Singapore',
    },
    null,
  );
}
async function ingest(n: number) {
  await command('ingest', {
    text: `合成发言 ${n}：先确认支持容量，再讨论邀请客户。`,
    kind: 'manual',
  });
  await expect
    .poll(
      async () =>
        (await call(workspace, 'snapshot')).meetings.find((m: any) => m.id === meetingId)
          ?.understoodVersion,
    )
    .toBe(n);
}

test.beforeEach(async () => {
  includeMarkup = false;
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const context = JSON.parse(JSON.parse(raw).messages.at(-1).content);
    const sources = context.segments
      .filter((s: any) => s.kind !== 'request')
      .map((s: any) => ({ id: s.id, rev: s.rev }));
    const ids = ['capacity', 'invite'].map(
      (detail) => context.objects.find((o: any) => o.detail === detail)?.id ?? detail,
    );
    const rel = context.relations[0]?.id ?? 'condition';
    const common = { sources, objectIds: ids, origin: 'agent_inferred', status: 'unverified' };
    const proposal = {
      focus: '如何推进客户试用？',
      changes: [`合成更新 ${context.inputVersion}：容量仍待确认。`],
      objects: ids.map((id, i) => ({
        id,
        kind: i ? 'task' : 'constraint',
        title: i ? '邀请客户' : '确认支持容量',
        detail: i ? 'invite' : 'capacity',
        origin: 'stated',
        status: 'unverified',
        sources,
        lifecycle: 'active',
      })),
      relations: [
        {
          id: rel,
          from: ids[0],
          to: ids[1],
          kind: 'conditions',
          origin: 'agent_inferred',
          sources,
        },
      ],
      action: 'create_artifact',
      rationale: 'Synthetic hover canvas test',
      artifact: {
        id: 'hover_work',
        purposeKey: 'customer_pilot',
        question: '如何推进客户试用？',
        summary: `合成更新 ${context.inputVersion}：容量仍待确认。`,
        layout: 'stack',
        objectIds: ids,
        sources,
        formulas: [],
        blocks: [
          ...(includeMarkup ? [{ ...common, id: 'markup', type: 'svg', title: 'Synthetic sandbox canvas',
            markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 90"><rect width="600" height="90" rx="12" fill="#edf3fc"/><text x="24" y="53" font-size="20" fill="#243750">Synthetic generated canvas</text></svg>' }] : []),
          {
            ...common,
            id: 'flow',
            type: 'diagram',
            title: '推进条件',
            layout: 'flow',
            nodes: [
              { id: 'a', objectId: ids[0], label: '确认支持容量' },
              { id: 'b', objectId: ids[1], label: '邀请客户' },
            ],
            edges: [{ from: 'a', to: 'b', relationId: rel, label: '成立条件' }],
          },
          {
            ...common,
            id: 'comparison',
            type: 'table',
            title: '方案比较',
            columns: ['选项', '支持条件', '当前状态'],
            rows: [{ id: 'row', cells: ['小范围邀请', '先确认容量', '尚未决定'], sources }],
          },
          {
            ...common,
            id: 'notes',
            type: 'text',
            title: '待核实',
            items: Array.from({ length: 6 }, (_, i) => `核对项 ${i + 1}：支持容量仍需负责人确认。`),
          },
          {
            ...common,
            id: 'next',
            type: 'actions',
            title: '继续讨论',
            items: [
              { id: 'explore', label: '比较试用路径', prompt: '请比较不同试用路径。', sources },
            ],
          },
        ],
      },
    };
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(proposal) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  dataDir = mkdtempSync(join(tmpdir(), 'meeting-desktop-hover-'));
  const executablePath = process.env.MEETING_HOVER_EXECUTABLE;
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [resolve('.')] }),
    env: {
      ...process.env,
      MEETING_DEV_INPUTS: '1',
      MEETING_SYSTEM_LOCALE: 'zh-CN',
      MEETING_DATA_DIR: dataDir,
      OPENAI_API_KEY: 'synthetic-only',
      MEETING_API_BASE: `http://127.0.0.1:${(server.address() as any).port}`,
      MEETING_STT_API_KEY: '',
      MEETING_AUTOSTART_PROXY: '0',
      MEETING_MIN_BATCH_MS: '100',
    },
  });
  await expect
    .poll(async () => {
      const pages = await app.windows();
      workspace = pages.find((p) => p.url().includes('role=workspace'))!;
      launcher = pages.find((p) => p.url().includes('role=launcher'))!;
      preview = pages.find((p) => p.url().includes('role=preview'))!;
      return !!workspace && !!launcher && !!preview;
    })
    .toBe(true);
  await expect
    .poll(async () => (await workspace.evaluate(() => window.meeting.call('snapshot'))).ok)
    .toBe(true);
  await expect.poll(async () => (await native('launcher')).visible).toBe(true);
  preview.on('pageerror', (e) => console.log('Preview error:', e.message));
  // A controlled foreground surface verifies that showing the preview leaves focus alone.
  await app.evaluate(async ({ BrowserWindow }) => {
    const surface = new BrowserWindow({
      width: 300,
      height: 160,
      x: 30,
      y: 50,
      title: 'Synthetic meeting surface',
      show: false,
    });
    await surface.loadURL('data:text/html,<p>Synthetic meeting surface</p>');
    surface.show();
    surface.focus();
  });
});

test.afterEach(async () => {
  if (test.info().status !== test.info().expectedStatus) {
    console.log(
      'Hover failure state',
      JSON.stringify({
        meeting: (await call(workspace, 'snapshot')).meetings.map((m: any) => ({
          error: m.error,
          understoodVersion: m.understoodVersion,
          calls: m.calls,
        })),
        workspace: await native('workspace'),
        launcher: await native('launcher'),
        preview: await native('preview'),
        pointerEvents: await launcher.evaluate(() => (globalThis as any).__pointerEvents),
      }),
    );
  }
  await cleanupElectron(app, dataDir);
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

test('hover shows the actual canvas and live revisions while the workspace stays hidden', async () => {
  await create();
  const focusedBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id ?? null);
  await enter();
  await expect.poll(async () => (await native('preview')).visible).toBe(true);
  await expect(preview.getByText('有值得整理的内容时，画板会在这里呈现。')).toBeVisible();
  expect((await native('workspace')).visible).toBe(false);
  expect((await native('preview')).focused).toBe(false);
  expect(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id ?? null),
  ).toBe(focusedBefore);
  await ingest(1);
  await expect(preview.locator('.preview-summary')).toHaveText('合成更新 1：容量仍待确认。');
  await expect(preview.locator('.relationship-canvas')).toBeVisible();
  await expect(preview.locator('table')).toHaveCount(1);
  await leave(launcher);
  await preview.mouse.move(40, 30);
  await preview.locator('.preview-scroll').evaluate((el) => {
    el.scrollTop = 140;
  });
  const before = await preview.locator('.preview-scroll').evaluate((el) => el.scrollTop);
  await ingest(2);
  await expect(preview.locator('.preview-summary')).toHaveText('合成更新 2：容量仍待确认。');
  expect(await preview.locator('.preview-scroll').evaluate((el) => el.scrollTop)).toBe(before);
  expect((await native('preview')).visible).toBe(true);
  expect((await native('workspace')).visible).toBe(false);
  await preview.locator('.preview-scroll').evaluate((el) => {
    el.scrollTop = 0;
  });
  await preview.screenshot({ path: test.info().outputPath('hover-canvas.png') });
  await leave(preview);
  await expect.poll(async () => (await native('preview')).visible).toBe(false);
  await ingest(3);
  await enter();
  await expect.poll(async () => (await native('preview')).visible).toBe(true);
  await expect(preview.locator('.preview-summary')).toHaveText('合成更新 3：容量仍待确认。');
  const state = await call(workspace, 'snapshot');
  expect(state.meetings[0].status).toBe('active');
  expect(state.meetings[0].capture).toBe('idle');
});

test('union-region grace, pending hover cancellation, drag and native menu do not open the workspace', async () => {
  await create();
  await enter();
  await leave(launcher);
  await new Promise((r) => setTimeout(r, 400));
  expect((await native('preview')).visible).toBe(false);
  await enter();
  await expect.poll(async () => (await native('preview')).visible).toBe(true);
  await leave(launcher);
  await preview.mouse.move(30, 30);
  await new Promise((r) => setTimeout(r, 400));
  expect((await native('preview')).visible).toBe(true);
  await leave(preview);
  await launcher.mouse.move(20, 20);
  await new Promise((r) => setTimeout(r, 400));
  expect((await native('preview')).visible).toBe(true);
  await launcher.evaluate(() => {
    (globalThis as any).__pointerEvents = [];
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'lostpointercapture',
      'pointercancel',
      'mouseover',
      'mouseout',
    ])
      document.addEventListener(type, (e) =>
        (globalThis as any).__pointerEvents.push({
          type,
          buttons: (e as PointerEvent).buttons,
          x: (e as PointerEvent).screenX,
          y: (e as PointerEvent).screenY,
        }),
      );
  });
  await launcher.mouse.down();
  await launcher.mouse.move(35, 20, { steps: 3 });
  await call(launcher, 'hover', true); // A queued native enter during a drag cannot show it.
  await new Promise((r) => setTimeout(r, 400));
  expect((await native('preview')).visible).toBe(false);
  await launcher.mouse.up();
  expect((await native('workspace')).visible).toBe(false);
  await enter();
  await expect.poll(async () => (await native('preview')).visible).toBe(true);
  await app.evaluate(({ Menu }) => {
    const original = Menu.prototype.popup;
    Menu.prototype.popup = function (options) {
      (globalThis as any).__hoverMenu = this;
      original.call(this, options);
    };
  });
  await call(launcher, 'menu');
  await call(launcher, 'hover', true);
  await new Promise((r) => setTimeout(r, 400));
  expect((await native('preview')).visible).toBe(false);
  await app.evaluate(() => (globalThis as any).__hoverMenu.closePopup());
  expect((await native('workspace')).visible).toBe(false);
  // Explicit click still opens exactly one persistent workspace.
  await launcher.locator('.launcher').click();
  await expect.poll(async () => (await native('workspace')).visible).toBe(true);
  await leave(launcher);
  await new Promise((r) => setTimeout(r, 400));
  expect((await native('workspace')).visible).toBe(true);
});

test('sources open the displayed revision and suggested actions only prepare a draft', async () => {
  await create();
  await ingest(1);
  await enter();
  await expect.poll(async () => (await native('preview')).visible).toBe(true);
  await preview.getByRole('button', { name: '查看来源: 推进条件', exact: true }).click();
  await expect.poll(async () => (await native('workspace')).visible).toBe(true);
  await expect(workspace.locator('.source-panel')).toContainText('合成发言 1');
  expect((await native('preview')).visible).toBe(false);
  await call(workspace, 'hide');
  await enter();
  await expect.poll(async () => (await native('preview')).visible).toBe(true);
  await leave(launcher);
  await preview.mouse.move(30, 30);
  await preview.getByRole('button', { name: '比较试用路径', exact: true }).click();
  await expect.poll(async () => (await native('workspace')).visible).toBe(true);
  await expect(workspace.locator('.ask-bar textarea')).toHaveValue('请比较不同试用路径。');
  const state = await call(workspace, 'snapshot');
  expect(state.meetings[0].segments).toHaveLength(1);
  expect(state.meetings[0].segments.filter((s: any) => s.kind === 'request')).toHaveLength(0);
});

test('preview follows display edges, stays readable at 200 percent, and clears ended content', async () => {
  await create();
  await ingest(1);
  for (const side of ['left', 'right']) {
    await call(launcher, 'hover', false);
    await call(preview, 'hover', false);
    await expect.poll(async () => (await native('preview')).visible).toBe(false);
    await app.evaluate(({ BrowserWindow, screen }, side) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('role=launcher'),
      )!;
      const a = screen.getPrimaryDisplay().workArea;
      w.setPosition(side === 'left' ? a.x + 12 : a.x + a.width - 56, a.y + a.height - 60);
    }, side);
    await enter();
    await expect.poll(async () => (await native('preview')).visible).toBe(true);
    const p = (await native('preview')).bounds,
      b = (await native('launcher')).bounds;
    const a = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    expect(p.x).toBeGreaterThanOrEqual(a.x);
    expect(p.y + p.height).toBeLessThanOrEqual(a.y + a.height);
    expect(side === 'left' ? p.x >= b.x + b.width : p.x + p.width <= b.x).toBe(true);
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('role=preview'))!
      .webContents.setZoomFactor(2),
  );
  await expect
    .poll(() => preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await expect(preview.getByRole('button', { name: '打开工作页', exact: true })).toBeVisible();
  const zoomPng = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('role=preview'),
    )!;
    return (await w.capturePage()).toPNG().toString('base64');
  });
  writeFileSync(test.info().outputPath('hover-canvas-200.png'), Buffer.from(zoomPng, 'base64'));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('role=preview'))!
      .webContents.setZoomFactor(1),
  );
  await command('end');
  await expect(preview.locator('.preview-canvas')).toHaveCount(0);
  await expect(preview.getByText('还没有正在进行的会议')).toBeVisible();
  await command('preferencesPatch', { uiLanguage: 'en' }, null);
  await expect(preview.getByText('No meeting in progress')).toBeVisible();
});


test('hover remains open over sandboxed generated SVG without giving the frame desktop access', async () => {
  includeMarkup = true;
  await create();
  await ingest(1);
  await enter();
  await expect.poll(async () => (await native('preview')).visible).toBe(true);
  await leave(launcher);
  const svg = preview.frameLocator('iframe.generated-frame').locator('svg');
  await svg.hover();
  await new Promise((r) => setTimeout(r, 450));
  expect((await native('preview')).visible).toBe(true);
  expect((await native('workspace')).visible).toBe(false);
  expect((await native('preview')).focused).toBe(false);
  expect(await svg.evaluate(() => typeof (window as any).meeting)).toBe('undefined');
  await leave(preview);
  await expect.poll(async () => (await native('preview')).visible).toBe(false);
});
