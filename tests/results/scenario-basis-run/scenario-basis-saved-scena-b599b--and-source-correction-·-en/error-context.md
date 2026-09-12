# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scenario-basis.spec.ts >> saved scenario basis: unrelated input, missing evidence and source correction · en
- Location: tests/e2e/scenario-basis.spec.ts:16:3

# Error details

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('details').filter({ has: locator('.saved-record') }).locator('summary')
    - locator resolved to <summary>Saved personal scenarios (2)</summary>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="modal-backdrop">…</div> intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="modal-backdrop">…</div> intercepts pointer events
    - retrying click action
      - waiting 100ms
    57 × waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div class="modal-backdrop">…</div> intercepts pointer events
     - retrying click action
       - waiting 500ms

```

# Test source

```ts
  1   | /** Actual Electron UI over isolated synthetic SQLite data; no audio/providers. */
  2   | import {
  3   |   test,
  4   |   expect,
  5   |   _electron as electron,
  6   |   type ElectronApplication,
  7   |   type Page,
  8   | } from '@playwright/test';
  9   | import { mkdtempSync, rmSync } from 'node:fs';
  10  | import { join, resolve } from 'node:path';
  11  | import { tmpdir } from 'node:os';
  12  | import { SQLiteStore, defaults } from '../../src/service/store';
  13  | import { scenarioFixture } from '../fixtures/scenario-basis';
  14  | 
  15  | for (const locale of ['en', 'zh-CN'] as const) {
  16  |   test(
  17  |     'saved scenario basis: unrelated input, missing evidence and source correction · ' + locale,
  18  |     async () => {
  19  |       const dir = mkdtempSync(join(tmpdir(), 'meeting-scenario-basis-ui-'));
  20  |       const m = scenarioFixture();
  21  |       const missing = structuredClone(m.scenarios[0]);
  22  |       missing.id = 'missing-basis';
  23  |       missing.artifactId = 'missing-artifact';
  24  |       missing.formula.label = 'Synthetic missing basis';
  25  |       m.scenarios.push(missing);
  26  |       const store = new SQLiteStore(join(dir, 'meetings.sqlite'));
  27  |       store.save([m], { ...defaults, uiLanguage: locale, uiLocale: locale });
  28  |       store.close();
  29  |       let app: ElectronApplication | undefined;
  30  |       try {
  31  |         app = await electron.launch({
  32  |           ...(process.env.MEETING_BASIS_PACKAGE === '1'
  33  |             ? {
  34  |                 executablePath: resolve(
  35  |                   'release/mac-arm64/Meeting Agent.app/Contents/MacOS/Meeting Agent',
  36  |                 ),
  37  |                 args: [],
  38  |               }
  39  |             : { args: [resolve('.')] }),
  40  |           env: {
  41  |             ...process.env,
  42  |             MEETING_DATA_DIR: dir,
  43  |             MEETING_SYSTEM_LOCALE: locale,
  44  |             OPENAI_API_KEY: '',
  45  |             MEETING_STT_API_KEY: '',
  46  |             MEETING_DEV_INPUTS: '1',
  47  |           },
  48  |         });
  49  |         let page: Page;
  50  |         await expect
  51  |           .poll(async () => {
  52  |             page = (await app!.windows()).find((p) => p.url().includes('role=workspace'))!;
  53  |             return !!page;
  54  |           })
  55  |           .toBe(true);
  56  |         await page!.waitForFunction(() => !!window.meeting);
  57  |         await page!.evaluate(() => window.meeting.call('open'));
  58  |         await page!.getByText(m.title, { exact: true }).click();
  59  |         await page!
  60  |           .locator('details')
  61  |           .filter({ has: page!.locator('.saved-record') })
  62  |           .locator('summary')
> 63  |           .click();
      |            ^ TimeoutError: locator.click: Timeout 30000ms exceeded.
  64  |         const saved = page!.locator('.saved-record').filter({ hasText: 'Synthetic cost:' });
  65  |         const unknown = page!
  66  |           .locator('.saved-record')
  67  |           .filter({ hasText: 'Synthetic missing basis:' });
  68  |         await expect(saved).toContainText('630 SGD');
  69  |         await expect(saved.getByTestId('scenario-basis-status')).toHaveCount(0);
  70  |         await expect(unknown.getByTestId('scenario-basis-status')).toHaveText(
  71  |           locale === 'en'
  72  |             ? 'Some original evidence is missing; saved values are preserved.'
  73  |             : '部分原始依据缺失，暂无法完整核对；保留原试算值。',
  74  |         );
  75  |         const command = async (type: string, payload: Record<string, unknown>) => {
  76  |           const result = await page!.evaluate(
  77  |             ({ meetingId, type, payload }) =>
  78  |               window.meeting.call('command', { id: crypto.randomUUID(), meetingId, type, payload }),
  79  |             { meetingId: m.id, type, payload },
  80  |           );
  81  |           expect(result.ok).toBe(true);
  82  |         };
  83  |         await command('ingest', {
  84  |           segmentId: 'unrelated-ui',
  85  |           kind: 'manual',
  86  |           text: 'Synthetic unrelated next meeting date.',
  87  |         });
  88  |         await expect
  89  |           .poll(
  90  |             async () =>
  91  |               (await page!.evaluate(async () => (await window.meeting.call('snapshot')).value))
  92  |                 .meetings[0].inputVersion,
  93  |           )
  94  |           .toBe(m.inputVersion + 1);
  95  |         await expect(saved.getByTestId('scenario-basis-status')).toHaveCount(0);
  96  |         await command('correct', {
  97  |           segmentId: 'cost-source',
  98  |           baseRevision: 1,
  99  |           text: 'Synthetic corrected venue price.',
  100 |           speaker: null,
  101 |         });
  102 |         await expect(saved.getByTestId('scenario-basis-status')).toHaveText(
  103 |           locale === 'en'
  104 |             ? 'Baseline has changed; saved values are preserved.'
  105 |             : '基础条件已变化，保留原试算值。',
  106 |         );
  107 |         await expect(saved).toContainText('630 SGD');
  108 |         const snapshot = await page!.evaluate(
  109 |           async () => (await window.meeting.call('snapshot')).value,
  110 |         );
  111 |         expect(snapshot.meetings[0].scenarios[0]).toEqual(m.scenarios[0]);
  112 |         expect(snapshot.capabilities.modelConfigured).toBe(false);
  113 |       } finally {
  114 |         if (app && app.process().exitCode === null) {
  115 |           const closed = app.waitForEvent('close');
  116 |           await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  117 |           await closed;
  118 |         }
  119 |         rmSync(dir, { recursive: true, force: true });
  120 |       }
  121 |     },
  122 |   );
  123 | }
  124 | 
```