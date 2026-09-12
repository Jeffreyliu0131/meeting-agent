# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scenario-basis.spec.ts >> saved scenario basis: unrelated input, missing evidence and source correction · zh-CN
- Location: tests/e2e/scenario-basis.spec.ts:16:3

# Error details

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('details').filter({ has: locator('.saved-record') }).locator('summary')
    - locator resolved to <summary>已保存的个人试算 (2)</summary>
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
    58 × waiting for element to be visible, enabled and stable
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
  27  |       store.save([m], {
  28  |         ...defaults,
  29  |         audio: { ...defaults.audio, setupCompleted: true },
  30  |         uiLanguage: locale,
  31  |         uiLocale: locale,
  32  |       });
  33  |       store.close();
  34  |       let app: ElectronApplication | undefined;
  35  |       try {
  36  |         app = await electron.launch({
  37  |           ...(process.env.MEETING_BASIS_PACKAGE === '1'
  38  |             ? {
  39  |                 executablePath: resolve(
  40  |                   'release/mac-arm64/Meeting Agent.app/Contents/MacOS/Meeting Agent',
  41  |                 ),
  42  |                 args: [],
  43  |               }
  44  |             : { args: [resolve('.')] }),
  45  |           env: {
  46  |             ...process.env,
  47  |             MEETING_DATA_DIR: dir,
  48  |             MEETING_SYSTEM_LOCALE: locale,
  49  |             OPENAI_API_KEY: '',
  50  |             MEETING_STT_API_KEY: '',
  51  |             MEETING_DEV_INPUTS: '1',
  52  |           },
  53  |         });
  54  |         let page: Page;
  55  |         await expect
  56  |           .poll(async () => {
  57  |             page = (await app!.windows()).find((p) => p.url().includes('role=workspace'))!;
  58  |             return !!page;
  59  |           })
  60  |           .toBe(true);
  61  |         await page!.waitForFunction(() => !!window.meeting);
  62  |         await page!.evaluate(() => window.meeting.call('open'));
  63  |         await expect(page!.getByText(m.title, { exact: true })).toBeVisible();
  64  |         await page!
  65  |           .locator('details')
  66  |           .filter({ has: page!.locator('.saved-record') })
  67  |           .locator('summary')
> 68  |           .click();
      |            ^ TimeoutError: locator.click: Timeout 30000ms exceeded.
  69  |         const saved = page!.locator('.saved-record').filter({ hasText: 'Synthetic cost:' });
  70  |         const unknown = page!
  71  |           .locator('.saved-record')
  72  |           .filter({ hasText: 'Synthetic missing basis:' });
  73  |         await expect(saved).toContainText('630 SGD');
  74  |         await expect(saved.getByTestId('scenario-basis-status')).toHaveCount(0);
  75  |         await expect(unknown.getByTestId('scenario-basis-status')).toHaveText(
  76  |           locale === 'en'
  77  |             ? 'Some original evidence is missing; saved values are preserved.'
  78  |             : '部分原始依据缺失，暂无法完整核对；保留原试算值。',
  79  |         );
  80  |         const command = async (type: string, payload: Record<string, unknown>) => {
  81  |           const result = await page!.evaluate(
  82  |             ({ meetingId, type, payload }) =>
  83  |               window.meeting.call('command', { id: crypto.randomUUID(), meetingId, type, payload }),
  84  |             { meetingId: m.id, type, payload },
  85  |           );
  86  |           expect(result.ok).toBe(true);
  87  |         };
  88  |         await command('ingest', {
  89  |           segmentId: 'unrelated-ui',
  90  |           kind: 'manual',
  91  |           text: 'Synthetic unrelated next meeting date.',
  92  |         });
  93  |         await expect
  94  |           .poll(
  95  |             async () =>
  96  |               (await page!.evaluate(async () => (await window.meeting.call('snapshot')).value))
  97  |                 .meetings[0].inputVersion,
  98  |           )
  99  |           .toBe(m.inputVersion + 1);
  100 |         await expect(saved.getByTestId('scenario-basis-status')).toHaveCount(0);
  101 |         await command('correct', {
  102 |           segmentId: 'cost-source',
  103 |           baseRevision: 1,
  104 |           text: 'Synthetic corrected venue price.',
  105 |           speaker: null,
  106 |         });
  107 |         await expect(saved.getByTestId('scenario-basis-status')).toHaveText(
  108 |           locale === 'en'
  109 |             ? 'Baseline has changed; saved values are preserved.'
  110 |             : '基础条件已变化，保留原试算值。',
  111 |         );
  112 |         await expect(saved).toContainText('630 SGD');
  113 |         const snapshot = await page!.evaluate(
  114 |           async () => (await window.meeting.call('snapshot')).value,
  115 |         );
  116 |         expect(snapshot.meetings[0].scenarios[0]).toEqual(m.scenarios[0]);
  117 |         expect(snapshot.capabilities.modelConfigured).toBe(false);
  118 |       } finally {
  119 |         if (app && app.process().exitCode === null) {
  120 |           const closed = app.waitForEvent('close');
  121 |           await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  122 |           await closed;
  123 |         }
  124 |         rmSync(dir, { recursive: true, force: true });
  125 |       }
  126 |     },
  127 |   );
  128 | }
  129 | 
```