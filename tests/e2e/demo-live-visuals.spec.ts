/** Synthetic transport only: actual SSE provider, service, preflight and Electron UI. */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
let app: ElectronApplication, page: Page, server: Server;
let finishResponse: (() => void) | undefined;
const output = resolve(
  process.env.MEETING_DEMO_PACKAGE
    ? 'tests/results/demo-live-visuals-package'
    : 'tests/results/demo-live-visuals',
);
const snapshot = () => page.evaluate(async () => (await window.meeting.call('snapshot')).value);
async function command(type: string, payload: unknown, id: string | null) {
  const result = await page.evaluate(
    ({ type, payload, id }) =>
      window.meeting.call('command', {
        id: crypto.randomUUID(),
        meetingId: id,
        type,
        payload,
      }),
    { type, payload, id },
  );
  expect(result.ok).toBe(true);
  return result.value;
}
test.afterEach(async () => {
  finishResponse?.();
  if (app) {
    const pids = await app
      .evaluate(({ app }) => app.getAppMetrics().map((m) => m.pid))
      .catch(() => [] as number[]);
    for (const pid of new Set([app.process().pid!, ...pids]))
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    await app.close().catch(() => {});
  }
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});
test('demo: real drafts precede a growing mindmap, source inspection preserves only its block, flow and SVG remain readable', async () => {
  mkdirSync(output, { recursive: true });
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);
    const c = JSON.parse(request.messages.at(-1).content);
    const phase = c.inputVersion;
    const sources = c.segments.map((s: any) => ({ id: s.id, rev: s.rev }));
    const labels = ['讲清产品价值', '目标用户', '演示路径', '验证效果', '支持容量待确认'];
    const kinds = ['topic', 'option', 'task', 'task', 'constraint'];
    const symbols = ['goal', 'person', 'task', 'data', 'constraint'];
    const count = phase >= 2 ? 5 : 4;
    const objectIds = labels
      .slice(0, count)
      .map((_, i) => c.objects.find((o: any) => o.detail === 'synthetic-' + i)?.id ?? 'new_o' + i);
    const relIds = labels
      .slice(1, count)
      .map(
        (_, i) =>
          c.relations.find((r: any) => r.from === objectIds[i + 1] && r.to === objectIds[0])?.id ??
          'new_r' + i,
      );
    const common = { sources, objectIds, origin: 'agent_inferred', status: 'unverified' };
    const reply = {
      focus: '从产品目标梳理演示路径',
      changes: [phase >= 2 ? '补充支持容量这一成立条件' : '形成目标、用户和演示的关联'],
      objects: labels.slice(0, count).map((title, i) => ({
        id: objectIds[i],
        title,
        kind: kinds[i],
        detail: 'synthetic-' + i,
        origin: 'stated',
        status: i === 4 ? 'unknown' : 'unverified',
        sources,
        lifecycle: 'active',
      })),
      relations: labels.slice(1, count).map((_, i) => ({
        id: relIds[i],
        from: objectIds[i + 1],
        to: objectIds[0],
        kind: i === 3 ? 'conditions' : 'part_of',
        sources,
        origin: 'agent_inferred',
      })),
      action: 'create_artifact',
      rationale: 'Synthetic UI transport fixture; not a model-quality result',
      artifact: {
        id: 'live_visual',
        purposeKey: 'demo_scope',
        question: '怎样把产品价值讲清楚？',
        summary:
          phase >= 2
            ? '支持容量成为新条件，其他工作继续展开。'
            : '围绕目标，把用户、演示与验证连起来。',
        layout: 'stack',
        sources,
        objectIds,
        formulas: [],
        blocks: [
          {
            ...common,
            id: 'thinking_map',
            type: 'diagram',
            title: '讨论正在形成的结构',
            layout: phase >= 3 ? 'flow' : 'mindmap',
            nodes: labels.slice(0, count).map((label, i) => ({
              id: 'node' + i,
              objectId: objectIds[i],
              label,
              icon: symbols[i],
            })),
            edges: labels.slice(1, count).map((_, i) => ({
              from: 'node' + (i + 1),
              to: 'node0',
              relationId: relIds[i],
              label: i === 3 ? '成立条件' : '组成',
            })),
          },
          phase >= 3
            ? {
                ...common,
                id: 'notes',
                type: 'svg',
                title: '从讨论到可见变化',
                markup:
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 100"><rect x="8" y="10" width="174" height="72" rx="12" fill="#edf3fc"/><path d="M192 46 H226 L217 39 M226 46 L217 53" fill="none" stroke="#37619a" stroke-width="2"/><rect x="238" y="10" width="350" height="72" rx="12" fill="#eaf5f0"/><text x="26" y="53" font-size="17" fill="#243750">新的会议发言</text><text x="258" y="53" font-size="17" fill="#243750">更新关系、条件与行动</text></svg>',
              }
            : {
                ...common,
                id: 'notes',
                type: 'text',
                title: '最新变化',
                items: [phase >= 2 ? '支持容量仍需核实。' : '先明确目标与演示路径。'],
              },
        ],
      },
    };
    const full = JSON.stringify(reply),
      prefix = '{"focus":' + JSON.stringify(reply.focus) + ',';
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders();
    const send = (v: unknown) => res.write('data: ' + JSON.stringify(v) + '\n\n');
    send({ choices: [{ delta: { content: prefix } }] });
    finishResponse = () => {
      send({ choices: [{ delta: { content: full.slice(prefix.length) }, finish_reason: 'stop' }] });
      send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 10 } });
      res.end('data: [DONE]\n\n');
      finishResponse = undefined;
    };
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  app = await electron.launch({
    executablePath: process.env.MEETING_DEMO_PACKAGE || undefined,
    args: process.env.MEETING_DEMO_PACKAGE ? [] : [resolve('.')],
    env: {
      ...process.env,
      MEETING_DEV_INPUTS: '1',
      MEETING_DATA_DIR: mkdtempSync(join(tmpdir(), 'meeting-demo-visuals-')),
      MEETING_SYSTEM_LOCALE: 'zh-CN',
      OPENAI_API_KEY: 'synthetic-only',
      MEETING_API_BASE: `http://127.0.0.1:${(server.address() as any).port}`,
      MEETING_MIN_BATCH_MS: '100',
      MEETING_STT_API_KEY: '',
      MEETING_RESPONSE_FORMAT: 'json_schema',
    },
  });
  await expect
    .poll(async () => {
      page = (await app.windows()).find((p) => p.url().includes('role=workspace'))!;
      return !!page;
    })
    .toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('role=workspace'),
    );
    w?.setSize(1488, 1056);
    w?.show();
  });
  await page.waitForFunction(() => !!window.meeting);
  await page.getByText('开发测试工具', { exact: true }).click();
  await page.getByRole('button', { name: '开发测试输入', exact: true }).click();
  await page.getByRole('dialog').locator('input').first().fill('实时表达 · 合成验证');
  await page.getByRole('dialog').locator('select').last().selectOption('zh-CN');
  await page.getByRole('dialog').getByRole('button', { name: '开始会议', exact: true }).click();
  const id = (await snapshot()).meetings[0].id;
  await command(
    'ingest',
    { text: '我们要讲清产品价值，分别展开目标用户、演示路径与效果验证。', kind: 'manual' },
    id,
  );
  await expect(page.locator('.live-model-draft')).toContainText('从产品目标梳理演示路径');
  expect((await snapshot()).meetings[0].artifacts).toHaveLength(0);
  await page.screenshot({ path: join(output, '01-live-draft.png') });
  finishResponse!();
  await expect(page.locator('.relationship-node')).toHaveCount(4);
  await expect(page.locator('[data-icon="goal"] .node-symbol svg')).toBeVisible();
  await expect(page.locator('.graph-caption')).toContainText('思路图');
  const positions = await page.locator('.relationship-node').evaluateAll((nodes) =>
    nodes.map((n) => ({
      id: n.getAttribute('data-node-id'),
      left: (n as HTMLElement).style.left,
      top: (n as HTMLElement).style.top,
    })),
  );
  await page.screenshot({ path: join(output, '02-mindmap.png') });
  await page.locator('.semantic-graph').screenshot({ path: join(output, '02-mindmap-detail.png') });
  await page.locator('[data-node-id="node0"]').click();
  await expect(page.locator('.source-panel')).toBeVisible();
  await command('ingest', { text: '还要补上支持容量这个前提，目前尚未确认。', kind: 'manual' }, id);
  await expect(page.locator('.live-model-draft')).toBeVisible();
  finishResponse!();
  await expect.poll(async () => (await snapshot()).meetings[0].artifacts.length).toBe(2);
  await expect(page.locator('[data-block-id="notes"]')).toContainText('支持容量仍需核实');
  await expect(page.locator('.relationship-node')).toHaveCount(4);
  await expect(page.locator('.reading-update')).toBeVisible();
  await page.locator('.reading-update button').click();
  await expect(page.locator('.relationship-node')).toHaveCount(5);
  await expect(page.locator('.graph-node-edited')).not.toHaveCount(0);
  const next = await page.locator('.relationship-node').evaluateAll((nodes) =>
    nodes.map((n) => ({
      id: n.getAttribute('data-node-id'),
      left: (n as HTMLElement).style.left,
      top: (n as HTMLElement).style.top,
    })),
  );
  expect(next.slice(0, 4)).toEqual(positions);
  await page.screenshot({ path: join(output, '03-growing-map.png') });
  await page.locator('.source-panel').getByRole('button', { name: '关闭', exact: true }).click();
  await command(
    'ingest',
    { text: '按依赖顺序展现，并用简洁 SVG 说明从发言到画面更新。', kind: 'manual' },
    id,
  );
  await expect(page.locator('.live-model-draft')).toBeVisible();
  finishResponse!();
  await expect(page.locator('.graph-caption')).toContainText('依赖与流程');
  await expect(page.locator('iframe.generated-frame')).toBeVisible();
  await expect(
    page.frameLocator('iframe.generated-frame').getByText('更新关系、条件与行动'),
  ).toBeVisible();
  // Capture the settled layout, not the middle of a deliberate carrier transition.
  await expect
    .poll(() =>
      page.locator('.relationship-node').evaluateAll((nodes) =>
        nodes.every((n) => {
          const e = n as HTMLElement,
            c = getComputedStyle(e);
          return (
            Math.abs(parseFloat(c.left) - parseFloat(e.style.left)) < 1 &&
            Math.abs(parseFloat(c.top) - parseFloat(e.style.top)) < 1
          );
        }),
      ),
    )
    .toBe(true);
  await page.screenshot({ path: join(output, '04-flow-svg.png') });
  await page.locator('.semantic-graph').screenshot({ path: join(output, '04-flow-detail.png') });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await expect(page.locator('.relationship-canvas')).toBeVisible();
  const checks = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= innerWidth + 1,
    labelsFit: [...document.querySelectorAll<HTMLElement>('.relationship-node')].every(
      (e) => e.scrollHeight <= e.clientHeight + 1,
    ),
  }));
  expect(checks).toEqual({ fits: true, labelsFit: true });
  await page.screenshot({ path: join(output, '05-narrow-flow.png') });
  writeFileSync(
    join(output, 'checks.json'),
    JSON.stringify(
      {
        input: 'synthetic',
        provider: 'SSE transport double',
        checks,
        positionsPreserved: true,
        draftBeforeCommit: true,
      },
      null,
      2,
    ),
  );
});
