import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
let app: ElectronApplication, page: Page, dataDir: string;
async function launch() {
  app = await electron.launch({
    args: [resolve('.')],
    env: {
      ...process.env,
      MEETING_DEV_INPUTS: '1',
      MEETING_SYSTEM_LOCALE: 'en',
      MEETING_DATA_DIR: dataDir,
      OPENAI_API_KEY: '',
      MEETING_STT_API_KEY: '',
    },
  });
  await expect
    .poll(async () => {
      page = (await app.windows()).find((p) => p.url().includes('role=workspace'))!;
      return !!page;
    })
    .toBe(true);
  page.on('pageerror', (e) => console.log('RENDERER ERROR', e.message));
  await page.waitForFunction(() => !!window.meeting);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('role=workspace'),
    );
    w?.show();
    w?.focus();
  });
  await expect(
    page.getByRole('heading', { name: 'A little clarity, while the conversation moves.' }),
  ).toBeVisible();
}
test.beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'meeting-desktop-'));
  await launch();
});
test.afterEach(async () => {
  await app
    ?.evaluate(({ app }) => {
      app.exit(0);
    })
    .catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
});
test('real Electron: event, manual original source, honest missing model, correction, UI locale, end and restore', async () => {
  await page.getByText('Development tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Development input', exact: true }).click();
  await page.getByLabel('Meeting title', { exact: true }).fill('Local input verification');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Start meeting', exact: true })
    .click();
  await expect(page.getByText('There is no generated work yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Add a transcript excerpt' }).click();
  await page
    .getByRole('textbox', { name: 'Original words…' })
    .fill('只有支持团队确认容量，才邀请客户参加。日期尚未确定。');
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await expect(
    page.getByText('Model not configured. Add a credential and restart, then retry.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'View sources' }).first().click();
  await expect(
    page.getByText('只有支持团队确认容量，才邀请客户参加。日期尚未确定。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Speaker unconfirmed')).toBeVisible();
  await page.getByRole('button', { name: 'Correct source', exact: true }).click();
  await page
    .getByLabel('Original words', { exact: true })
    .fill('Only invite customers if support confirms capacity. No date is agreed.');
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(
    page.getByText('Only invite customers if support confirms capacity. No date is agreed.', {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('dialog', { name: 'View sources' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('button', { name: '结束会议' })).toBeVisible();
  await page.getByRole('button', { name: '结束会议' }).click();
  await expect(page.getByText('会议已结束', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'tests/results/e2e-artifacts/ended-zh.png', fullPage: true });
  const state = await page.evaluate(async () => {
    const r = await window.meeting.call('snapshot');
    return r.value;
  });
  expect(state.meetings[0].segments).toHaveLength(2);
  expect(state.meetings[0].artifacts).toHaveLength(0);
  expect(state.meetings[0].segments[0].text).toContain('只有');
  expect(state.meetings[0].status).toBe('ended');
  await app.evaluate(({ app }) => app.exit(0));
  app = await electron.launch({
    args: [resolve('.')],
    env: {
      ...process.env,
      MEETING_DEV_INPUTS: '1',
      MEETING_SYSTEM_LOCALE: 'en',
      MEETING_DATA_DIR: dataDir,
      OPENAI_API_KEY: '',
    },
  });
  await expect
    .poll(async () => {
      const windows = await app.windows();
      for (const p of windows) {
        if (p.url().includes('role=workspace')) {
          page = p;
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  await page.waitForFunction(() => !!window.meeting);
  await expect
    .poll(async () => {
      const s = await page.evaluate(async () => await window.meeting.call('snapshot'));
      return s?.value?.meetings?.[0]?.capture;
    })
    .toBe('stopped');
});
test('native launcher opens one workspace; hiding does not stop the event; hover uses real windows', async () => {
  await page.getByText('Development tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Development input', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start meeting' }).click();
  await expect(page.getByRole('dialog', { name: 'Start meeting' })).toBeHidden();
  const launcher = (await app.windows()).find((p) => p.url().includes('role=launcher'))!;
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('role=workspace'))
          ?.isVisible(),
      ),
    )
    .toBe(false);
  await launcher.getByRole('button').hover();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('role=preview'))
          ?.isVisible(),
      ),
    )
    .toBe(true);
  await launcher.getByRole('button').click();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('role=workspace'))
          ?.isVisible(),
      ),
    )
    .toBe(true);
  await launcher.getByRole('button').click();
  expect(
    await app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().filter((w) =>
          w.webContents.getURL().includes('role=workspace'),
        ).length,
    ),
  ).toBe(1);
  const result = await page.evaluate(() => window.meeting.call('snapshot'));
  expect(result.value.meetings[0].status).toBe('active');
  expect(result.value.meetings[0].capture).toBe('idle');
});
test('UI cannot impersonate audio adapter; no frame gets filesystem or arbitrary IPC; responsive shell', async () => {
  expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
  expect(await page.evaluate(() => typeof (window as any).process)).toBe('undefined');
  const denied = await page.evaluate(() => window.meeting.call('audio', { wav: [] }));
  expect(denied.ok).toBe(false);
  const spoof = await page.evaluate(() =>
    window.meeting.call('command', {
      id: crypto.randomUUID(),
      meetingId: null,
      type: 'captureReady',
      payload: { epoch: 1 },
    }),
  );
  expect(spoof.error).toBe('PERMISSION_DENIED');
  for (const size of [
    { width: 1440, height: 1024 },
    { width: 1024, height: 768 },
    { width: 800, height: 600 },
  ]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('role=workspace'))
        ?.setSize(size.width, size.height);
    }, size);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({ path: `tests/results/e2e-artifacts/library-${size.width}.png` });
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('role=workspace'))
      ?.webContents.setZoomFactor(2),
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});
