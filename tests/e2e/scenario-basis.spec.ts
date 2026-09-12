/** Actual Electron UI over isolated synthetic SQLite data; no audio/providers. */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteStore, defaults } from '../../src/service/store';
import { scenarioFixture } from '../fixtures/scenario-basis';

for (const locale of ['en', 'zh-CN'] as const) {
  test(
    'saved scenario basis: unrelated input, missing evidence and source correction · ' + locale,
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'meeting-scenario-basis-ui-'));
      const m = scenarioFixture();
      const missing = structuredClone(m.scenarios[0]);
      missing.id = 'missing-basis';
      missing.artifactId = 'missing-artifact';
      missing.formula.label = 'Synthetic missing basis';
      m.scenarios.push(missing);
      const store = new SQLiteStore(join(dir, 'meetings.sqlite'));
      store.save([m], {
        ...defaults,
        audio: { ...defaults.audio!, setupCompleted: true },
        uiLanguage: locale,
        uiLocale: locale,
      });
      store.close();
      let app: ElectronApplication | undefined;
      try {
        app = await electron.launch({
          ...(process.env.MEETING_BASIS_PACKAGE === '1'
            ? {
                executablePath: resolve(
                  'release/mac-arm64/Meeting Agent.app/Contents/MacOS/Meeting Agent',
                ),
                args: [],
              }
            : { args: [resolve('.')] }),
          env: {
            ...process.env,
            MEETING_DATA_DIR: dir,
            MEETING_SYSTEM_LOCALE: locale,
            OPENAI_API_KEY: '',
            MEETING_STT_API_KEY: '',
            MEETING_DEV_INPUTS: '1',
          },
        });
        let page: Page;
        await expect
          .poll(async () => {
            page = (await app!.windows()).find((p) => p.url().includes('role=workspace'))!;
            return !!page;
          })
          .toBe(true);
        await page!.waitForFunction(() => !!window.meeting);
        await page!.evaluate(() => window.meeting.call('open'));
        await expect(page!.getByText(m.title, { exact: true })).toBeVisible();
        await page!
          .locator('details')
          .filter({ has: page!.locator('.saved-record') })
          .locator('summary')
          .click();
        const saved = page!.locator('.saved-record').filter({ hasText: 'Synthetic cost:' });
        const unknown = page!
          .locator('.saved-record')
          .filter({ hasText: 'Synthetic missing basis:' });
        await expect(saved).toContainText('630 SGD');
        await expect(saved.getByTestId('scenario-basis-status')).toHaveCount(0);
        await expect(unknown.getByTestId('scenario-basis-status')).toHaveText(
          locale === 'en'
            ? 'Some original evidence is missing; saved values are preserved.'
            : '部分原始依据缺失，暂无法完整核对；保留原试算值。',
        );
        const command = async (type: string, payload: Record<string, unknown>) => {
          const result = await page!.evaluate(
            ({ meetingId, type, payload }) =>
              window.meeting.call('command', { id: crypto.randomUUID(), meetingId, type, payload }),
            { meetingId: m.id, type, payload },
          );
          expect(result.ok).toBe(true);
        };
        await command('ingest', {
          segmentId: 'unrelated-ui',
          kind: 'manual',
          text: 'Synthetic unrelated next meeting date.',
        });
        await expect
          .poll(
            async () =>
              (await page!.evaluate(async () => (await window.meeting.call('snapshot')).value))
                .meetings[0].inputVersion,
          )
          .toBe(m.inputVersion + 1);
        await expect(saved.getByTestId('scenario-basis-status')).toHaveCount(0);
        await command('correct', {
          segmentId: 'cost-source',
          baseRevision: 1,
          text: 'Synthetic corrected venue price.',
          speaker: null,
        });
        await expect(saved.getByTestId('scenario-basis-status')).toHaveText(
          locale === 'en'
            ? 'Baseline has changed; saved values are preserved.'
            : '基础条件已变化，保留原试算值。',
        );
        await expect(saved).toContainText('630 SGD');
        const snapshot = await page!.evaluate(
          async () => (await window.meeting.call('snapshot')).value,
        );
        expect(snapshot.meetings[0].scenarios[0]).toEqual(m.scenarios[0]);
        expect(snapshot.capabilities.modelConfigured).toBe(false);
      } finally {
        if (app && app.process().exitCode === null) {
          const closed = app.waitForEvent('close');
          await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
          await closed;
        }
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
}
